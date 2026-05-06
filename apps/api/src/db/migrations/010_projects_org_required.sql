-- ============================================================================
-- 010 — projects.organization_id backfill + NOT NULL
-- ----------------------------------------------------------------------------
-- Migration 006 added projects.organization_id as nullable. This migration:
--   1. Back-fills any remaining NULLs to the bootstrap org
--      (00000000-0000-0000-0000-000000000010 = "Personal workspace"), creating
--      that org if it doesn't exist yet (idempotent for both fresh installs and
--      legacy single-user databases).
--   2. Adds NOT NULL so future code can rely on every project having an org.
--   3. Back-fills `created_by` from the bootstrap user where NULL so the
--      "owner" column remains useful for audit/UI purposes.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  v_bootstrap_org_id UUID := '00000000-0000-0000-0000-000000000010';
  v_bootstrap_user_id TEXT := '00000000-0000-0000-0000-000000000001';
BEGIN
  -- Ensure the bootstrap user exists (mirrors logic in apps/api/src/plugins/auth.ts).
  INSERT INTO auth_user (id, email, name, email_verified, created_at, updated_at)
  VALUES (v_bootstrap_user_id, 'bootstrap@local', 'Bootstrap User', true, now(), now())
  ON CONFLICT (id) DO NOTHING;

  -- Ensure the bootstrap organization exists.
  INSERT INTO organizations (id, slug, name, created_by)
  VALUES (v_bootstrap_org_id, 'personal', 'Personal workspace', v_bootstrap_user_id)
  ON CONFLICT (id) DO NOTHING;

  -- Ensure bootstrap user is a member (owner) of the bootstrap org.
  INSERT INTO organization_memberships (organization_id, user_id, role)
  VALUES (v_bootstrap_org_id, v_bootstrap_user_id, 'owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;
END $$;

-- Backfill: every project without an org goes to bootstrap org.
UPDATE projects
SET organization_id = '00000000-0000-0000-0000-000000000010'
WHERE organization_id IS NULL;

-- Backfill: every project without a creator gets the bootstrap user.
UPDATE projects
SET created_by = '00000000-0000-0000-0000-000000000001'
WHERE created_by IS NULL;

-- Enforce NOT NULL going forward.
ALTER TABLE projects
  ALTER COLUMN organization_id SET NOT NULL;
