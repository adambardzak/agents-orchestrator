/**
 * Tenant-isolation access helpers.
 *
 * Used by route handlers to verify that a project / session / task / ticket
 * belongs to the caller's active organization. Throws a 404 (not 403) on
 * mismatch so we don't leak existence of resources outside the caller's org.
 *
 * Usage pattern:
 *
 *   const { orgId } = await request.requireOrg();
 *   const project = await assertProjectAccess(fastify, projectId, orgId);
 *   // … project.organization_id === orgId guaranteed here
 *
 * The session/task/ticket variants traverse the join chain and validate the
 * terminal project's org. They are read-only — actual mutations stay in the
 * caller; the helpers only perform the access gate.
 */
import type { FastifyInstance } from 'fastify';

function notFound(): never {
  throw Object.assign(new Error('Not found'), { statusCode: 404 });
}

export interface ProjectRow {
  id: string;
  organization_id: string;
  workspace_path: string;
  name: string;
  created_by: string;
}

export interface SessionRow {
  id: string;
  project_id: string;
  organization_id: string;
}

export interface TaskRow {
  id: string;
  session_id: string;
  organization_id: string;
}

export interface TicketRow {
  id: string;
  session_id: string;
  organization_id: string;
}

/** Look up a project and verify it belongs to `orgId`. Throws 404 on mismatch. */
export async function assertProjectAccess(
  fastify: FastifyInstance,
  projectId: string,
  orgId: string,
): Promise<ProjectRow> {
  const { rows: [row] } = await fastify.pg.query<ProjectRow>(
    `SELECT id, organization_id, workspace_path, name, created_by
       FROM projects
      WHERE id = $1 AND organization_id = $2`,
    [projectId, orgId],
  );
  if (!row) notFound();
  return row;
}

/** Look up a session and verify its parent project belongs to `orgId`. Throws 404 on mismatch. */
export async function assertSessionAccess(
  fastify: FastifyInstance,
  sessionId: string,
  orgId: string,
): Promise<SessionRow> {
  const { rows: [row] } = await fastify.pg.query<SessionRow>(
    `SELECT s.id, s.project_id, p.organization_id
       FROM sessions s
       JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1 AND p.organization_id = $2`,
    [sessionId, orgId],
  );
  if (!row) notFound();
  return row;
}

/** Look up a task and verify its grandparent project belongs to `orgId`. Throws 404 on mismatch. */
export async function assertTaskAccess(
  fastify: FastifyInstance,
  taskId: string,
  orgId: string,
): Promise<TaskRow> {
  const { rows: [row] } = await fastify.pg.query<TaskRow>(
    `SELECT t.id, t.session_id, p.organization_id
       FROM agent_tasks t
       JOIN sessions  s ON s.id = t.session_id
       JOIN projects  p ON p.id = s.project_id
      WHERE t.id = $1 AND p.organization_id = $2`,
    [taskId, orgId],
  );
  if (!row) notFound();
  return row;
}

/** Look up a ticket and verify its grandparent project belongs to `orgId`. Throws 404 on mismatch. */
export async function assertTicketAccess(
  fastify: FastifyInstance,
  ticketId: string,
  orgId: string,
): Promise<TicketRow> {
  const { rows: [row] } = await fastify.pg.query<TicketRow>(
    `SELECT t.id, t.session_id, p.organization_id
       FROM tickets t
       JOIN sessions s ON s.id = t.session_id
       JOIN projects p ON p.id = s.project_id
      WHERE t.id = $1 AND p.organization_id = $2`,
    [ticketId, orgId],
  );
  if (!row) notFound();
  return row;
}
