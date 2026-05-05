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
  fastify.get<{ Querystring: { limit?: string; projectId?: string } }>(
    '/api/sessions',
    async (request, reply) => {
      const limit = Math.min(parseInt(request.query.limit ?? '30', 10), 100);
      const { projectId } = request.query;

      const { rows } = await fastify.pg.query(
        `SELECT * FROM sessions
         ${projectId ? 'WHERE project_id = $2' : ''}
         ORDER BY created_at DESC
         LIMIT $1`,
        projectId ? [limit, projectId] : [limit],
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
