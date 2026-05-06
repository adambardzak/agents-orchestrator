/**
 * RAG Service — project knowledge base with pgvector similarity search.
 *
 * Workflow:
 *  1. indexProjectFiles()  — chunk workspace files + generate embeddings → store in knowledge_chunks
 *  2. retrieveContext()    — embed query → cosine similarity search → return top-k chunks
 *  3. Agent worker calls retrieveContext() before spawning each task and injects result as extraContext
 *
 * Embedding model: OpenAI text-embedding-3-small via GitHub Copilot API (1536 dims)
 * Fallback: if OPENAI_API_KEY not set, runs without embeddings (empty retrieval)
 */

import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { promises as fs } from 'node:fs';
import nodePath from 'node:path';
import { v4 as uuid } from 'uuid';

const CHUNK_SIZE = 400;        // ~tokens per chunk (rough: 1 token ≈ 4 chars → 1600 chars)
const CHUNK_OVERLAP = 50;      // overlap chars between chunks
const EMBEDDING_DIMS = 1536;   // text-embedding-3-small
const TOP_K_DEFAULT = 5;

// File extensions to index
const INDEXABLE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'vue', 'svelte',
  'py', 'go', 'rs', 'java', 'kt', 'cs',
  'sql', 'graphql', 'gql',
  'md', 'mdx', 'txt',
  'json', 'yaml', 'yml', 'toml',
  'css', 'scss', 'less',
]);

const MAX_FILE_SIZE_BYTES = 100 * 1024; // skip files > 100 KB

export interface RagChunk {
  id: string;
  filePath: string;
  chunkIndex: number;
  content: string;
  score?: number; // cosine similarity (0–1), present in search results
}

export class RagService {
  constructor(
    private readonly db: Pool,
    private readonly logger: FastifyBaseLogger,
    private readonly openAiApiKey?: string,  // optional: GitHub Copilot embeddings endpoint
    private readonly embeddingEndpoint?: string,
    /** Minimum cosine similarity (0..1) for a chunk to survive `retrieveContext`.
     *  0 = no filtering (legacy). Recommended ~0.45. */
    private readonly minScore: number = 0,
  ) {}

  // ── Indexing ────────────────────────────────────────────────────────────────

