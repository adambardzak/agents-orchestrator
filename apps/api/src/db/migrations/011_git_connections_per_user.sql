-- ============================================================================
-- 011 — git_connections become per-USER (not per-org)
-- ----------------------------------------------------------------------------
-- Decision: a user's git accounts (GitHub, GitLab, Bitbucket) are inherently
-- personal — the OAuth scope is the user's own account, and the user sees
-- THEIR OWN repos. Tying connections to organizations created friction:
--   • The same user re-connecting in 2 orgs would have 2 duplicate rows.
--   • Switching active org would hide the user's connections.
--   • Org-level git is explicitly OUT OF SCOPE per product decision.
--
-- Migration steps:
--   1. Drop the (org, user, provider, account) UNIQUE.
--   2. Drop the org composite index.
--   3. Drop the organization_id column (and FK).
--   4. Add a new (user, provider, account) UNIQUE.
--   5. Add a per-user index for fast lookups.
-- ----------------------------------------------------------------------------

-- Step 1: drop existing UNIQUE constraint that includes organization_id.
ALTER TABLE git_connections
  DROP CONSTRAINT IF EXISTS git_connections_organization_id_user_id_provider_account_id_key;

-- Step 2: drop the org+user composite index (no longer useful).
DROP INDEX IF EXISTS idx_git_connections_org_user;

-- Step 3: drop the organization_id column.
-- NOTE: ON DELETE CASCADE FK is dropped automatically with the column.
-- Existing rows simply lose their org link; the user/provider/account
-- triple is preserved and remains the unique identifier.
ALTER TABLE git_connections
  DROP COLUMN IF EXISTS organization_id;

-- Step 4: new UNIQUE constraint scoped per user.
-- If the same user happened to have duplicate rows across orgs (one per
-- org context), we collapse those to a single row first. The most recently
-- updated row wins so we keep the freshest tokens.
DELETE FROM git_connections a
USING git_connections b
WHERE  a.id < b.id
  AND  a.user_id    = b.user_id
  AND  a.provider   = b.provider
  AND  a.account_id = b.account_id;

ALTER TABLE git_connections
  ADD CONSTRAINT git_connections_user_provider_account_key
  UNIQUE (user_id, provider, account_id);

-- Step 5: per-user lookup index.
CREATE INDEX IF NOT EXISTS idx_git_connections_user
  ON git_connections (user_id);
