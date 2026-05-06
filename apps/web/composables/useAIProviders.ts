/**
 * useAIProviders — wrapper around /api/ai-providers/* endpoints.
 *
 * The catalog (list of provider types + their popular models) comes from
 * /api/ai-providers/types and never changes during the session, so we
 * cache it on first call.
 */
export type AIProviderType =
  | 'anthropic' | 'openai' | 'google' | 'openrouter'
  | 'ollama' | 'github-copilot' | 'azure-openai' | 'mistral';

export interface ProviderTypeInfo {
  id: AIProviderType;
  displayName: string;
  needsApiKey: boolean;
  defaultBaseUrl: string | null;
  baseUrlRequired: boolean;
  popularModels: string[];
  apiKeyHelpUrl: string | null;
}

export interface AIProviderRow {
  id: string;
  organizationId: string;
  userId: string | null;
  provider: AIProviderType;
  label: string;
  baseUrl: string | null;
  defaultModel: string | null;
  enabled: boolean;
  isDefault: boolean;
  hasApiKey: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedProvider {
  provider: AIProviderRow | null;
  scope?: 'user' | 'org-shared';
}

export interface TestResult {
  ok: boolean;
  modelCount?: number;
  error?: string;
}

let typesCache: ProviderTypeInfo[] | null = null;

export function useAIProviders() {
  const config = useRuntimeConfig();
  const baseUrl = config.public.apiBase as string;

  function req(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  }

  async function listTypes(): Promise<ProviderTypeInfo[]> {
    if (typesCache) return typesCache;
    const res = await req('/api/ai-providers/types');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { types: ProviderTypeInfo[] };
    typesCache = data.types;
    return data.types;
  }

  async function list(): Promise<AIProviderRow[]> {
    const res = await req('/api/ai-providers');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { providers: AIProviderRow[] };
    return data.providers;
  }

  async function create(input: {
    provider:     AIProviderType;
    label:        string;
    apiKey?:      string;
    baseUrl?:     string;
    defaultModel?: string;
    scope:        'org' | 'personal';
  }): Promise<AIProviderRow> {
    const res = await req('/api/ai-providers', { method: 'POST', body: JSON.stringify(input) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    const data = (await res.json()) as { provider: AIProviderRow };
    return data.provider;
  }

  async function update(id: string, patch: {
    label?:        string;
    apiKey?:       string;
    baseUrl?:      string | null;
    defaultModel?: string | null;
    enabled?:      boolean;
    isDefault?:    boolean;
  }): Promise<AIProviderRow> {
    const res = await req(`/api/ai-providers/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { provider: AIProviderRow };
    return data.provider;
  }

  /**
   * Pins this provider as the default within its (scope, kind) group.
   * Backend atomically clears any sibling default first.
   */
  async function setDefault(id: string): Promise<AIProviderRow> {
    const res = await req(`/api/ai-providers/${id}/default`, { method: 'PATCH', body: '{}' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { provider: AIProviderRow };
    return data.provider;
  }

  /**
   * Returns which provider would currently be picked by the resolver
   * (user-wins + org fallback). Optional `kind` narrows by provider type.
   */
  async function resolved(kind?: AIProviderType): Promise<ResolvedProvider> {
    const path = kind ? `/api/ai-providers/resolved?kind=${kind}` : '/api/ai-providers/resolved';
    const res = await req(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as ResolvedProvider;
  }

  async function remove(id: string): Promise<void> {
    const res = await req(`/api/ai-providers/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function testStored(id: string): Promise<TestResult> {
    const res = await req(`/api/ai-providers/${id}/test`, { method: 'POST', body: '{}' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { result: TestResult };
    return data.result;
  }

  async function testInline(input: {
    provider: AIProviderType;
    apiKey?:  string;
    baseUrl?: string;
  }): Promise<TestResult> {
    const res = await req('/api/ai-providers/test', { method: 'POST', body: JSON.stringify(input) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { result: TestResult };
    return data.result;
  }

  return { listTypes, list, create, update, remove, testStored, testInline, setDefault, resolved };
}
