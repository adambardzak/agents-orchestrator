/**
 * Smoke Test 3: Model Router
 *
 * Tests that the model router correctly selects models
 * based on complexity and respects escalation ceilings.
 */

import { describe, it, expect } from 'vitest';
import { resolveModel, buildOpencodeConfig } from '../services/model-router/router.js';
import type { AgentDefinition, McpLocalServerConfig } from '@agent-orchestrator/shared';

describe('Model Router — resolveModel', () => {
  it('uses agent default when task complexity is lower', () => {
    // Architect default=complex, task=trivial → should use complex (agent default wins)
    const model = resolveModel('complex', 'trivial', 'expert');
    expect(model).toBe('github-copilot/claude-opus-4.6');
  });

  it('escalates to task complexity when it is higher than agent default', () => {
    // Backend default=standard, task=complex → escalates to complex
    const model = resolveModel('standard', 'complex', 'expert');
    expect(model).toBe('github-copilot/claude-opus-4.6');
  });

  it('never exceeds agent ceiling', () => {
    // Frontend default=simple, task=expert, ceiling=standard → caps at standard
    const model = resolveModel('simple', 'expert', 'standard');
    expect(model).toBe('github-copilot/claude-sonnet-4.6');
  });

  it('maps trivial → gpt-4o (free model)', () => {
    const model = resolveModel('trivial', 'trivial', 'simple');
    expect(model).toBe('github-copilot/gpt-4o');
  });

  it('maps expert → claude-opus-4.7', () => {
    const model = resolveModel('expert', 'expert', 'expert');
    expect(model).toBe('github-copilot/claude-opus-4.7');
  });
});

describe('Model Router — buildOpencodeConfig', () => {
  const testAgent: AgentDefinition = {
    id: 'test-agent',
    name: 'Test Agent',
    type: 'backend',
    description: 'Test',
    icon: 'code',
    defaultComplexity: 'standard',
    canEscalateTo: 'complex',
    systemPrompt: 'You are a backend engineer.',
    rules: ['Use TypeScript', 'Validate inputs'],
    skills: [],
    allowedMcpServers: ['filesystem', 'git'],
    allowedTools: [],
    maxSteps: 20,
    timeoutMinutes: 10,
    triggers: { taskTypes: ['backend'], contextTypes: ['personal'] },
    isBuiltIn: true,
    isActive: true,
    createdBy: 'system',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('generates valid opencode config structure with real schema', () => {
    const config = buildOpencodeConfig({
      agentConfig: testAgent,
      taskComplexity: 'standard',
      githubToken: 'ghp_test',
    });

    // Model at top-level and in agent block
    expect(config.model).toBe('github-copilot/claude-sonnet-4.6');
    // Provider as nested object (real OpenCode schema)
    expect(config.provider?.['github-copilot']?.options?.apiKey).toBe('ghp_test');
    // System prompt lives inside agent[type].prompt
    expect(config.agent?.['backend']?.prompt).toContain('backend engineer');
    // Rules are embedded in the prompt, not a top-level array
    expect(config.agent?.['backend']?.prompt).toContain('Use TypeScript');
    expect(config.agent?.['backend']?.prompt).toContain('Validate inputs');
    // permission["*"] = "allow" for non-interactive mode
    expect(config.permission?.['*']).toBe('allow');
    expect(config.autoupdate).toBe(false);
  });

  it('includes extra context in agent prompt when provided', () => {
    const config = buildOpencodeConfig({
      agentConfig: testAgent,
      taskComplexity: 'standard',
      githubToken: 'ghp_test',
      extraContext: 'Project uses PostgreSQL 16',
    });

    const prompt = config.agent?.['backend']?.prompt ?? '';
    expect(prompt).toContain('backend engineer');
    expect(prompt).toContain('Project uses PostgreSQL 16');
    expect(prompt).toContain('Project Context');
  });

  it('includes MCP servers in real OpenCode local format', () => {
    const config = buildOpencodeConfig({
      agentConfig: testAgent,
      taskComplexity: 'standard',
      githubToken: 'ghp_test',
    });

    // filesystem and git are in allowedMcpServers
    expect(config.mcp).toHaveProperty('filesystem');
    expect(config.mcp).toHaveProperty('git');

    // Real OpenCode format: type = "local", command = array starting with "npx"
    const fsMcp = config.mcp!['filesystem'] as McpLocalServerConfig;
    expect(fsMcp.type).toBe('local');
    expect(fsMcp.command[0]).toBe('npx');
    expect(fsMcp.enabled).toBe(true);
  });

  it('respects agent ceiling when task asks for higher complexity', () => {
    const config = buildOpencodeConfig({
      agentConfig: testAgent,
      taskComplexity: 'expert', // Higher than ceiling (complex)
      githubToken: 'ghp_test',
    });

    // Ceiling is 'complex' → should use claude-opus-4.6, not claude-opus-4.7
    expect(config.model).toBe('github-copilot/claude-opus-4.6');
  });
});
