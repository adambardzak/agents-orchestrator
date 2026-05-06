/**
 * QaRunner — deterministic post-task validation.
 *
 * After a code-writing agent completes, this runs a battery of static and
 * dynamic checks against the workspace and stores structured results in
 * `agent_qa_results`. Failures don't block the parent task — they're advisory
 * signals surfaced in the UI so humans (or follow-up tasks) can react.
 *
 * Tool detection is workspace-driven, not configured: we look at
 * package.json scripts + presence of common config files. If a tool isn't
 * obviously available, we skip it (status='skipped') rather than failing.
 *
 * Each tool runs with a hard timeout. Slow Playwright suites are bounded so
 * a runaway test doesn't pin worker capacity. stdout/stderr are tail-capped
 * before persisting to keep `agent_qa_results.details` from blowing up.
 */
import { spawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';

export type QaTool   = 'tsc' | 'eslint' | 'vitest' | 'playwright';
export type QaStatus = 'passed' | 'failed' | 'skipped' | 'error';

export interface QaToolResult {
  tool:         QaTool;
  status:       QaStatus;
  summary:      string;
  errorCount:   number;
  warningCount: number;
  durationMs:   number;
  details: {
    /** Tail of stdout/stderr, capped to ~16 KB. */
    stdout?:  string;
    stderr?:  string;
    /** Parsed structured findings when available. */
    problems?: Array<{
      file?:     string;
      line?:     number;
      column?:   number;
      severity?: 'error' | 'warning';
      message:   string;
      rule?:     string;
    }>;
    /** Tool-specific extras (e.g. test counts). */
    [key: string]: unknown;
  };
}

interface PackageJson {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
}

const STDOUT_TAIL_BYTES = 16 * 1024;

/**
 * Per-tool timeout. Playwright is generous because it boots browsers; tsc is
 * the cheapest of the bunch. These are upper bounds — they SIGTERM the child
 * and surface as status='error' so the agent worker doesn't hang.
 */
const TOOL_TIMEOUT_MS: Record<QaTool, number> = {
  tsc:        2  * 60 * 1000,
  eslint:     2  * 60 * 1000,
  vitest:     5  * 60 * 1000,
  playwright: 10 * 60 * 1000,
};

export class QaRunner {
  constructor(
    private readonly pool: Pool,
    private readonly logger: FastifyBaseLogger,
  ) {}

  /**
   * Run all detected QA tools against the workspace and persist results.
   * Returns the array of results (also stored in DB).
   *
   * Errors are caught per-tool — one tool blowing up does not abort the others.
   */
  async runAndStore(taskId: string, workspacePath: string): Promise<QaToolResult[]> {
    const detected = await this.detectTools(workspacePath);
    if (detected.size === 0) {
      this.logger.info({ taskId, workspacePath }, 'QA: no supported tools detected, skipping');
      return [];
    }

    const results: QaToolResult[] = [];
    // Run sequentially — parallel would race on shared caches (.next, dist, node_modules/.vite).
    for (const tool of detected) {
      try {
        const result = await this.runTool(tool, workspacePath);
        results.push(result);
      } catch (err) {
        results.push({
          tool,
          status:       'error',
          summary:      `Runner crashed: ${(err as Error).message}`,
          errorCount:   0,
          warningCount: 0,
          durationMs:   0,
          details:      { stderr: (err as Error).stack ?? '' },
        });
      }
    }

    await this.persistResults(taskId, results);
    return results;
  }

  // ── Detection ─────────────────────────────────────────────────────────────

  /**
   * Walk the workspace package.json + config files to decide which tools to run.
   * Conservative: if we can't unambiguously detect, we skip.
   */
  async detectTools(workspacePath: string): Promise<Set<QaTool>> {
    const tools = new Set<QaTool>();
    const pkg = await this.readPackageJson(workspacePath);
    if (!pkg) return tools; // not a node project — nothing we can run

    const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

    if ('typescript' in allDeps || (await fileExists(join(workspacePath, 'tsconfig.json')))) {
      tools.add('tsc');
    }
    if (
      'eslint' in allDeps ||
      (await fileExists(join(workspacePath, '.eslintrc.json'))) ||
      (await fileExists(join(workspacePath, '.eslintrc.cjs'))) ||
      (await fileExists(join(workspacePath, '.eslintrc.js'))) ||
      (await fileExists(join(workspacePath, 'eslint.config.js'))) ||
      (await fileExists(join(workspacePath, 'eslint.config.mjs')))
    ) {
      tools.add('eslint');
    }
    if (
      'vitest' in allDeps ||
      (await fileExists(join(workspacePath, 'vitest.config.ts'))) ||
      (await fileExists(join(workspacePath, 'vitest.config.js'))) ||
      (await fileExists(join(workspacePath, 'vitest.config.mjs')))
    ) {
      tools.add('vitest');
    }
    if (
      '@playwright/test' in allDeps ||
      (await fileExists(join(workspacePath, 'playwright.config.ts'))) ||
      (await fileExists(join(workspacePath, 'playwright.config.js')))
    ) {
      tools.add('playwright');
    }
    return tools;
  }

  // ── Per-tool runners ──────────────────────────────────────────────────────

  private async runTool(tool: QaTool, cwd: string): Promise<QaToolResult> {
    const started = Date.now();
    switch (tool) {
      case 'tsc':        return this.finalize(tool, started, await this.runTsc(cwd));
      case 'eslint':     return this.finalize(tool, started, await this.runEslint(cwd));
      case 'vitest':     return this.finalize(tool, started, await this.runVitest(cwd));
      case 'playwright': return this.finalize(tool, started, await this.runPlaywright(cwd));
    }
  }

  private finalize(
    tool: QaTool,
    started: number,
    raw: Omit<QaToolResult, 'tool' | 'durationMs'>,
  ): QaToolResult {
    return { ...raw, tool, durationMs: Date.now() - started };
  }

  private async runTsc(cwd: string): Promise<Omit<QaToolResult, 'tool' | 'durationMs'>> {
    const { stdout, stderr, exitCode, timedOut } = await execCapped(
      'npx', ['--no-install', 'tsc', '--noEmit', '--pretty', 'false'],
      cwd, TOOL_TIMEOUT_MS.tsc,
    );
    if (timedOut) {
      return { status: 'error', summary: 'tsc timed out', errorCount: 0, warningCount: 0, details: { stdout, stderr } };
    }
    // tsc lines: "src/foo.ts(12,5): error TS2304: Cannot find name 'foo'."
    const lineRe = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS\d+:\s+(.+)$/gm;
    const problems: NonNullable<QaToolResult['details']['problems']> = [];
    let m: RegExpExecArray | null;
    while ((m = lineRe.exec(stdout)) !== null) {
      problems.push({
        file:     m[1],
        line:     Number(m[2]),
        column:   Number(m[3]),
        severity: m[4] as 'error' | 'warning',
        message:  m[5]!,
      });
    }
    const errorCount   = problems.filter((p) => p.severity === 'error').length;
    const warningCount = problems.filter((p) => p.severity === 'warning').length;
    const status: QaStatus = exitCode === 0 ? 'passed' : 'failed';
    return {
      status,
      summary: status === 'passed' ? 'No type errors' : `${errorCount} type error(s)`,
      errorCount,
      warningCount,
      details: { stdout: tail(stdout), stderr: tail(stderr), problems },
    };
  }

  private async runEslint(cwd: string): Promise<Omit<QaToolResult, 'tool' | 'durationMs'>> {
    // -f json gives us structured output that we can summarize precisely.
    const { stdout, stderr, exitCode, timedOut } = await execCapped(
      'npx', ['--no-install', 'eslint', '.', '-f', 'json', '--no-error-on-unmatched-pattern'],
      cwd, TOOL_TIMEOUT_MS.eslint,
    );
    if (timedOut) {
      return { status: 'error', summary: 'eslint timed out', errorCount: 0, warningCount: 0, details: { stdout: tail(stdout), stderr: tail(stderr) } };
    }
    // exitCode 2 = config/runtime error; 1 = lint findings; 0 = clean
    if (exitCode === 2) {
      return { status: 'error', summary: 'eslint failed to run', errorCount: 0, warningCount: 0, details: { stdout: tail(stdout), stderr: tail(stderr) } };
    }
    interface EslintFile {
      filePath: string;
      messages: Array<{ ruleId: string | null; severity: number; message: string; line?: number; column?: number }>;
      errorCount: number;
      warningCount: number;
    }
    let parsed: EslintFile[] = [];
    try {
      parsed = JSON.parse(stdout) as EslintFile[];
    } catch {
      return { status: 'error', summary: 'eslint produced unparseable output', errorCount: 0, warningCount: 0, details: { stdout: tail(stdout), stderr: tail(stderr) } };
    }
    const problems: NonNullable<QaToolResult['details']['problems']> = [];
    let errorCount = 0;
    let warningCount = 0;
    for (const f of parsed) {
      errorCount   += f.errorCount;
      warningCount += f.warningCount;
      for (const msg of f.messages) {
        problems.push({
          file:     f.filePath,
          line:     msg.line,
          column:   msg.column,
          severity: msg.severity === 2 ? 'error' : 'warning',
          message:  msg.message,
          rule:     msg.ruleId ?? undefined,
        });
      }
    }
    const status: QaStatus = errorCount === 0 ? 'passed' : 'failed';
    return {
      status,
      summary: errorCount === 0
        ? warningCount === 0 ? 'Clean' : `${warningCount} warning(s)`
        : `${errorCount} error(s), ${warningCount} warning(s)`,
      errorCount,
      warningCount,
      details: { problems, stderr: tail(stderr) },
    };
  }

  private async runVitest(cwd: string): Promise<Omit<QaToolResult, 'tool' | 'durationMs'>> {
    // --run = no watch; --reporter=json for structured summary
    const { stdout, stderr, exitCode, timedOut } = await execCapped(
      'npx', ['--no-install', 'vitest', 'run', '--reporter=json', '--reporter=default'],
      cwd, TOOL_TIMEOUT_MS.vitest,
    );
    if (timedOut) {
      return { status: 'error', summary: 'vitest timed out', errorCount: 0, warningCount: 0, details: { stdout: tail(stdout), stderr: tail(stderr) } };
    }
    // vitest writes JSON between default-reporter noise; pull the first JSON object.
    interface VitestSummary {
      numTotalTests?: number;
      numPassedTests?: number;
      numFailedTests?: number;
      numPendingTests?: number;
    }
    let summary: VitestSummary = {};
    const jsonMatch = stdout.match(/\{[\s\S]*?"numTotalTests"[\s\S]*?\}/);
    if (jsonMatch) {
      try { summary = JSON.parse(jsonMatch[0]) as VitestSummary; } catch { /* ignore */ }
    }
    const status: QaStatus = exitCode === 0 ? 'passed' : 'failed';
    const failed = summary.numFailedTests ?? (status === 'failed' ? 1 : 0);
    const total  = summary.numTotalTests ?? 0;
    return {
      status,
      summary: total > 0
        ? `${(summary.numPassedTests ?? 0)}/${total} passed${failed > 0 ? `, ${failed} failed` : ''}`
        : status === 'passed' ? 'No tests' : 'Tests failed',
      errorCount:   failed,
      warningCount: 0,
      details: {
        stdout: tail(stdout),
        stderr: tail(stderr),
        totalTests:   total,
        passedTests:  summary.numPassedTests ?? 0,
        failedTests:  failed,
        pendingTests: summary.numPendingTests ?? 0,
      },
    };
  }

  private async runPlaywright(cwd: string): Promise<Omit<QaToolResult, 'tool' | 'durationMs'>> {
    // --reporter=line keeps output small; we mostly care about exit code.
    const { stdout, stderr, exitCode, timedOut } = await execCapped(
      'npx', ['--no-install', 'playwright', 'test', '--reporter=line'],
      cwd, TOOL_TIMEOUT_MS.playwright,
    );
    if (timedOut) {
      return { status: 'error', summary: 'playwright timed out', errorCount: 0, warningCount: 0, details: { stdout: tail(stdout), stderr: tail(stderr) } };
    }
    // Best-effort parse of "X passed, Y failed" summary line
    const tail500 = stdout.slice(-1500);
    const passedMatch = tail500.match(/(\d+)\s+passed/);
    const failedMatch = tail500.match(/(\d+)\s+failed/);
    const passed = passedMatch ? Number(passedMatch[1]) : 0;
    const failed = failedMatch ? Number(failedMatch[1]) : 0;
    const status: QaStatus = exitCode === 0 ? 'passed' : 'failed';
    return {
      status,
      summary: passed + failed > 0
        ? `${passed} passed${failed > 0 ? `, ${failed} failed` : ''}`
        : status === 'passed' ? 'No tests' : 'Tests failed',
      errorCount:   failed,
      warningCount: 0,
      details: { stdout: tail(stdout), stderr: tail(stderr), passed, failed },
    };
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private async persistResults(taskId: string, results: QaToolResult[]): Promise<void> {
    if (results.length === 0) return;
    // Replace any prior results for this task — tasks may be retried.
    await this.pool.query(`DELETE FROM agent_qa_results WHERE task_id = $1`, [taskId]);
    for (const r of results) {
      await this.pool.query(
        `INSERT INTO agent_qa_results
           (task_id, tool, status, summary, error_count, warning_count, duration_ms, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [taskId, r.tool, r.status, r.summary, r.errorCount, r.warningCount, r.durationMs, JSON.stringify(r.details)],
      );
    }
    this.logger.info(
      {
        taskId,
        results: results.map((r) => ({ tool: r.tool, status: r.status, errors: r.errorCount, ms: r.durationMs })),
      },
      'QA results persisted',
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async readPackageJson(workspacePath: string): Promise<PackageJson | null> {
    try {
      const raw = await readFile(join(workspacePath, 'package.json'), 'utf8');
      return JSON.parse(raw) as PackageJson;
    } catch {
      return null;
    }
  }

  /**
   * Fetch persisted QA results for a given task — used by the API surface.
   */
  async getResultsForTask(taskId: string): Promise<QaToolResult[]> {
    const { rows } = await this.pool.query(
      `SELECT tool, status, summary, error_count, warning_count, duration_ms, details, ran_at
         FROM agent_qa_results
        WHERE task_id = $1
        ORDER BY ran_at ASC, tool ASC`,
      [taskId],
    );
    return rows.map((r) => ({
      tool:         r.tool as QaTool,
      status:       r.status as QaStatus,
      summary:      r.summary,
      errorCount:   r.error_count,
      warningCount: r.warning_count,
      durationMs:   r.duration_ms,
      details:      r.details,
    }));
  }
}

// ── module-private utilities ───────────────────────────────────────────────

async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

function tail(text: string): string {
  if (text.length <= STDOUT_TAIL_BYTES) return text;
  return '...[truncated]...\n' + text.slice(-STDOUT_TAIL_BYTES);
}

interface ExecResult {
  stdout:   string;
  stderr:   string;
  exitCode: number;
  timedOut: boolean;
}

/**
 * Spawn a child process with a hard timeout. Captures stdout/stderr fully
 * (caller is responsible for tailing). Never throws — always resolves with
 * a structured result so callers can encode failure modes as data.
 */
function execCapped(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // Belt and braces — give it 2s then SIGKILL
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already dead */ } }, 2000);
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + `\n[spawn error] ${err.message}`, exitCode: -1, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? -1, timedOut });
    });
  });
}