  /**
   * Index all workspace files for a project.
   * Skips files that haven't changed (based on file mtime vs chunk updated_at).
   * Returns number of chunks upserted.
   */
  async indexProjectFiles(projectId: string, workspaceDir: string): Promise<number> {
    const files = await this.collectIndexableFiles(workspaceDir);
    let upserted = 0;

    for (const absPath of files) {
      try {
        const relPath = nodePath.relative(workspaceDir, absPath);
        const content = await fs.readFile(absPath, 'utf-8');
        const chunks = splitIntoChunks(content);

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]!;
          const embedding = await this.embed(chunk);

          await this.db.query(
            `INSERT INTO knowledge_chunks
               (id, project_id, file_path, chunk_index, content, embedding, token_count)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (project_id, file_path, chunk_index)
             DO UPDATE SET content = EXCLUDED.content,
                           embedding = EXCLUDED.embedding,
                           token_count = EXCLUDED.token_count,
                           updated_at = NOW()`,
            [
              uuid(),
              projectId,
              relPath,
              i,
              chunk,
              embedding ? `[${embedding.join(',')}]` : null,
              Math.ceil(chunk.length / 4),
            ],
          );
          upserted++;
        }
      } catch (err) {
        this.logger.warn({ err, absPath }, 'Failed to index file for RAG');
      }
    }

    this.logger.info({ projectId, upserted, files: files.length }, 'RAG indexing complete');
    return upserted;
  }

  /**
   * Retrieve top-k most relevant chunks for a query.
   * Falls back to keyword search if embeddings are not available.
   */
  async retrieveContext(
    projectId: string,
    query: string,
    taskId?: string,
    topK = TOP_K_DEFAULT,
  ): Promise<RagChunk[]> {
    const start = Date.now();
    let results: RagChunk[] = [];

    const embedding = await this.embed(query);

    if (embedding) {
      // Vector similarity search
      const { rows } = await this.db.query<{
        id: string;
        file_path: string;
        chunk_index: number;
        content: string;
        score: number;
      }>(
        `SELECT id, file_path, chunk_index, content,
                1 - (embedding <=> $1::vector) AS score
         FROM knowledge_chunks
         WHERE project_id = $2
           AND embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT $3`,
        [`[${embedding.join(',')}]`, projectId, topK],
      );
      results = rows.map((r) => ({ id: r.id, filePath: r.file_path, chunkIndex: r.chunk_index, content: r.content, score: r.score }));

      // Drop hits below the configured similarity threshold. Done in JS rather
      // than SQL so the pgvector index can still be used (ORDER BY + LIMIT).
      if (this.minScore > 0) {
        const before = results.length;
        results = results.filter((r) => (r.score ?? 0) >= this.minScore);
        if (before !== results.length) {
          this.logger.debug(
            { projectId, before, after: results.length, minScore: this.minScore },
            'RAG: filtered low-relevance chunks',
          );
        }
      }
    } else {
      // Keyword fallback — full-text search
      const { rows } = await this.db.query<{
        id: string;
        file_path: string;
        chunk_index: number;
        content: string;
      }>(
        `SELECT id, file_path, chunk_index, content
         FROM knowledge_chunks
         WHERE project_id = $1
           AND content ILIKE $2
         LIMIT $3`,
        [projectId, `%${query.slice(0, 100)}%`, topK],
      );
      results = rows.map((r) => ({ id: r.id, filePath: r.file_path, chunkIndex: r.chunk_index, content: r.content }));
    }

    // Log query
    const latency = Date.now() - start;
    this.db.query(
      `INSERT INTO rag_queries (id, task_id, project_id, query_text, top_k, results, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        uuid(),
        taskId ?? null,
        projectId,
        query.slice(0, 500),
        topK,
        JSON.stringify(results.map((r) => ({ chunk_id: r.id, score: r.score, preview: r.content.slice(0, 100) }))),
        latency,
      ],
    ).catch(() => undefined);

    return results;
  }

  /**
   * Format retrieved chunks as an extraContext block to inject into the agent's system prompt.
   */
  formatAsContext(chunks: RagChunk[]): string {
    if (chunks.length === 0) return '';
    const sections = chunks.map((c) =>
      `### ${c.filePath} (chunk ${c.chunkIndex}${c.score !== undefined ? `, relevance: ${(c.score * 100).toFixed(0)}%` : ''})\n\`\`\`\n${c.content.slice(0, 600)}\n\`\`\``,
    );
    return `## Relevant Project Context (from knowledge base)\n\n${sections.join('\n\n')}`;
  }

  // ── Embedding ───────────────────────────────────────────────────────────────

  private async embed(text: string): Promise<number[] | null> {
    if (!this.openAiApiKey) return null;

    try {
      const endpoint = this.embeddingEndpoint ?? 'https://api.githubcopilot.com/embeddings';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openAiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: text.slice(0, 8000), // API limit
        }),
      });

      if (!res.ok) {
        this.logger.warn({ status: res.status }, 'Embedding API error');
        return null;
      }

      const data = await res.json() as { data: Array<{ embedding: number[] }> };
      return data.data[0]?.embedding ?? null;
    } catch (err) {
      this.logger.warn({ err }, 'Embedding request failed');
      return null;
    }
  }

  // ── File collection ─────────────────────────────────────────────────────────

  private async collectIndexableFiles(dir: string, acc: string[] = []): Promise<string[]> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return acc;
    }

    for (const entry of entries) {
      const fullPath = nodePath.join(dir, entry.name);

      // Skip hidden dirs and common noise
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }

      if (entry.isDirectory()) {
        await this.collectIndexableFiles(fullPath, acc);
      } else if (entry.isFile()) {
        const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
        if (!INDEXABLE_EXTENSIONS.has(ext)) continue;
        try {
          const stat = await fs.stat(fullPath);
          if (stat.size > MAX_FILE_SIZE_BYTES) continue;
        } catch { continue; }
        acc.push(fullPath);
      }
    }

    return acc;
  }
}

// ── Text chunking ─────────────────────────────────────────────────────────────

function splitIntoChunks(text: string): string[] {
  const charSize = CHUNK_SIZE * 4; // ~4 chars per token
  const overlap = CHUNK_OVERLAP * 4;
  const chunks: string[] = [];

  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + charSize, text.length);
    chunks.push(text.slice(start, end));
    start += charSize - overlap;
    if (start >= text.length) break;
  }

  return chunks.filter((c) => c.trim().length > 20); // skip near-empty chunks
}
