/**
 * Per-provider mapping from TaskComplexity to a concrete model ID.
 *
 * Used when an organization has a configured AI provider that should
 * replace the default GitHub Copilot routing. Falls back to defaultModel
 * (or null = "no preference, let provider choose") when complexity isn't
 * in the table.
 */
import type { TaskComplexity } from '@agent-orchestrator/shared';
import type { AIProviderType } from './provider-service.js';

type ComplexityMap = Record<TaskComplexity, string>;

/**
 * Best-effort mapping; users can override per-provider via `defaultModel`.
 * For providers without a complexity-tier model lineup (Ollama, Azure,
 * Copilot — Azure deployments are user-named, Ollama depends on what's
 * pulled), we return null and rely on the provider's `defaultModel`.
 */
export const COMPLEXITY_TO_MODEL: Partial<Record<AIProviderType, ComplexityMap>> = {
  anthropic: {
    trivial:  'claude-3-5-haiku-20241022',
    simple:   'claude-3-5-haiku-20241022',
    standard: 'claude-sonnet-4-20250514',
    complex:  'claude-sonnet-4-20250514',
    expert:   'claude-opus-4-20250514',
  },
  openai: {
    trivial:  'gpt-4o-mini',
    simple:   'gpt-4o-mini',
    standard: 'gpt-4o',
    complex:  'gpt-4.1',
    expert:   'o1',
  },
  google: {
    trivial:  'gemini-2.0-flash',
    simple:   'gemini-2.0-flash',
    standard: 'gemini-2.5-flash',
    complex:  'gemini-2.5-pro',
    expert:   'gemini-2.5-pro',
  },
  mistral: {
    trivial:  'mistral-small-latest',
    simple:   'mistral-small-latest',
    standard: 'mistral-large-latest',
    complex:  'mistral-large-latest',
    expert:   'mistral-large-latest',
  },
  openrouter: {
    trivial:  'anthropic/claude-3.5-haiku',
    simple:   'anthropic/claude-3.5-haiku',
    standard: 'anthropic/claude-sonnet-4',
    complex:  'anthropic/claude-sonnet-4',
    expert:   'anthropic/claude-opus-4',
  },
};

/**
 * Resolve the model ID for a given provider type + complexity, preferring
 * the user's configured `defaultModel` if present.
 */
export function resolveProviderModel(
  provider: AIProviderType,
  complexity: TaskComplexity,
  userDefaultModel: string | null,
): string | null {
  if (userDefaultModel) return userDefaultModel;
  return COMPLEXITY_TO_MODEL[provider]?.[complexity] ?? null;
}
