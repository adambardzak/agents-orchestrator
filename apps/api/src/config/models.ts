import type { TaskComplexity } from '@agent-orchestrator/shared';

// Model routing podle specifikace sekce 4
// Model IDs používají tečkovou notaci (github-copilot/claude-sonnet-4.6)
export const MODEL_ROUTING: Record<TaskComplexity, string> = {
  trivial: 'github-copilot/gpt-4o',
  simple: 'github-copilot/claude-haiku-4.5',
  standard: 'github-copilot/claude-sonnet-4.6',
  complex: 'github-copilot/claude-opus-4.6',
  expert: 'github-copilot/claude-opus-4.7',
} as const;

// Přibližné náklady v USD za 1M tokenů (input/output) — pro cost tracking
export const MODEL_COSTS: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'github-copilot/gpt-4o': { inputPer1M: 0, outputPer1M: 0 }, // free via Copilot
  'github-copilot/claude-haiku-4.5': { inputPer1M: 0.8, outputPer1M: 4 },
  'github-copilot/claude-sonnet-4.6': { inputPer1M: 3, outputPer1M: 15 },
  'github-copilot/claude-opus-4.6': { inputPer1M: 15, outputPer1M: 75 },
  'github-copilot/claude-opus-4.7': { inputPer1M: 75, outputPer1M: 375 },
};

export const DEFAULT_MAX_STEPS = 20;
export const DEFAULT_TIMEOUT_MINUTES = 10;
