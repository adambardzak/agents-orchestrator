import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AgentDefinition, AgentTask, OpencodeEvent } from '@agent-orchestrator/shared';
import type { FastifyBaseLogger } from 'fastify';
import { buildOpencodeConfig } from '../model-router/router.js';

export interface SpawnAgentOptions {
  task: AgentTask;
  agentConfig: AgentDefinition;
  workspacesRoot: string;
  /** Absolute workspace path — overrides path.join(workspacesRoot, task.projectId). */
  workspaceDir?: string;
  githubToken: string;
  extraContext?: string;
  env?: Record<string, string>;
  onEvent: (event: OpencodeEvent) => void;
  onComplete: (summary: string) => void;
  onError: (error: Error) => void;
  /** Override the opencode binary path — used in tests to inject a mock. */
  opencodeBinary?: string;
}

export interface RunningProcess {
  taskId: string;
  process: ChildProcess;
  workspaceDir: string;
  startedAt: Date;
  kill: () => void;
  inject: (message: string) => void;
}

/**
 * OpenCode Process Manager
 *
 * Responsible for:
 * 1. Writing per-agent opencode.json config to workspace
 * 2. Spawning OpenCode process with -f json output
 * 3. Parsing NDJSON events from stdout in real time
 * 4. Calling onEvent callback for each parsed event
 * 5. Tracking running processes for pause/stop
 */
export class OpenCodeProcessManager {
  private runningProcesses = new Map<string, RunningProcess>();
  private logger: FastifyBaseLogger;

  constructor(logger: FastifyBaseLogger) {
    this.logger = logger;
  }

