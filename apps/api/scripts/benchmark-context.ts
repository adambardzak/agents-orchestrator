#!/usr/bin/env tsx
/**
 * benchmark-context.ts
 *
 * Standalone harness that measures the per-block character/token cost of the
 * agent prompt assembly across representative scenarios. The goal is data-
 * driven optimisation: before we apply caveman-style compression to skills /
 * frontend-rules / RAG output, we want to know which blocks dominate the
 * prompt budget in realistic configurations.
 *
 * The harness:
 *   1. Boots its own in-process TaskQueue + AgentWorker against the local
 *      Postgres + Redis (same DSNs the API uses, via env.ts). It does NOT
 *      require a running API server.
 *   2. Replaces the OpenCode binary with the mock at test/mock-opencode.js
 *      so spawns return synthetic NDJSON instantly and no model tokens are
 *      burned.
 *   3. Stubs RagService.retrieveContext to return deterministic fake chunks
 *      (so we don't depend on Copilot embeddings, which are flaky).
 *   4. Captures every `event: "context-budget"` emission via a custom Pino
 *      stream. Each scenario runs one task; we read back its breakdown.
 *   5. Aggregates results into /tmp/context-benchmark-report.md.
 *
 * Usage:
 *   pnpm --filter api bench:context
 *   # or directly:
 *   tsx apps/api/scripts/benchmark-context.ts
 *
 * Re-run safe; depends on `seed-bench.ts` having run at least once.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// ─── Load .env manually then force-override OPENCODE_BINARY ───────────────
// Important: env.ts evaluates env vars at import time. ESM imports are
// hoisted, so a module-top `process.env.X = …` runs AFTER all imports.
// Solution: load env synchronously in this top section, then dynamic-import
// every module that depends on env.ts inside main().
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv(envPath: string): void {
  let envContent: string;
  try {
    envContent = readFileSync(envPath, 'utf8');
  } catch {
    console.warn('⚠ No .env at', envPath);
    return;
  }
  let count = 0;
  for (const line of envContent.split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key] !== undefined) continue;
    let val = raw;
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
    count++;
  }
  if (process.env.BENCH_DEBUG) {
    console.log(`[bench-debug] loaded ${count} env vars from ${envPath}`);
  }
}

loadEnv(path.resolve(__dirname, '../.env'));

// Force-override AFTER .env load (overrides .env entry).
const MOCK_OPENCODE = path.resolve(__dirname, '../../../test/mock-opencode.js');
process.env.OPENCODE_BINARY = MOCK_OPENCODE;
process.env.GITHUB_TOKEN    = process.env.GITHUB_TOKEN ?? 'bench-fake-token';

// ─── Static imports (these don't depend on env.ts at module-init time) ────
import { Pool } from 'pg';
import IORedis from 'ioredis';
import { v4 as uuid } from 'uuid';
import pino from 'pino';
import type { AgentTask, AgentType } from '@agent-orchestrator/shared';

// NOTE: env.ts, OpenCodeProcessManager, EventBus, CostTracker, TaskQueue,
// RagService, and built-in agent definitions are all imported dynamically
// inside main() AFTER process.env.OPENCODE_BINARY override has taken effect.

import { BENCH_IDS } from './seed-bench.js';

// ─── Captured context-budget events ────────────────────────────────────────

interface BudgetBreakdown {
  base: number;
  [block: string]: number;
}

interface BudgetEvent {
  taskId: string;
  agent:  string;
  chars:  number;
  tokens: number;
  breakdown: BudgetBreakdown;
  filters?: Record<string, unknown>;
}

const captured: BudgetEvent[] = [];

/** Custom Pino destination — intercepts `context-budget` log records. */
const captureStream = {
  write(line: string): void {
    try {
      const rec = JSON.parse(line) as Record<string, unknown>;
      if (rec.event === 'context-budget') {
        captured.push({
          taskId:    String(rec.taskId),
          agent:     String(rec.agent),
          chars:     Number(rec.chars),
          tokens:    Number(rec.tokens),
          breakdown: rec.breakdown as BudgetBreakdown,
          filters:   rec.filters as Record<string, unknown> | undefined,
        });
      } else if (process.env.BENCH_DEBUG) {
        process.stderr.write(`[bench-debug] ${line}`);
      }
    } catch {
      if (process.env.BENCH_DEBUG) {
        process.stderr.write(`[bench-debug-nojson] ${line}`);
      }
    }
  },
};

