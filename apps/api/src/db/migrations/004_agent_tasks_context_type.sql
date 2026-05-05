-- Migration 004: Add context_type to agent_tasks
--
-- Sessions already carry context_type; propagate it to each task so that
-- the agent worker knows which env vars to inject (personal vs. cez).

ALTER TABLE agent_tasks
  ADD COLUMN IF NOT EXISTS context_type TEXT NOT NULL DEFAULT 'personal'
    CHECK (context_type IN ('personal', 'cez'));
