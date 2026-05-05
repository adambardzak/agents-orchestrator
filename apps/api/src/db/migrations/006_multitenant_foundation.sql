-- Migration 006: Multi-tenant foundation
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds:
--   • Better Auth tables (users, sessions, accounts, verifications)
--   • Organizations (workgroups) + memberships (M:N user↔org with roles)
--   • Org-scoped git provider connections (encrypted tokens)
--   • Org-scoped AI provider configurations (encrypted API keys)
--   • Backfills existing projects into a default "Personal" org for the
--     bootstrap user (created on first login).
--   • Adds organization_id to projects (NOT NULL after backfill).

-- ─── Better Auth core tables ───────────────────────────────────────────────
-- Schema follows Better Auth defaults. We use snake_case via column mapping
-- on the JS side; raw column names stay default-style for Better Auth CLI.

CREATE TABLE IF NOT EXISTS auth_user (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  name            TEXT,
  image           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_session (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  token           TEXT NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  ip_address      TEXT,
  user_agent      TEXT,
  active_organization_id TEXT,  -- "current" org context for this session
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_session_user ON auth_session(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_session_expires ON auth_session(expires_at);

CREATE TABLE IF NOT EXISTS auth_account (
  id                       TEXT PRIMARY KEY,
  user_id                  TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  provider_id              TEXT NOT NULL,    -- 'github' | 'google' | 'credentials'
  account_id               TEXT NOT NULL,    -- provider's user id
  password                 TEXT,             -- bcrypt hash for email/password
  access_token             TEXT,
  refresh_token            TEXT,
  access_token_expires_at  TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  scope                    TEXT,
  id_token                 TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_auth_account_user ON auth_account(user_id);

CREATE TABLE IF NOT EXISTS auth_verification (
  id          TEXT PRIMARY KEY,
  identifier  TEXT NOT NULL,
  value       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_verification_identifier ON auth_verification(identifier);

-- ─── Organizations (workgroups / tenants) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  logo_url    TEXT,
  created_by  TEXT NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- M:N user ↔ org with roles
CREATE TABLE IF NOT EXISTS organization_memberships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member'
                    CHECK (role IN ('owner', 'admin', 'member')),
  invited_by      TEXT REFERENCES auth_user(id) ON DELETE SET NULL,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_membership_user ON organization_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_org_membership_org  ON organization_memberships(organization_id);

-- Pending invitations (email-based)
CREATE TABLE IF NOT EXISTS organization_invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'member'
                    CHECK (role IN ('owner', 'admin', 'member')),
  invited_by      TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  token           TEXT NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_invite_email ON organization_invitations(email);
CREATE INDEX IF NOT EXISTS idx_org_invite_org   ON organization_invitations(organization_id);

-- ─── Project ↔ Organization (backfill existing projects) ───────────────────
-- Step 1: add nullable column.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS created_by TEXT REFERENCES auth_user(id) ON DELETE SET NULL;

-- (NOT NULL constraint added in a follow-up migration once a default org exists.
--  In the meantime the API treats NULL as "single-user legacy" and refuses to
--  show those projects when auth is enforced.)

CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(organization_id);

-- ─── Git provider connections (per user, scoped per org context) ───────────
CREATE TABLE IF NOT EXISTS git_connections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL CHECK (provider IN ('github', 'gitlab', 'bitbucket')),
  account_login   TEXT NOT NULL,            -- handle on the provider
  account_id      TEXT NOT NULL,            -- provider's account id
  -- Encrypted at rest with APP_ENCRYPTION_KEY (AES-256-GCM, base64 ciphertext)
  access_token_enc      TEXT NOT NULL,
  refresh_token_enc     TEXT,
  token_expires_at      TIMESTAMPTZ,
  scopes                TEXT[] NOT NULL DEFAULT '{}',
  default_visibility    TEXT NOT NULL DEFAULT 'private'
                          CHECK (default_visibility IN ('private', 'public', 'internal')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id, provider, account_id)
);
CREATE INDEX IF NOT EXISTS idx_git_connections_org_user ON git_connections(organization_id, user_id);

-- Per-project remote repository (one per project; projects have at most one
-- remote attached at any time, but history of disconnects survives via audit).
CREATE TABLE IF NOT EXISTS project_repositories (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  git_connection_id   UUID NOT NULL REFERENCES git_connections(id) ON DELETE RESTRICT,
  provider            TEXT NOT NULL CHECK (provider IN ('github', 'gitlab', 'bitbucket')),
  remote_url          TEXT NOT NULL,        -- https or ssh
  default_branch      TEXT NOT NULL DEFAULT 'main',
  full_name           TEXT NOT NULL,        -- "owner/repo" for GH/Bitbucket, "group/sub/proj" for GitLab
  visibility          TEXT NOT NULL DEFAULT 'private',
  external_id         TEXT,                 -- numeric id on the provider
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id)
);

-- ─── AI provider configurations (per org, optional per user override) ──────
CREATE TABLE IF NOT EXISTS ai_providers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- NULL = org-shared. Non-NULL = user's personal key inside this org.
  user_id         TEXT REFERENCES auth_user(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL
                    CHECK (provider IN (
                      'anthropic', 'openai', 'google', 'openrouter',
                      'ollama', 'github-copilot', 'azure-openai', 'mistral'
                    )),
  label           TEXT NOT NULL,            -- e.g. "Anthropic — production"
  -- Encrypted with APP_ENCRYPTION_KEY (AES-256-GCM). NULL for ollama / oauth-based providers.
  api_key_enc     TEXT,
  base_url        TEXT,                     -- override (Azure, self-hosted, custom OpenAI-compat)
  -- For oauth-based providers (Copilot etc.) — references auth_account.
  account_id      TEXT REFERENCES auth_account(id) ON DELETE CASCADE,
  default_model   TEXT,                     -- preferred model id when this provider is selected
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_providers_org ON ai_providers(organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_providers_user ON ai_providers(user_id);

-- ─── Session ↔ commit linkage (audit trail for auto-commits) ───────────────
-- A session may produce 1+ commits (or 0 if auto-commit failed/disabled).
CREATE TABLE IF NOT EXISTS session_commits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sha             TEXT NOT NULL,
  message         TEXT NOT NULL,
  branch          TEXT NOT NULL,
  files_changed   INT NOT NULL DEFAULT 0,
  insertions      INT NOT NULL DEFAULT 0,
  deletions       INT NOT NULL DEFAULT 0,
  pushed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_session_commits_session ON session_commits(session_id);
CREATE INDEX IF NOT EXISTS idx_session_commits_project ON session_commits(project_id);
