/**
 * Knowledge base REST API — org-scoped markdown documents with embeddings.
 *
 *   GET    /api/knowledge                        — list docs (summaries) for active org
 *   GET    /api/knowledge/:id                    — full document with content
 *   POST   /api/knowledge                        — create new doc (auto-indexes)
 *   PATCH  /api/knowledge/:id                    — update title/path/content/tags (re-indexes on content change)
 *   DELETE /api/knowledge/:id                    — remove doc + chunks
 *   POST   /api/knowledge/:id/reindex            — force re-embed (e.g. after model swap)
 *   POST   /api/knowledge/search                 — top-K similarity search (debug/preview)
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { KnowledgeService } from '../services/knowledge/knowledge-service.js';
import { env } from '../config/env.js';

const createSchema = z.object({
  title:   z.string().min(1).max(200),
  path:    z.string().min(1).max(500).regex(/^[A-Za-z0-9._\-/ ]+$/, 'Path must be filesystem-safe'),
  content: z.string().min(1).max(500_000),
  tags:    z.array(z.string().min(1).max(50)).max(50).optional(),
});

const updateSchema = z.object({
  title:   z.string().min(1).max(200).optional(),
  path:    z.string().min(1).max(500).regex(/^[A-Za-z0-9._\-/ ]+$/).optional(),
  content: z.string().min(1).max(500_000).optional(),
  tags:    z.array(z.string().min(1).max(50)).max(50).optional(),
});

const searchSchema = z.object({
  query: z.string().min(1).max(500),
  topK:  z.number().int().min(1).max(20).optional(),
});

export async function knowledgeRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new KnowledgeService(
    fastify.pg.pool,
    fastify.log,
    env.GITHUB_TOKEN,
  );

  // ── GET /api/knowledge ─────────────────────────────────────────────────
  fastify.get('/api/knowledge', async (request, reply) => {
    await request.requireUser();
    const orgId = request.session?.activeOrganizationId;
    if (!orgId) return reply.status(403).send({ error: 'No active organization' });
    const documents = await service.listForOrg(orgId);
    return { documents };
  });

  // ── GET /api/knowledge/:id ─────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/knowledge/:id', async (request, reply) => {
    await request.requireUser();
    const orgId = request.session?.activeOrganizationId;
    if (!orgId) return reply.status(403).send({ error: 'No active organization' });

    const doc = await service.getById(request.params.id);
    if (!doc) return reply.status(404).send({ error: 'Document not found' });
    if (doc.organizationId !== orgId) return reply.status(404).send({ error: 'Document not found' });
    return { document: doc };
  });

  // ── POST /api/knowledge ────────────────────────────────────────────────
  fastify.post('/api/knowledge', async (request, reply) => {
    const user = await request.requireUser();
    const orgId = request.session?.activeOrganizationId;
    if (!orgId) return reply.status(403).send({ error: 'No active organization' });

    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', issues: parsed.error.issues });

    try {
      const doc = await service.create({
        organizationId: orgId,
        createdBy:      user.id,
        ...parsed.data,
      });
      return reply.status(201).send({ document: doc });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('knowledge_documents_path_per_org_unique')) {
        return reply.status(409).send({ error: `A document already exists at path "${parsed.data.path}"` });
      }
      throw err;
    }
  });

  // ── PATCH /api/knowledge/:id ───────────────────────────────────────────
  fastify.patch<{ Params: { id: string } }>('/api/knowledge/:id', async (request, reply) => {
    await request.requireUser();
    const orgId = request.session?.activeOrganizationId;
    if (!orgId) return reply.status(403).send({ error: 'No active organization' });

    const existing = await service.getById(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Document not found' });
    if (existing.organizationId !== orgId) return reply.status(403).send({ error: 'Forbidden' });

    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', issues: parsed.error.issues });

    try {
      const updated = await service.update(request.params.id, parsed.data);
      return { document: updated };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('knowledge_documents_path_per_org_unique')) {
        return reply.status(409).send({ error: `A document already exists at that path` });
      }
      throw err;
    }
  });

  // ── DELETE /api/knowledge/:id ──────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/api/knowledge/:id', async (request, reply) => {
    await request.requireUser();
    const orgId = request.session?.activeOrganizationId;
    if (!orgId) return reply.status(403).send({ error: 'No active organization' });

    const existing = await service.getById(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Document not found' });
    if (existing.organizationId !== orgId) return reply.status(403).send({ error: 'Forbidden' });

    await service.delete(request.params.id);
    return { ok: true };
  });

  // ── POST /api/knowledge/:id/reindex ────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/api/knowledge/:id/reindex', async (request, reply) => {
    await request.requireUser();
    const orgId = request.session?.activeOrganizationId;
    if (!orgId) return reply.status(403).send({ error: 'No active organization' });

    const existing = await service.getById(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Document not found' });
    if (existing.organizationId !== orgId) return reply.status(403).send({ error: 'Forbidden' });

    // Fire-and-forget; status visible via GET.
    service.indexDocument(request.params.id).catch(() => undefined);
    return { ok: true, status: 'indexing' };
  });

  // ── POST /api/knowledge/search ─────────────────────────────────────────
  // Useful for debugging RAG retrieval + previewing what an agent would see.
  fastify.post('/api/knowledge/search', async (request, reply) => {
    await request.requireUser();
    const orgId = request.session?.activeOrganizationId;
    if (!orgId) return reply.status(403).send({ error: 'No active organization' });

    const parsed = searchSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', issues: parsed.error.issues });

    const hits = await service.retrieveForOrg(orgId, parsed.data.query, parsed.data.topK);
    return { hits };
  });
}
