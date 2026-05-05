/**
 * Smoke Test 1: OpenCode Process Manager
 *
 * Tests that the process manager:
 * 1. Correctly spawns a process (mock-opencode)
 * 2. Parses NDJSON output into OpencodeEvent objects
 * 3. Calls onEvent for each event type
 * 4. Calls onComplete with summary
 * 5. Writes valid opencode.json config before spawning
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenCodeProcessManager } from '../services/opencode/sdk-process-manager.js';
import type { AgentTask, AgentDefinition, OpencodeEvent } from '@agent-orchestrator/shared';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_OPENCODE = path.resolve(__dirname, '../../../../test/mock-opencode.js');
const WORKSPACES_ROOT = path.resolve(__dirname, '../../../../test/workspaces');

// Mock logger
const mockLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: () => mockLogger,
} as unknown as import('fastify').FastifyBaseLogger;

const mockTask: AgentTask = {
  id: 'test-task-001',
  sessionId: 'test-session-001',
  projectId: 'test-project-001',
  contextType: 'personal',
  agentType: 'architect',
  agentId: 'built-in:architect',
  prompt: 'Design the database schema for a todo app',
  status: 'pending',
  complexity: 'complex',
  model: 'github-copilot/claude-opus-4.6',
  currentStep: 0,
  maxSteps: 20,
  contextTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  dependsOn: [],
  createdAt: new Date(),
};

const mockAgentConfig: AgentDefinition = {
  id: 'built-in:architect',
  name: 'Architect',
  type: 'architect',
  defaultComplexity: 'complex',
  canEscalateTo: 'expert',
  systemPrompt: 'You are a senior software architect.',
  rules: ['Always create an ADR for significant decisions'],
  skills: [],
  allowedMcpServers: ['filesystem', 'git'],
  allowedTools: [],
  maxSteps: 25,
  timeoutMinutes: 15,
  description: 'Architect agent',
  icon: 'building',
  triggers: { taskTypes: ['architecture'], contextTypes: ['personal'] },
  isBuiltIn: true,
  isActive: true,
  createdBy: 'system',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const BASE_SPAWN_OPTIONS = {
  workspacesRoot: WORKSPACES_ROOT,
  githubToken: 'ghp_test_token',
  opencodeBinary: MOCK_OPENCODE,
  env: { MOCK_OPENCODE_AGENT_TYPE: 'architect' },
};

describe('OpenCode Process Manager', () => {
  let processManager: OpenCodeProcessManager;

  beforeEach(async () => {
    processManager = new OpenCodeProcessManager(mockLogger);
    await fs.mkdir(path.join(WORKSPACES_ROOT, mockTask.projectId, 'sessions', mockTask.sessionId), { recursive: true });
  });

  it('receives all NDJSON event types from mock process', async () => {
    const receivedEvents: OpencodeEvent[] = [];
    let completeSummary = '';

    await new Promise<void>((resolve, reject) => {
      processManager.spawnAgent({
        ...BASE_SPAWN_OPTIONS,
        task: mockTask,
        agentConfig: mockAgentConfig,
        onEvent: (event) => receivedEvents.push(event),
        onComplete: (summary) => { completeSummary = summary; resolve(); },
        onError: reject,
      }).catch(reject);
    });

    const eventTypes = new Set(receivedEvents.map((e) => e.type));

    expect(eventTypes.has('message'), 'message events').toBe(true);
    expect(eventTypes.has('tool_use'), 'tool_use events').toBe(true);
    expect(eventTypes.has('tool_result'), 'tool_result events').toBe(true);
    expect(eventTypes.has('usage'), 'usage events').toBe(true);
    expect(completeSummary).toContain('Architecture designed');
  }, 15_000);

  it('writes valid opencode.json before spawning process', async () => {
    const configPath = path.join(
      WORKSPACES_ROOT, mockTask.projectId, 'sessions', mockTask.sessionId, '.opencode', `agent-${mockAgentConfig.type}.json`,
    );
    await fs.rm(configPath, { force: true });

    await new Promise<void>((resolve, reject) => {
      processManager.spawnAgent({
        ...BASE_SPAWN_OPTIONS,
        task: mockTask,
        agentConfig: mockAgentConfig,
        onEvent: () => {},
        onComplete: () => resolve(),
        onError: reject,
      }).catch(reject);
    });

    const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));

    expect(config.model).toBe('github-copilot/claude-opus-4.6');
    // Real OpenCode schema: provider is a nested object, not a string
    expect(config.provider?.['github-copilot']?.options?.apiKey).toBe('ghp_test_token');
    // System prompt is in agent[type].prompt, not top-level
    expect(config.agent?.['architect']?.prompt).toContain('architect');
    // maxSteps is embedded in the prompt, not a top-level field
    expect(config.agent?.['architect']?.prompt).toContain('25');
    expect(Array.isArray(config.mcp ? Object.keys(config.mcp) : [])).toBe(true);
  }, 10_000);

  it('tool_use events have correct shape', async () => {
    const toolUseEvents: Array<Extract<OpencodeEvent, { type: 'tool_use' }>> = [];

    await new Promise<void>((resolve, reject) => {
      processManager.spawnAgent({
        ...BASE_SPAWN_OPTIONS,
        task: mockTask,
        agentConfig: mockAgentConfig,
        onEvent: (event) => {
          if (event.type === 'tool_use') toolUseEvents.push(event);
        },
        onComplete: () => resolve(),
        onError: reject,
      }).catch(reject);
    });

    expect(toolUseEvents.length).toBeGreaterThanOrEqual(2);

    for (const event of toolUseEvents) {
      expect(event).toMatchObject({
        type: 'tool_use',
        name: expect.any(String),
        input: expect.any(Object),
      });
    }

    // Architect mock uses write_file — verify path is in input
    const writeFiles = toolUseEvents.filter((e) => e.name === 'write_file');
    expect(writeFiles.length).toBeGreaterThanOrEqual(1);
    expect(writeFiles[0].input).toHaveProperty('path');
  }, 15_000);

  it('usage events contain valid token counts', async () => {
    const usageEvents: Array<Extract<OpencodeEvent, { type: 'usage' }>> = [];

    await new Promise<void>((resolve, reject) => {
      processManager.spawnAgent({
        ...BASE_SPAWN_OPTIONS,
        task: mockTask,
        agentConfig: mockAgentConfig,
        onEvent: (event) => {
          if (event.type === 'usage') usageEvents.push(event);
        },
        onComplete: () => resolve(),
        onError: reject,
      }).catch(reject);
    });

    expect(usageEvents.length).toBeGreaterThanOrEqual(1);

    for (const event of usageEvents) {
      expect(event.input_tokens).toBeGreaterThan(0);
      expect(event.output_tokens).toBeGreaterThan(0);
      expect(event.model).toMatch(/^github-copilot\//);
    }
  }, 15_000);

  it('stopAgent kills running process', async () => {
    const taskId = 'test-stop-001';
    let processEndedWithError = false;

    processManager.spawnAgent({
      ...BASE_SPAWN_OPTIONS,
      task: { ...mockTask, id: taskId },
      agentConfig: mockAgentConfig,
      env: { MOCK_OPENCODE_AGENT_TYPE: 'backend' },
      onEvent: () => {},
      onComplete: () => {},
      onError: () => { processEndedWithError = true; },
    }).catch(() => { processEndedWithError = true; });

    // Wait for process to start
    await new Promise((r) => setTimeout(r, 150));

    expect(processManager.isRunning(taskId)).toBe(true);
    const stopped = processManager.stopAgent(taskId);
    expect(stopped).toBe(true);

    await new Promise((r) => setTimeout(r, 500));
    expect(processManager.isRunning(taskId)).toBe(false);
  }, 5_000);
});
