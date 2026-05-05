-- Migration 001: Initial schema
-- Coding Agent Orchestrator — Phase 1

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  context_type TEXT NOT NULL CHECK (context_type IN ('personal', 'cez')),
  workspace_path TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessions — one user request = one session (may spawn multiple agent tasks)
CREATE TABLE IF NOT EXISTS sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  context_type    TEXT NOT NULL CHECK (context_type IN ('personal', 'cez')),
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'completed', 'failed')),
  user_prompt     TEXT NOT NULL,
  total_cost_usd  NUMERIC(10, 6) NOT NULL DEFAULT 0,
  budget_cap_usd  NUMERIC(10, 4) NOT NULL DEFAULT 5,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_project_id ON sessions(project_id);
CREATE INDEX idx_sessions_status ON sessions(status);

-- Agent tasks — individual OpenCode process runs
CREATE TABLE IF NOT EXISTS agent_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_type      TEXT NOT NULL,
  agent_id        TEXT NOT NULL,  -- references AgentDefinition.id
  prompt          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'planning', 'running', 'paused',
                                      'completed', 'failed', 'cancelled')),
  complexity      TEXT NOT NULL
                    CHECK (complexity IN ('trivial', 'simple', 'standard', 'complex', 'expert')),
  model           TEXT NOT NULL,

  -- Runtime stats
  current_step    INTEGER NOT NULL DEFAULT 0,
  max_steps       INTEGER NOT NULL DEFAULT 20,
  context_tokens  INTEGER NOT NULL DEFAULT 0,
  input_tokens    BIGINT NOT NULL DEFAULT 0,
  output_tokens   BIGINT NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(10, 6) NOT NULL DEFAULT 0,

  -- Dependencies (array of task UUIDs)
  depends_on      UUID[] NOT NULL DEFAULT '{}',

  -- Result
  summary         TEXT,
  error_message   TEXT,

  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_tasks_session_id ON agent_tasks(session_id);
CREATE INDEX idx_agent_tasks_status ON agent_tasks(status);
CREATE INDEX idx_agent_tasks_project_id ON agent_tasks(project_id);

-- Agent event log — every OpenCode event is persisted here
CREATE TABLE IF NOT EXISTS agent_events (
  id          BIGSERIAL PRIMARY KEY,
  task_id     UUID NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  session_id  UUID NOT NULL,
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_events_task_id ON agent_events(task_id);
CREATE INDEX idx_agent_events_session_id ON agent_events(session_id);
CREATE INDEX idx_agent_events_event_type ON agent_events(event_type);
-- Faster queries for recent events
CREATE INDEX idx_agent_events_created_at ON agent_events(created_at DESC);

-- Custom agent definitions (user-created, non-built-in)
CREATE TABLE IF NOT EXISTS agent_definitions (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  description         TEXT NOT NULL,
  icon                TEXT NOT NULL,
  agent_type          TEXT NOT NULL,
  default_complexity  TEXT NOT NULL,
  can_escalate_to     TEXT NOT NULL,
  system_prompt       TEXT NOT NULL,
  rules               JSONB NOT NULL DEFAULT '[]',
  skills              JSONB NOT NULL DEFAULT '[]',
  allowed_mcp_servers JSONB NOT NULL DEFAULT '[]',
  allowed_tools       JSONB NOT NULL DEFAULT '[]',
  max_steps           INTEGER NOT NULL DEFAULT 20,
  timeout_minutes     INTEGER NOT NULL DEFAULT 10,
  triggers            JSONB NOT NULL DEFAULT '{}',
  is_built_in         BOOLEAN NOT NULL DEFAULT FALSE,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_by          TEXT NOT NULL DEFAULT 'user',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cost aggregates per day (materialized for dashboard)
CREATE TABLE IF NOT EXISTS cost_daily (
  date            DATE NOT NULL,
  session_id      UUID,
  agent_type      TEXT NOT NULL,
  model           TEXT NOT NULL,
  input_tokens    BIGINT NOT NULL DEFAULT 0,
  output_tokens   BIGINT NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(10, 6) NOT NULL DEFAULT 0,
  PRIMARY KEY (date, agent_type, model)
);

CREATE INDEX idx_cost_daily_date ON cost_daily(date DESC);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_agent_tasks_updated_at
  BEFORE UPDATE ON agent_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
