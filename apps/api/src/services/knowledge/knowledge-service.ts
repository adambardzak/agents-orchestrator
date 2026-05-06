/**
 * Knowledge service — scope-aware markdown KB (user XOR organization).
 *
 * Each document belongs to exactly ONE owner: a user (personal KB) OR an
 * organization (workspace KB). DB-level XOR check guarantees the invariant.
 *
 * RAG retrieval (`retrieveForScopes`) accepts a list of scopes so callers
 * can union org-KB + user-KB hits at the agent-spawn layer (e.g. "use the
 * project's org KB and fall back to the project owner's personal KB").
 */
import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { createHash } from 'node:crypto';

const CHUNK_SIZE_CHARS = 1600;
const CHUNK_OVERLAP_CHARS = 200;
const EMBEDDING_DIMS = 1536;
const TOP_K_DEFAULT = 5;

export type KbScope =
  | { kind: 'user'; userId: string }
  | { kind: 'org';  organizationId: string };

export interface KnowledgeDocument {
  id:             string;
  scope:          KbScope;
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
  contentPreview: string;
  chunkCount:     number;
}

export interface KnowledgeChunkHit {
  id:            string;
  documentId:    string;
  documentPath:  string;
  documentTitle: string;
  chunkIndex:    number;
  content:       string;
  score:         number;
  scope:         KbScope;
}

