/**
 * Organization REST API
 *
 *   GET    /api/orgs                              — orgs the current user belongs to
 *   POST   /api/orgs                              — create new org (becomes owner)
 *   POST   /api/orgs/:id/activate                 — set as session's active org
 *   PATCH  /api/orgs/:id                          — rename / change slug (admin/owner)
 *   DELETE /api/orgs/:id                          — delete org + all data (owner)
 *   GET    /api/orgs/:id/members                  — list members
 *   PATCH  /api/orgs/:id/members/:userId          — change member role (owner)
 *   DELETE /api/orgs/:id/members/:userId          — remove or self-leave
 *   GET    /api/orgs/:id/invitations              — list invitations (admin/owner)
 *   POST   /api/orgs/:id/invitations              — invite by email (admin/owner)
 *   DELETE /api/orgs/:id/invitations/:invId       — revoke pending invite (admin/owner)
 *   POST   /api/invitations/accept                — { token } — accept pending invite
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OrganizationService } from '../services/auth/organization-service.js';

const createOrgSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().min(2).max(48).regex(/^[a-z0-9-]+$/).optional(),
});

const updateOrgSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  slug: z.string().min(2).max(48).regex(/^[a-z0-9-]+$/).optional(),
  logoUrl: z.string().url().nullable().optional(),
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member']).default('member'),
});

const updateRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'member']),
});

export async function organizationRoutes(fastify: FastifyInstance): Promise<void> {
  const orgs = new OrganizationService(fastify.pg.pool);

  // ── GET /api/orgs ─────────────────────────────────────────────────────────
  fastify.get('/api/orgs', async (request) => {
    const user = await request.requireUser();
    return { organizations: await orgs.listForUser(user.id) };
  });

  // ── POST /api/orgs ────────────────────────────────────────────────────────
  fastify.post('/api/orgs', async (request, reply) => {
    const user = await request.requireUser();
    const parsed = createOrgSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const org = await orgs.create({ ...parsed.data, createdBy: user.id });
    return { organization: org };
  });

  // ── POST /api/orgs/:id/activate ───────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/api/orgs/:id/activate',
    async (request, reply) => {
      const user = await request.requireUser();
      const membership = await orgs.getMembership(request.params.id, user.id);
      if (!membership) return reply.status(403).send({ error: 'Not a member of this organization' });

      // Persist the new active org. In bootstrap dev mode this updates the
      // synthetic 'bootstrap' session row so the choice survives restarts.
      if (request.session) {
        await orgs.setActiveOrgForSession(request.session.id, request.params.id);
        request.session.activeOrganizationId = request.params.id;
      }
      return { activeOrganizationId: request.params.id };
    },
  );

  // ── PATCH /api/orgs/:id ───────────────────────────────────────────────────
  fastify.patch<{ Params: { id: string } }>(
    '/api/orgs/:id',
    async (request, reply) => {
      const user = await request.requireUser();
      const m = await orgs.getMembership(request.params.id, user.id);
      if (!m || (m.role !== 'owner' && m.role !== 'admin')) {
        return reply.status(403).send({ error: 'Only admins/owners can edit workspace' });
      }
      const parsed = updateOrgSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

      const updated = await orgs.update(request.params.id, parsed.data);
      if (!updated) return reply.status(404).send({ error: 'Workspace not found' });
      return { organization: updated };
    },
  );

  // ── DELETE /api/orgs/:id ──────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/api/orgs/:id',
    async (request, reply) => {
      const user = await request.requireUser();
      const m = await orgs.getMembership(request.params.id, user.id);
      if (!m || m.role !== 'owner') {
        return reply.status(403).send({ error: 'Only owners can delete the workspace' });
      }
      await orgs.delete(request.params.id);
      // If this was the active org, clear it from the session
      if (request.session?.activeOrganizationId === request.params.id) {
        await fastify.pg.pool.query(
          `UPDATE auth_session SET active_organization_id = NULL WHERE id = $1`,
          [request.session.id],
        );
        request.session.activeOrganizationId = null;
      }
      return reply.status(204).send();
    },
  );

  // ── GET /api/orgs/:id/members ─────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/api/orgs/:id/members',
    async (request, reply) => {
      const user = await request.requireUser();
      const membership = await orgs.getMembership(request.params.id, user.id);
      if (!membership) return reply.status(403).send({ error: 'Not a member' });
      return { members: await orgs.listMembers(request.params.id) };
    },
  );

  // ── PATCH /api/orgs/:id/members/:userId ───────────────────────────────────
  fastify.patch<{ Params: { id: string; userId: string } }>(
    '/api/orgs/:id/members/:userId',
    async (request, reply) => {
      const user = await request.requireUser();
      const actor = await orgs.getMembership(request.params.id, user.id);
      if (!actor || actor.role !== 'owner') {
        return reply.status(403).send({ error: 'Only owners can change roles' });
      }
      const target = await orgs.getMembership(request.params.id, request.params.userId);
      if (!target) return reply.status(404).send({ error: 'Member not found' });

      const parsed = updateRoleSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

      // Don't allow demoting the last owner
      if (target.role === 'owner' && parsed.data.role !== 'owner') {
        const hasOther = await orgs.hasOtherOwner(request.params.id, request.params.userId);
        if (!hasOther) {
          return reply.status(409).send({ error: 'Cannot demote the last owner' });
        }
      }
      await orgs.updateMemberRole(request.params.id, request.params.userId, parsed.data.role);
      return { ok: true };
    },
  );

  // ── DELETE /api/orgs/:id/members/:userId ──────────────────────────────────
  // Remove a member or leave the org (when userId === current user).
  fastify.delete<{ Params: { id: string; userId: string } }>(
    '/api/orgs/:id/members/:userId',
    async (request, reply) => {
      const user = await request.requireUser();
      const actor = await orgs.getMembership(request.params.id, user.id);
      if (!actor) return reply.status(403).send({ error: 'Not a member' });

      const isSelfLeave = request.params.userId === user.id;
      if (!isSelfLeave && actor.role !== 'owner' && actor.role !== 'admin') {
        return reply.status(403).send({ error: 'Only admins/owners can remove members' });
      }

      const target = await orgs.getMembership(request.params.id, request.params.userId);
      if (!target) return reply.status(404).send({ error: 'Member not found' });

      // Don't allow removing the last owner
      if (target.role === 'owner') {
        const hasOther = await orgs.hasOtherOwner(request.params.id, request.params.userId);
        if (!hasOther) {
          return reply.status(409).send({ error: 'Cannot remove the last owner' });
        }
      }
      await orgs.removeMember(request.params.id, request.params.userId);
      return reply.status(204).send();
    },
  );

  // ── GET /api/orgs/:id/invitations ─────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/api/orgs/:id/invitations',
    async (request, reply) => {
      const user = await request.requireUser();
      const m = await orgs.getMembership(request.params.id, user.id);
      if (!m || (m.role !== 'owner' && m.role !== 'admin')) {
        return reply.status(403).send({ error: 'Only admins/owners can list invitations' });
      }
      return { invitations: await orgs.listInvitations(request.params.id) };
    },
  );

  // ── POST /api/orgs/:id/invitations ────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/api/orgs/:id/invitations',
    async (request, reply) => {
      const user = await request.requireUser();
      const membership = await orgs.getMembership(request.params.id, user.id);
      if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
        return reply.status(403).send({ error: 'Only admins/owners can invite' });
      }
      const parsed = inviteSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

      const inv = await orgs.invite({
        orgId: request.params.id,
        email: parsed.data.email,
        role:  parsed.data.role,
        invitedBy: user.id,
      });
      // TODO: send email with token. For now just return it.
      return { invitation: inv };
    },
  );

  // ── DELETE /api/orgs/:id/invitations/:invId ───────────────────────────────
  fastify.delete<{ Params: { id: string; invId: string } }>(
    '/api/orgs/:id/invitations/:invId',
    async (request, reply) => {
      const user = await request.requireUser();
      const m = await orgs.getMembership(request.params.id, user.id);
      if (!m || (m.role !== 'owner' && m.role !== 'admin')) {
        return reply.status(403).send({ error: 'Only admins/owners can revoke invitations' });
      }
      await orgs.revokeInvitation(request.params.id, request.params.invId);
      return reply.status(204).send();
    },
  );

  // ── POST /api/invitations/accept ──────────────────────────────────────────
  fastify.post<{ Body: { token: string } }>('/api/invitations/accept', async (request, reply) => {
    const user = await request.requireUser();
    const token = String((request.body as Record<string, unknown>)?.['token'] ?? '');
    if (!token) return reply.status(400).send({ error: 'token required' });
    try {
      const org = await orgs.acceptInvitation(token, user.id);
      return { organization: org };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'invalid';
      return reply.status(400).send({ error: msg });
    }
  });
}
