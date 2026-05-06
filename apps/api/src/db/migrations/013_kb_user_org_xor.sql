-- ============================================================================
-- Migration 013 — Knowledge Base scope: User XOR Organization
-- ============================================================================
--
-- Pivot from org-only KB to dual-scope:
--   - user_id  IS NOT NULL, organization_id IS NULL  → personal KB
--   - user_id  IS NULL,     organization_id IS NOT NULL → workspace KB
--
-- Existing rows (all currently org-scoped) are preserved as workspace KB.
-- The XOR constraint is enforced at the DB level so neither service nor UI
-- can accidentally create dual-owned documents.
--
-- knowledge_doc_chunks intentionally does NOT carry user_id/org_id anymore;
-- chunks inherit ownership via FK → knowledge_documents (cleaner: scope is
-- a single source of truth on the document row).

-- ── 1. knowledge_documents ────────────────────────────────────────────────────

ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES auth_user(id) ON DELETE CASCADE;

-- Drop NOT NULL on organization_id so personal docs can have it NULL.
ALTER TABLE knowledge_documents
  ALTER COLUMN organization_id DROP NOT NULL;

-- XOR: exactly one of user_id / organization_id must be present.
-- Use NOT VALID + VALIDATE so existing rows (all org-scoped) pass cleanly.
ALTER TABLE knowledge_documents
  DROP CONSTRAINT IF EXISTS knowledge_documents_scope_xor;

ALTER TABLE knowledge_documents
  ADD CONSTRAINT knowledge_documents_scope_xor
  CHECK ((user_id IS NULL) <> (organization_id IS NULL))
  NOT VALID;

ALTER TABLE knowledge_documents VALIDATE CONSTRAINT knowledge_documents_scope_xor;

-- Existing UNIQUE(organization_id, path) only protects org-scoped docs.
-- Add a separate partial UNIQUE for user-scoped docs so personal namespaces
-- don't collide.
DROP INDEX IF EXISTS knowledge_documents_path_per_user_unique;
CREATE UNIQUE INDEX knowledge_documents_path_per_user_unique
  ON knowledge_documents (user_id, path)
  WHERE user_id IS NOT NULL;

-- The original "knowledge_documents_path_per_org_unique" constraint already
-- naturally excludes user rows (user rows have org=NULL, so the composite
-- key is NULL and Postgres treats it as distinct). Keep as-is.

-- Helpful indexes for scope-filtered list queries.
CREATE INDEX IF NOT EXISTS knowledge_documents_user_idx
  ON knowledge_documents (user_id) WHERE user_id IS NOT NULL;

-- ── 2. knowledge_doc_chunks ───────────────────────────────────────────────────
-- Chunks no longer need scope columns (inherit from document via FK).
-- We keep organization_id for backwards compatibility but make it nullable
-- and stop using it in queries; future migration may drop the column.

ALTER TABLE knowledge_doc_chunks
  ALTER COLUMN organization_id DROP NOT NULL;

-- ── 3. Sanity: bootstrap user gets nothing migrated; existing personal
--      organization seeded in plugins/auth.ts already owns any sample docs.
