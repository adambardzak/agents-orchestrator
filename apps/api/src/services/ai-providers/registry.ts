/**
 * AI provider registry — static metadata about each known provider type:
 * display name, default base URL, popular model IDs, and a `testKey()`
 * function that pings the provider's "list models" endpoint to validate
 * a key without spending tokens.
 *
 * The registry is intentionally hard-coded (rather than loaded from DB)
 * because adding a new provider type requires code changes to the model-router
 * anyway, so a code-level enum is the source of truth.
 */
import type { AIProviderType } from './provider-service.js';

export interface ProviderTypeInfo {
  id:             AIProviderType;
  displayName:    string;
  /** Whether this provider needs an API key (false for ollama/oauth). */
  needsApiKey:    boolean;
  /** Default base URL — user can override per-provider (Azure, custom). */
  defaultBaseUrl: string | null;
  /** Whether base URL is required (Azure, Ollama). */
  baseUrlRequired: boolean;
  /** Popular model IDs to suggest in the UI dropdown. */
  popularModels:  string[];
  /** Help link for getting a key. */
  apiKeyHelpUrl:  string | null;
}

export const PROVIDER_CATALOG: Record<AIProviderType, ProviderTypeInfo> = {
  anthropic: {
    id:              'anthropic',
    displayName:     'Anthropic (Claude)',
    needsApiKey:     true,
    defaultBaseUrl:  'https://api.anthropic.com',
    baseUrlRequired: false,
    popularModels:   [
      'claude-opus-4-20250514',
      'claude-sonnet-4-20250514',
      'claude-3-7-sonnet-20250219',
      'claude-3-5-haiku-20241022',
    ],
    apiKeyHelpUrl:   'https://console.anthropic.com/settings/keys',
  },
  openai: {
    id:              'openai',
    displayName:     'OpenAI',
    needsApiKey:     true,
    defaultBaseUrl:  'https://api.openai.com/v1',
    baseUrlRequired: false,
    popularModels:   ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o1', 'o3-mini'],
    apiKeyHelpUrl:   'https://platform.openai.com/api-keys',
  },
  google: {
    id:              'google',
    displayName:     'Google (Gemini)',
    needsApiKey:     true,
    defaultBaseUrl:  'https://generativelanguage.googleapis.com/v1beta',
    baseUrlRequired: false,
    popularModels:   ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    apiKeyHelpUrl:   'https://aistudio.google.com/app/apikey',
  },
  openrouter: {
    id:              'openrouter',
    displayName:     'OpenRouter',
    needsApiKey:     true,
    defaultBaseUrl:  'https://openrouter.ai/api/v1',
    baseUrlRequired: false,
    popularModels:   [
      'anthropic/claude-sonnet-4',
      'openai/gpt-4o',
      'google/gemini-2.5-pro',
      'meta-llama/llama-3.3-70b-instruct',
    ],
    apiKeyHelpUrl:   'https://openrouter.ai/keys',
  },
  ollama: {
    id:              'ollama',
    displayName:     'Ollama (local)',
    needsApiKey:     false,
    defaultBaseUrl:  'http://localhost:11434',
    baseUrlRequired: true,
    popularModels:   ['llama3.3', 'qwen2.5-coder', 'deepseek-r1'],
    apiKeyHelpUrl:   null,
  },
  'github-copilot': {
    id:              'github-copilot',
    displayName:     'GitHub Copilot',
    needsApiKey:     true, // gho_… token from `gh auth`
    defaultBaseUrl:  'https://api.githubcopilot.com',
    baseUrlRequired: false,
    popularModels:   ['claude-sonnet-4', 'gpt-5', 'claude-opus-4', 'o1'],
    apiKeyHelpUrl:   'https://github.com/settings/copilot',
  },
  'azure-openai': {
    id:              'azure-openai',
    displayName:     'Azure OpenAI',
    needsApiKey:     true,
    defaultBaseUrl:  null,
    baseUrlRequired: true, // user must provide their resource endpoint
    popularModels:   ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1'],
    apiKeyHelpUrl:   'https://learn.microsoft.com/azure/ai-services/openai/how-to/create-resource',
  },
  mistral: {
    id:              'mistral',
    displayName:     'Mistral',
    needsApiKey:     true,
    defaultBaseUrl:  'https://api.mistral.ai/v1',
    baseUrlRequired: false,
    popularModels:   ['mistral-large-latest', 'codestral-latest', 'mistral-small-latest'],
    apiKeyHelpUrl:   'https://console.mistral.ai/api-keys',
  },
};

export function listProviderTypes(): ProviderTypeInfo[] {
  return Object.values(PROVIDER_CATALOG);
}

/**
 * Test an API key against the provider's models list endpoint. Returns the
 * number of models if successful, throws on auth/network failure.
 *
 * We deliberately use the cheapest "GET /models" call available — no tokens
 * spent, just an auth check.
 */
export async function testApiKey(args: {
  provider: AIProviderType;
  apiKey:   string | null;
  baseUrl?: string | null;
}): Promise<{ ok: true; modelCount: number } | { ok: false; error: string }> {
  const info = PROVIDER_CATALOG[args.provider];
  const base = args.baseUrl || info.defaultBaseUrl;
  if (!base) return { ok: false, error: 'baseUrl is required' };

  try {
    let url: string;
    let headers: Record<string, string> = {};

    switch (args.provider) {
      case 'anthropic':
        url = `${base}/v1/models`;
        if (!args.apiKey) return { ok: false, error: 'apiKey required' };
        headers = { 'x-api-key': args.apiKey, 'anthropic-version': '2023-06-01' };
        break;
      case 'openai':
      case 'openrouter':
      case 'mistral':
      case 'azure-openai':
        url = `${base}/models`;
        if (!args.apiKey) return { ok: false, error: 'apiKey required' };
        headers = { Authorization: `Bearer ${args.apiKey}` };
        break;
      case 'google':
        if (!args.apiKey) return { ok: false, error: 'apiKey required' };
        url = `${base}/models?key=${encodeURIComponent(args.apiKey)}`;
        break;
      case 'ollama':
        url = `${base}/api/tags`;
        break;
      case 'github-copilot':
        // Copilot doesn't expose a models list endpoint; ping /chat/completions
        // would cost tokens. Best we can do is verify the token format.
        if (!args.apiKey || !/^gh[ous]_/.test(args.apiKey)) {
          return { ok: false, error: 'Copilot token must start with gho_/ghu_/ghs_' };
        }
        return { ok: true, modelCount: 0 };
      default:
        return { ok: false, error: `Unknown provider: ${String(args.provider)}` };
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${await res.text().catch(() => '')}` };
    }
    const data = (await res.json().catch(() => ({}))) as {
      data?: unknown[];        // openai, mistral, openrouter
      models?: unknown[];      // ollama, anthropic
    };
    const list = data.data ?? data.models ?? [];
    return { ok: true, modelCount: Array.isArray(list) ? list.length : 0 };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
