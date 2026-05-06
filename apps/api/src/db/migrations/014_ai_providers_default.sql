-- 014_ai_providers_default.sql
--
-- Adds `is_default` flag for AI providers so a user (or org) with multiple
-- entries of the same kind can pin which one resolveForUser() should pick.
--
-- Resolver semantics (implemented in AIProviderService.resolveForUser):
--   1. user-owned, kind=X, enabled, has key   → prefer is_default=true,
--                                                  then most recent
--   2. org-shared (user_id IS NULL), kind=X   → same preference order
--   3. null (caller falls back to Copilot)
--
-- Partial unique indexes guarantee at most one default per scope+kind:
--   - per (user_id, provider) when is_default = true
--   - per (organization_id, provider) when is_default = true AND user_id IS NULL
--
-- Idempotent: safe to re-run on existing dev DBs.

ALTER TABLE ai_providers
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

-- One default per user per provider kind (personal scope).
CREATE UNIQUE INDEX IF NOT EXISTS ai_providers_default_per_user
  ON ai_providers (user_id, provider)
  WHERE is_default = TRUE AND user_id IS NOT NULL;

-- One default per org per provider kind (org-shared scope).
CREATE UNIQUE INDEX IF NOT EXISTS ai_providers_default_per_org_shared
  ON ai_providers (organization_id, provider)
  WHERE is_default = TRUE AND user_id IS NULL;

-- Resolver query benefits from a composite index on (scope, kind, enabled).
CREATE INDEX IF NOT EXISTS idx_ai_providers_resolve_user
  ON ai_providers (user_id, provider, enabled)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_providers_resolve_org_shared
  ON ai_providers (organization_id, provider, enabled)
  WHERE user_id IS NULL;
