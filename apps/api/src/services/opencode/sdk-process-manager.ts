/**
 * OpenCode SDK Process Manager
 *
 * Replaces the stdout-based process manager with the OpenCode SDK approach:
 * 1. Spawns `opencode serve` per task (in the task workspace dir)
 * 2. Connects via HTTP API + Server-Sent Events (no stdout buffering)
 * 3. Translates SDK events to internal OpencodeEvent format in real time
 *
 * Why not `opencode run --format json`?
 * Node.js pipes cause block-buffering in child processes — events only arrive
 * in one batch on process exit, not in real time.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { AgentDefinition, AgentTask, OpencodeEvent } from '@agent-orchestrator/shared';
import type { FastifyBaseLogger } from 'fastify';
import type {
  Event as SdkEvent,
  Part,
  ToolState,
  ToolStatePending,
  ToolStateRunning,
  ToolStateCompleted,
  ToolStateError,
} from '@opencode-ai/sdk';
import { createOpencodeClient } from '@opencode-ai/sdk';
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

export class OpenCodeProcessManager {
  private runningProcesses = new Map<string, RunningProcess>();
  private logger: FastifyBaseLogger;

  constructor(logger: FastifyBaseLogger) {
    this.logger = logger;
  }

  async spawnAgent(options: SpawnAgentOptions): Promise<RunningProcess> {
    const {
      task,
      agentConfig,
      workspacesRoot,
      workspaceDir: workspaceDirOverride,
      githubToken,
      extraContext,
      env,
      onEvent,
      onComplete,
      onError,
      opencodeBinary,
    } = options;

    const workspaceDir = workspaceDirOverride
      ?? (task.sessionId
        ? path.join(workspacesRoot, task.projectId, 'sessions', task.sessionId)
        : path.join(workspacesRoot, task.projectId));
    const opencodeDir = path.join(workspaceDir, '.opencode');
    await fs.mkdir(opencodeDir, { recursive: true });

    // Build agent-specific OpenCode config
    const config = buildOpencodeConfig({
      agentConfig,
      taskComplexity: task.complexity,
      githubToken,
      extraContext,
    });

    // Write config as debug artifact
    const configPath = path.join(opencodeDir, `agent-${agentConfig.type}.json`);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    const binary = opencodeBinary ?? 'opencode';
    const isMockScript = binary.endsWith('.js');

    // If using a mock JS script, fall back to the legacy stdout approach
    // (mock doesn't support the serve protocol)
    if (isMockScript) {
      return this._spawnLegacy(options, workspaceDir, config);
    }

    // Find a free port by using port 0 (OS assigns one)
    const port = await findFreePort();

    this.logger.info(
      { taskId: task.id, agentType: agentConfig.type, model: config.model, binary, port },
      'Spawning OpenCode server (SDK mode)',
    );

    // Build env for the server process — strip all parent OpenCode env vars
    const serverEnv: Record<string, string | undefined> = {
      ...process.env,
      ...env,
      GITHUB_TOKEN: githubToken,
      OPENCODE_WORKSPACE: workspaceDir,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      // Strip parent OpenCode session env vars to prevent subagent behaviour
      OPENCODE: undefined,
      OPENCODE_PROCESS_ROLE: undefined,
      OPENCODE_PID: undefined,
      OPENCODE_RUN_ID: undefined,
      OPENCODE_SERVER_URL: undefined,
      OPENCODE_SERVER_PASSWORD: undefined,
      OPENCODE_SESSION_ID: undefined,
      // Suppress password warning (we run in a trusted local context)
      OPENCODE_SERVER_PASSWORD_SKIP_WARNING: '1',
    };

    // Spawn `opencode serve --port <port>` in the workspace directory
    const proc = spawn(
      binary,
      ['serve', `--port=${port}`, '--hostname=127.0.0.1'],
      {
        cwd: workspaceDir,
        env: serverEnv as Record<string, string>,
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
          setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 5000);
        }
      },
      inject: (message: string) => {
        const injectFile = path.join(workspaceDir, '.opencode', 'context-inject.md');
        const line = `\n\n---\n**User injected at ${new Date().toISOString()}:**\n${message}\n`;
        fs.appendFile(injectFile, line, 'utf-8').catch(() => undefined);
      },
    };

    this.runningProcesses.set(task.id, running);

    // Wait for the server to start and read its URL
    const serverUrl = await waitForServerUrl(proc, port, 15_000).catch((err: Error) => {
      this.runningProcesses.delete(task.id);
      running.kill();
      onError(err);
      return null;
    });

    if (!serverUrl) return running;

    // Connect via SDK, subscribe to events, send the prompt
    this._runSdkSession({
      taskId: task.id,
      sessionId: task.id,
      serverUrl,
      proc,
      running,
      task,
      config,
      onEvent,
      onComplete,
      onError,
    }).catch((err: Error) => {
      this.runningProcesses.delete(task.id);
      running.kill();
      onError(err);
    });

    return running;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SDK session execution
  // ─────────────────────────────────────────────────────────────────────────

  private async _runSdkSession(opts: {
    taskId: string;
    sessionId: string;
    serverUrl: string;
    proc: ChildProcess;
    running: RunningProcess;
    task: AgentTask;
    config: ReturnType<typeof buildOpencodeConfig>;
    onEvent: (event: OpencodeEvent) => void;
    onComplete: (summary: string) => void;
    onError: (error: Error) => void;
  }): Promise<void> {
    const { taskId, serverUrl, proc, running, task, config, onEvent, onComplete, onError } = opts;

    const client = createOpencodeClient({ baseUrl: serverUrl });

    // Create session
    const sessionResult = await client.session.create({ body: { title: taskId } });
    const opencodeSessionId = sessionResult.data?.id;
    if (!opencodeSessionId) {
      throw new Error('Failed to create OpenCode session');
    }

    this.logger.info({ taskId, opencodeSessionId, serverUrl }, 'OpenCode session created (SDK)');

    // Subscribe to global SSE event stream
    const eventStream = await client.event.subscribe();
    let completedByEvent = false;
    let summarizedText = '';

    // Track user message IDs so we can skip their text parts
    // (user prompt comes through as message.part.updated with role="user")
    const userMessageIds = new Set<string>();

    // Start consuming events in background
    const eventsPromise = (async () => {
      for await (const globalEvent of eventStream.stream) {
        const ev = globalEvent as { type?: string; properties?: Record<string, unknown> };
        if (!ev.properties) continue;

        const props = ev.properties;
        const evSessionId = props['sessionID'] as string | undefined;

        // Only handle events for our session
        if (evSessionId !== opencodeSessionId) continue;

        // Track user message IDs from message.updated events
        if (ev.type === 'message.updated') {
          const info = props['info'] as { id?: string; role?: string } | undefined;
          if (info?.role === 'user' && info?.id) {
            userMessageIds.add(info.id);
          }
        }

        const translated = translateSdkEvent(
          ev as SdkEvent,
          config.model ?? '',
          userMessageIds,
        );

        if (translated) {
          if (translated.type === 'message' && translated.role === 'assistant') {
            summarizedText += translated.content;
          }
          onEvent(translated);
        }

        // session.idle signals the LLM turn is complete
        if (ev.type === 'session.idle') {
          completedByEvent = true;
          break;
        }

        // session.error signals a failure
        if (ev.type === 'session.error') {
          const errProps = props as { error?: { name?: string; data?: { message?: string } } };
          const msg =
            errProps.error?.data?.message ?? errProps.error?.name ?? 'Unknown session error';
          onError(new Error(msg));
          completedByEvent = true;
          break;
        }
      }
    })();

    // Send the prompt — this blocks until the AI finishes responding
    try {
      // Build prompt body:
      // - agent: route to the correct configured agent (orchestrator / backend / etc.)
      // - tools: disable `question` for orchestrator — it's intercepted at the worker level
      //          and killing/re-spawning is handled by /clarify; letting the process block
      //          on an unanswerable HTTP call wastes time
      const promptBody: Parameters<typeof client.session.prompt>[0]['body'] & object = {
        agent: task.agentType,
        parts: [{ type: 'text' as const, text: task.prompt }],
        ...((task.agentType === 'orchestrator' || task.agentType === 'planner') && {
          tools: { question: false },
        }),
      };
      await client.session.prompt({
        path: { id: opencodeSessionId },
        body: promptBody,
      });
    } catch (err) {
      this.logger.error({ taskId, error: (err as Error).message }, 'session.prompt failed');
      // Don't throw — session.error SSE event should handle this
    }

    // Wait for SSE stream to signal completion (or timeout after 3s)
    await Promise.race([
      eventsPromise,
      new Promise<void>((r) => setTimeout(r, 3_000)),
    ]);

    this.runningProcesses.delete(taskId);
    running.kill();

    if (!completedByEvent) {
      onComplete(summarizedText.slice(0, 8000) || 'Task completed');
    } else {
      onComplete(summarizedText.slice(0, 8000) || 'Task completed');
    }

    this.logger.info({ taskId, opencodeSessionId }, 'OpenCode SDK session completed');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Legacy stdout-based spawn (used only for mock JS scripts in tests)
  // ─────────────────────────────────────────────────────────────────────────

  private _spawnLegacy(
    options: SpawnAgentOptions,
    workspaceDir: string,
    config: ReturnType<typeof buildOpencodeConfig>,
  ): RunningProcess {
    const { task, env, githubToken, onEvent, onComplete, onError, opencodeBinary } = options;

    const binary = opencodeBinary!;
    const proc = spawn(
      process.execPath,
      [
        binary,
        'run',
        task.prompt,
        '--format', 'json',
        '--agent', options.agentConfig.type,
        '--dangerously-skip-permissions',
      ],
      {
        cwd: workspaceDir,
        env: {
          ...process.env,
          ...env,
          GITHUB_TOKEN: githubToken,
          OPENCODE_WORKSPACE: workspaceDir,
          OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
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
          setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 5000);
        }
      },
      inject: (message: string) => {
        if (proc.stdin && !proc.stdin.destroyed) proc.stdin.write(message + '\n');
        const injectFile = path.join(workspaceDir, '.opencode', 'context-inject.md');
        const line = `\n\n---\n**Injected at ${new Date().toISOString()}:**\n${message}\n`;
        fs.appendFile(injectFile, line, 'utf-8').catch(() => undefined);
      },
    };

    this.runningProcesses.set(task.id, running);

    let buffer = '';
    let completedByEvent = false;

    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const event = parseLegacyLine(trimmed, task.id, config.model ?? '');
        if (event) {
          onEvent(event);
          if (event.type === 'complete') {
            completedByEvent = true;
            onComplete(event.summary);
          }
        }
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      this.logger.warn({ taskId: task.id, stderr: chunk.toString().slice(0, 500) }, 'Mock stderr');
    });

    proc.on('close', (code) => {
      this.runningProcesses.delete(task.id);
      if (buffer.trim()) {
        const event = parseLegacyLine(buffer.trim(), task.id, config.model ?? '');
        if (event) onEvent(event);
      }
      if (code !== 0 && code !== null) {
        onError(new Error(`Process exited with code ${code}`));
      } else if (!completedByEvent) {
        onComplete('Task completed');
      }
    });

    proc.on('error', (err) => {
      this.runningProcesses.delete(task.id);
      onError(err);
    });

    return running;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Agent control
  // ─────────────────────────────────────────────────────────────────────────

  pauseAgent(taskId: string): boolean {
    const running = this.runningProcesses.get(taskId);
    if (!running || running.process.killed) return false;
    running.process.kill('SIGSTOP');
    this.logger.info({ taskId }, 'OpenCode server paused');
    return true;
  }

  resumeAgent(taskId: string): boolean {
    const running = this.runningProcesses.get(taskId);
    if (!running || running.process.killed) return false;
    running.process.kill('SIGCONT');
    this.logger.info({ taskId }, 'OpenCode server resumed');
    return true;
  }

  injectMessage(taskId: string, message: string): boolean {
    const running = this.runningProcesses.get(taskId);
    if (!running) return false;
    running.inject(message);
    this.logger.info({ taskId }, 'Context message injected');
    return true;
  }

  stopAgent(taskId: string): boolean {
    const running = this.runningProcesses.get(taskId);
    if (!running) return false;
    running.kill();
    this.logger.info({ taskId }, 'OpenCode server stopped');
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
      this.logger.info({ taskId }, 'Stopping OpenCode server (shutdown)');
      running.kill();
    }
    this.runningProcesses.clear();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Utility: wait for OpenCode server URL from stdout
// ──────────────────────────────────────────────────────────────────────────────

function waitForServerUrl(proc: ChildProcess, port: number, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => {
      reject(new Error(`Timeout waiting for OpenCode server on port ${port}`));
    }, timeout);

    let output = '';
    let resolved = false;

    proc.stdout?.on('data', (chunk: Buffer) => {
      if (resolved) return;
      output += chunk.toString('utf-8');
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.includes('opencode server listening')) {
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
          if (match) {
            clearTimeout(id);
            resolved = true;
            resolve(match[1]);
            return;
          }
        }
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf-8');
    });

    proc.on('exit', (code) => {
      if (resolved) return;
      clearTimeout(id);
      reject(new Error(`OpenCode server exited with code ${code}. Output: ${output.slice(0, 500)}`));
    });

    proc.on('error', (err) => {
      if (resolved) return;
      clearTimeout(id);
      reject(err);
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Utility: find a free TCP port
// ──────────────────────────────────────────────────────────────────────────────

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        return reject(new Error('Failed to get free port'));
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SDK Event translation
//
// SDK SSE events → internal OpencodeEvent format
// Key mapping:
//   message.part.updated { part.type: "text" }           → message (assistant)
//   message.part.updated { part.type: "tool" running }   → tool_use
//   message.part.updated { part.type: "tool" completed } → tool_result
//   message.part.updated { part.type: "step-finish" }    → usage
//   session.error                                         → error
// ──────────────────────────────────────────────────────────────────────────────

function translateSdkEvent(ev: SdkEvent, model: string, userMessageIds: Set<string>): OpencodeEvent | null {
  if (ev.type === 'message.part.updated') {
    const part = ev.properties.part as Part;

    // Skip text parts from user messages (only emit assistant content)
    if (part.type === 'text' && userMessageIds.has(part.messageID)) {
      return null;
    }

    return translatePart(part, model);
  }

  if (ev.type === 'session.error') {
    const error = ev.properties.error;
    let msg = 'Unknown error';
    if (error) {
      if ('data' in error && error.data && typeof error.data === 'object' && 'message' in error.data) {
        msg = String(error.data.message);
      } else if ('name' in error) {
        msg = String(error.name);
      }
    }
    return { type: 'error', message: msg };
  }

  return null;
}

function translatePart(part: Part, model: string): OpencodeEvent | null {
  switch (part.type) {
    case 'text': {
      if (!part.text) return null;
      return { type: 'message', role: 'assistant', content: part.text };
    }

    case 'tool': {
      const state = part.state as ToolState;
      if (state.status === 'running') {
        const running = state as ToolStateRunning;
        return { type: 'tool_use', name: part.tool, input: running.input ?? {} };
      }
      if (state.status === 'completed') {
        const completed = state as ToolStateCompleted;
        return { type: 'tool_result', name: part.tool, output: completed.output ?? '' };
      }
      if (state.status === 'error') {
        const errState = state as ToolStateError;
        return { type: 'tool_result', name: part.tool, output: `Error: ${errState.error}` };
      }
      if (state.status === 'pending') {
        const pending = state as ToolStatePending;
        return { type: 'tool_use', name: part.tool, input: pending.input ?? {} };
      }
      return null;
    }

    case 'step-finish': {
      return {
        type: 'usage',
        input_tokens: part.tokens.input,
        output_tokens: part.tokens.output,
        model,
      };
    }

    default:
      return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Legacy line parser — used by mock JS scripts in tests
// ──────────────────────────────────────────────────────────────────────────────

interface LegacyRealEvent {
  type: string;
  timestamp?: number;
  part?: {
    type?: string;
    text?: string;
    toolName?: string;
    name?: string;
    input?: Record<string, unknown>;
    output?: unknown;
    content?: unknown;
    message?: string;
    tokens?: { input?: number; output?: number };
    cost?: number;
    [key: string]: unknown;
  };
  error?: { name?: string; message?: string; data?: { message?: string } };
}

function parseLegacyLine(line: string, _taskId: string, model: string): OpencodeEvent | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;

    // Real OpenCode format: has numeric timestamp and part
    if (typeof parsed['timestamp'] === 'number') {
      return translateLegacyRealEvent(parsed as unknown as LegacyRealEvent, model);
    }

    // Internal/mock format
    if (isOpencodeEvent(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

function isOpencodeEvent(val: unknown): val is OpencodeEvent {
  if (typeof val !== 'object' || val === null) return false;
  const obj = val as Record<string, unknown>;
  if (typeof obj['type'] !== 'string') return false;
  return ['message', 'tool_use', 'tool_result', 'usage', 'complete', 'error'].includes(obj['type']);
}

function translateLegacyRealEvent(ev: LegacyRealEvent, model: string): OpencodeEvent | null {
  const part = ev.part;
  switch (ev.type) {
    case 'text': {
      if (part?.text) return { type: 'message', role: 'assistant', content: part.text };
      return null;
    }
    case 'tool': {
      const name = part?.toolName ?? part?.name ?? 'unknown';
      return { type: 'tool_use', name, input: (part?.input ?? {}) as Record<string, unknown> };
    }
    case 'tool_result': {
      const name = part?.toolName ?? part?.name ?? 'unknown';
      const raw = part?.output ?? part?.content ?? '';
      const output = typeof raw === 'string' ? raw : JSON.stringify(raw);
      return { type: 'tool_result', name, output };
    }
    case 'step_finish': {
      if (part?.tokens) {
        return {
          type: 'usage',
          input_tokens: (part.tokens.input ?? 0),
          output_tokens: (part.tokens.output ?? 0),
          model,
        };
      }
      return null;
    }
    case 'error': {
      const msg = ev.error?.data?.message ?? ev.error?.message ?? part?.message ?? 'Unknown error';
      return { type: 'error', message: msg };
    }
    default:
      return null;
  }
}
