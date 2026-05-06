/**
 * Organization REST API
 *
 *   GET    /api/orgs                         — orgs the current user belongs to
 *   POST   /api/orgs                         — create new org (becomes owner)
 *   POST   /api/orgs/:id/activate            — set as session's active org
 *   GET    /api/orgs/:id/members             — list members (admin/owner only)
 *   POST   /api/orgs/:id/invitations         — invite by email (admin/owner)
 *   POST   /api/invitations/accept           — { token } — accept pending invite
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OrganizationService } from '../services/auth/organization-service.js';

const createOrgSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().min(2).max(48).regex(/^[a-z0-9-]+$/).optional(),
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member']).default('member'),
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
