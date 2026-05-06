-- ============================================================================
-- Migration 008 — Org-scoped Knowledge Base
-- ============================================================================
--
-- Augments the existing project-scoped RAG (knowledge_chunks) with an
-- organization-level knowledge base: hand-authored markdown documents that
-- get chunked + embedded for retrieval at agent-spawn time.
--
-- Two-table layout:
--   knowledge_documents    — source-of-truth markdown content (org-scoped)
--   knowledge_doc_chunks   — embeddings derived from documents (joined to org)
--
-- We keep the existing knowledge_chunks table untouched (project-file RAG)
-- and add a separate doc_chunks table so the two retrieval paths can be
-- queried independently or unioned at the worker level.

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by      TEXT REFERENCES auth_user(id) ON DELETE SET NULL,

  title           TEXT NOT NULL,
  -- "path" mimics an Obsidian vault layout, e.g. "guides/architecture/api.md".
  -- Lets the UI render a folder tree without a separate folders table.
  path            TEXT NOT NULL,
  content         TEXT NOT NULL,                       -- raw markdown
  content_hash    TEXT NOT NULL,                       -- sha256 of content; skip re-embedding when unchanged
  tags            JSONB NOT NULL DEFAULT '[]'::jsonb,  -- string[] for filtering
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Embedding pipeline state
  index_status    TEXT NOT NULL DEFAULT 'pending'      -- pending | indexing | indexed | failed
                  CHECK (index_status IN ('pending', 'indexing', 'indexed', 'failed')),
  index_error     TEXT,
  indexed_at      TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT knowledge_documents_path_per_org_unique UNIQUE (organization_id, path)
);

CREATE INDEX IF NOT EXISTS knowledge_documents_org_idx       ON knowledge_documents (organization_id);
CREATE INDEX IF NOT EXISTS knowledge_documents_index_status_idx ON knowledge_documents (index_status);

-- Per-document chunks with embeddings. ON DELETE CASCADE so deleting a doc
-- always cleans up its embeddings.
CREATE TABLE IF NOT EXISTS knowledge_doc_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  chunk_index     INTEGER NOT NULL,
  content         TEXT NOT NULL,
  embedding       vector(1536),         -- text-embedding-3-small dims; NULL while pending
  token_count     INTEGER,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS knowledge_doc_chunks_org_idx ON knowledge_doc_chunks (organization_id);
CREATE INDEX IF NOT EXISTS knowledge_doc_chunks_embedding_idx
  ON knowledge_doc_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
