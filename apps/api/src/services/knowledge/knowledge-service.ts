/**
 * Knowledge service — org-scoped markdown knowledge base.
 *
 * Stores hand-authored markdown documents (Obsidian-style path layout) and
 * derives embedding chunks for retrieval at agent-spawn time. Source content
 * lives in `knowledge_documents`; embeddings live in `knowledge_doc_chunks`.
 *
 * Embedding strategy:
 *   - On create/update we recompute content_hash and re-embed only when it
 *     changes. Embedding runs synchronously on save (small docs, fast model).
 *   - When the embedding model is unavailable (no API key), the doc is saved
 *     with index_status='pending' and chunks stay vector-NULL — retrieval
 *     just returns no hits, no error.
 */
import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { createHash } from 'node:crypto';

const CHUNK_SIZE_CHARS = 1600;   // ~400 tokens
const CHUNK_OVERLAP_CHARS = 200;
const EMBEDDING_DIMS = 1536;
const TOP_K_DEFAULT = 5;

export interface KnowledgeDocument {
  id:             string;
  organizationId: string;
  createdBy:      string | null;
  title:          string;
  path:           string;
  content:        string;
  tags:           string[];
  indexStatus:    'pending' | 'indexing' | 'indexed' | 'failed';
  indexError:     string | null;
  indexedAt:      Date | null;
  createdAt:      Date;
  updatedAt:      Date;
}

export interface KnowledgeDocSummary extends Omit<KnowledgeDocument, 'content'> {
  contentPreview: string; // first ~200 chars for list views
  chunkCount:     number;
}

export interface KnowledgeChunkHit {
  id:           string;
  documentId:   string;
  documentPath: string;
  documentTitle: string;
  chunkIndex:   number;
  content:      string;
  score:        number;
}

export interface CreateDocInput {
  organizationId: string;
  createdBy:      string | null;
  title:          string;
  path:           string;
  content:        string;
  tags?:          string[];
}

export interface UpdateDocInput {
  title?:   string;
  path?:    string;
  content?: string;
  tags?:    string[];
}

export class KnowledgeService {
  constructor(
    private readonly pool: Pool,
    private readonly logger: FastifyBaseLogger,
    private readonly openAiApiKey?: string,
    private readonly embeddingEndpoint?: string,
  ) {}

  // ── CRUD ───────────────────────────────────────────────────────────────────

  async listForOrg(organizationId: string): Promise<KnowledgeDocSummary[]> {
    const { rows } = await this.pool.query(
      `SELECT d.*,
              (SELECT COUNT(*) FROM knowledge_doc_chunks WHERE document_id = d.id) AS chunk_count
         FROM knowledge_documents d
         WHERE d.organization_id = $1
         ORDER BY d.path ASC`,
      [organizationId],
    );
    return rows.map((r) => this.mapSummary(r as Record<string, unknown>));
  }

  async getById(id: string): Promise<KnowledgeDocument | null> {
    const { rows: [r] } = await this.pool.query(
      `SELECT * FROM knowledge_documents WHERE id = $1`,
      [id],
    );
    return r ? this.mapDoc(r as Record<string, unknown>) : null;
  }

  async create(input: CreateDocInput): Promise<KnowledgeDocument> {
    const hash = sha256(input.content);
    const { rows: [r] } = await this.pool.query(
      `INSERT INTO knowledge_documents
         (organization_id, created_by, title, path, content, content_hash, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING *`,
      [
        input.organizationId,
        input.createdBy,
        input.title,
        input.path,
        input.content,
        hash,
        JSON.stringify(input.tags ?? []),
      ],
    );
    const doc = this.mapDoc(r as Record<string, unknown>);
    // Fire-and-forget embedding so the API responds quickly. The doc is
    // visible immediately; chunks appear when indexing finishes.
    this.indexDocument(doc.id).catch((err) =>
      this.logger.warn({ docId: doc.id, err: err.message }, 'KB indexing failed'),
    );
    return doc;
  }

  async update(id: string, input: UpdateDocInput): Promise<KnowledgeDocument | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    let contentChanged = false;

