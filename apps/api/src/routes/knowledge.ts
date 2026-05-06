/**
 * Knowledge base REST API — scope-aware (user XOR organization).
 *
 * Scope resolution per request:
 *   - `?scope=user`  → personal KB of authenticated user
 *   - `?scope=org`   → workspace KB of session.activeOrganizationId
 *   - omitted        → defaults to org (preserves pre-XOR behaviour)
 *
 *   GET    /api/knowledge?scope=...                — list docs (summaries) for resolved scope
 *   GET    /api/knowledge/:id                       — full document with content (any scope user owns)
 *   POST   /api/knowledge?scope=...                 — create new doc in resolved scope (auto-indexes)
 *   PATCH  /api/knowledge/:id                       — update title/path/content/tags (re-indexes on content change)
 *   DELETE /api/knowledge/:id                       — remove doc + chunks
 *   POST   /api/knowledge/:id/reindex               — force re-embed
 *   POST   /api/knowledge/search?scope=...          — top-K similarity search; scope can be 'both'
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { KnowledgeService, type KbScope } from '../services/knowledge/knowledge-service.js';
import { env } from '../config/env.js';

const scopeQuerySchema = z.object({
  scope: z.enum(['user', 'org']).optional(),
});

const searchQuerySchema = z.object({
  scope: z.enum(['user', 'org', 'both']).optional(),
});

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

  /**
   * Resolve a single scope from query string + session. Returns null on
   * misconfiguration (e.g. ?scope=org without active org) so the caller can
   * 403 cleanly.
   */
  function resolveScope(
    requested: 'user' | 'org' | undefined,
    userId: string,
    activeOrgId: string | null | undefined,
  ): KbScope | null {
    const want = requested ?? 'org';
    if (want === 'user') return { kind: 'user', userId };
    if (!activeOrgId) return null;
    return { kind: 'org', organizationId: activeOrgId };
  }

  /**
   * Verify the caller is allowed to read/mutate a given document.
   * - user-scoped doc: only the owner
   * - org-scoped doc:  only members of the active org
   */
  function canAccessDoc(
    docScope: KbScope,
    userId: string,
    activeOrgId: string | null | undefined,
  ): boolean {
    if (docScope.kind === 'user') return docScope.userId === userId;
    return docScope.organizationId === activeOrgId;
  }

  // ── GET /api/knowledge ─────────────────────────────────────────────────
  fastify.get('/api/knowledge', async (request, reply) => {
    const user = await request.requireUser();
    const q = scopeQuerySchema.safeParse(request.query);
    if (!q.success) return reply.status(400).send({ error: 'Invalid query', issues: q.error.issues });

    const scope = resolveScope(q.data.scope, user.id, request.session?.activeOrganizationId);
    if (!scope) return reply.status(403).send({ error: 'No active organization' });

    const documents = await service.listForScope(scope);
    return { documents, scope: scope.kind };
  });

  // ── GET /api/knowledge/:id ─────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/knowledge/:id', async (request, reply) => {
    const user = await request.requireUser();
    const doc = await service.getById(request.params.id);
    if (!doc) return reply.status(404).send({ error: 'Document not found' });
    if (!canAccessDoc(doc.scope, user.id, request.session?.activeOrganizationId)) {
      return reply.status(404).send({ error: 'Document not found' });
    }
    return { document: doc };
  });

  // ── POST /api/knowledge ────────────────────────────────────────────────
  fastify.post('/api/knowledge', async (request, reply) => {
    const user = await request.requireUser();
    const q = scopeQuerySchema.safeParse(request.query);
    if (!q.success) return reply.status(400).send({ error: 'Invalid query', issues: q.error.issues });

    const scope = resolveScope(q.data.scope, user.id, request.session?.activeOrganizationId);
    if (!scope) return reply.status(403).send({ error: 'No active organization' });

    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', issues: parsed.error.issues });

    try {
      const doc = await service.create({
        scope,
        createdBy: user.id,
        ...parsed.data,
      });
      return reply.status(201).send({ document: doc });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('knowledge_documents_path_per_org_unique') ||
          msg.includes('knowledge_documents_path_per_user_unique')) {
        return reply.status(409).send({ error: `A document already exists at path "${parsed.data.path}"` });
      }
      throw err;
    }
  });

  // ── PATCH /api/knowledge/:id ───────────────────────────────────────────
  fastify.patch<{ Params: { id: string } }>('/api/knowledge/:id', async (request, reply) => {
    const user = await request.requireUser();
    const existing = await service.getById(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Document not found' });
    if (!canAccessDoc(existing.scope, user.id, request.session?.activeOrganizationId)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', issues: parsed.error.issues });

    try {
      const updated = await service.update(request.params.id, parsed.data);
      return { document: updated };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('knowledge_documents_path_per_org_unique') ||
          msg.includes('knowledge_documents_path_per_user_unique')) {
        return reply.status(409).send({ error: `A document already exists at that path` });
      }
      throw err;
    }
  });

  // ── DELETE /api/knowledge/:id ──────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/api/knowledge/:id', async (request, reply) => {
    const user = await request.requireUser();
    const existing = await service.getById(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Document not found' });
    if (!canAccessDoc(existing.scope, user.id, request.session?.activeOrganizationId)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    await service.delete(request.params.id);
    return { ok: true };
  });

  // ── POST /api/knowledge/:id/reindex ────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/api/knowledge/:id/reindex', async (request, reply) => {
    const user = await request.requireUser();
    const existing = await service.getById(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Document not found' });
    if (!canAccessDoc(existing.scope, user.id, request.session?.activeOrganizationId)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    service.indexDocument(request.params.id).catch(() => undefined);
    return { ok: true, status: 'indexing' };
  });

  // ── POST /api/knowledge/search ─────────────────────────────────────────
  fastify.post('/api/knowledge/search', async (request, reply) => {
    const user = await request.requireUser();
    const q = searchQuerySchema.safeParse(request.query);
    if (!q.success) return reply.status(400).send({ error: 'Invalid query', issues: q.error.issues });

    const parsed = searchSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', issues: parsed.error.issues });

    const scopes: KbScope[] = [];
    const want = q.data.scope ?? 'org';
    const orgId = request.session?.activeOrganizationId;

    if (want === 'user' || want === 'both') {
      scopes.push({ kind: 'user', userId: user.id });
    }
    if ((want === 'org' || want === 'both') && orgId) {
      scopes.push({ kind: 'org', organizationId: orgId });
    }
    if (scopes.length === 0) return reply.status(403).send({ error: 'No scope to search' });

    const hits = await service.retrieveForScopes(scopes, parsed.data.query, parsed.data.topK);
    return { hits };
  });
}