const benchLogger = pino(
  { level: 'info', base: null, timestamp: false },
  captureStream,
);

// ─── Stub RAG service ──────────────────────────────────────────────────────
//
// Returns synthetic chunks of fixed sizes so scenarios are deterministic and
// independent of the embeddings pipeline (which depends on the Copilot
// endpoint and would skew results).

function makeStubRag(): unknown {
  return {
    async retrieveContext(): Promise<unknown[]> {
      // 5 chunks × ~1500 chars each — matches default top-K and CHUNK_SIZE.
      return Array.from({ length: 5 }, (_, i) => ({
        path:    `src/example-${i}.ts`,
        score:   0.85 - i * 0.05,
        snippet: 'x'.repeat(1500),
      }));
    },
    formatAsContext(chunks: unknown[]): string {
      const arr = chunks as Array<{ path: string; snippet: string }>;
      return arr.map(c => `### ${c.path}\n\n\`\`\`\n${c.snippet}\n\`\`\``).join('\n\n');
    },
    async indexProjectFiles(): Promise<number> {
      return 0;
    },
  };
}

// ─── Scenario matrix ───────────────────────────────────────────────────────

type Scenario = {
  id:              string;
  label:           string;
  agentType:       AgentType;
  agentId:         string;
  complexity:      string;
  model:           string;
  maxSteps:        number;
  sessionId:       string;
  prompt:          string;
  referencedFiles: string[];
};

const SMALL_FILES = ['src/server.ts', 'src/users.ts', 'src/db.ts'];
// duplicate small files to get >5 entries; harmless, files just re-injected
const FIVE_SMALL = [...SMALL_FILES, 'src/server.ts', 'src/users.ts'];
const LARGE_FILES = ['src/large-file.ts', 'src/large-file.ts', 'src/large-file.ts'];

