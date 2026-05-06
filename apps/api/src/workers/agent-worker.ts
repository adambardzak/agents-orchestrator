import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { promises as fs } from 'node:fs';
import nodePath from 'node:path';
import { v4 as uuid } from 'uuid';
import type { AgentDefinition, AgentTask, AgentType, TaskComplexity, TaskStatus } from '@agent-orchestrator/shared';
import type { OpenCodeProcessManager } from '../services/opencode/sdk-process-manager.js';
import type { EventBus } from '../websocket/event-bus.js';
import type { CostTracker } from '../services/cost-tracker/tracker.js';
import type { RagService } from '../services/rag/rag-service.js';
import { getAgentById, getAgentByType, DOCUMENT_AGENT, VISUAL_QA_AGENT, PLANNER_AGENT } from '../agents/definitions.js';
import { resolveModel, COMPLEXITY_ORDER } from '../services/model-router/router.js';
import { env } from '../config/env.js';
import { AGENT_QUEUE_NAME, type AgentJobData } from '../services/queue/task-queue.js';
import { MODEL_ROUTING } from '../config/models.js';
import { TicketService, tryParsePlannerOutput, isSplittableAgent } from '../services/tickets/ticket-service.js';
import { ProjectRepoService } from '../services/git/project-repo-service.js';
import { GitConnectionService } from '../services/git/connection-service.js';
import { getGitProvider } from '../services/git/registry.js';
import { commitAll, pushBranch } from '../services/git/workspace-git.js';
import { AIProviderService } from '../services/ai-providers/provider-service.js';
import { KnowledgeService } from '../services/knowledge/knowledge-service.js';
import { SkillRelevanceFilter } from '../services/skills/skill-relevance.js';
import { ContextBudget } from '../services/telemetry/context-budget.js';
import { QaRunner } from '../services/qa/qa-runner.js';
import { resolveProviderModel } from '../services/ai-providers/complexity-map.js';
import type { ProviderOverride } from '../services/model-router/router.js';

// ─── Orchestrator plan shape ──────────────────────────────────────────────────

interface OrchestratorPlanTask {
  id: string;              // logical ID used for dependency references in the plan
  agentType: string;
  prompt: string;
  complexity: string;
  dependsOn: string[];     // logical IDs (not real UUIDs)
  rationale?: string;
}

interface OrchestratorPlan {
  analysis?: string;
  tasks: OrchestratorPlanTask[];
}

function tryParseOrchestratorPlan(content: string): OrchestratorPlan | null {
  if (!content?.trim()) return null;

  function isValidPlan(val: unknown): val is OrchestratorPlan {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    return Array.isArray(obj['tasks']) && (obj['tasks'] as unknown[]).length > 0;
  }

  // Attempt 1: direct JSON parse (model output entire JSON)
  try {
    const parsed = JSON.parse(content) as unknown;
    if (isValidPlan(parsed)) return parsed as OrchestratorPlan;
  } catch { /* not bare JSON */ }

  // Attempt 2: JSON inside a ```json … ``` code fence
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch?.[1]) {
    try {
      const parsed = JSON.parse(fenceMatch[1]) as unknown;
      if (isValidPlan(parsed)) return parsed as OrchestratorPlan;
    } catch { /* not valid JSON in fence */ }
  }

  // Attempt 3: find the first { … } block that contains "tasks"
  // Walk through the string to find balanced braces
  if (content.includes('"tasks"')) {
    let depth = 0;
    let start = -1;
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (content[i] === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          const candidate = content.slice(start, i + 1);
          try {
            const parsed = JSON.parse(candidate) as unknown;
            if (isValidPlan(parsed)) return parsed as OrchestratorPlan;
          } catch { /* try next block */ }
          start = -1;
        }
      }
    }
  }

  return null;
}

interface EscalationSignal {
  escalate: import('@agent-orchestrator/shared').TaskComplexity;
  reason: string;
}

function tryParseEscalation(content: string): EscalationSignal | null {
  if (!content?.includes('"escalate"')) return null;
  try {
    // Try to extract JSON from markdown code fence or plain JSON
    const jsonMatch = content.match(/```json\s*(\{[^`]+\})\s*```/s) ??
                      content.match(/(\{"escalate"[^}]+\})/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[1]!) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'escalate' in parsed &&
      'reason' in parsed
    ) {
      return parsed as EscalationSignal;
    }
  } catch { /* not a valid escalation signal */ }
  return null;
}

interface ClarificationSignal {
  clarification_needed: true;
  questions: string[];
}

function tryParseClarification(content: string): ClarificationSignal | null {
  if (!content?.includes('"clarification_needed"')) return null;
  try {
    const jsonMatch = content.match(/```json\s*(\{[^`]+\})\s*```/s) ??
                      content.match(/(\{"clarification_needed"[^}]+\}[^}]*\})/s) ??
                      content.match(/(\{[\s\S]*"clarification_needed"[\s\S]*\})/);
    const raw = jsonMatch ? jsonMatch[1]! : content;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'clarification_needed' in parsed &&
      (parsed as Record<string, unknown>)['clarification_needed'] === true &&
      Array.isArray((parsed as Record<string, unknown>)['questions'])
    ) {
      return parsed as ClarificationSignal;
    }
  } catch { /* not a valid clarification signal */ }
  return null;
}

// ─── Destructive task detection ───────────────────────────────────────────────

const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\btruncate\b/i,
  /\bpurge\b/i,
  /\bdrop\s+(table|database|schema|column|index)\b/i,
  /\bdelete\s+(all|from|table|database|files|data|everything)\b/i,
  /rm\s+-rf\b/i,
  /\bdestroy\b.*\b(database|data|everything)\b/i,
  /\bwipe\b.*\b(database|data|all)\b/i,
  /\breset\s+(the\s+)?(database|db|all\s+data)\b/i,
  /\bclear\s+(the\s+)?(database|db|all\s+data)\b/i,
];

/**
 * Returns a human-readable reason if the task is considered destructive,
 * or null if it is safe to run without approval.
 */
function getDestructiveReason(task: OrchestratorPlanTask): string | null {
  if (task.agentType === 'infra') {
    return 'Infrastructure tasks may modify cloud resources, run migrations, or alter deployments.';
  }
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(task.prompt)) {
      return `Prompt contains potentially destructive operation: "${task.prompt.slice(0, 120)}..."`;
    }
  }
  return null;
}

// ─── AgentWorker deps ─────────────────────────────────────────────────────────

export interface AgentWorkerDeps {
  redis: Redis;
  db: Pool;
  processManager: OpenCodeProcessManager;
  eventBus: EventBus;
  costTracker: CostTracker;
  ragService: RagService;
  logger: FastifyBaseLogger;
  onTaskStatusChange: (taskId: string, status: TaskStatus, data?: unknown) => Promise<void>;
  /** Called to enqueue a task — provided by TaskQueue to avoid circular reference. */
  enqueueTask: (
    task: AgentTask,
    githubToken: string,
    opts?: { extraContext?: string; additionalEnv?: Record<string, string> },
  ) => Promise<void>;
}

// ─── AgentWorker class ────────────────────────────────────────────────────────

/**
 * AgentWorker — BullMQ Worker that processes agent tasks.
 *
 * Responsibilities:
 *  1. Spawns an OpenCode process for each task
 *  2. Parses NDJSON events and publishes them via EventBus
 *  3. Persists every event to agent_events table
 *  4. For orchestrator tasks: parses the JSON plan and creates subtasks in DB
 *  5. For other tasks: triggers event-driven dependency resolution
 *  6. Updates task status in DB (running → completed | failed)
 */
export class AgentWorker {
  private worker: Worker<AgentJobData>;
  private logger: FastifyBaseLogger;
  private processManager: OpenCodeProcessManager;
  private eventBus: EventBus;
  private costTracker: CostTracker;
  private ragService: RagService;
  private db: Pool;
  private onTaskStatusChange: (taskId: string, status: TaskStatus, data?: unknown) => Promise<void>;
  private enqueueTask: AgentWorkerDeps['enqueueTask'];

  /**
   * Tracks completed task IDs in-process memory for fast dependency checks.
   * Supplemented by DB queries in checkAndEnqueueDependents for correctness.
   */
  readonly completedTaskIds = new Set<string>();

  /** Budget cap (USD) per session, cached to avoid repeated DB queries. */
  private sessionBudgets = new Map<string, number>();

  /**
   * Tracks which budget threshold alerts have already fired.
   * Key format: `${sessionId}:${thresholdPct}` e.g. "abc-123:80"
   */
  private firedBudgetAlerts = new Set<string>();

  /** Lazy-initialized ticket service. */
  private tickets: TicketService;

  /** Lazy-initialized AI provider service for org-level provider overrides. */
  private aiProviders: AIProviderService;

  /** Lazy-initialized KB service for org-level knowledge retrieval. */
  private knowledge: KnowledgeService;

  /** Deterministic post-task QA runner (tsc/eslint/vitest/playwright). */
  private qaRunner: QaRunner;

  /** Per-spawn skill relevance filter — drops irrelevant skill knowledge blocks. */
  private skillFilter: SkillRelevanceFilter;

  constructor(deps: AgentWorkerDeps) {
    this.logger = deps.logger;
    this.processManager = deps.processManager;
    this.eventBus = deps.eventBus;
    this.costTracker = deps.costTracker;
    this.ragService = deps.ragService;
    this.db = deps.db;
    this.onTaskStatusChange = deps.onTaskStatusChange;
    this.enqueueTask = deps.enqueueTask;
    this.tickets = new TicketService(deps.db, deps.logger);

    this.aiProviders = new AIProviderService(deps.db);
    this.knowledge = new KnowledgeService(deps.db, deps.logger, env.GITHUB_TOKEN, undefined, env.KB_MIN_SCORE);
    this.qaRunner = new QaRunner(deps.db, deps.logger);
    this.skillFilter = new SkillRelevanceFilter(deps.logger, env.GITHUB_TOKEN, env.SKILL_MIN_SCORE);

    this.worker = new Worker<AgentJobData>(
      AGENT_QUEUE_NAME,
      (job) => this.processJob(job),
      {
        connection: deps.redis,
        concurrency: env.MAX_PARALLEL_AGENTS,
        limiter: {
          max: env.MAX_PARALLEL_AGENTS,
          duration: 1000,
        },
      },
    );

    this.setupWorkerEvents();
  }