  async spawnAgent(options: SpawnAgentOptions): Promise<RunningProcess> {
    const {
      task, agentConfig, workspacesRoot, workspaceDir: workspaceDirOverride,
      githubToken, extraContext, env, onEvent, onComplete, onError, opencodeBinary,
    } = options;

    const workspaceDir = workspaceDirOverride
      ?? (task.sessionId
        ? path.join(workspacesRoot, task.projectId, 'sessions', task.sessionId)
        : path.join(workspacesRoot, task.projectId));
    const opencodeDir = path.join(workspaceDir, '.opencode');

    // Ensure .opencode directory exists (needed for context-inject.md)
    await fs.mkdir(opencodeDir, { recursive: true });

    // Build agent-specific OpenCode config
    const config = buildOpencodeConfig({
      agentConfig,
      taskComplexity: task.complexity,
      githubToken,
      extraContext,
    });

    // Write config to disk as a debug artifact (not used by real OpenCode binary —
    // it reads from OPENCODE_CONFIG_CONTENT env var instead)
    const configPath = path.join(opencodeDir, `agent-${agentConfig.type}.json`);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    // Use override binary for testing, otherwise use 'opencode' from PATH
    const binary = opencodeBinary ?? 'opencode';
    const isJsScript = binary.endsWith('.js');

    this.logger.info(
      { taskId: task.id, agentType: agentConfig.type, model: config.model, binary },
      'Spawning OpenCode process',
    );

    // Real OpenCode CLI: opencode run "PROMPT" --format json --agent TYPE --dangerously-skip-permissions
    // Mock JS script: node mock-opencode.js run "PROMPT" --format json --agent TYPE
    // Config is passed via OPENCODE_CONFIG_CONTENT env var (no --config flag)
    const proc = spawn(
      isJsScript ? process.execPath : binary,
      [
        ...(isJsScript ? [binary] : []),
        'run',
        task.prompt,
        '--format', 'json',
        '--agent', agentConfig.type,
        '--dangerously-skip-permissions',
      ],
      {
        cwd: workspaceDir,
        env: {
          ...process.env,
          ...env,
          GITHUB_TOKEN: githubToken,
          OPENCODE_WORKSPACE: workspaceDir,
          // Inline JSON config — avoids file race conditions for parallel agents
          // and is the correct approach for real OpenCode binary
          OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
          // Strip parent OpenCode process env vars — the API server may itself be
          // running inside an OpenCode session, and these vars would cause the child
          // process to behave as a subagent instead of a standalone process.
          OPENCODE: undefined,
          OPENCODE_PROCESS_ROLE: undefined,
          OPENCODE_PID: undefined,
          OPENCODE_RUN_ID: undefined,
          OPENCODE_SERVER_URL: undefined,
          OPENCODE_SERVER_PASSWORD: undefined,
          OPENCODE_SESSION_ID: undefined,
        } as Record<string, string | undefined>,
      },
    );

    const running: RunningProcess = {
      taskId: task.id,
      process: proc,
      workspaceDir,
      startedAt: new Date(),
      kill: () => {
        if (!proc.killed) {
          proc.kill('SIGTERM');
          // Force kill after 5s if still alive
          setTimeout(() => {
            if (!proc.killed) proc.kill('SIGKILL');
          }, 5000);
        }
      },
      inject: (message: string) => {
        // Write to stdin — real OpenCode may handle this in future versions
        if (proc.stdin && !proc.stdin.destroyed) {
          proc.stdin.write(message + '\n', 'utf-8');
        }
        // Also write to a context inject file the agent can read via filesystem MCP
        const injectFile = path.join(workspaceDir, '.opencode', 'context-inject.md');
        const line = `\n\n---\n**User injected at ${new Date().toISOString()}:**\n${message}\n`;
        fs.appendFile(injectFile, line, 'utf-8').catch(() => undefined);
      },
    };

    this.runningProcesses.set(task.id, running);

    // Parse NDJSON events from stdout
    let buffer = '';
    let completedByEvent = false;

    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');

      // Process complete lines (NDJSON — one JSON object per line)
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // Keep incomplete last line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const event = this.parseLine(trimmed, task.id, config.model ?? '');
        if (event) {
          onEvent(event);

          if (event.type === 'complete') {
            completedByEvent = true;
            onComplete(event.summary);
          }
        }
      }
    });

    // Log stderr for debugging
    proc.stderr?.on('data', (chunk: Buffer) => {
      this.logger.warn(
        { taskId: task.id, stderr: chunk.toString('utf-8').slice(0, 500) },
        'OpenCode stderr',
      );
    });

    proc.on('close', (code) => {
      this.runningProcesses.delete(task.id);

      // Process any remaining buffered content
      if (buffer.trim()) {
        const event = this.parseLine(buffer.trim(), task.id, config.model ?? '');
        if (event) onEvent(event);
      }

      if (code !== 0 && code !== null) {
        this.logger.error({ taskId: task.id, exitCode: code }, 'OpenCode process exited with error');
        onError(new Error(`OpenCode process exited with code ${code}`));
      } else {
        this.logger.info({ taskId: task.id, exitCode: code }, 'OpenCode process completed');
        // Real OpenCode has no `complete` event — signal completion on clean exit
        if (!completedByEvent) {
          onComplete('Task completed');
        }
      }
    });

    proc.on('error', (err) => {
      this.runningProcesses.delete(task.id);
      this.logger.error({ taskId: task.id, error: err.message }, 'OpenCode process error');
      onError(err);
    });

    return running;
  }

  /**
   * Parse a single NDJSON line into an OpencodeEvent.
   *
   * Handles two formats:
   * 1. Real OpenCode binary (`--format json`): { type, timestamp, sessionID, part }
   * 2. Mock / internal format: { type: 'message' | 'tool_use' | ... }
   */
  private parseLine(line: string, taskId: string, model: string): OpencodeEvent | null {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;

      // Real OpenCode format has a numeric `timestamp` and `part` object
      if (typeof parsed['timestamp'] === 'number') {
        return translateRealEvent(parsed, model);
      }

      // Internal / mock format — validate directly
      if (isOpencodeEvent(parsed)) {
        return parsed;
      }

      this.logger.debug({ taskId, line }, 'Non-event JSON line from OpenCode');
      return null;
    } catch {
      // Not JSON — could be a log line or partial output, ignore
      this.logger.debug({ taskId, line }, 'Non-JSON line from OpenCode stdout');
      return null;
    }
  }

  pauseAgent(taskId: string): boolean {
    const running = this.runningProcesses.get(taskId);
    if (!running || running.process.killed) return false;

    running.process.kill('SIGSTOP');
    this.logger.info({ taskId }, 'OpenCode process paused');
    return true;
  }

  resumeAgent(taskId: string): boolean {
    const running = this.runningProcesses.get(taskId);
    if (!running || running.process.killed) return false;

    running.process.kill('SIGCONT');
    this.logger.info({ taskId }, 'OpenCode process resumed');
    return true;
  }

  /**
   * Injects a user message into a running OpenCode process.
   * Writes to stdin (for future real OpenCode support) and to
   * {workspaceDir}/.opencode/context-inject.md (readable via filesystem MCP).
   * Returns false if task is not currently running.
   */
  injectMessage(taskId: string, message: string): boolean {
    const running = this.runningProcesses.get(taskId);
    if (!running) return false;

    running.inject(message);
    this.logger.info({ taskId }, 'Context message injected into running task');
    return true;
  }

  stopAgent(taskId: string): boolean {
    const running = this.runningProcesses.get(taskId);
    if (!running) return false;

    running.kill();
    this.logger.info({ taskId }, 'OpenCode process stopped');
    return true;
  }

  isRunning(taskId: string): boolean {
    return this.runningProcesses.has(taskId);
  }

  getRunningCount(): number {
    return this.runningProcesses.size;
  }

  stopAll(): void {
    for (const [taskId, running] of this.runningProcesses) {
      this.logger.info({ taskId }, 'Stopping OpenCode process (shutdown)');
      running.kill();
    }
    this.runningProcesses.clear();
  }
}

