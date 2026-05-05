import type { AgentDefinition, OpencodeConfig, TaskComplexity } from '@agent-orchestrator/shared';
import { MODEL_ROUTING } from '../../config/models.js';
import { buildMcpServerConfigs } from '../../agents/mcp-catalog.js';

interface BuildConfigOptions {
  agentConfig: AgentDefinition;
  taskComplexity: TaskComplexity;
  githubToken: string;
  extraContext?: string;
}

/**
 * Builds the OPENCODE_CONFIG_CONTENT value for a specific agent run.
 *
 * Uses the real OpenCode JSON schema:
 *   - provider.github-copilot.options.apiKey  (not top-level providers)
 *   - mcp[name].type / command[]              (not command+args)
 *   - agent[type].prompt                      (not top-level systemPrompt)
 *   - permission["*"] = "allow"               (non-interactive, skip confirmations)
 */
export function buildOpencodeConfig(options: BuildConfigOptions): OpencodeConfig {
  const { agentConfig, taskComplexity, githubToken, extraContext } = options;

  // Resolve model — use task complexity but cap at agent's canEscalateTo
  const model = resolveModel(agentConfig.defaultComplexity, taskComplexity, agentConfig.canEscalateTo);

  // ── Assemble system prompt ──────────────────────────────────────────────────
  const parts: string[] = [agentConfig.systemPrompt];

  // Embed rules directly in the prompt (real OpenCode has no top-level `rules` array)
  const allRules = [
    ...agentConfig.rules,
    ...agentConfig.skills.flatMap((s) => s.rules),
  ];
  if (allRules.length > 0) {
    parts.push(`\n\n## Rules\n\n${allRules.map((r) => `- ${r}`).join('\n')}`);
  }

  // Inject skill knowledge blocks
  if (agentConfig.skills.length > 0) {
    const skillBlocks = agentConfig.skills
      .map((s) => `## Skill: ${s.name}\n\n${s.knowledgeBlock}`)
      .join('\n\n---\n\n');
    parts.push(`\n\n## Specialized Knowledge\n\n${skillBlocks}`);
  }

  // Append extra project context
  if (extraContext) {
    parts.push(`\n\n## Project Context\n\n${extraContext}`);
  }

  // ── Escalation instruction (worker agents only — NOT orchestrator) ──────────
  // Orchestrator outputs a single JSON plan object; adding escalation JSON
  // examples would conflict with "output ONLY the plan JSON" and confuse models.
  const currentIdx = COMPLEXITY_ORDER.indexOf(taskComplexity);
  const ceilingIdx = COMPLEXITY_ORDER.indexOf(agentConfig.canEscalateTo);
  if (agentConfig.type !== 'orchestrator' && agentConfig.type !== 'planner' && ceilingIdx > currentIdx) {
    const nextComplexity = COMPLEXITY_ORDER[currentIdx + 1];
    if (nextComplexity) {
      parts.push(`\n\n## Model Escalation
If this task turns out to be significantly more complex than initially assessed and you need a more powerful model to complete it correctly, output a JSON escalation request on a new line:
\`\`\`json
{"escalate": "${nextComplexity}", "reason": "brief explanation of why a more powerful model is needed"}
\`\`\`
Only escalate if truly necessary — it increases cost. Current model ceiling: ${agentConfig.canEscalateTo}.`);
    }
  }

  // Embed maxSteps as a rule in the prompt
  parts.push(`\n\n## Limits\n\nComplete the task in at most ${agentConfig.maxSteps} steps.`);

  const systemPrompt = parts.join('');

  // ── Merge MCP servers (agent + skills) ─────────────────────────────────────
  const allMcpServerIds = [
    ...new Set([
      ...agentConfig.allowedMcpServers,
      ...agentConfig.skills.flatMap((s) => s.requiredMcpServers),
    ]),
  ];
  const mcpServers = buildMcpServerConfigs(allMcpServerIds, process.env as Record<string, string>);

  // ── Real OpenCode config schema ─────────────────────────────────────────────
  return {
    $schema: 'https://opencode.ai/config.json',
    model,
    provider: {
      'github-copilot': {
        options: { apiKey: githubToken },
      },
    },
    mcp: mcpServers,
    agent: {
      [agentConfig.type]: {
        model,
        prompt: systemPrompt,
        description: agentConfig.description,
        mode: 'primary' as const,
      },
    },
    // Allow all tool calls without interactive confirmation (headless mode)
    permission: { '*': 'allow' },
    autoupdate: false,
  };
}

export const COMPLEXITY_ORDER: TaskComplexity[] = ['trivial', 'simple', 'standard', 'complex', 'expert'];

/**
 * Resolves the actual model ID based on:
 * - agent's default complexity preference
 * - current task's actual complexity
 * - agent's escalation ceiling
 */
export function resolveModel(
  agentDefault: TaskComplexity,
  taskComplexity: TaskComplexity,
  ceiling: TaskComplexity,
): string {
  const defaultIdx = COMPLEXITY_ORDER.indexOf(agentDefault);
  const taskIdx = COMPLEXITY_ORDER.indexOf(taskComplexity);
  const ceilingIdx = COMPLEXITY_ORDER.indexOf(ceiling);

  // Use max(default, task) but cap at ceiling
  const resolvedIdx = Math.min(Math.max(defaultIdx, taskIdx), ceilingIdx);
  const resolved = COMPLEXITY_ORDER[resolvedIdx];

  return MODEL_ROUTING[resolved];
}
