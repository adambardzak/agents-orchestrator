/**
 * useKnowledge — wrapper around /api/knowledge/* endpoints.
 *
 * Org-scoped Markdown knowledge base with embedding-based retrieval.
 * Documents are stored in DB only (no filesystem vault). The `path` field
 * mimics an Obsidian-style folder layout ("guides/architecture.md") and is
 * used by the UI to render a folder tree.
 */
export interface KnowledgeDocSummary {
  id:             string;
  organizationId: string;
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

  async function list(): Promise<KnowledgeDocSummary[]> {
    const res = await req('/api/knowledge');
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

  async function create(input: {
    title:   string;
    path:    string;
    content: string;
    tags?:   string[];
  }): Promise<KnowledgeDocument> {
    const res = await req('/api/knowledge', { method: 'POST', body: JSON.stringify(input) });
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

  async function search(query: string, topK = 5): Promise<KnowledgeChunkHit[]> {
    const res = await req('/api/knowledge/search', {
      method: 'POST',
      body:   JSON.stringify({ query, topK }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { hits: KnowledgeChunkHit[] };
    return data.hits;
  }

  return { list, get, create, update, remove, reindex, search };
}