  // ─── Agent config resolution (built-in first, then DB) ──────────────────────

  private async resolveAgentConfig(agentId: string): Promise<AgentDefinition | undefined> {
    // 1. Built-in agents (fast path — no DB round-trip)
    const builtIn = getAgentById(agentId);
    if (builtIn) return builtIn;

    // 2. Custom agent from DB
    try {
      const { rows: [row] } = await this.db.query(
        'SELECT * FROM agent_definitions WHERE id = $1 AND is_active = true',
        [agentId],
      );
      if (!row) return undefined;

      return {
        id: row.id,
        name: row.name,
        description: row.description ?? '',
        icon: row.icon ?? 'bot',
        type: row.agent_type,
        defaultComplexity: row.default_complexity,
        canEscalateTo: row.can_escalate_to,
        systemPrompt: row.system_prompt,
        rules: row.rules ?? [],
        skills: row.skills ?? [],
        allowedMcpServers: row.allowed_mcp_servers ?? [],
        allowedTools: row.allowed_tools ?? [],
        maxSteps: row.max_steps ?? 20,
        timeoutMinutes: row.timeout_minutes ?? 10,
        triggers: row.triggers ?? {},
        isBuiltIn: false,
        isActive: true,
        createdBy: row.created_by ?? 'user',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      } satisfies AgentDefinition;
    } catch (err) {
      this.logger.warn({ agentId, err }, 'Failed to load custom agent from DB');
      return undefined;
    }
  }

  // ─── Core job processor ──────────────────────────────────────────────────────

