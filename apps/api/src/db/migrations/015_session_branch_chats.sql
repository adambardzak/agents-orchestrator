-- 015_session_branch_chats.sql
--
-- Adds "branch chats" — named sub-sessions that fork from a parent (typically
-- the project's main chat) and let the user focus on a specific concern with
-- isolated history, optional file scope, and a dedicated git branch.
--
-- New columns on `sessions`:
--   - kind                 : 'main' (default, current behaviour) or 'branch'
--   - parent_session_id    : nullable FK back to sessions(id) — branch's parent
--   - name                 : optional human-readable label ("Refactor LoginButton")
--   - scope_globs          : JSONB array of glob patterns the agent should focus
--                            on. Empty array = no scope restriction. Patterns
--                            are passed verbatim into the agent's system prompt
--                            as soft scope (no workspace filtering — agent can
--                            still read other files when investigating).
--   - branch_name          : git branch name auto-created for this branch chat.
--                            Format: feat/<slug-from-name>-<short-id>. Only set
--                            for kind='branch'.
--   - merged_at            : timestamp when the user accepted the merge into
--                            parent's branch. Null = still active (or
--                            abandoned — we don't distinguish yet).
--
-- Index on parent_session_id powers the sidebar "list branch chats of this
-- main chat" query.
--
-- Idempotent: safe to re-run.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS kind              TEXT NOT NULL DEFAULT 'main'
                              CHECK (kind IN ('main', 'branch')),
  ADD COLUMN IF NOT EXISTS parent_session_id UUID
                              REFERENCES sessions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS name              TEXT,
  ADD COLUMN IF NOT EXISTS scope_globs       JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS branch_name       TEXT,
  ADD COLUMN IF NOT EXISTS merged_at         TIMESTAMPTZ;

-- Branch chats must reference a parent. Main chats must not.
-- Done as a NOT VALID constraint then validated so existing rows aren't
-- penalized — they default to kind='main' with parent_session_id NULL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sessions_branch_requires_parent'
  ) THEN
    ALTER TABLE sessions
      ADD CONSTRAINT sessions_branch_requires_parent
      CHECK (
        (kind = 'main'   AND parent_session_id IS NULL) OR
        (kind = 'branch' AND parent_session_id IS NOT NULL)
      ) NOT VALID;
    ALTER TABLE sessions VALIDATE CONSTRAINT sessions_branch_requires_parent;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id)
  WHERE parent_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_project_kind
  ON sessions(project_id, kind, created_at DESC);