    if (input.title   !== undefined) { sets.push(`title = $${i++}`);   params.push(input.title); }
    if (input.path    !== undefined) { sets.push(`path = $${i++}`);    params.push(input.path); }
    if (input.tags    !== undefined) { sets.push(`tags = $${i++}::jsonb`); params.push(JSON.stringify(input.tags)); }
    if (input.content !== undefined && input.content !== existing.content) {
      const hash = sha256(input.content);
      sets.push(`content = $${i++}`);       params.push(input.content);
      sets.push(`content_hash = $${i++}`);  params.push(hash);
      sets.push(`index_status = 'pending'`);
      sets.push(`indexed_at = NULL`);
      contentChanged = true;
    }
    if (sets.length === 0) return existing;

    sets.push(`updated_at = NOW()`);
    params.push(id);
    const { rows: [r] } = await this.pool.query(
      `UPDATE knowledge_documents SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      params,
    );
    const doc = r ? this.mapDoc(r as Record<string, unknown>) : null;
    if (doc && contentChanged) {
      this.indexDocument(doc.id).catch((err) =>
        this.logger.warn({ docId: doc.id, err: err.message }, 'KB re-indexing failed'),
      );
    }
    return doc;
  }

  async delete(id: string): Promise<void> {
    // doc_chunks cascade via FK
    await this.pool.query(`DELETE FROM knowledge_documents WHERE id = $1`, [id]);
  }

  // ── Indexing ───────────────────────────────────────────────────────────────

  /**
   * Embed a document's chunks. Idempotent — safe to call multiple times.
   * Does nothing when no embedding API key is configured (chunks remain
   * vector-NULL and retrieval returns empty hits).
   */
  async indexDocument(id: string): Promise<void> {
    const doc = await this.getById(id);
    if (!doc) return;

    await this.pool.query(
      `UPDATE knowledge_documents SET index_status = 'indexing', index_error = NULL WHERE id = $1`,
      [id],
    );

    try {
      // Wipe existing chunks for this doc — simpler than diffing.
      await this.pool.query(`DELETE FROM knowledge_doc_chunks WHERE document_id = $1`, [id]);

      const chunks = splitMarkdownIntoChunks(doc.content);
      for (let i = 0; i < chunks.length; i++) {
        const text = chunks[i]!;
        const embedding = await this.embed(text);
        await this.pool.query(
          `INSERT INTO knowledge_doc_chunks
             (document_id, organization_id, chunk_index, content, embedding, token_count)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            id,
            doc.organizationId,
            i,
            text,
            embedding ? `[${embedding.join(',')}]` : null,
            Math.ceil(text.length / 4),
          ],
        );
      }

      await this.pool.query(
        `UPDATE knowledge_documents
            SET index_status = 'indexed', indexed_at = NOW(), index_error = NULL
          WHERE id = $1`,
        [id],
      );
      this.logger.info({ docId: id, chunks: chunks.length }, 'KB document indexed');
    } catch (err) {
      const msg = (err as Error).message;
      await this.pool.query(
        `UPDATE knowledge_documents SET index_status = 'failed', index_error = $1 WHERE id = $2`,
        [msg, id],
      );
      this.logger.warn({ docId: id, err: msg }, 'KB indexing failed');
    }
  }

  // ── Retrieval ──────────────────────────────────────────────────────────────

  /**
   * Top-K cosine-similarity search across an org's KB. Returns empty array
   * when embeddings unavailable (and no keyword fallback — kept simple to
   * avoid mixing strategies; project-file RAG already does keyword fallback).
   */
  async retrieveForOrg(
    organizationId: string,
    query: string,
    topK = TOP_K_DEFAULT,
  ): Promise<KnowledgeChunkHit[]> {
    const embedding = await this.embed(query);
    if (!embedding) return [];

    const { rows } = await this.pool.query<{
      id:             string;
      document_id:    string;
      document_title: string;
      document_path:  string;
      chunk_index:    number;
      content:        string;
      score:          number;
    }>(
      `SELECT c.id, c.document_id, c.chunk_index, c.content,
              d.title AS document_title, d.path AS document_path,
              1 - (c.embedding <=> $1::vector) AS score
         FROM knowledge_doc_chunks c
         JOIN knowledge_documents d ON d.id = c.document_id
        WHERE c.organization_id = $2
          AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> $1::vector
        LIMIT $3`,
      [`[${embedding.join(',')}]`, organizationId, topK],
    );

    return rows.map((r) => ({
      id:            r.id,
      documentId:    r.document_id,
      documentTitle: r.document_title,
      documentPath:  r.document_path,
      chunkIndex:    r.chunk_index,
      content:       r.content,
      score:         r.score,
    }));
  }

  /**
   * Format retrieved KB chunks as a markdown block to inject into agent prompts.
   * Designed to be appended *after* the project-file RAG context.
   */
  formatAsContext(hits: KnowledgeChunkHit[]): string {
    if (hits.length === 0) return '';
    const sections = hits.map((h) =>
      `### ${h.documentTitle} — \`${h.documentPath}\` (chunk ${h.chunkIndex}, relevance: ${(h.score * 100).toFixed(0)}%)\n${h.content.slice(0, 800)}`,
    );
    return `## Organization Knowledge Base\n\n${sections.join('\n\n---\n\n')}`;
  }

  // ── private ────────────────────────────────────────────────────────────────

  private async embed(text: string): Promise<number[] | null> {
    if (!this.openAiApiKey) return null;
    try {
      const endpoint = this.embeddingEndpoint ?? 'https://api.githubcopilot.com/embeddings';
      const res = await fetch(endpoint, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${this.openAiApiKey}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: text.slice(0, 8000),
        }),
      });
      if (!res.ok) {
        this.logger.warn({ status: res.status }, 'KB embedding API error');
        return null;
      }
      const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
      const vec = data.data[0]?.embedding;
      if (vec && vec.length !== EMBEDDING_DIMS) {
        this.logger.warn({ got: vec.length, expected: EMBEDDING_DIMS }, 'Embedding dim mismatch');
        return null;
      }
      return vec ?? null;
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'KB embedding request failed');
      return null;
    }
  }

  private mapDoc(r: Record<string, unknown>): KnowledgeDocument {
    return {
      id:             String(r['id']),
      organizationId: String(r['organization_id']),
      createdBy:      (r['created_by'] as string | null) ?? null,
      title:          String(r['title']),
      path:           String(r['path']),
      content:        String(r['content']),
      tags:           (r['tags'] as string[]) ?? [],
      indexStatus:    r['index_status'] as KnowledgeDocument['indexStatus'],
      indexError:     (r['index_error'] as string | null) ?? null,
      indexedAt:      r['indexed_at'] ? new Date(r['indexed_at'] as string) : null,
      createdAt:      new Date(r['created_at'] as string),
      updatedAt:      new Date(r['updated_at'] as string),
    };
  }

  private mapSummary(r: Record<string, unknown>): KnowledgeDocSummary {
    const doc = this.mapDoc(r);
    return {
      ...doc,
      contentPreview: doc.content.slice(0, 200),
      chunkCount:     Number(r['chunk_count'] ?? 0),
      content:        undefined as unknown as string, // erase from summary type
    } as unknown as KnowledgeDocSummary;
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Split markdown into overlapping chunks, prefer breaking on heading or
 * paragraph boundaries when possible. Falls back to char-window splitting.
 */
function splitMarkdownIntoChunks(text: string): string[] {
  if (text.length <= CHUNK_SIZE_CHARS) {
    return text.trim().length >= 20 ? [text.trim()] : [];
  }

  // Try paragraph-level splitting first
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buffer = '';

  for (const para of paragraphs) {
    if ((buffer + '\n\n' + para).length > CHUNK_SIZE_CHARS && buffer.length > 0) {
      chunks.push(buffer.trim());
      // overlap: keep tail of previous buffer to maintain context
      const tail = buffer.slice(Math.max(0, buffer.length - CHUNK_OVERLAP_CHARS));
      buffer = tail + '\n\n' + para;
    } else {
      buffer = buffer.length === 0 ? para : `${buffer}\n\n${para}`;
    }
  }
  if (buffer.trim().length > 0) chunks.push(buffer.trim());

  // If a single paragraph exceeded CHUNK_SIZE_CHARS, force-split it.
  const result: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= CHUNK_SIZE_CHARS * 1.5) {
      result.push(chunk);
    } else {
      let start = 0;
      while (start < chunk.length) {
        const end = Math.min(start + CHUNK_SIZE_CHARS, chunk.length);
        result.push(chunk.slice(start, end));
        start += CHUNK_SIZE_CHARS - CHUNK_OVERLAP_CHARS;
      }
    }
  }
  return result.filter((c) => c.trim().length >= 20);
}
