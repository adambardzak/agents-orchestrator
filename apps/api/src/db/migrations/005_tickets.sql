-- Migration 005: Tickets — Linear-like atomic units of work
-- A ticket is a granular subtask under an agent_task (planner-generated).
-- Tickets have status workflow (backlog → todo → in_progress → done) and support
-- comments + reopen iterations.

CREATE TABLE IF NOT EXISTS tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human-friendly identifier per session, e.g. "AGT-1", "AGT-2"
  ticket_key      TEXT NOT NULL,
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Parent agent_task that planned this ticket (e.g. the "frontend" agent task)
  parent_task_id  UUID REFERENCES agent_tasks(id) ON DELETE SET NULL,
  -- Currently executing agent_task (changes on reopen → new iteration)
  current_task_id UUID REFERENCES agent_tasks(id) ON DELETE SET NULL,

  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  agent_type      TEXT NOT NULL,                  -- which agent should execute (frontend, design...)
  complexity      TEXT NOT NULL DEFAULT 'trivial' -- atomic tickets default to haiku
                    CHECK (complexity IN ('trivial', 'simple', 'standard', 'complex', 'expert')),
  priority        TEXT NOT NULL DEFAULT 'normal'
                    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  labels          JSONB NOT NULL DEFAULT '[]',

  status          TEXT NOT NULL DEFAULT 'todo'
                    CHECK (status IN ('backlog', 'todo', 'in_progress', 'done', 'failed', 'cancelled')),
  iteration       INTEGER NOT NULL DEFAULT 1,     -- bumped on reopen

  -- Aggregated cost across all iterations
  total_cost_usd  NUMERIC(10, 6) NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,

  UNIQUE (session_id, ticket_key)
);

CREATE INDEX idx_tickets_session_id ON tickets(session_id);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_parent_task_id ON tickets(parent_task_id);
CREATE INDEX idx_tickets_current_task_id ON tickets(current_task_id);

-- Comments on tickets — both user comments (=context for reopen) and agent notes
CREATE TABLE IF NOT EXISTS ticket_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author      TEXT NOT NULL CHECK (author IN ('user', 'agent', 'system')),
  body        TEXT NOT NULL,
  -- If this comment was used as context for a reopen, link to that iteration's task
  iteration_task_id UUID REFERENCES agent_tasks(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ticket_comments_ticket_id ON ticket_comments(ticket_id);
CREATE INDEX idx_ticket_comments_created_at ON ticket_comments(created_at);

-- Iteration history per ticket (audit trail of every execution attempt)
CREATE TABLE IF NOT EXISTS ticket_iterations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  task_id     UUID NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  iteration   INTEGER NOT NULL,
  -- Context inject (from user comment) that triggered this iteration; NULL for first run
  injected_context TEXT,
  status      TEXT NOT NULL,                       -- snapshot at end (or 'running')
  cost_usd    NUMERIC(10, 6) NOT NULL DEFAULT 0,
  summary     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_ticket_iterations_ticket_id ON ticket_iterations(ticket_id);
CREATE INDEX idx_ticket_iterations_task_id ON ticket_iterations(task_id);

CREATE TRIGGER trg_tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Mark agent_tasks rows that are "planner" tasks (which generated tickets)
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS planner_output JSONB;
-- Tickets a task was spawned for (when worker executes a single ticket, not the whole agent block)
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL;
-- For planner tasks: the agent_type that the generated tickets should be executed by
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS target_agent_type TEXT;
CREATE INDEX IF NOT EXISTS idx_agent_tasks_ticket_id ON agent_tasks(ticket_id);
