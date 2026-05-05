-- Migration 003: RAG / pgvector — project knowledge base
-- Requires pgvector extension (available in pgvector Docker image)

-- Enable pgvector if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Knowledge chunks — source text split into ~512 token chunks with embeddings
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Source file info
  file_path    TEXT NOT NULL,            -- relative to workspace root
  chunk_index  INTEGER NOT NULL,         -- 0-based position within file
  content      TEXT NOT NULL,            -- raw text of the chunk

  -- Embedding (text-embedding-3-small = 1536 dims, nomic-embed-text = 768 dims)
  embedding    vector(1536),             -- NULL until embedded

  -- Metadata
  token_count  INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (project_id, file_path, chunk_index)
);

CREATE INDEX idx_knowledge_chunks_project ON knowledge_chunks(project_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
  ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- RAG queries log — track what was retrieved and why (debugging + quality)
CREATE TABLE IF NOT EXISTS rag_queries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      UUID REFERENCES agent_tasks(id) ON DELETE SET NULL,
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  query_text   TEXT NOT NULL,
  top_k        INTEGER NOT NULL DEFAULT 5,
  results      JSONB NOT NULL DEFAULT '[]',  -- array of {chunk_id, score, content_preview}
  latency_ms   INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rag_queries_project ON rag_queries(project_id);
CREATE INDEX idx_rag_queries_task ON rag_queries(task_id);