function buildScenarios(agents: {
  ARCHITECT_AGENT:    { id: string; defaultComplexity: string; maxSteps: number };
  BACKEND_AGENT:      { id: string; defaultComplexity: string; maxSteps: number };
  FRONTEND_AGENT:     { id: string; defaultComplexity: string; maxSteps: number };
  ORCHESTRATOR_AGENT: { id: string; defaultComplexity: string; maxSteps: number };
}): Scenario[] {
  const { ARCHITECT_AGENT, BACKEND_AGENT, FRONTEND_AGENT, ORCHESTRATOR_AGENT } = agents;
  return [
    {
      id: 'S1-orchestrator-baseline',
      label: 'Orchestrator (lean baseline; skips RAG/KB)',
      agentType: 'orchestrator',
      agentId: ORCHESTRATOR_AGENT.id,
      complexity: ORCHESTRATOR_AGENT.defaultComplexity,
      model: 'github-copilot/claude-sonnet-4-6',
      maxSteps: ORCHESTRATOR_AGENT.maxSteps,
      sessionId: BENCH_IDS.sessionMain,
      prompt: 'Plan a small feature: add /healthz endpoint',
      referencedFiles: [],
    },
    {
      id: 'S2-backend-typical',
      label: 'Backend subagent (RAG + KB, no skills)',
      agentType: 'backend',
      agentId: BACKEND_AGENT.id,
      complexity: BACKEND_AGENT.defaultComplexity,
      model: 'github-copilot/claude-sonnet-4-6',
      maxSteps: BACKEND_AGENT.maxSteps,
      sessionId: BENCH_IDS.sessionMain,
      prompt: 'Implement a POST /users endpoint with Zod validation',
      referencedFiles: [],
    },
    {
      id: 'S3-backend-skill-heavy',
      label: 'Backend custom agent with 5-skill snapshot',
      agentType: 'backend',
      agentId: BENCH_IDS.customAgent,
      complexity: 'standard',
      model: 'github-copilot/claude-sonnet-4-6',
      maxSteps: 30,
      sessionId: BENCH_IDS.sessionMain,
      prompt: 'Implement a POST /users endpoint with Zod validation',
      referencedFiles: [],
    },
    {
      id: 'S4-frontend',
      label: 'Frontend subagent (loads design-system/frontend-rules.md)',
      agentType: 'frontend',
      agentId: FRONTEND_AGENT.id,
      complexity: FRONTEND_AGENT.defaultComplexity,
      model: 'github-copilot/claude-haiku-4-5',
      maxSteps: FRONTEND_AGENT.maxSteps,
      sessionId: BENCH_IDS.sessionMain,
      prompt: 'Build a UserCard.vue component',
      referencedFiles: [],
    },
    {
      id: 'S5-backend-files-small',
      label: 'Backend + 5 small @file refs (~3 KB each)',
      agentType: 'backend',
      agentId: BACKEND_AGENT.id,
      complexity: BACKEND_AGENT.defaultComplexity,
      model: 'github-copilot/claude-sonnet-4-6',
      maxSteps: BACKEND_AGENT.maxSteps,
      sessionId: BENCH_IDS.sessionMain,
      prompt: 'Refactor user routes referencing the included files',
      referencedFiles: FIVE_SMALL,
    },
    {
      id: 'S6-backend-files-large',
      label: 'Backend + 3 large @file refs (~45 KB each, near per-file cap)',
      agentType: 'backend',
      agentId: BACKEND_AGENT.id,
      complexity: BACKEND_AGENT.defaultComplexity,
      model: 'github-copilot/claude-sonnet-4-6',
      maxSteps: BACKEND_AGENT.maxSteps,
      sessionId: BENCH_IDS.sessionMain,
      prompt: 'Inspect the large fixture files',
      referencedFiles: LARGE_FILES,
    },
    {
      id: 'S7-backend-branch-scope',
      label: 'Backend in branch session (4 scope_globs entries)',
      agentType: 'backend',
      agentId: BACKEND_AGENT.id,
      complexity: BACKEND_AGENT.defaultComplexity,
      model: 'github-copilot/claude-sonnet-4-6',
      maxSteps: BACKEND_AGENT.maxSteps,
      sessionId: BENCH_IDS.sessionBranch,
      prompt: 'Refactor auth middleware',
      referencedFiles: [],
    },
    {
      id: 'S8-architect-everything',
      label: 'Architect in branch + 5 small files (worst-case mix)',
      agentType: 'architect',
      agentId: ARCHITECT_AGENT.id,
      complexity: ARCHITECT_AGENT.defaultComplexity,
      model: 'github-copilot/claude-opus-4-6',
      maxSteps: ARCHITECT_AGENT.maxSteps,
      sessionId: BENCH_IDS.sessionBranch,
      prompt: 'Design a refactor of the auth subsystem',
      referencedFiles: FIVE_SMALL,
    },
  ];
}

// ─── Harness ───────────────────────────────────────────────────────────────

async function insertTask(pool: Pool, s: Scenario): Promise<AgentTask> {
  const id = uuid();
  await pool.query(
    `INSERT INTO agent_tasks
       (id, session_id, project_id, context_type, agent_type, agent_id, prompt,
        status, complexity, model, max_steps, referenced_files)
     VALUES ($1, $2, $3, 'personal', $4, $5, $6, 'pending', $7, $8, $9, $10)`,
    [
      id,
      s.sessionId,
      BENCH_IDS.project,
      s.agentType,
      s.agentId,
      s.prompt,
      s.complexity,
      s.model,
      s.maxSteps,
      JSON.stringify(s.referencedFiles),
    ],
  );

  return {
    id,
    sessionId:       s.sessionId,
    projectId:       BENCH_IDS.project,
    contextType:     'personal',
    agentType:       s.agentType,
    agentId:         s.agentId,
    prompt:          s.prompt,
    status:          'pending',
    complexity:      s.complexity as AgentTask['complexity'],
    model:           s.model,
    currentStep:     0,
    maxSteps:        s.maxSteps,
    contextTokens:   0,
    inputTokens:     0,
    outputTokens:    0,
    costUsd:         0,
    dependsOn:       [],
    referencedFiles: s.referencedFiles,
    createdAt:       new Date(),
  };
}

