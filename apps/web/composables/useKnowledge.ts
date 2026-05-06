/**
 * useKnowledge — wrapper around /api/knowledge/* endpoints.
 *
 * Scope-aware Markdown KB (XOR per spec v0.3):
 *   - 'user' scope → personal KB of the authenticated user
 *   - 'org'  scope → workspace KB of the active organization
 *
 * Documents are stored in DB only (no filesystem vault). The `path` field
 * mimics an Obsidian-style folder layout ("guides/architecture.md") and is
 * used by the UI to render a folder tree.
 */
export type KbScopeKind = 'user' | 'org';

export interface KbScope {
  kind:           KbScopeKind;
  userId?:        string;
  organizationId?: string;
}

export interface KnowledgeDocSummary {
  id:             string;
  scope:          KbScope;
  createdBy:      string | null;
  title:          string;
  path:           string;
  contentPreview: string;
  tags:           string[];
  indexStatus:    'pending' | 'indexing' | 'indexed' | 'failed';
  indexError:     string | null;
  indexedAt:      string | null;
  chunkCount:     number;
  createdAt:      string;
  updatedAt:      string;
}

export interface KnowledgeDocument extends Omit<KnowledgeDocSummary, 'contentPreview' | 'chunkCount'> {
  content: string;
}

export interface KnowledgeChunkHit {
  id:            string;
  documentId:    string;
  documentTitle: string;
  documentPath:  string;
  chunkIndex:    number;
  content:       string;
  score:         number;
  scope:         KbScope;
}

export function useKnowledge() {
  const config = useRuntimeConfig();
  const baseUrl = config.public.apiBase as string;

  function req(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  }

  async function list(scope: KbScopeKind = 'org'): Promise<KnowledgeDocSummary[]> {
    const res = await req(`/api/knowledge?scope=${scope}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { documents: KnowledgeDocSummary[] };
    return data.documents;
  }

  async function get(id: string): Promise<KnowledgeDocument> {
    const res = await req(`/api/knowledge/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { document: KnowledgeDocument };
    return data.document;
  }

  async function create(
    scope: KbScopeKind,
    input: {
      title:   string;
      path:    string;
      content: string;
      tags?:   string[];
    },
  ): Promise<KnowledgeDocument> {
    const res = await req(`/api/knowledge?scope=${scope}`, {
      method: 'POST',
      body:   JSON.stringify(input),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { document: KnowledgeDocument };
    return data.document;
  }

  async function update(id: string, patch: {
    title?:   string;
    path?:    string;
    content?: string;
    tags?:    string[];
  }): Promise<KnowledgeDocument> {
    const res = await req(`/api/knowledge/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { document: KnowledgeDocument };
    return data.document;
  }

  async function remove(id: string): Promise<void> {
    const res = await req(`/api/knowledge/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function reindex(id: string): Promise<void> {
    const res = await req(`/api/knowledge/${id}/reindex`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function search(
    query: string,
    opts: { scope?: KbScopeKind | 'both'; topK?: number } = {},
  ): Promise<KnowledgeChunkHit[]> {
    const scope = opts.scope ?? 'both';
    const res = await req(`/api/knowledge/search?scope=${scope}`, {
      method: 'POST',
      body:   JSON.stringify({ query, topK: opts.topK ?? 5 }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { hits: KnowledgeChunkHit[] };
    return data.hits;
  }

  return { list, get, create, update, remove, reindex, search };
}
