-- ============================================================================
-- Migration 007 — User-defined Skills (org-scoped)
-- ============================================================================
--
-- The application ships with a built-in skill catalog (apps/api/src/agents/skills.ts)
-- that's hard-coded for engineering reasons (skills can reference MCP servers
-- registered at app startup). Users can additionally define their own skills
-- per organization — extra knowledge blocks + rules to be merged into agent
-- prompts at spawn time.
--
-- Built-in skills remain read-only and are surfaced through GET /api/skills
-- alongside org-defined entries.

CREATE TABLE IF NOT EXISTS skills (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by           TEXT REFERENCES auth_user(id) ON DELETE SET NULL,

  -- Identity
  slug                 TEXT NOT NULL,                       -- short URL-safe id (e.g. "react-19-rsc")
  name                 TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  icon                 TEXT,                                -- optional iconify id

  -- Knowledge
  knowledge_block      TEXT NOT NULL,                       -- markdown injected into system prompt
  rules                JSONB NOT NULL DEFAULT '[]'::jsonb,  -- string[] merged with agent rules
  required_mcp_servers JSONB NOT NULL DEFAULT '[]'::jsonb,  -- string[] (must already exist in MCP catalog)

  enabled              BOOLEAN NOT NULL DEFAULT TRUE,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT skills_slug_per_org_unique UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS skills_organization_id_idx ON skills (organization_id);
CREATE INDEX IF NOT EXISTS skills_enabled_idx          ON skills (enabled);