async function waitForCompletion(pool: Pool, taskId: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows: [row] } = await pool.query<{ status: string }>(
      `SELECT status FROM agent_tasks WHERE id = $1`,
      [taskId],
    );
    if (row && (row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled')) {
      return row.status;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Task ${taskId} did not complete within ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  // Dynamic imports — must come AFTER process.env.OPENCODE_BINARY override
  // at top of file (env.ts captures values at module-init time).
  const { env }                  = await import('../src/config/env.js');
  const { OpenCodeProcessManager } = await import('../src/services/opencode/sdk-process-manager.js');
  const { EventBus }             = await import('../src/websocket/event-bus.js');
  const { CostTracker }          = await import('../src/services/cost-tracker/tracker.js');
  const { TaskQueue }            = await import('../src/services/queue/task-queue.js');
  const agentDefs                = await import('../src/agents/definitions.js');
  // dynamic fs import for reportwriter
  const { promises: fs }         = await import('node:fs');

  console.log('▶ Boot bench harness');
  console.log('  OPENCODE_BINARY =', env.OPENCODE_BINARY);
  console.log('  DATABASE_URL    =', env.DATABASE_URL.replace(/:[^:@]+@/, ':****@'));
  console.log('  REDIS_URL       =', env.REDIS_URL);

  const pool  = new Pool({ connectionString: env.DATABASE_URL });
  const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

  const processManager = new OpenCodeProcessManager(benchLogger);
  const eventBus       = new EventBus(benchLogger);
  const costTracker    = new CostTracker(benchLogger);
  const ragService     = makeStubRag();

  const taskQueue = new TaskQueue(
    redis,
    pool,
    processManager,
    eventBus,
    costTracker,
    benchLogger,
    async (taskId, status, data) => {
      await pool.query(
        `UPDATE agent_tasks
           SET status = $1, updated_at = NOW(),
               started_at   = CASE WHEN $1 = 'running' AND started_at IS NULL THEN NOW() ELSE started_at END,
               completed_at = CASE WHEN $1 IN ('completed','failed','cancelled') THEN NOW() ELSE completed_at END,
               summary       = COALESCE($3, summary),
               error_message = COALESCE($4, error_message)
         WHERE id = $2`,
        [
          status,
          taskId,
          (data as { summary?: string })?.summary ?? null,
          (data as { error?: string })?.error ?? null,
        ],
      );
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ragService as any,
  );

  const SCENARIOS = buildScenarios({
    ARCHITECT_AGENT:    agentDefs.ARCHITECT_AGENT,
    BACKEND_AGENT:      agentDefs.BACKEND_AGENT,
    FRONTEND_AGENT:     agentDefs.FRONTEND_AGENT,
    ORCHESTRATOR_AGENT: agentDefs.ORCHESTRATOR_AGENT,
  });

  const results: Array<{ scenario: Scenario; event?: BudgetEvent; status: string; taskId: string }> = [];

  for (const s of SCENARIOS) {
    process.stdout.write(`▶ ${s.id} ... `);
    const task = await insertTask(pool, s);
    captured.length = 0; // reset capture buffer per scenario for clean isolation

    await taskQueue.enqueueTask(task, process.env.GITHUB_TOKEN!);

    let status = 'unknown';
    try {
      status = await waitForCompletion(pool, task.id, 30_000);
    } catch (err) {
      console.log(`TIMEOUT (${(err as Error).message})`);
      results.push({ scenario: s, status: 'timeout', taskId: task.id });
      continue;
    }

    // The matching event may not be the only one captured (escalation, doc spawn,
    // qa spawn etc. all emit). Filter to this exact taskId.
    const event = captured.find(e => e.taskId === task.id);
    if (!event) {
      console.log(`${status} (no budget event captured)`);
    } else {
      console.log(`${status} — ${event.tokens} tok (${event.chars} chars)`);
    }
    results.push({ scenario: s, event, status, taskId: task.id });
  }

  // ─── Build report ─────────────────────────────────────────────────────────

  const lines: string[] = [];
  lines.push('# Context-Budget Benchmark Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('Token estimate: chars / 4 (matches in-app heuristic). Real usage varies ±30%.');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| # | Scenario | Status | Total chars | Est. tokens |');
  lines.push('|---|---|---|---:|---:|');
  for (const r of results) {
    const chars  = r.event ? r.event.chars.toLocaleString()  : '—';
    const tokens = r.event ? r.event.tokens.toLocaleString() : '—';
    lines.push(`| ${r.scenario.id} | ${r.scenario.label} | ${r.status} | ${chars} | ${tokens} |`);
  }
  lines.push('');

  // Per-block matrix
  const allBlockNames = new Set<string>(['base']);
  for (const r of results) {
    if (r.event) for (const k of Object.keys(r.event.breakdown)) allBlockNames.add(k);
  }
  const blockOrder = ['base', 'caller-extra', 'frontend-rules', 'rag', 'kb', 'branch-scope', 'referenced-files', 'skills'];
  const orderedBlocks = [
    ...blockOrder.filter(b => allBlockNames.has(b)),
    ...[...allBlockNames].filter(b => !blockOrder.includes(b)),
  ];

  lines.push('## Per-block breakdown (chars)');
  lines.push('');
  lines.push('| Scenario | ' + orderedBlocks.join(' | ') + ' |');
  lines.push('|---|' + orderedBlocks.map(() => '---:').join('|') + '|');
  for (const r of results) {
    const cells = orderedBlocks.map(b => {
      const v = r.event?.breakdown[b];
      return v ? v.toLocaleString() : '·';
    });
    lines.push(`| ${r.scenario.id} | ${cells.join(' | ')} |`);
  }
  lines.push('');

  // Block share by scenario (% of total)
  lines.push('## Per-block share (% of scenario total)');
  lines.push('');
  lines.push('| Scenario | ' + orderedBlocks.join(' | ') + ' |');
  lines.push('|---|' + orderedBlocks.map(() => '---:').join('|') + '|');
  for (const r of results) {
    if (!r.event) {
      lines.push(`| ${r.scenario.id} | ${orderedBlocks.map(() => '—').join(' | ')} |`);
      continue;
    }
    const total = r.event.chars;
    const cells = orderedBlocks.map(b => {
      const v = r.event!.breakdown[b];
      return v ? `${((v / total) * 100).toFixed(1)}%` : '·';
    });
    lines.push(`| ${r.scenario.id} | ${cells.join(' | ')} |`);
  }
  lines.push('');

  // Block totals across scenarios (where the optimisation $$ live)
  const blockTotals: Record<string, number> = {};
  for (const r of results) {
    if (!r.event) continue;
    for (const [k, v] of Object.entries(r.event.breakdown)) {
      blockTotals[k] = (blockTotals[k] ?? 0) + v;
    }
  }
  const sortedTotals = Object.entries(blockTotals).sort((a, b) => b[1] - a[1]);
  lines.push('## Block totals across all scenarios');
  lines.push('');
  lines.push('| Block | Total chars | Est. tokens | Avg per scenario |');
  lines.push('|---|---:|---:|---:|');
  const scenariosWithEvent = results.filter(r => r.event).length || 1;
  for (const [block, total] of sortedTotals) {
    lines.push(
      `| ${block} | ${total.toLocaleString()} | ${Math.ceil(total / 4).toLocaleString()} | ${Math.round(total / scenariosWithEvent).toLocaleString()} |`,
    );
  }
  lines.push('');

  lines.push('## Notes');
  lines.push('');
  lines.push('- RAG output is stubbed: 5 chunks × 1500 chars = 7500 chars + format overhead. ');
  lines.push('  Real RAG hits this size when relevance threshold is loose; can be 0 with strict threshold.');
  lines.push('- KB block is currently always 0 in this run because the stub RagService does not');
  lines.push('  cover knowledge-service queries (those go through a separate path).');
  lines.push('- Mock OpenCode binary returns canned NDJSON — actual model output not measured.');
  lines.push('- `base` is the agent system prompt (template + rules in `agents/definitions.ts`).');

  const outPath = '/tmp/context-benchmark-report.md';
  await fs.writeFile(outPath, lines.join('\n'), 'utf8');
  console.log(`\n✅ Report written to ${outPath}`);
  console.log('');
  console.log(lines.slice(0, 80).join('\n'));

  await taskQueue.close();
  await redis.quit();
  await pool.end();
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