  private async processJob(job: Job<AgentJobData>): Promise<void> {
    const { task, githubToken, extraContext, additionalEnv } = job.data;
    const sessionId = task.sessionId;

    this.logger.info(
      { taskId: task.id, agentType: task.agentType, attempt: job.attemptsMade },
      'Processing agent task',
    );

    const agentConfig = await this.resolveAgentConfig(task.agentId);
    if (!agentConfig) {
      throw new Error(`Agent definition not found: ${task.agentId}`);
    }

    // ── Resolve workspace path from DB ───────────────────────────────────────
    const workspaceDir = await this.getProjectWorkspaceDir(task.projectId, task.sessionId);

    // ── Inject frontend-rules.md for Frontend agent (Fáze 1 quality layer) ──
    let resolvedExtraContext = extraContext;
    const budget = new ContextBudget();
    if (extraContext) budget.add('caller-extra', extraContext.length);
    if (task.agentType === 'frontend') {
      // The rules file lives in the project root (committed alongside source).
      // Prefer the project root path so we don't depend on the per-session
      // workspace mirror (which is currently created empty by sessions.ts and
      // would always miss). Fall back to the session subdir for the case
      // where the Design Agent wrote a session-local override.
      const projectRoot = await this.getProjectWorkspaceDir(task.projectId);
      const candidates = [
        nodePath.join(projectRoot,  'design-system', 'frontend-rules.md'),
        nodePath.join(workspaceDir, 'design-system', 'frontend-rules.md'),
      ];
      let rulesRaw: string | null = null;
      let resolvedFrom: string | null = null;
      for (const candidate of candidates) {
        try {
          rulesRaw = await fs.readFile(candidate, 'utf-8');
          resolvedFrom = candidate;
          break;
        } catch {
          // try next candidate
        }
      }
      if (rulesRaw !== null && resolvedFrom !== null) {
        const cap = env.FRONTEND_RULES_MAX_CHARS;
        let rules = rulesRaw;
        let truncated = false;
        if (cap > 0 && rulesRaw.length > cap) {
          // Keep the head: rules docs typically front-load most important
          // conventions. Append a marker so the agent knows content was cut.
          rules = rulesRaw.slice(0, cap) + `\n\n<!-- truncated: ${rulesRaw.length - cap} chars omitted (FRONTEND_RULES_MAX_CHARS=${cap}) -->`;
          truncated = true;
          this.logger.warn(
            { taskId: task.id, original: rulesRaw.length, cap },
            'frontend-rules.md exceeds FRONTEND_RULES_MAX_CHARS; truncating before injection',
          );
        }
        const rulesBlock = `\n\n## Project Frontend Rules (from design-system/frontend-rules.md)\n\n${rules}`;
        resolvedExtraContext = (resolvedExtraContext ?? '') + rulesBlock;
        budget.add('frontend-rules', rulesBlock.length, { truncated, originalChars: rulesRaw.length, resolvedFrom });
        this.logger.info(
          { taskId: task.id, chars: rules.length, truncated, resolvedFrom },
          'Injected frontend-rules.md into Frontend agent context',
        );
      } else {
        // Design Agent hasn't run yet or no rules file in either location —
        // continue without it.
        this.logger.debug?.({ taskId: task.id, candidates }, 'frontend-rules.md not found in any candidate path');
      }
    }

    // ── RAG: retrieve relevant project context ────────────────────────────────
    // (skip for document/qa/orchestrator — they don't benefit from code retrieval)
    if (!['document', 'qa', 'orchestrator'].includes(task.agentType)) {
      try {
        const ragChunks = await this.ragService.retrieveContext(
          task.projectId,
          task.prompt,
          task.id,
          5,
        );
        if (ragChunks.length > 0) {
          const ragContext = this.ragService.formatAsContext(ragChunks);
          resolvedExtraContext = (resolvedExtraContext ?? '') + '\n\n' + ragContext;
          budget.add('rag', ragContext.length, { hits: ragChunks.length, requested: 5 });
          this.logger.info({ taskId: task.id, chunks: ragChunks.length }, 'RAG context injected');
        } else {
          budget.add('rag', 0, { hits: 0, requested: 5, allFiltered: true });
        }
      } catch (err) {
        this.logger.warn({ err, taskId: task.id }, 'RAG retrieval failed, continuing without context');
      }
    }

    // ── KB: retrieve workspace + project-owner personal KB ───────────────────
    // Strategy: search both the project's organization KB and the project
    // owner's personal KB simultaneously, then re-rank by relevance. Personal
    // notes from the owner often contain pre-org tribal knowledge worth
    // surfacing alongside official workspace docs.
    try {
      const { rows } = await this.db.query<{
        organization_id: string | null;
        created_by:      string | null;
      }>(
        `SELECT organization_id, created_by FROM projects WHERE id = $1`,
        [task.projectId],
      );
      const orgId = rows[0]?.organization_id;
      const ownerId = rows[0]?.created_by;
      const scopes: import('../services/knowledge/knowledge-service.js').KbScope[] = [];
      if (orgId)   scopes.push({ kind: 'org',  organizationId: orgId });
      if (ownerId) scopes.push({ kind: 'user', userId: ownerId });

      if (scopes.length > 0) {
        const kbHits = await this.knowledge.retrieveForScopes(scopes, task.prompt, 5);
        if (kbHits.length > 0) {
          const kbContext = this.knowledge.formatAsContext(kbHits);
          resolvedExtraContext = (resolvedExtraContext ?? '') + '\n\n' + kbContext;
          budget.add('kb', kbContext.length, { hits: kbHits.length, requested: 5, scopes: scopes.map((s) => s.kind) });
          this.logger.info(
            { taskId: task.id, hits: kbHits.length, scopes: scopes.map((s) => s.kind) },
            'KB context injected',
          );
        } else {
          budget.add('kb', 0, { hits: 0, requested: 5, scopes: scopes.map((s) => s.kind), allFiltered: true });
        }
      }
    } catch (err) {
      this.logger.warn({ err, taskId: task.id }, 'KB retrieval failed, continuing without context');
    }

    // ── Branch chat soft scope ──────────────────────────────────────────────
    // When the task's session is a branch chat with scope_globs configured,
    // inject a focus block into the system prompt so the agent prioritizes
    // those files. This is "soft scope" — the agent can still explore other
    // files when investigating; we just bias its attention.
    try {
      const { rows: scopeRows } = await this.db.query<{
        kind: string; scope_globs: unknown; name: string | null;
      }>(
        `SELECT kind, scope_globs, name FROM sessions WHERE id = $1`,
        [task.sessionId],
      );
      const scopeRow = scopeRows[0];
      if (scopeRow && scopeRow.kind === 'branch') {
        const globs = Array.isArray(scopeRow.scope_globs) ? (scopeRow.scope_globs as string[]) : [];
        if (globs.length > 0) {
          const label = scopeRow.name ? `"${scopeRow.name}"` : 'this branch chat';
          const scopeBlock = [
            '',
            '## Branch Chat Scope',
            '',
            `You are working inside a focused branch chat ${label}. Prioritize`,
            'changes to the files matching these patterns and avoid touching',
            'unrelated code unless absolutely necessary:',
            '',
            ...globs.map((g) => `- \`${g}\``),
            '',
            'You may still read other files when investigating, but limit edits',
            'to the scope above. If a fix genuinely requires changes elsewhere,',
            'mention it explicitly in your final summary.',
          ].join('\n');
          resolvedExtraContext = (resolvedExtraContext ?? '') + '\n' + scopeBlock;
          budget.add('branch-scope', scopeBlock.length, { globs: globs.length });
          this.logger.info(
            { taskId: task.id, sessionId: task.sessionId, globCount: globs.length },
            'Branch chat scope injected into agent context',
          );
        }
      }
    } catch (err) {
      this.logger.warn({ err, taskId: task.id }, 'Failed to load branch chat scope (continuing)');
    }

    // ── User-referenced files (`@file` mentions) ────────────────────────────
    // The chat input lets the user mention files via autocomplete; those
    // paths arrive as `task.referencedFiles` (already traversal-validated at
    // the API ingest layer). Load each from the project's CANONICAL workspace
    // root (not the per-session subdir — we want the clean source-of-truth
    // version, not a partially-edited copy from this same session) and inject
    // contents under a `## Referenced Files` block.
    //
    // Caps:
    //   - per file: REFERENCED_FILES_PER_FILE_MAX_CHARS (truncate head, mark)
    //   - total:    REFERENCED_FILES_TOTAL_MAX_CHARS    (drop overflow files)
    if (Array.isArray(task.referencedFiles) && task.referencedFiles.length > 0) {
      try {
        const projectRoot = await this.getProjectWorkspaceDir(task.projectId);
        const perFileCap   = env.REFERENCED_FILES_PER_FILE_MAX_CHARS;
        const totalCap     = env.REFERENCED_FILES_TOTAL_MAX_CHARS;
        const sections: string[] = [];
        const loaded: { path: string; chars: number; truncated: boolean }[] = [];
        const skipped: { path: string; reason: string }[] = [];
        let runningTotal = 0;

        for (const relPath of task.referencedFiles) {
          // Defense in depth: re-validate traversal here too (worker may
          // execute long after ingest, and DB rows can in theory be tampered
          // with). Use posix-style normalization since stored paths are posix.
          const norm = nodePath.posix.normalize(relPath);
          if (norm.startsWith('..') || nodePath.isAbsolute(norm)) {
            skipped.push({ path: relPath, reason: 'traversal' });
            continue;
          }
          const absPath = nodePath.join(projectRoot, norm);
          // Final safety: realpath check is too slow; verify the resolved
          // path stays under projectRoot lexically.
          const resolved = nodePath.resolve(absPath);
          const resolvedRoot = nodePath.resolve(projectRoot);
          if (!resolved.startsWith(resolvedRoot + nodePath.sep) && resolved !== resolvedRoot) {
            skipped.push({ path: relPath, reason: 'escape' });
            continue;
          }
          let raw: string;
          try {
            raw = await fs.readFile(absPath, 'utf-8');
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            skipped.push({ path: relPath, reason: code === 'ENOENT' ? 'not-found' : `read-error:${code ?? 'unknown'}` });
            continue;
          }
          let body = raw;
          let truncated = false;
          if (perFileCap > 0 && raw.length > perFileCap) {
            body = raw.slice(0, perFileCap)
              + `\n\n<!-- truncated: ${raw.length - perFileCap} chars omitted (REFERENCED_FILES_PER_FILE_MAX_CHARS=${perFileCap}) -->`;
            truncated = true;
          }
          // Pick a fence size that won't collide with content (rare but
          // possible when referencing markdown). 4 backticks beats almost
          // any embedded code fence.
          const lang = inferLangFromPath(norm);
          const section = `### \`${norm}\`\n\n\`\`\`\`${lang}\n${body}\n\`\`\`\`\n`;
          if (totalCap > 0 && runningTotal + section.length > totalCap) {
            skipped.push({ path: relPath, reason: 'total-cap-exceeded' });
            continue;
          }
          sections.push(section);
          runningTotal += section.length;
          loaded.push({ path: norm, chars: body.length, truncated });
        }

        if (sections.length > 0) {
          const header = [
            '',
            '## Referenced Files',
            '',
            'The user explicitly referenced the following files in their request.',
            'Treat them as primary context for the task. Paths are relative to the',
            'project workspace root.',
            '',
          ].join('\n');
          const block = header + sections.join('\n');
          resolvedExtraContext = (resolvedExtraContext ?? '') + '\n' + block;
          budget.add('referenced-files', block.length, {
            requested: task.referencedFiles.length,
            loaded: loaded.length,
            skipped: skipped.length,
            truncated: loaded.filter((f) => f.truncated).length,
          });
          this.logger.info(
            { taskId: task.id, loaded, skipped },
            'Injected user-referenced files into agent context',
          );
        } else if (skipped.length > 0) {
          this.logger.warn(
            { taskId: task.id, skipped },
            'All `@file` references were skipped (none could be loaded)',
          );
        }
      } catch (err) {
        this.logger.warn(
          { err, taskId: task.id },
          'Referenced-files injection failed (continuing without)',
        );
      }
    }

    // ── status: pending → running ────────────────────────────────────────────
    await this.onTaskStatusChange(task.id, 'running');
    this.eventBus.publish(
      'agent:status',
      sessionId,
      { taskId: task.id, status: 'running', currentStep: 0, maxSteps: task.maxSteps },
      task.id,
    );

    // Bump ticket → in_progress when its worker starts
    if (task.ticketId) {
      try {
        await this.tickets.updateStatus(task.ticketId, 'in_progress', { currentTaskId: task.id });
        this.eventBus.publish('ticket:updated', sessionId, {
          ticketId: task.ticketId,
          sessionId,
          status: 'in_progress',
          iteration: 1,
        });
      } catch (err) {
        this.logger.warn({ ticketId: task.ticketId, err: (err as Error).message }, 'Failed to set ticket in_progress');
      }
    }

    let stepCount = 0;
    // Orchestrator: capture the last JSON plan seen in message events
    let orchestratorPlan: OrchestratorPlan | null = null;
    // Orchestrator: accumulate raw text output to detect clarification signals
    let rawOrchestratorOutput = '';
    // Orchestrator: set true when question tool detected → suppress "no plan" warning
    let clarificationTriggered = false;

    // Resolve org-level AI provider override (Anthropic / OpenAI bypass Copilot).
    // Falls back to Copilot routing when no provider is configured for the org.
    const providerOverride = await this.resolveProviderOverride(task);

    // ── Trim irrelevant skills from the agent config ────────────────────────
    // The agent's `.skills` array is statically declared but every skill ships
    // a verbose knowledge block (~800–2300 chars). Drop those that don't match
    // the task's intent based on cosine similarity. Built-in agent objects are
    // shared across workers — never mutate; create a shallow clone.
    let spawnAgentConfig = agentConfig;
    if (agentConfig.skills.length > 0) {
      try {
        const filteredSkills = await this.skillFilter.selectRelevant(agentConfig.skills, task.prompt);
        if (filteredSkills.length !== agentConfig.skills.length) {
          spawnAgentConfig = { ...agentConfig, skills: filteredSkills };
          this.logger.info(
            { taskId: task.id, agentType: task.agentType, before: agentConfig.skills.length, after: filteredSkills.length },
            'Filtered skill list for agent spawn',
          );
        }
        // Track skill knowledge size delta for the budget summary
        const skillsChars = spawnAgentConfig.skills.reduce((n, s) => n + s.knowledgeBlock.length + s.name.length + 16, 0);
        budget.add('skills', skillsChars, { kept: spawnAgentConfig.skills.length, of: agentConfig.skills.length });
      } catch (err) {
        this.logger.warn({ err, taskId: task.id }, 'skill-filter threw, falling back to full skill list');
      }
    }

    // ── Emit context-budget summary log (one structured line per spawn) ─────
    // Greppable for "context-budget" to audit prompt sizes per task/agent.
    budget.emit(this.logger, {
      taskId:                task.id,
      agentType:             task.agentType,
      baseSystemPromptChars: spawnAgentConfig.systemPrompt.length,
    });

    await new Promise<void>((resolve, reject) => {
      this.processManager
        .spawnAgent({
          task,
          agentConfig: spawnAgentConfig,
          workspacesRoot: env.WORKSPACES_ROOT,
          workspaceDir,
          githubToken,
          providerOverride,
          extraContext: resolvedExtraContext,
          opencodeBinary: env.OPENCODE_BINARY,
          env: {
            ...additionalEnv,
            // Per-context env vars — injected based on session's context type
            ...buildContextEnv(task.contextType as 'personal' | 'cez'),
            // Allows mock-opencode.js to emit the right sequence during tests
            MOCK_OPENCODE_AGENT_TYPE: task.agentType,
            MOCK_OPENCODE_MODEL: task.model,
          },

          onEvent: (event) => {
            // ── Publish to all subscribed WebSocket clients ──────────────────
            this.eventBus.publish('agent:event', sessionId, event, task.id);

            // ── Persist to agent_events table (fire-and-forget) ──────────────
            this.db
              .query(
                `INSERT INTO agent_events (task_id, session_id, event_type, payload)
                 VALUES ($1, $2, $3, $4)`,
                [task.id, sessionId, event.type, JSON.stringify(event)],
              )
              .catch((err: Error) =>
                this.logger.warn(
                  { taskId: task.id, error: err.message },
                  'Failed to persist agent event',
                ),
              );

            // ── Cost tracking (usage events) ─────────────────────────────────
            if (event.type === 'usage') {
              const { sessionTotal } = this.costTracker.trackUsage(
                task.id,
                sessionId,
                event.input_tokens,
                event.output_tokens,
                event.model,
              );

              this.eventBus.publish(
                'cost:update',
                sessionId,
                {
                  taskId: task.id,
                  sessionId,
                  inputTokens: event.input_tokens,
                  outputTokens: event.output_tokens,
                  model: event.model,
                  costUsd: this.costTracker.getTaskCost(task.id),
                  sessionTotalUsd: sessionTotal,
                },
                task.id,
              );

              // Fire-and-forget budget threshold check
              void this.checkBudgetAlerts(sessionId, sessionTotal);

              // Persist incremental token counts to DB
              // NOTE: cost_usd is SET (=) not incremented (+=) because
              // getTaskCost() returns the running cumulative total
              this.db
                .query(
                  `UPDATE agent_tasks
                   SET input_tokens  = input_tokens  + $2,
                       output_tokens = output_tokens + $3,
                       cost_usd      = $4,
                       updated_at    = NOW()
                   WHERE id = $1`,
                  [
                    task.id,
                    event.input_tokens,
                    event.output_tokens,
                    this.costTracker.getTaskCost(task.id),
                  ],
                )
                .catch((err: Error) =>
                  this.logger.warn(
                    { taskId: task.id, error: err.message },
                    'Failed to persist token usage',
                  ),
                );
            }

            // ── Step counting (tool_use events) ──────────────────────────────
            if (event.type === 'tool_use') {
              stepCount++;

              this.db
                .query(
                  'UPDATE agent_tasks SET current_step = $2, updated_at = NOW() WHERE id = $1',
                  [task.id, stepCount],
                )
                .catch(() => undefined);

              this.eventBus.publish(
                'agent:status',
                sessionId,
                {
                  taskId: task.id,
                  status: 'running',
                  currentStep: stepCount,
                  maxSteps: task.maxSteps,
                },
                task.id,
              );
            }

            // ── Orchestrator: detect `question` tool → clarification UI ─────
            // The real OpenCode binary uses the built-in `question` tool to ask
            // the user questions. We intercept it here and emit clarification:needed
            // so the frontend can show the question form.
            if (
              task.agentType === 'orchestrator' &&
              event.type === 'tool_use' &&
              event.name === 'question'
            ) {
              interface QuestionInput {
                questions?: Array<{ question?: string; header?: string }>;
              }
              const qi = event.input as QuestionInput;
              const questionTexts = (qi?.questions ?? [])
                .map((q) => q.question ?? q.header ?? '')
                .filter(Boolean);

              if (questionTexts.length > 0) {
                this.logger.info(
                  { taskId: task.id, questions: questionTexts },
                  'Orchestrator used question tool — surfacing as clarification',
                );
                clarificationTriggered = true;
                this.eventBus.publish(
                  'clarification:needed',
                  sessionId,
                  {
                    sessionId,
                    taskId: task.id,
                    questions: questionTexts,
                    originalPrompt: task.prompt,
                  },
                  task.id,
                );
                // Persist to DB so it survives page refresh
                this.db
                  .query(
                    `INSERT INTO agent_events (task_id, session_id, event_type, payload)
                     VALUES ($1, $2, 'clarification_needed', $3)`,
                    [
                      task.id,
                      sessionId,
                      JSON.stringify({ questions: questionTexts, originalPrompt: task.prompt }),
                    ],
                  )
                  .catch(() => undefined);

                // The `question` tool blocks the OpenCode process waiting for an
                // HTTP response that will never arrive. Kill it immediately — the
                // /clarify endpoint will spawn a fresh orchestrator with the answers.
                this.logger.info(
                  { taskId: task.id },
                  'Killing stuck orchestrator immediately (question tool intercepted)',
                );
                this.processManager.stopAgent(task.id);
              }
            }

            // ── Orchestrator: capture JSON plan from message events ───────────
            if (task.agentType === 'orchestrator' && event.type === 'message') {
              const plan = tryParseOrchestratorPlan(event.content);
              if (plan) orchestratorPlan = plan;
              // Also accumulate raw text for clarification detection
              rawOrchestratorOutput += event.content + '\n';
            }

            // ── Planner: accumulate raw text so we can parse on completion ───
            if (task.agentType === 'planner' && event.type === 'message') {
              rawOrchestratorOutput += event.content + '\n';
            }

            // ── Model escalation signal ───────────────────────────────────────
            if (event.type === 'message' && event.content) {
              const escalation = tryParseEscalation(event.content);
              if (escalation && agentConfig) {
                const currentIdx = COMPLEXITY_ORDER.indexOf(task.complexity);
                const requestedIdx = COMPLEXITY_ORDER.indexOf(escalation.escalate);
                const ceilingIdx = COMPLEXITY_ORDER.indexOf(agentConfig.canEscalateTo);
                if (requestedIdx > currentIdx && requestedIdx <= ceilingIdx) {
                  this.logger.info(
                    { taskId: task.id, from: task.complexity, to: escalation.escalate, reason: escalation.reason },
                    'Agent requested model escalation',
                  );
                  void this.spawnEscalatedTask(task, escalation.escalate, escalation.reason, githubToken, additionalEnv);
                }
              }
            }
          },

          onComplete: async (summary) => {
            this.completedTaskIds.add(task.id);

            await this.onTaskStatusChange(task.id, 'completed', { summary });
            this.eventBus.publish(
              'agent:status',
              sessionId,
              {
                taskId: task.id,
                status: 'completed',
                currentStep: stepCount,
                maxSteps: task.maxSteps,
              },
              task.id,
            );

            // Auto-commit per-task changes for non-orchestrator agents only.
            // Orchestrators don't write code, just plan, so committing them
            // would create empty commits.
            if (task.agentType !== 'orchestrator') {
              void this.autoCommitTaskChanges(task, summary);
            }

            // Run deterministic QA validation against the workspace for
            // code-writing agents. Fire-and-forget — results are advisory and
            // surfaced in the UI via /api/tasks/:id/qa. Skipped for agents
            // that don't produce code (orchestrator/document/qa).
            if (!['orchestrator', 'document', 'qa'].includes(task.agentType)) {
              void this.runPostTaskQa(task);
            }

            if (task.agentType === 'orchestrator') {
              // Check for clarification request BEFORE checking for a plan
              // The orchestrator may emit clarification_needed in either the streaming output
              // or in the final summary
              const clarificationFromStream = rawOrchestratorOutput
                ? tryParseClarification(rawOrchestratorOutput)
                : null;
              const clarification = tryParseClarification(summary) ?? clarificationFromStream;

              if (clarification && clarification.questions.length > 0) {
                this.logger.info(
                  { taskId: task.id, questions: clarification.questions },
                  'Orchestrator needs clarification before planning',
                );
                // Publish WS event so frontend can show question form
                this.eventBus.publish(
                  'clarification:needed',
                  sessionId,
                  {
                    sessionId,
                    taskId: task.id,
                    questions: clarification.questions,
                    originalPrompt: task.prompt,
                  },
                  task.id,
                );
                // Store questions in DB for recovery (as agent_event)
                await this.db.query(
                  `INSERT INTO agent_events (task_id, session_id, event_type, payload)
                   VALUES ($1, $2, 'clarification_needed', $3)`,
                  [task.id, sessionId, JSON.stringify({ questions: clarification.questions, originalPrompt: task.prompt })],
                ).catch(() => undefined);
              } else {
                // Try the full accumulated output first (summary is truncated to 500 chars
                // which may cut a long JSON plan — rawOrchestratorOutput is untruncated)
                const planFromFull    = tryParseOrchestratorPlan(rawOrchestratorOutput);
                const planFromSummary = planFromFull ?? tryParseOrchestratorPlan(summary);
                const plan = planFromSummary ?? orchestratorPlan;

                if (plan && plan.tasks.length > 0) {
                  await this.createSubtasksFromPlan(plan, task, githubToken, additionalEnv);
                } else if (!clarificationTriggered) {
                  // Only warn when there was no clarification flow — in the clarification
                  // case the orchestrator was intentionally killed before it produced a plan.
                  this.logger.warn(
                    { taskId: task.id, summary: summary.slice(0, 300), rawLen: rawOrchestratorOutput.length },
                    'Orchestrator completed but produced no parseable plan',
                  );
                }
              }
            } else if (task.agentType === 'planner') {
              // ── Planner: parse tickets[] and spawn one task per ticket ────
              await this.handlePlannerComplete(task, summary, rawOrchestratorOutput, githubToken, additionalEnv);
              await this.checkAndCloseSession(sessionId);
            } else {
              // Non-orchestrator: enqueue dependents whose all deps are now satisfied
              await this.checkAndEnqueueDependents(sessionId, task.id, githubToken, additionalEnv);
              // After dependency chain step, check if the whole session is done
              await this.checkAndCloseSession(sessionId);

              // ── Ticket-bound worker completion ─────────────────────────────
              // If this task is executing a ticket, mark the ticket done and
              // close out its iteration row.
              if (task.ticketId) {
                try {
                  await this.tickets.updateStatus(task.ticketId, 'done', {
                    currentTaskId: null,
                  });
                  await this.tickets.completeIteration({
                    ticketId: task.ticketId,
                    taskId: task.id,
                    status: 'done',
                    summary,
                    costUsd: this.costTracker.getTaskCost(task.id),
                  });
                  await this.tickets.recomputeCost(task.ticketId);
                  const ticket = await this.tickets.getById(task.ticketId);
                  if (ticket) {
                    this.eventBus.publish('ticket:updated', sessionId, {
                      ticketId: ticket.id,
                      sessionId,
                      status: ticket.status,
                      iteration: ticket.iteration,
                    });
                  }
                } catch (err) {
                  this.logger.warn(
                    { ticketId: task.ticketId, err: (err as Error).message },
                    'Failed to update ticket on worker completion',
                  );
                }
              }

              // Spawn a DocumentAgent to write a summary to Obsidian vault
              // (skip for document/qa agents to avoid infinite loops, and skip
              //  ticket-bound tasks — too noisy when many haiku tickets run)
              if (task.agentType !== 'document' && task.agentType !== 'qa' && !task.ticketId) {
                void this.spawnDocumentTask(task, summary, githubToken, additionalEnv);
              }

              // Spawn Visual QA after frontend tasks (but only after the LAST
              // ticket of the same parent planner task — see below)
              if (task.agentType === 'frontend' && !task.ticketId) {
                void this.spawnVisualQaTask(task, githubToken, additionalEnv);
              }
            }

            resolve();
          },

          onError: (error) => {
            reject(error);
          },
        })
        .catch(reject);
    });
  }

