-- 016_referenced_files.sql
--
-- Adds explicit `@file` references to agent_tasks. When a user mentions files
-- in their chat input via the `@path/to/file` autocomplete, the frontend
-- extracts those paths into a separate array (instead of leaving them as
-- ambiguous prose in the prompt). The worker then loads each file from the
-- project's canonical workspace root and injects its contents into the
-- agent's system prompt under a `## Referenced Files` block.
--
-- Storage: JSONB array of strings. Paths are relative to the project's
-- workspace root, validated against path traversal at API ingest time.
-- Empty array (default) means no references — preserves existing behaviour.
--
-- Idempotent: safe to re-run.

ALTER TABLE agent_tasks
  ADD COLUMN IF NOT EXISTS referenced_files JSONB NOT NULL DEFAULT '[]'::jsonb;
