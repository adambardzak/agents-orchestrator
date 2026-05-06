-- ============================================================================
-- Migration 012 — Skill categories
-- ============================================================================
--
-- Adds optional `category` column to user-defined skills so the catalog UI can
-- group them alongside built-ins. Built-in categories live in the in-memory
-- catalog (apps/api/src/agents/skills.ts) and are not stored here.
--
-- Allowed values are validated by the API layer (Zod) — keeping the constraint
-- in app code lets us add categories without DB migrations.

ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS category TEXT;

CREATE INDEX IF NOT EXISTS skills_category_idx ON skills (category);