  // ─── Workspace path resolution ───────────────────────────────────────────────

  /**
   * Returns the absolute workspace directory for a (project, session) pair.
   *
   * Layout: `<projectWorkspace>/sessions/<sessionId>/`
   *
   * This guarantees per-session isolation — two concurrent sessions of the
   * same project never overwrite each other's files. The session subdirectory
   * is created on-demand by the OpenCode runtime when the agent first writes.
   *
   * Falls back to `{WORKSPACES_ROOT}/{projectId}/sessions/{sessionId}` if the
   * project row is missing.
   */
  /**
   * Auto-commit any changes in the project workspace to a per-session branch
   * after a non-orchestrator task completes. No-op if the project has no
   * linked git repository, or if the working tree is clean.
   *
   * Errors are logged but never thrown — git failures must not break the
   * agent task. Push errors leave the commit local; the user can re-push later.
   */
  private async autoCommitTaskChanges(task: AgentTask, summary: string): Promise<void> {
    try {
      const repos = new ProjectRepoService(this.db);
      const repo = await repos.getByProject(task.projectId);
      if (!repo) return; // Project has no git remote — skip silently.

      const projectRoot = await this.getProjectWorkspaceDir(task.projectId);
      const branch = `agent/session-${task.sessionId}`;
      const shortSummary = summary.split('\n')[0]?.slice(0, 100) ?? task.agentType;
      const message = `[${task.agentType}] ${shortSummary}\n\nTask: ${task.id}\nSession: ${task.sessionId}`;

      const commit = await commitAll({
        workspaceDir: projectRoot,
        branch,
        message,
        authorName:  'Agent Orchestrator',
        authorEmail: 'agent@orchestrator.local',
        createBranchIfMissing: true,
      });
      if (!commit) return; // Clean working tree.

      let pushed = false;
      try {
        const connections = new GitConnectionService(this.db);
        const token = await connections.getAccessToken(repo.gitConnectionId);
        const provider = getGitProvider(repo.provider);
        if (token && provider) {
          await pushBranch({
            workspaceDir:     projectRoot,
            branch,
            authenticatedUrl: provider.authenticatedCloneUrl(token, {
              id:            repo.externalId ?? '',
              name:          repo.fullName.split('/').pop() ?? '',
              fullName:      repo.fullName,
              description:   null,
              private:       repo.visibility !== 'public',
              defaultBranch: repo.defaultBranch,
              htmlUrl:       repo.remoteUrl,
              cloneUrl:      repo.remoteUrl,
              sshUrl:        null,
              updatedAt:     new Date().toISOString(),
            }),
          });
          pushed = true;
        }
      } catch (pushErr) {
        this.logger.warn({ err: pushErr, taskId: task.id }, 'Auto-commit push failed (commit kept locally)');
      }

      await repos.recordCommit({
        sessionId: task.sessionId,
        projectId: task.projectId,
        commit,
        pushed,
      });

      this.logger.info(
        { taskId: task.id, sha: commit.sha, branch, pushed },
        'Auto-committed task changes',
      );
    } catch (err) {
      this.logger.warn({ err, taskId: task.id }, 'Auto-commit failed (non-fatal)');
    }
  }

