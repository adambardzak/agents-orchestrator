/**
 * Skills REST API.
 *
 *   GET    /api/skills           — list built-in + this org's custom skills (merged)
 *   GET    /api/skills/:id       — get a single custom skill (built-ins not addressable here)
 *   POST   /api/skills           — create a new custom skill in active org
 *   PATCH  /api/skills/:id       — update fields (custom only — can't edit built-ins)
 *   DELETE /api/skills/:id       — delete a custom skill (built-ins protected)
 *
 * The legacy GET /api/agents/skills endpoint (read-only built-in catalog)
 * remains untouched so existing UI keeps working during migration.
 *
 * Slug rules: lowercase a-z, digits and dashes (URL-safe). The "skill:" prefix
 * is added by the service when forming the public id consumed by the rest of
 * the app — clients never type it.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SkillService } from '../services/skills/skill-service.js';
import { SKILL_CATALOG } from '../agents/skills.js';

const slugRegex = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const createSchema = z.object({
  slug:               z.string().min(2).max(60).regex(slugRegex, 'Slug must be lowercase a-z, 0-9, dashes'),
  name:               z.string().min(1).max(100),
  description:        z.string().max(500).optional(),
  icon:               z.string().max(80).optional(),
  knowledgeBlock:     z.string().min(10).max(20_000),
  rules:              z.array(z.string().min(1).max(500)).max(50).optional(),
  requiredMcpServers: z.array(z.string().min(1).max(100)).max(20).optional(),
  enabled:            z.boolean().optional(),
});

const updateSchema = z.object({
  name:               z.string().min(1).max(100).optional(),
  description:        z.string().max(500).optional(),
  icon:               z.string().max(80).nullable().optional(),
  knowledgeBlock:     z.string().min(10).max(20_000).optional(),
  rules:              z.array(z.string().min(1).max(500)).max(50).optional(),
  requiredMcpServers: z.array(z.string().min(1).max(100)).max(20).optional(),
  enabled:            z.boolean().optional(),
});

export async function skillRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new SkillService(fastify.pg.pool);

  // ── GET /api/skills ────────────────────────────────────────────────────
  // Returns merged list: built-in (read-only) + this org's custom skills.
  fastify.get('/api/skills', async (request, reply) => {
    await request.requireUser();
    const orgId = request.session?.activeOrganizationId;
    if (!orgId) return reply.status(403).send({ error: 'No active organization' });
    const skills = await service.listForOrg(orgId);
    return { skills };
  });

  // ── GET /api/skills/:id ────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/skills/:id', async (request, reply) => {
    await request.requireUser();
    const skill = await service.getById(request.params.id);
    if (!skill) return reply.status(404).send({ error: 'Skill not found' });
    const orgId = request.session?.activeOrganizationId;
    if (skill.organizationId !== orgId) return reply.status(404).send({ error: 'Skill not found' });
    return { skill };
  });

  // ── POST /api/skills ───────────────────────────────────────────────────
  fastify.post('/api/skills', async (request, reply) => {
    const user = await request.requireUser();
    const orgId = request.session?.activeOrganizationId;
    if (!orgId) return reply.status(403).send({ error: 'No active organization' });

    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', issues: parsed.error.issues });

    // Forbid colliding with a built-in skill id (skill:<slug>)
    const wantedId = `skill:${parsed.data.slug}`;
    if (SKILL_CATALOG.some((s) => s.id === wantedId)) {
      return reply.status(409).send({ error: `Slug "${parsed.data.slug}" collides with a built-in skill` });
    }

    try {
      const skill = await service.create({
        organizationId: orgId,
        createdBy:      user.id,
        ...parsed.data,
      });
      return reply.status(201).send({ skill });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('skills_slug_per_org_unique')) {
        return reply.status(409).send({ error: `A skill with slug "${parsed.data.slug}" already exists in this org` });
      }
      throw err;
    }
  });

  // ── PATCH /api/skills/:id ──────────────────────────────────────────────
  fastify.patch<{ Params: { id: string } }>('/api/skills/:id', async (request, reply) => {
    await request.requireUser();
    const orgId = request.session?.activeOrganizationId;
    if (!orgId) return reply.status(403).send({ error: 'No active organization' });

    const existing = await service.getById(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Skill not found' });
    if (existing.organizationId !== orgId) return reply.status(403).send({ error: 'Forbidden' });

    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', issues: parsed.error.issues });

    const updated = await service.update(request.params.id, parsed.data);
    return { skill: updated };
  });

  // ── DELETE /api/skills/:id ─────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/api/skills/:id', async (request, reply) => {
    await request.requireUser();
    const orgId = request.session?.activeOrganizationId;
    if (!orgId) return reply.status(403).send({ error: 'No active organization' });

    const existing = await service.getById(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Skill not found' });
    if (existing.organizationId !== orgId) return reply.status(403).send({ error: 'Forbidden' });

    await service.delete(request.params.id);
    return { ok: true };
  });
}
