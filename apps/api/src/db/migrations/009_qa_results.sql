-- 009_qa_results.sql
-- Deterministic post-task QA validation results.
--
-- After every code-writing agent task completes, the QaRunner detects which
-- tools the workspace supports (tsc, eslint, vitest, playwright) and runs
-- each one. One row per (task, tool) pair. Failure of any tool does NOT
-- fail the parent task — results are advisory and surfaced in UI; agents
-- may also be re-prompted with the errors as a follow-up task.

CREATE TABLE IF NOT EXISTS agent_qa_results (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID         NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  tool            TEXT         NOT NULL,                    -- 'tsc' | 'eslint' | 'vitest' | 'playwright'
  status          TEXT         NOT NULL,                    -- 'passed' | 'failed' | 'skipped' | 'error'
  summary         TEXT         NOT NULL DEFAULT '',         -- one-line human-readable summary
  error_count     INTEGER      NOT NULL DEFAULT 0,
  warning_count   INTEGER      NOT NULL DEFAULT 0,
  duration_ms     INTEGER      NOT NULL DEFAULT 0,
  details         JSONB        NOT NULL DEFAULT '{}'::jsonb, -- raw stdout (capped) + parsed problems
  ran_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_qa_results_task_idx ON agent_qa_results (task_id);
CREATE INDEX IF NOT EXISTS agent_qa_results_status_idx ON agent_qa_results (status);