  /**
   * Resolves the AI provider override for a task. Looks up the task's project
   * → (organization, owner), then asks AIProviderService.resolveForUser for
   * the highest-precedence enabled provider with an API key:
   *
   *   1. project owner's personal entry (any kind, default-then-recent)
   *   2. org-shared entry as fallback
   *   3. null → spawn falls back to default Copilot routing
   *
   * The resolved provider's complexity → model mapping (or its `defaultModel`)
   * decides which concrete model id we hand to OpenCode.
   *
   * Returns undefined when:
   *   - the project has neither organization_id nor created_by (legacy row)
   *   - no resolved provider exists or none has a valid model for this complexity
   *   - the resolved provider is github-copilot (already the default path)
   */
  private async resolveProviderOverride(task: AgentTask): Promise<ProviderOverride | undefined> {
    try {
      const { rows } = await this.db.query<{
        organization_id: string | null;
        created_by:      string | null;
      }>(
        'SELECT organization_id, created_by FROM projects WHERE id = $1',
        [task.projectId],
      );
      const orgId    = rows[0]?.organization_id ?? null;
      const ownerId  = rows[0]?.created_by      ?? null;

      // Need at least one scope to look up — both null = legacy/bootstrap row.
      if (!orgId && !ownerId) return undefined;

      // "User wins, org fallback" — project owner's personal key takes
      // precedence over the org-shared one (per spec v0.3 Krok 3).
      const active = ownerId
        ? await this.aiProviders.resolveForUser(ownerId, orgId)
        : await this.aiProviders.resolveActiveForOrg(orgId!);
      if (!active) return undefined;

      // Skip override for github-copilot (Copilot is the default path anyway).
      if (active.provider.provider === 'github-copilot') return undefined;

      const modelName = resolveProviderModel(
        active.provider.provider,
        task.complexity,
        active.provider.defaultModel,
      );
      if (!modelName) {
        this.logger.warn(
          { providerId: active.provider.id, provider: active.provider.provider, complexity: task.complexity },
          'AI provider has no model for this complexity and no defaultModel — falling back to Copilot',
        );
        return undefined;
      }

      // OpenCode model ID format: "<provider>/<model>"
      const prefixedModel = `${active.provider.provider}/${modelName}`;

      this.logger.info(
        {
          taskId:   task.id,
          provider: active.provider.provider,
          model:    prefixedModel,
          scope:    active.provider.userId ? 'user' : 'org-shared',
          ownerId,
        },
        'Using resolved AI provider override',
      );

      return {
        type:    active.provider.provider,
        model:   prefixedModel,
        apiKey:  active.apiKey,
        baseUrl: active.provider.baseUrl,
      };
    } catch (err) {
      this.logger.warn({ taskId: task.id, err: (err as Error).message }, 'Failed to resolve AI provider override');
      return undefined;
    }
  }

  /**
   * Run deterministic QA validation against the project workspace after a
   * code-writing task completes. Tools are auto-detected from package.json
   * and config files; results land in `agent_qa_results` and are broadcast
   * via EventBus so the UI can refresh in real time.
   *
   * Never throws — QA is advisory and must not affect the parent task lifecycle.
   */
  private async runPostTaskQa(task: AgentTask): Promise<void> {
    try {
      const workspacePath = await this.getProjectWorkspaceDir(task.projectId);
      const results = await this.qaRunner.runAndStore(task.id, workspacePath);
      if (results.length === 0) return;

      const failed = results.filter((r) => r.status === 'failed' || r.status === 'error');
      this.eventBus.publish(
        'qa:completed',
        task.sessionId,
        {
          taskId:       task.id,
          totalTools:   results.length,
          failedTools:  failed.length,
          totalErrors:  results.reduce((sum, r) => sum + r.errorCount, 0),
          totalWarnings: results.reduce((sum, r) => sum + r.warningCount, 0),
          results: results.map((r) => ({
            tool:         r.tool,
            status:       r.status,
            summary:      r.summary,
            errorCount:   r.errorCount,
            warningCount: r.warningCount,
            durationMs:   r.durationMs,
          })),
        },
        task.id,
      );
    } catch (err) {
      this.logger.warn({ taskId: task.id, err: (err as Error).message }, 'Post-task QA failed');
    }
  }

  private async getProjectWorkspaceDir(projectId: string, sessionId?: string): Promise<string> {
    let projectRoot: string;
    try {
      const { rows } = await this.db.query<{ workspace_path: string }>(
        'SELECT workspace_path FROM projects WHERE id = $1',
        [projectId],
      );
      projectRoot = rows[0]?.workspace_path
        ?? nodePath.join(env.WORKSPACES_ROOT, projectId);
    } catch (err) {
      this.logger.warn({ projectId, error: (err as Error).message }, 'Failed to fetch workspace_path');
      projectRoot = nodePath.join(env.WORKSPACES_ROOT, projectId);
    }

    if (!sessionId) return projectRoot;
    return nodePath.join(projectRoot, 'sessions', sessionId);
  }

  // ─── Obsidian vault: Document Agent ──────────────────────────────────────────

  /**
   * Spawns a new task with an escalated model when an agent requests a more
   * powerful model mid-run. The original task continues; the escalated task
   * will re-attempt the same work with a better model.
   * Fire-and-forget — escalation failure must not crash the current task.
   */
  private async spawnEscalatedTask(
    originalTask: AgentTask,
    newComplexity: import('@agent-orchestrator/shared').TaskComplexity,
    reason: string,
    githubToken: string,
    additionalEnv?: Record<string, string>,
  ): Promise<void> {
    try {
      const taskId = uuid();
      const newModel = resolveModel(newComplexity, newComplexity, newComplexity);

      await this.db.query(
         `INSERT INTO agent_tasks
            (id, session_id, project_id, context_type, agent_type, agent_id, prompt,
             status, complexity, model, max_steps, depends_on)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, '{}')`,
         [
           taskId,
           originalTask.sessionId,
           originalTask.projectId,
           originalTask.contextType,
           originalTask.agentType,
           originalTask.agentId,
           `[ESCALATED from ${originalTask.complexity}→${newComplexity}: ${reason}]\n\n${originalTask.prompt}`,
           newComplexity,
           newModel,
           originalTask.maxSteps,
         ],
       );

      const escalatedTask: AgentTask = {
        ...originalTask,
        id: taskId,
        complexity: newComplexity,
        model: newModel,
        prompt: `[ESCALATED from ${originalTask.complexity}→${newComplexity}: ${reason}]\n\n${originalTask.prompt}`,
        status: 'pending',
        currentStep: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        dependsOn: [],
        createdAt: new Date(),
      };

      this.eventBus.publish('task:created', originalTask.sessionId, {
        ...escalatedTask,
        escalatedFrom: originalTask.id,
        escalationReason: reason,
      }, taskId);

      await this.enqueueTask(escalatedTask, githubToken, { additionalEnv });

      this.logger.info(
        { escalatedTaskId: taskId, originalTaskId: originalTask.id, newComplexity, reason },
        'Escalated task enqueued with higher model',
      );
    } catch (err) {
      this.logger.warn({ err, originalTaskId: originalTask.id }, 'Failed to spawn escalated task');
    }
  }

