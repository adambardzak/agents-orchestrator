/**
 * AI provider REST API.
 *
 *   GET    /api/ai-providers/types              — static catalog (display names, models)
 *   GET    /api/ai-providers                    — list configured providers for active org+user
 *   POST   /api/ai-providers                    — create new provider entry
 *   PATCH  /api/ai-providers/:id                — update label / key / base / default model / enabled
 *   DELETE /api/ai-providers/:id                — remove
 *   POST   /api/ai-providers/:id/test           — validate stored key against provider's models endpoint
 *   POST   /api/ai-providers/test               — validate an unsaved key (for the "Add" form)
 *
 * Security:
 *   - All endpoints require `requireUser()`
 *   - Org-shared entries (user_id NULL) are visible to all org members; only
 *     org owners/admins should be able to create/edit them. For now we let any
 *     member do it — refine when we add role enforcement.
 *   - API keys are write-only — never returned in list/get responses.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AIProviderService,
  type AIProviderType,
} from '../services/ai-providers/provider-service.js';
import { listProviderTypes, testApiKey } from '../services/ai-providers/registry.js';

const PROVIDER_TYPES: [AIProviderType, ...AIProviderType[]] = [
  'anthropic', 'openai', 'google', 'openrouter',
  'ollama', 'github-copilot', 'azure-openai', 'mistral',
];

const createSchema = z.object({
  provider:     z.enum(PROVIDER_TYPES),
  label:        z.string().min(1).max(100),
  apiKey:       z.string().optional(),
  baseUrl:      z.string().url().optional(),
  defaultModel: z.string().optional(),
  scope:        z.enum(['org', 'personal']).default('personal'),
  metadata:     z.record(z.unknown()).optional(),
});

const updateSchema = z.object({
  label:        z.string().min(1).max(100).optional(),
  apiKey:       z.string().optional(),     // pass to rotate, omit to keep
  baseUrl:      z.string().url().nullable().optional(),
  defaultModel: z.string().nullable().optional(),
  enabled:      z.boolean().optional(),
  isDefault:    z.boolean().optional(),
  metadata:     z.record(z.unknown()).optional(),
});

const testInlineSchema = z.object({
  provider: z.enum(PROVIDER_TYPES),
  apiKey:   z.string().optional(),
  baseUrl:  z.string().url().optional(),
});

export async function aiProviderRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new AIProviderService(fastify.pg.pool);

  // ── GET /api/ai-providers/types ────────────────────────────────────────
  fastify.get('/api/ai-providers/types', async () => ({
    types: listProviderTypes(),
  }));

  // ── GET /api/ai-providers ──────────────────────────────────────────────
  fastify.get('/api/ai-providers', async (request, reply) => {
    const user = await request.requireUser();
    const orgId = request.session?.activeOrganizationId;
    if (!orgId) return reply.status(403).send({ error: 'No active organization' });
    const providers = await service.listForUser(orgId, user.id);
    return { providers };
  });

  // ── POST /api/ai-providers ─────────────────────────────────────────────
  fastify.post('/api/ai-providers', async (request, reply) => {
    const user = await request.requireUser();
    const orgId = request.session?.activeOrganizationId;
    if (!orgId) return reply.status(403).send({ error: 'No active organization' });

    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const input = parsed.data;

    const created = await service.create({
      organizationId: orgId,
      userId:         input.scope === 'org' ? null : user.id,
      provider:       input.provider,
      label:          input.label,
      ...(input.apiKey       ? { apiKey:       input.apiKey       } : {}),
      ...(input.baseUrl      ? { baseUrl:      input.baseUrl      } : {}),
      ...(input.defaultModel ? { defaultModel: input.defaultModel } : {}),
      ...(input.metadata     ? { metadata:     input.metadata     } : {}),
    });
    return reply.status(201).send({ provider: created });
  });

  // ── PATCH /api/ai-providers/:id ────────────────────────────────────────
  fastify.patch<{ Params: { id: string } }>(
    '/api/ai-providers/:id',
    async (request, reply) => {
      const user = await request.requireUser();
      const orgId = request.session?.activeOrganizationId;
      const existing = await service.getById(request.params.id);
      if (!existing) return reply.status(404).send({ error: 'Not found' });
      if (existing.organizationId !== orgId) return reply.status(403).send({ error: 'Forbidden' });
      // Personal entries can only be edited by their owner
      if (existing.userId && existing.userId !== user.id) {
        return reply.status(403).send({ error: 'Cannot edit another user\'s personal provider' });
      }

      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

      const updated = await service.update(request.params.id, parsed.data);
      return { provider: updated };
    },
  );

  // ── DELETE /api/ai-providers/:id ───────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/api/ai-providers/:id',
    async (request, reply) => {
      const user = await request.requireUser();
      const orgId = request.session?.activeOrganizationId;
      const existing = await service.getById(request.params.id);
      if (!existing) return reply.status(404).send({ error: 'Not found' });
      if (existing.organizationId !== orgId) return reply.status(403).send({ error: 'Forbidden' });
      if (existing.userId && existing.userId !== user.id) {
        return reply.status(403).send({ error: 'Cannot delete another user\'s personal provider' });
      }
      await service.delete(request.params.id);
      return { ok: true };
    },
  );

  // ── POST /api/ai-providers/:id/test ────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/api/ai-providers/:id/test',
    async (request, reply) => {
      await request.requireUser();
      const existing = await service.getById(request.params.id);
      if (!existing) return reply.status(404).send({ error: 'Not found' });
      const apiKey = await service.getApiKey(request.params.id);
      const result = await testApiKey({
        provider: existing.provider,
        apiKey,
        ...(existing.baseUrl ? { baseUrl: existing.baseUrl } : {}),
      });
      return { result };
    },
  );

  // ── POST /api/ai-providers/test ────────────────────────────────────────
  // Test a key BEFORE saving (used by the Add form to validate user input).
  fastify.post('/api/ai-providers/test', async (request, reply) => {
    await request.requireUser();
    const parsed = testInlineSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const result = await testApiKey({
      provider: parsed.data.provider,
      apiKey:   parsed.data.apiKey ?? null,
      ...(parsed.data.baseUrl ? { baseUrl: parsed.data.baseUrl } : {}),
    });
    return { result };
  });

  // ── PATCH /api/ai-providers/:id/default ────────────────────────────────
  // Pin this provider as the default within its (scope, kind). Atomically
  // clears any sibling default first so the partial unique index holds.
  fastify.patch<{ Params: { id: string } }>(
    '/api/ai-providers/:id/default',
    async (request, reply) => {
      const user = await request.requireUser();
      const orgId = request.session?.activeOrganizationId;
      const existing = await service.getById(request.params.id);
      if (!existing) return reply.status(404).send({ error: 'Not found' });
      if (existing.organizationId !== orgId) return reply.status(403).send({ error: 'Forbidden' });
      // Personal entries can only be modified by their owner.
      if (existing.userId && existing.userId !== user.id) {
        return reply.status(403).send({ error: 'Cannot modify another user\'s personal provider' });
      }
      const updated = await service.setDefault(request.params.id);
      return { provider: updated };
    },
  );

  // ── GET /api/ai-providers/resolved ─────────────────────────────────────
  // Debug/UI endpoint — shows which provider would be picked for the current
  // user inside the active org, applying the "user wins, org fallback" rule.
  // Optional ?kind=anthropic|openai|... narrows to a specific provider type.
  fastify.get<{ Querystring: { kind?: string } }>(
    '/api/ai-providers/resolved',
    async (request, reply) => {
      const user = await request.requireUser();
      const orgId = request.session?.activeOrganizationId ?? null;
      const kindParam = request.query.kind;
      const kind: AIProviderType | undefined =
        kindParam && (PROVIDER_TYPES as readonly string[]).includes(kindParam)
          ? (kindParam as AIProviderType)
          : undefined;

      const resolved = await service.resolveForUser(user.id, orgId, kind);
      if (!resolved) return reply.send({ provider: null });
      // Strip the apiKey before returning — caller only needs metadata.
      return reply.send({
        provider: resolved.provider,
        scope:    resolved.provider.userId ? 'user' : 'org-shared',
      });
    },
  );
}