/**
 * Type guard for OpencodeEvent — validates the event shape before processing.
 */
function isOpencodeEvent(val: unknown): val is OpencodeEvent {
  if (typeof val !== 'object' || val === null) return false;
  const obj = val as Record<string, unknown>;

  if (typeof obj['type'] !== 'string') return false;

  const validTypes = ['message', 'tool_use', 'tool_result', 'usage', 'complete', 'error'];
  return validTypes.includes(obj['type']);
}

// ────────────────────────────────────────────────────────────────────────────
// Real OpenCode JSON format translation
//
// Real OpenCode (--format json) emits events shaped like:
//   { type: "text"|"tool"|"tool_result"|"step_finish"|"error"|...,
//     timestamp: number, sessionID: string, part: { ... } }
//
// We translate these into our internal OpencodeEvent format so the rest of
// the pipeline (WS broadcast, DB storage, cost tracking) works unchanged.
// ────────────────────────────────────────────────────────────────────────────

interface RealPart {
  type?: string;
  text?: string;
  toolName?: string;
  name?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  content?: unknown;
  message?: string;
  reason?: string;
  tokens?: {
    input?: number;
    output?: number;
    total?: number;
    reasoning?: number;
    cache?: { write?: number; read?: number };
  };
  cost?: number;
  [key: string]: unknown;
}

interface RealOpencodeJsonLine {
  type: string;
  timestamp?: number;
  sessionID?: string;
  part?: RealPart;
  error?: { name?: string; message?: string; data?: { message?: string } };
}

function translateRealEvent(raw: Record<string, unknown>, model: string): OpencodeEvent | null {
  const ev = raw as unknown as RealOpencodeJsonLine;
  const part = ev.part;

  switch (ev.type) {
    // ── Text / assistant message ────────────────────────────────────────────
    case 'text': {
      const text = part?.text;
      if (text) return { type: 'message', role: 'assistant', content: text };
      return null;
    }

    // ── Tool call ───────────────────────────────────────────────────────────
    case 'tool': {
      const name = part?.toolName ?? part?.name ?? 'unknown';
      const input = (part?.input ?? {}) as Record<string, unknown>;
      return { type: 'tool_use', name, input };
    }

    // ── Tool result ─────────────────────────────────────────────────────────
    case 'tool_result': {
      const name = part?.toolName ?? part?.name ?? 'unknown';
      const raw = part?.output ?? part?.content ?? '';
      const output = typeof raw === 'string' ? raw : JSON.stringify(raw);
      return { type: 'tool_result', name, output };
    }

    // ── Step finish → usage event ───────────────────────────────────────────
    case 'step_finish': {
      const tokens = part?.tokens;
      if (tokens) {
        return {
          type: 'usage',
          input_tokens: tokens.input ?? 0,
          output_tokens: tokens.output ?? 0,
          model,
        };
      }
      return null;
    }

    // ── Error ───────────────────────────────────────────────────────────────
    case 'error': {
      const msg =
        ev.error?.data?.message ??
        ev.error?.message ??
        (part as RealPart | undefined)?.message ??
        'Unknown error';
      return { type: 'error', message: msg };
    }

    // ── Events we don't need to surface ────────────────────────────────────
    // step_start, assistant, snapshot, etc.
    default:
      return null;
  }
}