  /**
   * Spawns a Visual QA Agent after a frontend task completes.
   * Takes screenshots and verifies UI at multiple viewports.
   * Fire-and-forget.
   */
  private async spawnVisualQaTask(
    parentTask: AgentTask,
    githubToken: string,
    additionalEnv?: Record<string, string>,
  ): Promise<void> {
    try {
      const taskId = uuid();
      const prompt = `Run Visual QA checks for the frontend work completed by task ${parentTask.id}.

## Completed frontend task
- Prompt: ${parentTask.prompt.slice(0, 300)}
- Cost: $${(parentTask.costUsd ?? 0).toFixed(4)}

## Your task
1. Take screenshots at desktop (1440px), tablet (768px), and mobile (375px) viewports
2. Check for layout issues, overlapping elements, broken styles
3. Run basic accessibility checks with axe-core if available
4. Write a QA report to .obsidian-vault/QA/report-${new Date().toISOString().slice(0, 10)}.md`;

      await this.db.query(
         `INSERT INTO agent_tasks
            (id, session_id, project_id, context_type, agent_type, agent_id, prompt,
             status, complexity, model, max_steps, depends_on)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, '{}')`,
         [
           taskId,
           parentTask.sessionId,
           parentTask.projectId,
           parentTask.contextType,
           VISUAL_QA_AGENT.type,
           VISUAL_QA_AGENT.id,
           prompt,
           VISUAL_QA_AGENT.defaultComplexity,
           MODEL_ROUTING[VISUAL_QA_AGENT.defaultComplexity],
           VISUAL_QA_AGENT.maxSteps,
         ],
       );

      const qaTask: AgentTask = {
        id: taskId,
        sessionId: parentTask.sessionId,
        projectId: parentTask.projectId,
        contextType: parentTask.contextType,
        agentType: 'qa',
        agentId: VISUAL_QA_AGENT.id,
        prompt,
        status: 'pending',
        complexity: VISUAL_QA_AGENT.defaultComplexity,
        model: MODEL_ROUTING[VISUAL_QA_AGENT.defaultComplexity],
        currentStep: 0,
        maxSteps: VISUAL_QA_AGENT.maxSteps,
        contextTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        dependsOn: [],
        createdAt: new Date(),
      };

      this.eventBus.publish('task:created', parentTask.sessionId, qaTask, taskId);
      await this.enqueueTask(qaTask, githubToken, { additionalEnv });

      this.logger.info(
        { qaTaskId: taskId, parentTaskId: parentTask.id },
        'Visual QA task enqueued after frontend task',
      );
    } catch (err) {
      this.logger.warn({ err, parentTaskId: parentTask.id }, 'Failed to spawn Visual QA task');
    }
  }

  /**
   * Spawns a cheap DocumentAgent (Haiku) to write a summary of the completed
   * task to the project's Obsidian vault. Fire-and-forget — failures are logged
   * but do not affect the parent task.
   */
  private async spawnDocumentTask(
    parentTask: AgentTask,
    summary: string,
    githubToken: string,
    additionalEnv?: Record<string, string>,
  ): Promise<void> {
    try {
      const taskId = uuid();
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const prompt = `Write documentation for a completed agent task.

## Completed Task
- Agent: ${parentTask.agentType}
- Task ID: ${parentTask.id}
- Prompt: ${parentTask.prompt.slice(0, 500)}
- Summary: ${summary.slice(0, 1000)}
- Completed at: ${new Date().toISOString()}
- Cost: $${(parentTask.costUsd ?? 0).toFixed(4)}

## Your task
1. Append an entry to .obsidian-vault/Daily/${today}.md (create if it doesn't exist)
2. If the task involved architectural decisions, write/update an ADR in .obsidian-vault/Architecture/
3. If the task created new components or APIs, update .obsidian-vault/Components/component-registry.md
4. Keep entries concise and factual.`;

      await this.db.query(
         `INSERT INTO agent_tasks
            (id, session_id, project_id, context_type, agent_type, agent_id, prompt,
             status, complexity, model, max_steps, depends_on)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, '{}')`,
         [
           taskId,
           parentTask.sessionId,
           parentTask.projectId,
           parentTask.contextType,
           DOCUMENT_AGENT.type,
           DOCUMENT_AGENT.id,
           prompt,
           DOCUMENT_AGENT.defaultComplexity,
           MODEL_ROUTING[DOCUMENT_AGENT.defaultComplexity],
           DOCUMENT_AGENT.maxSteps,
         ],
       );

      const docTask: AgentTask = {
        id: taskId,
        sessionId: parentTask.sessionId,
        projectId: parentTask.projectId,
        contextType: parentTask.contextType,
        agentType: 'document',
        agentId: DOCUMENT_AGENT.id,
        prompt,
        status: 'pending',
        complexity: DOCUMENT_AGENT.defaultComplexity,
        model: MODEL_ROUTING[DOCUMENT_AGENT.defaultComplexity],
        currentStep: 0,
        maxSteps: DOCUMENT_AGENT.maxSteps,
        contextTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        dependsOn: [],
        createdAt: new Date(),
      };

      // Notify dashboard that a document task was created
      this.eventBus.publish('task:created', parentTask.sessionId, docTask, taskId);

      await this.enqueueTask(docTask, githubToken, { additionalEnv });

      this.logger.info(
        { documentTaskId: taskId, parentTaskId: parentTask.id, parentAgentType: parentTask.agentType },
        'Document task enqueued for Obsidian vault',
      );
    } catch (err) {
      // Non-fatal — documentation failure must not break the session
      this.logger.warn(
        { parentTaskId: parentTask.id, error: (err as Error).message },
        'Failed to spawn document task',
      );
    }
  }

  // ─── Context Inject ───────────────────────────────────────────────────────────

  /**
   * Injects a user message into a currently running OpenCode process.
   * Returns true if the task is running and the message was sent.
   */
  injectToTask(taskId: string, message: string): boolean {
    return this.processManager.injectMessage(taskId, message);
  }

  // ─── Orchestrator plan → subtasks ────────────────────────────────────────────

