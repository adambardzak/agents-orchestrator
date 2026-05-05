-- Migration 002: Add 'awaiting_approval' to agent_tasks status CHECK constraint
--
-- PostgreSQL does not allow modifying a CHECK constraint in-place;
-- we drop the auto-generated constraint and recreate it with the new value.

ALTER TABLE agent_tasks
  DROP CONSTRAINT IF EXISTS agent_tasks_status_check;

ALTER TABLE agent_tasks
  ADD CONSTRAINT agent_tasks_status_check
    CHECK (status IN (
      'pending', 'planning', 'running', 'paused',
      'awaiting_approval',
      'completed', 'failed', 'cancelled'
    ));