export interface CreateDocInput {
  scope:     KbScope;
  createdBy: string | null;
  title:     string;
  path:      string;
  content:   string;
  tags?:     string[];
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
    /** Minimum cosine similarity (0..1) for a chunk to survive `retrieveForScopes`.
     *  0 = no filtering (legacy). Recommended ~0.45. */
    private readonly minScore: number = 0,
  ) {}

  // ── CRUD ───────────────────────────────────────────────────────────────────

  /**
   * List documents for a single scope (user OR org).
   */
  async listForScope(scope: KbScope): Promise<KnowledgeDocSummary[]> {
    const where = scope.kind === 'user' ? 'd.user_id = $1' : 'd.organization_id = $1';
    const param = scope.kind === 'user' ? scope.userId : scope.organizationId;
    const { rows } = await this.pool.query(
      `SELECT d.*,
              (SELECT COUNT(*) FROM knowledge_doc_chunks WHERE document_id = d.id) AS chunk_count
         FROM knowledge_documents d
         WHERE ${where}
         ORDER BY d.path ASC`,
      [param],
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
    const userId = input.scope.kind === 'user' ? input.scope.userId : null;
    const orgId  = input.scope.kind === 'org'  ? input.scope.organizationId : null;

    const { rows: [r] } = await this.pool.query(
      `INSERT INTO knowledge_documents
         (user_id, organization_id, created_by, title, path, content, content_hash, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING *`,
      [
        userId,
        orgId,
        input.createdBy,
        input.title,
        input.path,
        input.content,
        hash,
        JSON.stringify(input.tags ?? []),
      ],
    );
    const doc = this.mapDoc(r as Record<string, unknown>);
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
    await this.pool.query(`DELETE FROM knowledge_documents WHERE id = $1`, [id]);
  }

  // ── Indexing ───────────────────────────────────────────────────────────────

  async indexDocument(id: string): Promise<void> {
    const doc = await this.getById(id);
    if (!doc) return;

    await this.pool.query(
      `UPDATE knowledge_documents SET index_status = 'indexing', index_error = NULL WHERE id = $1`,
      [id],
    );

    try {
      await this.pool.query(`DELETE FROM knowledge_doc_chunks WHERE document_id = $1`, [id]);

      const chunks = splitMarkdownIntoChunks(doc.content);
      // Persist scope mirror on chunks for backwards-compat with old org_id
      // index; new code paths join through knowledge_documents instead.
      const orgId = doc.scope.kind === 'org' ? doc.scope.organizationId : null;

      for (let i = 0; i < chunks.length; i++) {
        const text = chunks[i]!;
        const embedding = await this.embed(text);
        await this.pool.query(
          `INSERT INTO knowledge_doc_chunks
             (document_id, organization_id, chunk_index, content, embedding, token_count)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            id,
            orgId,
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
   * Top-K cosine-similarity search across one or more scopes.
   *
   * Use a single scope for explicit user/org search; pass both when an agent
   * should pull from the project's org KB and the project owner's personal KB
   * simultaneously (results unioned and re-ranked by score).
   */
  async retrieveForScopes(
    scopes: KbScope[],
    query: string,
    topK = TOP_K_DEFAULT,
  ): Promise<KnowledgeChunkHit[]> {
    if (scopes.length === 0) return [];
    const embedding = await this.embed(query);
    if (!embedding) return [];

    // Build OR-of-scopes WHERE clause with positional params.
    const clauses: string[] = [];
    const params: unknown[] = [`[${embedding.join(',')}]`];
    let p = 2;
    for (const scope of scopes) {
      if (scope.kind === 'user') {
        clauses.push(`d.user_id = $${p++}`);
        params.push(scope.userId);
      } else {
        clauses.push(`d.organization_id = $${p++}`);
        params.push(scope.organizationId);
      }
    }
    params.push(topK);

    const { rows } = await this.pool.query<{
      id:              string;
      document_id:     string;
      document_title:  string;
      document_path:   string;
      chunk_index:     number;
      content:         string;
      score:           number;
      user_id:         string | null;
      organization_id: string | null;
    }>(
      `SELECT c.id, c.document_id, c.chunk_index, c.content,
              d.title AS document_title, d.path AS document_path,
              d.user_id, d.organization_id,
              1 - (c.embedding <=> $1::vector) AS score
         FROM knowledge_doc_chunks c
         JOIN knowledge_documents d ON d.id = c.document_id
        WHERE c.embedding IS NOT NULL
          AND (${clauses.join(' OR ')})
        ORDER BY c.embedding <=> $1::vector
        LIMIT $${p}`,
      params,
    );

    const hits: KnowledgeChunkHit[] = rows.map((r) => ({
      id:            r.id,
      documentId:    r.document_id,
      documentTitle: r.document_title,
      documentPath:  r.document_path,
      chunkIndex:    r.chunk_index,
      content:       r.content,
      score:         r.score,
      scope:         r.user_id
        ? { kind: 'user', userId: r.user_id }
        : { kind: 'org',  organizationId: r.organization_id! },
    }));

    // Drop low-relevance hits when a threshold is configured. Done in JS so
    // the pgvector index can still drive ORDER BY + LIMIT.
    if (this.minScore <= 0) return hits;
    const filtered = hits.filter((hit) => hit.score >= this.minScore);
    if (filtered.length !== hits.length) {
      this.logger.debug(
        { dropped: hits.length - filtered.length, kept: filtered.length, minScore: this.minScore },
        'KB: filtered low-relevance hits',
      );
    }
    return filtered;
  }

  /**
   * Format retrieved KB chunks as a markdown block to inject into agent
   * prompts. Sections labelled by scope so the agent knows whether the
   * context came from the workspace or the user's personal vault.
   */
  formatAsContext(hits: KnowledgeChunkHit[]): string {
    if (hits.length === 0) return '';
    const sections = hits.map((h) => {
      const scopeLabel = h.scope.kind === 'user' ? 'Personal KB' : 'Workspace KB';
      return `### [${scopeLabel}] ${h.documentTitle} — \`${h.documentPath}\` (chunk ${h.chunkIndex}, relevance: ${(h.score * 100).toFixed(0)}%)\n${h.content.slice(0, 800)}`;
    });
    return `## Knowledge Base\n\n${sections.join('\n\n---\n\n')}`;
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
    const userId = (r['user_id'] as string | null) ?? null;
    const orgId  = (r['organization_id'] as string | null) ?? null;
    const scope: KbScope = userId
      ? { kind: 'user', userId }
      : { kind: 'org',  organizationId: orgId! };
    return {
      id:          String(r['id']),
      scope,
      createdBy:   (r['created_by'] as string | null) ?? null,
      title:       String(r['title']),
      path:        String(r['path']),
      content:     String(r['content']),
      tags:        (r['tags'] as string[]) ?? [],
      indexStatus: r['index_status'] as KnowledgeDocument['indexStatus'],
      indexError:  (r['index_error'] as string | null) ?? null,
      indexedAt:   r['indexed_at'] ? new Date(r['indexed_at'] as string) : null,
      createdAt:   new Date(r['created_at'] as string),
      updatedAt:   new Date(r['updated_at'] as string),
    };
  }

  private mapSummary(r: Record<string, unknown>): KnowledgeDocSummary {
    const doc = this.mapDoc(r);
    return {
      ...doc,
      contentPreview: doc.content.slice(0, 200),
      chunkCount:     Number(r['chunk_count'] ?? 0),
      content:        undefined as unknown as string,
    } as unknown as KnowledgeDocSummary;
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function splitMarkdownIntoChunks(text: string): string[] {
  if (text.length <= CHUNK_SIZE_CHARS) {
    return text.trim().length >= 20 ? [text.trim()] : [];
  }

  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buffer = '';

  for (const para of paragraphs) {
    if ((buffer + '\n\n' + para).length > CHUNK_SIZE_CHARS && buffer.length > 0) {
      chunks.push(buffer.trim());
      const tail = buffer.slice(Math.max(0, buffer.length - CHUNK_OVERLAP_CHARS));
      buffer = tail + '\n\n' + para;
    } else {
      buffer = buffer.length === 0 ? para : `${buffer}\n\n${para}`;
    }
  }
  if (buffer.trim().length > 0) chunks.push(buffer.trim());

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
