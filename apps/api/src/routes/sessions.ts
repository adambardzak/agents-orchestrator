import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import * as fs from 'node:fs/promises';
import * as nodePath from 'node:path';
import type { AgentTask } from '@agent-orchestrator/shared';
import { ORCHESTRATOR_AGENT } from '../agents/definitions.js';
import { env } from '../config/env.js';
import { MODEL_ROUTING } from '../config/models.js';
import { mapSession, mapTask } from '../db/mappers.js';
import { createBranchFrom, getDiff, mergeBranch } from '../services/git/workspace-git.js';

const createSessionSchema = z.object({
  projectId: z.string().uuid(),
  contextType: z.enum(['personal', 'cez']),
  userPrompt: z.string().min(1).max(10_000),
  budgetCapUsd: z.number().positive().default(5),
});

export async function sessionRoutes(fastify: FastifyInstance): Promise<void> {
  // ── POST /api/sessions — start a new orchestration session ──────────────────
  fastify.post('/api/sessions', async (request, reply) => {
    const body = createSessionSchema.parse(request.body);
    const githubToken = (request.headers['x-github-token'] as string) ?? env.GITHUB_TOKEN ?? '';

    if (!githubToken) {
      return reply.status(401).send({
        error: 'GitHub token required (x-github-token header or GITHUB_TOKEN env)',
      });
    }

    const sessionId = uuid();

    // Create session row
    await fastify.pg.query(
      `INSERT INTO sessions (id, project_id, context_type, user_prompt, budget_cap_usd)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, body.projectId, body.contextType, body.userPrompt, body.budgetCapUsd],
    );

    // Per-session workspace isolation:
    // Layout: <projectRoot>/sessions/<sessionId>/
    // Each session gets a fresh, isolated workspace so concurrent sessions of
    // the same project never overwrite each other's files.
    try {
      const { rows: projectRows } = await fastify.pg.query<{ workspace_path: string | null }>(
        'SELECT workspace_path FROM projects WHERE id = $1',
        [body.projectId],
      );
      const projectRoot = projectRows[0]?.workspace_path
        ?? nodePath.join(env.WORKSPACES_ROOT, body.projectId);
      const sessionWorkspace = nodePath.join(projectRoot, 'sessions', sessionId);
      await fs.mkdir(sessionWorkspace, { recursive: true });
      fastify.log.info({ sessionId, sessionWorkspace }, 'Session workspace created');
    } catch (err) {
      fastify.log.warn(
        { sessionId, error: (err as Error).message },
        'Failed to pre-create session workspace (will be lazily created by worker)',
      );
    }

    // Create the orchestrator task row
    const orchestratorTaskId = uuid();
    const orchestratorModel = MODEL_ROUTING[ORCHESTRATOR_AGENT.defaultComplexity];

    await fastify.pg.query(
      `INSERT INTO agent_tasks
         (id, session_id, project_id, context_type, agent_type, agent_id, prompt, status, complexity, model, max_steps)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10)`,
      [
        orchestratorTaskId,
        sessionId,
        body.projectId,
        body.contextType,
        'orchestrator',
        ORCHESTRATOR_AGENT.id,
        body.userPrompt,
        ORCHESTRATOR_AGENT.defaultComplexity,
        orchestratorModel,
        ORCHESTRATOR_AGENT.maxSteps,
      ],
    );

    const orchestratorTask: AgentTask = {
      id: orchestratorTaskId,
      sessionId,
      projectId: body.projectId,
      contextType: body.contextType,
      agentType: 'orchestrator',
      agentId: ORCHESTRATOR_AGENT.id,
      prompt: body.userPrompt,
      status: 'pending',
      complexity: ORCHESTRATOR_AGENT.defaultComplexity,
      model: orchestratorModel,
      currentStep: 0,
      maxSteps: ORCHESTRATOR_AGENT.maxSteps,
      contextTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      dependsOn: [],
      createdAt: new Date(),
    };

    // Enqueue orchestrator — it will plan and spawn subtasks when it completes
    await fastify.taskQueue.enqueueTask(orchestratorTask, githubToken);

    // Re-read session from DB to return the canonical row
    const { rows: [sessionRow] } = await fastify.pg.query(
      'SELECT * FROM sessions WHERE id = $1',
      [sessionId],
    );

    return reply.status(201).send({
      session: mapSession(sessionRow as Record<string, unknown>),
      tasks: [orchestratorTask],
    });
  });

  // ── GET /api/sessions — list recent sessions ────────────────────────────────
  // Optional filters:
  //   - projectId : restrict to one project
  //   - kind      : 'main' (default for sidebar root list) or 'branch'
  //   - parent    : list only branch chats whose parent_session_id matches
  fastify.get<{ Querystring: { limit?: string; projectId?: string; kind?: string; parent?: string } }>(
    '/api/sessions',
    async (request, reply) => {
      const limit = Math.min(parseInt(request.query.limit ?? '30', 10), 100);
      const { projectId, kind, parent } = request.query;

      const conds: string[] = [];
      const params: unknown[] = [limit];
      if (projectId) { conds.push(`project_id = $${params.length + 1}`); params.push(projectId); }
      if (kind)      { conds.push(`kind       = $${params.length + 1}`); params.push(kind); }
      if (parent)    { conds.push(`parent_session_id = $${params.length + 1}`); params.push(parent); }

      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const { rows } = await fastify.pg.query(
        `SELECT * FROM sessions ${where}
          ORDER BY created_at DESC
          LIMIT $1`,
        params,
      );

      return { sessions: rows.map((r) => mapSession(r as Record<string, unknown>)) };
    },
  );

  // ── GET /api/sessions/:id ────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params;

    const { rows: [sessionRow] } = await fastify.pg.query(
      `SELECT s.*, p.workspace_path AS project_workspace_path, p.name AS project_name
         FROM sessions s
         LEFT JOIN projects p ON p.id = s.project_id
         WHERE s.id = $1`,
      [id],
    );

    if (!sessionRow) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    const { rows: taskRows } = await fastify.pg.query(
      'SELECT * FROM agent_tasks WHERE session_id = $1 ORDER BY created_at',
      [id],
    );

    const row = sessionRow as Record<string, unknown>;
    return {
      session: {
        ...mapSession(row),
        projectWorkspacePath: (row['project_workspace_path'] as string | null) ?? null,
        projectName:          (row['project_name']           as string | null) ?? null,
      },
      tasks: taskRows.map((r) => mapTask(r as Record<string, unknown>)),
      codeServerUrl: env.CODE_SERVER_URL,
    };
  });

  // ── GET /api/sessions/:id/events ─────────────────────────────────────────────
  fastify.get<{ Params: { id: string }; Querystring: { taskId?: string; limit?: string } }>(
    '/api/sessions/:id/events',
    async (request, reply) => {
      const { id } = request.params;
      const { taskId, limit = '200' } = request.query;

      let query: string;
      let params: unknown[];

      if (taskId) {
        query = `SELECT * FROM agent_events
                 WHERE session_id = $1 AND task_id = $2
                 ORDER BY created_at DESC LIMIT $3`;
        params = [id, taskId, parseInt(limit, 10)];
      } else {
        query = `SELECT * FROM agent_events
                 WHERE session_id = $1
                 ORDER BY created_at DESC LIMIT $2`;
        params = [id, parseInt(limit, 10)];
      }

      const { rows } = await fastify.pg.query(query, params);
      return { events: rows.reverse() };
    },
  );

  // ── POST /api/sessions/:id/clarify — answer orchestrator questions ───────────
  // The user answers the clarification questions; we re-spawn the orchestrator
  // with the original prompt augmented by the answers, and close the old task.
  fastify.post<{ Params: { id: string } }>(
    '/api/sessions/:id/clarify',
    async (request, reply) => {
      const { id: sessionId } = request.params;
      const githubToken = (request.headers['x-github-token'] as string) ?? env.GITHUB_TOKEN ?? '';

      const body = z.object({
        answers: z.record(z.string(), z.string()).or(z.array(z.string())),
      }).parse(request.body);

      // Convert answers array/object to readable text
      const answersText = Array.isArray(body.answers)
        ? body.answers.map((a, i) => `Answer ${i + 1}: ${a}`).join('\n')
        : Object.entries(body.answers).map(([q, a]) => `Q: ${q}\nA: ${a}`).join('\n\n');

      // Load session + find orchestrator task that produced the clarification
      const { rows: [sessionRow] } = await fastify.pg.query(
        'SELECT * FROM sessions WHERE id = $1',
        [sessionId],
      );
      if (!sessionRow) return reply.status(404).send({ error: 'Session not found' });

      const { rows: [orchRow] } = await fastify.pg.query(
        `SELECT * FROM agent_tasks
         WHERE session_id = $1 AND agent_type = 'orchestrator'
         ORDER BY created_at DESC LIMIT 1`,
        [sessionId],
      );
      if (!orchRow) return reply.status(404).send({ error: 'Orchestrator task not found' });

      const originalPrompt: string = (orchRow as Record<string, unknown>)['prompt'] as string;

      // Build an augmented prompt that includes user answers
      const augmentedPrompt = `${originalPrompt}

---
CLARIFICATION ANSWERS PROVIDED BY USER:
${answersText}

Please now produce the execution plan (no further clarification needed).`;

      // Cancel any running tasks that are stuck (e.g. question tool waiting)
      // before spawning the new orchestrator task with the user's answers.
      const { rows: runningRows } = await fastify.pg.query<{ id: string }>(
        `SELECT id FROM agent_tasks
         WHERE session_id = $1 AND status IN ('running', 'planning', 'pending')`,
        [sessionId],
      );
      for (const r of runningRows) {
        fastify.processManager.stopAgent(r.id);
        await fastify.pg.query(
          `UPDATE agent_tasks SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
          [r.id],
        );
        fastify.eventBus.publish('agent:status', sessionId, {
          taskId: r.id,
          status: 'cancelled',
          currentStep: 0,
          maxSteps: 0,
        });
      }

      // Spawn a new orchestrator task with the augmented prompt
      const newTaskId = uuid();
      const orchestratorModel = MODEL_ROUTING[ORCHESTRATOR_AGENT.defaultComplexity];

      await fastify.pg.query(
        `INSERT INTO agent_tasks
           (id, session_id, project_id, context_type, agent_type, agent_id, prompt, status, complexity, model, max_steps)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10)`,
        [
          newTaskId,
          sessionId,
          (sessionRow as Record<string, unknown>)['project_id'],
          (sessionRow as Record<string, unknown>)['context_type'],
          'orchestrator',
          ORCHESTRATOR_AGENT.id,
          augmentedPrompt,
          ORCHESTRATOR_AGENT.defaultComplexity,
          orchestratorModel,
          ORCHESTRATOR_AGENT.maxSteps,
        ],
      );

      const newTask: AgentTask = {
        id: newTaskId,
        sessionId,
        projectId: (sessionRow as Record<string, unknown>)['project_id'] as string,
        contextType: (sessionRow as Record<string, unknown>)['context_type'] as 'personal' | 'cez',
        agentType: 'orchestrator',
        agentId: ORCHESTRATOR_AGENT.id,
        prompt: augmentedPrompt,
        status: 'pending',
        complexity: ORCHESTRATOR_AGENT.defaultComplexity,
        model: orchestratorModel,
        currentStep: 0,
        maxSteps: ORCHESTRATOR_AGENT.maxSteps,
        contextTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        dependsOn: [],
        createdAt: new Date(),
      };

      await fastify.taskQueue.enqueueTask(newTask, githubToken);

      return reply.status(201).send({ task: newTask });
    },
  );

  // ── POST /api/sessions/:id/branch ────────────────────────────────────────────
  // Fork a focused "branch chat" off an existing session. Creates a new
  // session row (kind='branch') linked to the parent, allocates a fresh git
  // branch in the project workspace, and returns the new session — the FE
  // navigates the chat to it. The branch chat shares the same project +
  // contextType as its parent and inherits the parent's budget cap.
  //
  // Optional `name` becomes the sidebar label and seeds the git branch slug.
  // Optional `scopeGlobs` are injected as soft scope into every agent's
  // system prompt for this branch (no workspace filtering — the agent can
  // still read other files when needed).
  fastify.post<{ Params: { id: string } }>(
    '/api/sessions/:id/branch',
    async (request, reply) => {
      const parentId = request.params.id;
      const body = z.object({
        name:        z.string().min(1).max(120).optional(),
        scopeGlobs:  z.array(z.string().min(1).max(200)).max(50).default([]),
        userPrompt:  z.string().min(1).max(10_000).optional(),
      }).parse(request.body);

      // Load parent session to inherit project + context.
      const { rows: [parentRow] } = await fastify.pg.query(
        'SELECT * FROM sessions WHERE id = $1',
        [parentId],
      );
      if (!parentRow) return reply.status(404).send({ error: 'Parent session not found' });
      const parent = mapSession(parentRow as Record<string, unknown>);

      // Branch chats can only fork off main chats for now — keeps the tree
      // shallow (1 level) and avoids fork-of-fork merge complexity. Easy to
      // relax later by changing this check to `parent.kind === 'branch' &&
      // parent.parentSessionId` to walk up.
      if (parent.kind !== 'main') {
        return reply.status(400).send({
          error: 'Branch chats can only be forked from main chats (no nested branches yet)',
        });
      }

      const newSessionId = uuid();
      const slug = (body.name ?? 'work')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 40) || 'work';
      const branchName = `agent/branch-${slug}-${newSessionId.slice(0, 8)}`;

      await fastify.pg.query(
        `INSERT INTO sessions
           (id, project_id, context_type, user_prompt, budget_cap_usd,
            kind, parent_session_id, name, scope_globs, branch_name)
         VALUES ($1, $2, $3, $4, $5, 'branch', $6, $7, $8::jsonb, $9)`,
        [
          newSessionId,
          parent.projectId,
          parent.contextType,
          body.userPrompt ?? body.name ?? 'Branch chat',
          parent.budgetCapUsd,
          parentId,
          body.name ?? null,
          JSON.stringify(body.scopeGlobs),
          branchName,
        ],
      );

      // Best-effort: create the git branch in the project workspace so the
      // first agent run on this chat starts from a known ref. If the project
      // has no workspace yet (lazy-cloned), the worker will materialize it
      // and we'll create the branch on first commit instead — non-fatal.
      try {
        const { rows: projectRows } = await fastify.pg.query<{ workspace_path: string | null }>(
          'SELECT workspace_path FROM projects WHERE id = $1',
          [parent.projectId],
        );
        const projectRoot = projectRows[0]?.workspace_path
          ?? nodePath.join(env.WORKSPACES_ROOT, parent.projectId);
        await createBranchFrom({ workspaceDir: projectRoot, newBranch: branchName });
      } catch (err) {
        fastify.log.warn(
          { sessionId: newSessionId, branchName, err: (err as Error).message },
          'Could not pre-create git branch for branch chat (will be created on first commit)',
        );
      }

      const { rows: [newRow] } = await fastify.pg.query(
        'SELECT * FROM sessions WHERE id = $1',
        [newSessionId],
      );
      return reply.status(201).send({
        session: mapSession(newRow as Record<string, unknown>),
      });
    },
  );

  // ── GET /api/sessions/:id/diff ───────────────────────────────────────────────
  // Returns a unified diff of this branch chat's git branch against its
  // parent's branch (typically `main`). Used by the merge prompt UI.
  // 404 when the session is not a branch chat. Empty `diff` = nothing changed.
  fastify.get<{ Params: { id: string } }>(
    '/api/sessions/:id/diff',
    async (request, reply) => {
      const { rows: [row] } = await fastify.pg.query(
        'SELECT * FROM sessions WHERE id = $1',
        [request.params.id],
      );
      if (!row) return reply.status(404).send({ error: 'Session not found' });
      const session = mapSession(row as Record<string, unknown>);
      if (session.kind !== 'branch' || !session.branchName) {
        return reply.status(400).send({ error: 'Diff is only available for branch chats' });
      }
      const { rows: [parentRow] } = await fastify.pg.query(
        'SELECT * FROM sessions WHERE id = $1',
        [session.parentSessionId],
      );
      const parent = parentRow ? mapSession(parentRow as Record<string, unknown>) : null;
      // Parent's effective branch — main chat doesn't have its own branch_name,
      // so we use the project's default branch (HEAD on the parent ref).
      const parentBranch = parent?.branchName ?? 'HEAD';

      const { rows: projectRows } = await fastify.pg.query<{ workspace_path: string | null }>(
        'SELECT workspace_path FROM projects WHERE id = $1',
        [session.projectId],
      );
      const projectRoot = projectRows[0]?.workspace_path
        ?? nodePath.join(env.WORKSPACES_ROOT, session.projectId);

      try {
        const diff = await getDiff({
          workspaceDir: projectRoot,
          from: parentBranch,
          to:   session.branchName,
        });
        return { diff, sourceBranch: session.branchName, targetBranch: parentBranch };
      } catch (err) {
        return reply.status(500).send({ error: (err as Error).message });
      }
    },
  );

  // ── POST /api/sessions/:id/merge ─────────────────────────────────────────────
  // Merges this branch chat's git branch into its parent's branch (--no-ff)
  // and marks the session as merged. Returns the merge commit SHA.
  // The session row stays — UI can keep showing it as "merged" in the sidebar.
  fastify.post<{ Params: { id: string } }>(
    '/api/sessions/:id/merge',
    async (request, reply) => {
      const { rows: [row] } = await fastify.pg.query(
        'SELECT * FROM sessions WHERE id = $1',
        [request.params.id],
      );
      if (!row) return reply.status(404).send({ error: 'Session not found' });
      const session = mapSession(row as Record<string, unknown>);
      if (session.kind !== 'branch' || !session.branchName) {
        return reply.status(400).send({ error: 'Only branch chats can be merged' });
      }
      if (session.mergedAt) {
        return reply.status(409).send({ error: 'Branch already merged' });
      }

      const { rows: [parentRow] } = await fastify.pg.query(
        'SELECT * FROM sessions WHERE id = $1',
        [session.parentSessionId],
      );
      const parent = parentRow ? mapSession(parentRow as Record<string, unknown>) : null;
      // Default branch to merge into when parent is the main chat — we read
      // the workspace's current branch as the project's effective default.
      const targetBranch = parent?.branchName ?? null;

      const { rows: projectRows } = await fastify.pg.query<{ workspace_path: string | null }>(
        'SELECT workspace_path FROM projects WHERE id = $1',
        [session.projectId],
      );
      const projectRoot = projectRows[0]?.workspace_path
        ?? nodePath.join(env.WORKSPACES_ROOT, session.projectId);

      // If targetBranch is null (parent is main chat), figure out the default
      // branch by reading the workspace's current HEAD before any checkout.
      let effectiveTarget = targetBranch;
      if (!effectiveTarget) {
        try {
          const { simpleGit } = await import('simple-git');
          const status = await simpleGit(projectRoot).branchLocal();
          // Prefer 'main' or 'master' if present, else current branch.
          effectiveTarget = ['main', 'master'].find((b) => status.all.includes(b)) ?? status.current;
        } catch {
          effectiveTarget = 'main';
        }
      }
      if (!effectiveTarget) {
        return reply.status(500).send({ error: 'Could not determine target branch for merge' });
      }

      try {
        const result = await mergeBranch({
          workspaceDir:  projectRoot,
          sourceBranch:  session.branchName,
          targetBranch:  effectiveTarget,
          message:       session.name
            ? `Merge branch chat: ${session.name}`
            : `Merge branch chat ${session.id.slice(0, 8)}`,
          authorName:    'Agent Orchestrator',
          authorEmail:   'agents@orchestrator.local',
        });
        await fastify.pg.query(
          `UPDATE sessions SET merged_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [session.id],
        );
        return reply.send({
          merged:           true,
          sha:              result.sha,
          alreadyUpToDate:  result.alreadyUpToDate,
          targetBranch:     effectiveTarget,
          sourceBranch:     session.branchName,
        });
      } catch (err) {
        // Most common failure: merge conflict. Surface the raw stderr so the
        // user knows which files to fix in the workspace.
        return reply.status(409).send({
          error:   'Merge failed (likely conflicts) — resolve in the workspace and retry',
          detail:  (err as Error).message,
        });
      }
    },
  );

  // ── DELETE /api/sessions/:id — cancel running tasks then delete the session ──
  fastify.delete<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params;

    // Stop any running/pending tasks first
    const { rows: tasks } = await fastify.pg.query<{ id: string }>(
      `SELECT id FROM agent_tasks WHERE session_id = $1 AND status IN ('pending', 'running', 'paused')`,
      [id],
    );

    for (const task of tasks) {
      await fastify.taskQueue.stopTask(task.id);
    }

    // Delete session — CASCADE removes agent_tasks and agent_events automatically
    const { rowCount } = await fastify.pg.query(
      `DELETE FROM sessions WHERE id = $1`,
      [id],
    );

    if (!rowCount) return reply.status(404).send({ error: 'Session not found' });

    return { deleted: true, cancelledTasks: tasks.length };
  });
}