  /**
   * Parses the orchestrator's JSON plan, creates subtask rows in DB,
   * publishes `task:created` for each, and immediately enqueues tasks
   * that have no dependencies.
   */
  private async createSubtasksFromPlan(
    plan: OrchestratorPlan,
    orchestratorTask: AgentTask,
    githubToken: string,
    additionalEnv?: Record<string, string>,
  ): Promise<void> {
    const { sessionId, projectId } = orchestratorTask;

    // Map logical plan IDs → real UUIDs
    const idMap = new Map<string, string>();
    for (const t of plan.tasks) {
      idMap.set(t.id, uuid());
    }

    const tasksToEnqueueNow: AgentTask[] = [];

    for (const planTask of plan.tasks) {
      const agentDef = getAgentByType(planTask.agentType);
      if (!agentDef) {
        this.logger.warn(
          { agentType: planTask.agentType },
          'Unknown agent type in orchestrator plan — skipping',
        );
        continue;
      }

      const taskId = idMap.get(planTask.id)!;
      const complexity = (planTask.complexity ?? agentDef.defaultComplexity) as TaskComplexity;

      // Resolve dependency logical IDs → real UUIDs (skip unknown IDs)
      const dependsOn = planTask.dependsOn
        .map((d) => idMap.get(d))
        .filter((id): id is string => id !== undefined);

      // ── Splittable agent → wrap in a Planner task ─────────────────────────
      // Instead of running the worker agent directly on the entire prompt,
      // we first run the cheap Planner (haiku) which breaks the prompt into
      // atomic Tickets. The Planner's onComplete handler then spawns one
      // haiku worker task per ticket.
      //
      // SKIP the planner for trivial/simple complexity — the overhead of
      // planning + spawning N tickets dwarfs the actual work. Run the worker
      // directly in those cases (single-shot execution).
      const shouldSkipPlanner = complexity === 'trivial' || complexity === 'simple';

      if (isSplittableAgent(agentDef.type) && !shouldSkipPlanner) {
        const plannerModel = resolveModel(
          PLANNER_AGENT.defaultComplexity,
          PLANNER_AGENT.defaultComplexity,
          PLANNER_AGENT.canEscalateTo,
        );
        const plannerPrompt = `Target agent: ${agentDef.type}
High-level task description for that agent:

${planTask.prompt}

Break this into atomic tickets per the schema.`;

        await this.db.query(
           `INSERT INTO agent_tasks
              (id, session_id, project_id, context_type, agent_type, agent_id, prompt,
               status, complexity, model, max_steps, depends_on, target_agent_type)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11, $12)`,
           [
             taskId,
             sessionId,
             projectId,
             orchestratorTask.contextType,
             'planner',
             PLANNER_AGENT.id,
             plannerPrompt,
             PLANNER_AGENT.defaultComplexity,
             plannerModel,
             PLANNER_AGENT.maxSteps,
             dependsOn,
             agentDef.type,
           ],
         );

        const plannerTask: AgentTask = {
          id: taskId,
          sessionId,
          projectId,
          contextType: orchestratorTask.contextType,
          agentType: 'planner',
          agentId: PLANNER_AGENT.id,
          prompt: plannerPrompt,
          status: 'pending',
          complexity: PLANNER_AGENT.defaultComplexity,
          model: plannerModel,
          currentStep: 0,
          maxSteps: PLANNER_AGENT.maxSteps,
          contextTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          dependsOn,
          targetAgentType: agentDef.type as AgentType,
          createdAt: new Date(),
        };

        this.eventBus.publish('task:created', sessionId, plannerTask, taskId);
        if (dependsOn.length === 0) {
          tasksToEnqueueNow.push(plannerTask);
        }
        continue;
      }

      // ── Non-splittable agent → execute directly (legacy path) ─────────────
      const model = resolveModel(agentDef.defaultComplexity, complexity, agentDef.canEscalateTo);

      // Insert subtask into DB
      const destructiveReason = getDestructiveReason(planTask);
      const initialStatus = destructiveReason ? 'awaiting_approval' : 'pending';

      await this.db.query(
         `INSERT INTO agent_tasks
            (id, session_id, project_id, context_type, agent_type, agent_id, prompt,
             status, complexity, model, max_steps, depends_on)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
         [
           taskId,
           sessionId,
           projectId,
           orchestratorTask.contextType,
           agentDef.type,
           agentDef.id,
           planTask.prompt,
           initialStatus,
           complexity,
           model,
           agentDef.maxSteps,
           dependsOn,
         ],
       );

      const task: AgentTask = {
        id: taskId,
        sessionId,
        projectId,
        contextType: orchestratorTask.contextType,
        agentType: agentDef.type as AgentType,
        agentId: agentDef.id,
        prompt: planTask.prompt,
        status: initialStatus,
        complexity,
        model,
        currentStep: 0,
        maxSteps: agentDef.maxSteps,
        contextTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        dependsOn,
        createdAt: new Date(),
      };

      // Notify the frontend dashboard that a new task has been created
      this.eventBus.publish('task:created', sessionId, task, taskId);

      if (destructiveReason) {
        // Publish approval:required — frontend will show a modal
        this.eventBus.publish(
          'approval:required',
          sessionId,
          {
            taskId,
            sessionId,
            agentType: agentDef.type,
            prompt: planTask.prompt,
            reason: destructiveReason,
          },
          taskId,
        );
        this.logger.info(
          { taskId, agentType: agentDef.type, reason: destructiveReason },
          'Task requires approval — holding in awaiting_approval state',
        );
      } else if (dependsOn.length === 0) {
        tasksToEnqueueNow.push(task);
      }
    }

    this.logger.info(
      {
        sessionId,
        analysis: plan.analysis,
        planTaskCount: plan.tasks.length,
        enqueueable: tasksToEnqueueNow.length,
      },
      'Orchestrator plan parsed — creating subtasks',
    );

    // Immediately enqueue tasks with no dependencies
    for (const task of tasksToEnqueueNow) {
      await this.enqueueTask(task, githubToken, { additionalEnv });
    }
  }

  // ─── Budget threshold alerting ────────────────────────────────────────────────

  /**
   * Checks whether `currentCostUsd` has crossed a budget threshold (80%, 100%).
   * Publishes a `budget:alert` WS event each time a new threshold is crossed.
   * Fires at most once per session per threshold.
   */
  private async checkBudgetAlerts(sessionId: string, currentCostUsd: number): Promise<void> {
    try {
      // Lazy-load budget cap from DB (cached per session)
      if (!this.sessionBudgets.has(sessionId)) {
        const { rows } = await this.db.query<{ budget_cap_usd: string }>(
          'SELECT budget_cap_usd FROM sessions WHERE id = $1',
          [sessionId],
        );
        const cap = rows[0] ? parseFloat(rows[0].budget_cap_usd) : 0;
        this.sessionBudgets.set(sessionId, cap);
      }

      const budgetCapUsd = this.sessionBudgets.get(sessionId) ?? 0;
      if (budgetCapUsd <= 0) return;

      const pct = currentCostUsd / budgetCapUsd;

      for (const threshold of [0.8, 1.0]) {
        const thresholdPct = Math.round(threshold * 100);
        const alertKey = `${sessionId}:${thresholdPct}`;

        if (pct >= threshold && !this.firedBudgetAlerts.has(alertKey)) {
          this.firedBudgetAlerts.add(alertKey);

          this.logger.warn(
            { sessionId, currentCostUsd, budgetCapUsd, thresholdPct },
            'Budget threshold reached',
          );

          this.eventBus.publish(
            'budget:alert',
            sessionId,
            { sessionId, currentCostUsd, budgetCapUsd, thresholdPct },
            undefined,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        { sessionId, error: (err as Error).message },
        'Failed to check budget alerts',
      );
    }
  }

  // ─── Event-driven dependency resolution ──────────────────────────────────────

  /**
   * After a task completes, finds all pending tasks in the session whose
   * full dependency list is now satisfied, and enqueues them.
   *
   * Uses both the in-memory completedTaskIds set (fast path) and DB row data
   * (correctness across restarts).
   */
  private async checkAndEnqueueDependents(
    sessionId: string,
    completedTaskId: string,
    githubToken: string,
    additionalEnv?: Record<string, string>,
  ): Promise<void> {
    const { rows: candidates } = await this.db.query<{
      id: string;
      agent_type: string;
      agent_id: string;
      prompt: string;
      complexity: string;
      model: string;
      max_steps: number;
      depends_on: string[];
      project_id: string;
      session_id: string;
      context_type: string;
      ticket_id: string | null;
      target_agent_type: string | null;
    }>(
      `SELECT id, agent_type, agent_id, prompt, complexity, model,
              max_steps, depends_on, project_id, session_id, context_type,
              ticket_id, target_agent_type
       FROM agent_tasks
       WHERE session_id = $1
         AND status IN ('pending', 'planning')
         AND $2 = ANY(depends_on)`,
      [sessionId, completedTaskId],
    );

    for (const row of candidates) {
      const allDepsCompleted = row.depends_on.every((depId) =>
        this.completedTaskIds.has(depId),
      );

      if (!allDepsCompleted) {
        this.logger.debug(
          {
            taskId: row.id,
            pendingDeps: row.depends_on.filter((d) => !this.completedTaskIds.has(d)),
          },
          'Task still waiting for other dependencies',
        );
        continue;
      }

      const task: AgentTask = {
        id: row.id,
        sessionId: row.session_id,
        projectId: row.project_id,
        contextType: (row.context_type as 'personal' | 'cez') ?? 'personal',
        agentType: row.agent_type as AgentType,
        agentId: row.agent_id,
        prompt: row.prompt,
        status: 'pending',
        complexity: row.complexity as TaskComplexity,
        model: row.model,
        currentStep: 0,
        maxSteps: row.max_steps,
        contextTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        dependsOn: row.depends_on,
        ticketId: row.ticket_id,
        targetAgentType: (row.target_agent_type as AgentType | null),
        createdAt: new Date(),
      };

      this.logger.info(
        { taskId: task.id, agentType: task.agentType },
        'All dependencies satisfied — enqueuing task',
      );

      await this.enqueueTask(task, githubToken, { additionalEnv });
    }
  }

  // ─── Session completion check ─────────────────────────────────────────────────

  /**
   * Called after every non-orchestrator task completes.
   * If ALL tasks in the session are in a terminal state (completed/failed/cancelled),
   * marks the session as completed and publishes a session:completed WS event.
   */
  private async checkAndCloseSession(sessionId: string): Promise<void> {
    const { rows } = await this.db.query<{ status: string; cost_usd: string }>(
      `SELECT status, cost_usd FROM agent_tasks WHERE session_id = $1`,
      [sessionId],
    );

    if (rows.length === 0) return;

    const allDone = rows.every((r) =>
      ['completed', 'failed', 'cancelled'].includes(r.status),
    );

    if (!allDone) return;

    const totalCostUsd = rows.reduce((sum, r) => sum + parseFloat(r.cost_usd), 0);
    const hasFailed = rows.some((r) => r.status === 'failed');
    const finalStatus = hasFailed ? 'failed' : 'completed';

    await this.db.query(
      `UPDATE sessions
       SET status = $2, total_cost_usd = $3, updated_at = NOW()
       WHERE id = $1 AND status = 'active'`,
      [sessionId, finalStatus, totalCostUsd],
    );

    this.eventBus.publish(
      'session:update',
      sessionId,
      { sessionId, status: finalStatus, totalCostUsd },
      undefined,
    );

    this.logger.info({ sessionId, finalStatus, totalCostUsd }, 'Session closed');
  }

  // ─── Worker lifecycle events ──────────────────────────────────────────────────

  private setupWorkerEvents(): void {
    this.worker.on('failed', async (job, error) => {
      if (!job) return;
      const { task } = job.data;

      this.logger.error(
        { taskId: task.id, error: error.message, attempts: job.attemptsMade },
        'Agent task failed',
      );

      // Only mark permanently failed after all retries exhausted
      if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
        await this.onTaskStatusChange(task.id, 'failed', { error: error.message });
        this.eventBus.publish(
          'agent:status',
          task.sessionId,
          { taskId: task.id, status: 'failed', currentStep: 0, maxSteps: task.maxSteps },
          task.id,
        );
      }
    });

    this.worker.on('error', (error) => {
      this.logger.error({ error: error.message }, 'BullMQ worker error');
    });
  }

  async close(): Promise<void> {
    await this.worker.close();
  }

  // ─── Planner → tickets → ticket-bound worker tasks ─────────────────────────

  /**
   * After a Planner agent task completes, parse its JSON tickets[] output,
   * persist a Ticket row per entry, and spawn one cheap (haiku) worker
   * agent_task per ticket. Tickets execute sequentially within a planner
   * batch (each waits for the previous one to finish) so file conflicts
   * are avoided.
   */
  private async handlePlannerComplete(
    plannerTask: AgentTask,
    summary: string,
    rawOutput: string,
    githubToken: string,
    additionalEnv?: Record<string, string>,
  ): Promise<void> {
    const targetType = plannerTask.targetAgentType;
    if (!targetType) {
      this.logger.warn(
        { taskId: plannerTask.id },
        'Planner task has no target_agent_type — skipping ticket generation',
      );
      return;
    }

    // Try full raw output first (untruncated), then fall back to summary
    const planFromRaw = tryParsePlannerOutput(rawOutput);
    const plan = planFromRaw ?? tryParsePlannerOutput(summary);

    // Hard cap on ticket count — if planner went overboard, merge extras into the last ticket.
    // Prevents 10+ Haiku spawns for tasks that should have been 4-6.
    const MAX_TICKETS = 6;
    if (plan && plan.tickets.length > MAX_TICKETS) {
      const kept = plan.tickets.slice(0, MAX_TICKETS - 1);
      const overflow = plan.tickets.slice(MAX_TICKETS - 1);
      const mergedTitle = overflow.length === 1
        ? overflow[0]!.title
        : `Final integration & polish (${overflow.length} merged subtasks)`;
      const mergedDescription = overflow
        .map((t, i) => `### ${i + 1}. ${t.title}\n${t.description}`)
        .join('\n\n');
      const mergedFiles = [...new Set(overflow.flatMap((t) => t.files ?? []))];
      kept.push({
        title: mergedTitle,
        description: mergedDescription,
        complexity: 'simple',
        priority: 'normal',
        files: mergedFiles.length > 0 ? mergedFiles : ['*'],
      });
      this.logger.warn(
        { plannerTaskId: plannerTask.id, originalCount: plan.tickets.length, capped: kept.length },
        `Planner produced too many tickets — merged tail into one`,
      );
      plan.tickets = kept;
    }

    if (!plan || plan.tickets.length === 0) {
      this.logger.warn(
        {
          taskId: plannerTask.id,
          targetType,
          rawLen: rawOutput.length,
          summary: summary.slice(0, 300),
        },
        'Planner completed but produced no parseable tickets — falling back to single-task execution',
      );
      // Fallback: execute the original prompt directly with the worker agent.
      await this.spawnFallbackWorker(plannerTask, targetType, githubToken, additionalEnv);
      return;
    }

    const targetAgent = getAgentByType(targetType);
    if (!targetAgent) {
      this.logger.error({ targetType }, 'Target agent type not found');
      return;
    }

    this.logger.info(
      { plannerTaskId: plannerTask.id, targetType, ticketCount: plan.tickets.length },
      'Planner produced tickets — spawning worker tasks',
    );

    // Persist planner output for audit trail
    await this.db.query(
      'UPDATE agent_tasks SET planner_output = $2 WHERE id = $1',
      [plannerTask.id, JSON.stringify(plan)],
    );

    // ── Build per-ticket dependency graph based on file overlap ─────────────
    // A ticket depends on every earlier ticket that:
    //   - shares at least one file path with it, OR
    //   - declared "*" (unknown / exclusive scope), OR
    //   - the current ticket itself declared "*" (force serialize against all)
    // Tickets with disjoint file sets run in parallel.
    function normalizeFiles(files: string[] | undefined): { exclusive: boolean; set: Set<string> } {
      if (!files || files.length === 0) return { exclusive: true, set: new Set() }; // safety: treat unknown as exclusive
      const set = new Set<string>();
      let exclusive = false;
      for (const f of files) {
        const trimmed = f.trim();
        if (!trimmed) continue;
        if (trimmed === '*') { exclusive = true; continue; }
        // normalise leading ./ and / to keep equality robust
        set.add(trimmed.replace(/^\.?\/+/, ''));
      }
      return { exclusive, set };
    }

    const fileSets = plan.tickets.map((t) => normalizeFiles(t.files));
    const taskIds: string[] = [];
    const ticketIds: string[] = [];
    const ticketObjs: Awaited<ReturnType<typeof this.tickets.createTicket>>[] = [];
    const workerTasks: AgentTask[] = [];
    const enqueueImmediately: AgentTask[] = [];

    // Pre-allocate UUIDs so we can reference them in dependsOn arrays
    for (let i = 0; i < plan.tickets.length; i++) {
      taskIds.push(uuid());
    }

    for (let i = 0; i < plan.tickets.length; i++) {
      const plannerTicket = plan.tickets[i]!;
      const myFiles = fileSets[i]!;

      // Create ticket row
      const ticket = await this.tickets.createTicket({
        sessionId: plannerTask.sessionId,
        projectId: plannerTask.projectId,
        parentTaskId: plannerTask.id,
        targetAgentType: targetType,
        plannerTicket,
      });
      ticketObjs.push(ticket);
      ticketIds.push(ticket.id);

      this.eventBus.publish('ticket:created', plannerTask.sessionId, { ticket });

      // Spawn one worker task per ticket
      const workerTaskId = taskIds[i]!;
      const workerComplexity = (plannerTicket.complexity ?? 'trivial') as TaskComplexity;
      const workerModel = resolveModel(
        workerComplexity,
        workerComplexity,
        targetAgent.canEscalateTo,
      );

      // ── Compute deps: every earlier ticket whose files overlap with mine,
      //    plus all earlier tickets if either side is exclusive ("*").
      const dependsOn: string[] = [];
      for (let j = 0; j < i; j++) {
        const other = fileSets[j]!;
        const overlap = myFiles.exclusive
          || other.exclusive
          || [...myFiles.set].some((f) => other.set.has(f));
        if (overlap) dependsOn.push(taskIds[j]!);
      }

      const workerPrompt = `[Ticket ${ticket.ticketKey}] ${ticket.title}

${ticket.description}`;

      await this.db.query(
         `INSERT INTO agent_tasks
            (id, session_id, project_id, context_type, agent_type, agent_id, prompt,
             status, complexity, model, max_steps, depends_on, ticket_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11, $12)`,
         [
           workerTaskId,
           plannerTask.sessionId,
           plannerTask.projectId,
           plannerTask.contextType,
           targetAgent.type,
           targetAgent.id,
           workerPrompt,
           workerComplexity,
           workerModel,
           targetAgent.maxSteps,
           dependsOn,
           ticket.id,
         ],
       );

      // Link ticket → current_task
      await this.tickets.updateStatus(ticket.id, 'todo', { currentTaskId: workerTaskId });
      await this.tickets.createIteration({
        ticketId: ticket.id,
        taskId: workerTaskId,
        iteration: 1,
        status: 'pending',
      });

      const workerTask: AgentTask = {
        id: workerTaskId,
        sessionId: plannerTask.sessionId,
        projectId: plannerTask.projectId,
        contextType: plannerTask.contextType,
        agentType: targetAgent.type as AgentType,
        agentId: targetAgent.id,
        prompt: workerPrompt,
        status: 'pending',
        complexity: workerComplexity,
        model: workerModel,
        currentStep: 0,
        maxSteps: targetAgent.maxSteps,
        contextTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        dependsOn,
        ticketId: ticket.id,
        createdAt: new Date(),
      };
      workerTasks.push(workerTask);

      this.eventBus.publish('task:created', plannerTask.sessionId, workerTask, workerTaskId);

      // Enqueue everything with no dependencies right now (parallel start)
      if (dependsOn.length === 0) {
        enqueueImmediately.push(workerTask);
      }
    }

    this.logger.info(
      {
        plannerTaskId: plannerTask.id,
        targetType,
        ticketCount: plan.tickets.length,
        parallelStart: enqueueImmediately.length,
        sequentialChained: plan.tickets.length - enqueueImmediately.length,
      },
      'Tickets created — starting parallel-safe execution',
    );

    for (const t of enqueueImmediately) {
      await this.enqueueTask(t, githubToken, { additionalEnv });
    }
  }

  /**
   * If the Planner fails to produce parseable output, fall back to running
   * the target agent directly on the original prompt (the planner prompt
   * starts with "Target agent:\n... task description").
   */
  private async spawnFallbackWorker(
    plannerTask: AgentTask,
    targetType: AgentType,
    githubToken: string,
    additionalEnv?: Record<string, string>,
  ): Promise<void> {
    const targetAgent = getAgentByType(targetType);
    if (!targetAgent) return;

    // Strip the "Target agent: X\n\nHigh-level..." preamble from the planner prompt
    const cleanedPrompt = plannerTask.prompt
      .replace(/^Target agent:.*?\n+/s, '')
      .replace(/^High-level task description for that agent:\s*/m, '')
      .replace(/\n+Break this into atomic tickets per the schema\.\s*$/m, '')
      .trim();

    const taskId = uuid();
    const complexity = targetAgent.defaultComplexity;
    const model = resolveModel(complexity, complexity, targetAgent.canEscalateTo);

    await this.db.query(
       `INSERT INTO agent_tasks
          (id, session_id, project_id, context_type, agent_type, agent_id, prompt,
           status, complexity, model, max_steps, depends_on)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, '{}')`,
       [
         taskId,
         plannerTask.sessionId,
         plannerTask.projectId,
         plannerTask.contextType,
         targetAgent.type,
         targetAgent.id,
         cleanedPrompt,
         complexity,
         model,
         targetAgent.maxSteps,
       ],
     );

    const fallbackTask: AgentTask = {
      id: taskId,
      sessionId: plannerTask.sessionId,
      projectId: plannerTask.projectId,
      contextType: plannerTask.contextType,
      agentType: targetAgent.type as AgentType,
      agentId: targetAgent.id,
      prompt: cleanedPrompt,
      status: 'pending',
      complexity,
      model,
      currentStep: 0,
      maxSteps: targetAgent.maxSteps,
      contextTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      dependsOn: [],
      createdAt: new Date(),
    };

    this.eventBus.publish('task:created', plannerTask.sessionId, fallbackTask, taskId);
    await this.enqueueTask(fallbackTask, githubToken, { additionalEnv });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-context environment variable injection
//
// Each context type carries different credentials that are available to the
// agent process. Only vars that are set in the API server's env are injected
// — missing ones are silently skipped.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a file extension to a markdown code-fence language hint. Used when
 * embedding `@file` referenced contents in the system prompt — gives the
 * agent a syntactic cue instead of a bare ``` block. Unknown extensions
 * fall back to an empty hint (still a valid fenced block).
 */
function inferLangFromPath(p: string): string {
  const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'ts': case 'tsx': return 'ts';
    case 'js': case 'jsx': case 'mjs': case 'cjs': return 'js';
    case 'vue': return 'vue';
    case 'py': return 'python';
    case 'rb': return 'ruby';
    case 'go': return 'go';
    case 'rs': return 'rust';
    case 'java': return 'java';
    case 'kt': return 'kotlin';
    case 'swift': return 'swift';
    case 'php': return 'php';
    case 'cs': return 'csharp';
    case 'cpp': case 'cc': case 'cxx': case 'hpp': case 'hh': return 'cpp';
    case 'c': case 'h': return 'c';
    case 'sh': case 'bash': case 'zsh': return 'bash';
    case 'sql': return 'sql';
    case 'json': return 'json';
    case 'yaml': case 'yml': return 'yaml';
    case 'toml': return 'toml';
    case 'xml': return 'xml';
    case 'html': case 'htm': return 'html';
    case 'css': return 'css';
    case 'scss': case 'sass': return 'scss';
    case 'md': case 'markdown': return 'md';
    case 'dockerfile': return 'dockerfile';
    default:
      if (p.toLowerCase().endsWith('dockerfile')) return 'dockerfile';
      return '';
  }
}

function buildContextEnv(contextType: 'personal' | 'cez'): Record<string, string> {
  const result: Record<string, string> = {};

  if (contextType === 'personal') {
    // GitHub token already passed as GITHUB_TOKEN via spawnAgent options
    if (env.VERCEL_TOKEN) result['VERCEL_TOKEN'] = env.VERCEL_TOKEN;
    if (env.HETZNER_API_TOKEN) result['HETZNER_API_TOKEN'] = env.HETZNER_API_TOKEN;
  }

  if (contextType === 'cez') {
    if (env.CEZ_VAULT_ADDR) result['VAULT_ADDR'] = env.CEZ_VAULT_ADDR;
    if (env.CEZ_GITLAB_TOKEN) result['GITLAB_TOKEN'] = env.CEZ_GITLAB_TOKEN;
    if (env.CEZ_OPENSHIFT_TOKEN) result['OPENSHIFT_TOKEN'] = env.CEZ_OPENSHIFT_TOKEN;
    if (env.CEZ_NEXUS_URL) result['NEXUS_URL'] = env.CEZ_NEXUS_URL;
  }

  return result;
}
