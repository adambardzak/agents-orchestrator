/**
 * Git connection REST API
 *
 *   GET    /api/git/providers                — list configured providers
 *   GET    /api/git/connections              — list connections for active org
 *   DELETE /api/git/connections/:id          — disconnect
 *   PATCH  /api/git/connections/:id          — update default visibility
 *   GET    /api/git/connections/:id/repos    — list user's repos via this connection
 *
 * OAuth flow:
 *   GET    /api/git/connect/:provider        — redirect to provider authorize URL
 *   GET    /api/git/callback/:provider       — OAuth callback; upserts connection
 *
 * The CSRF `state` token is stored in a short-lived signed cookie. On callback
 * we verify the state matches before exchanging the code.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  getGitProvider,
  listConfiguredProviders,
} from '../services/git/registry.js';
import { GitConnectionService } from '../services/git/connection-service.js';
import type { GitProviderId } from '../services/git/provider.js';
import { env } from '../config/env.js';

const STATE_COOKIE = 'git_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000; // 10 min

interface OAuthState {
  provider: GitProviderId;
  organizationId: string;
  userId: string;
  redirect: string;
  nonce: string;
  expiresAt: number;
}

function buildRedirectUri(provider: GitProviderId): string {
  return `${env.APP_URL}/api/git/callback/${provider}`;
}

function setStateCookie(reply: FastifyReply, state: OAuthState): void {
  const value = Buffer.from(JSON.stringify(state)).toString('base64url');
  reply.header(
    'set-cookie',
    `${STATE_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(STATE_TTL_MS / 1000)}${env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  );
}

function readStateCookie(request: FastifyRequest): OAuthState | null {
  const header = request.headers.cookie ?? '';
  const cookies = Object.fromEntries(
    header.split(';').map((c) => {
      const [k, ...rest] = c.trim().split('=');
      return [k ?? '', rest.join('=')];
    }),
  );
  const raw = cookies[STATE_COOKIE];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as OAuthState;
    if (parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function gitConnectionRoutes(fastify: FastifyInstance): Promise<void> {
  const connections = new GitConnectionService(fastify.pg.pool);

  // ── GET /api/git/providers ────────────────────────────────────────────────
  fastify.get('/api/git/providers', async () => ({
    providers: listConfiguredProviders(),
  }));

  // ── GET /api/git/connections ──────────────────────────────────────────────
  fastify.get('/api/git/connections', async (request, reply) => {
    const user = await request.requireUser();
    const orgId = request.session?.activeOrganizationId;
    if (!orgId) return reply.status(403).send({ error: 'No active organization' });
    void user;
    return { connections: await connections.listForOrg(orgId) };
  });

  // ── PATCH /api/git/connections/:id ────────────────────────────────────────
  const patchSchema = z.object({
    defaultVisibility: z.enum(['private', 'public', 'internal']),
  });
  fastify.patch<{ Params: { id: string } }>(
    '/api/git/connections/:id',
    async (request, reply) => {
      await request.requireUser();
      const parsed = patchSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
      const conn = await connections.getById(request.params.id);
      if (!conn) return reply.status(404).send({ error: 'Not found' });
      if (conn.organizationId !== request.session?.activeOrganizationId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      await connections.setDefaultVisibility(request.params.id, parsed.data.defaultVisibility);
      return { ok: true };
    },
  );

  // ── DELETE /api/git/connections/:id ───────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/api/git/connections/:id',
    async (request, reply) => {
      await request.requireUser();
      const conn = await connections.getById(request.params.id);
      if (!conn) return reply.status(404).send({ error: 'Not found' });
      if (conn.organizationId !== request.session?.activeOrganizationId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      await connections.delete(request.params.id);
      return { ok: true };
    },
  );

  // ── GET /api/git/connections/:id/repos ────────────────────────────────────
  fastify.get<{ Params: { id: string }; Querystring: { page?: string } }>(
    '/api/git/connections/:id/repos',
    async (request, reply) => {
      await request.requireUser();
      const conn = await connections.getById(request.params.id);
      if (!conn) return reply.status(404).send({ error: 'Not found' });
      if (conn.organizationId !== request.session?.activeOrganizationId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      const provider = getGitProvider(conn.provider);
      if (!provider) return reply.status(400).send({ error: `Provider ${conn.provider} not configured` });
      const token = await connections.getAccessToken(conn.id);
      if (!token) return reply.status(500).send({ error: 'Token unavailable' });
      const page = Number(request.query.page ?? '1') || 1;
      try {
        const repos = await provider.listRepos(token, { page });
        return { repos };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'unknown';
        return reply.status(502).send({ error: `Provider error: ${msg}` });
      }
    },
  );

  // ── GET /api/git/connect/:provider ────────────────────────────────────────
  fastify.get<{ Params: { provider: string }; Querystring: { redirect?: string } }>(
    '/api/git/connect/:provider',
    async (request, reply) => {
      const user = await request.requireUser();
      const orgId = request.session?.activeOrganizationId;
      if (!orgId) return reply.status(403).send({ error: 'No active organization' });

      const provider = getGitProvider(request.params.provider as GitProviderId);
      if (!provider) {
        return reply.status(404).send({ error: `Provider ${request.params.provider} not configured` });
      }

      const state: OAuthState = {
        provider:       provider.id,
        organizationId: orgId,
        userId:         user.id,
        redirect:       request.query.redirect ?? '/settings',
        nonce:          randomBytes(16).toString('base64url'),
        expiresAt:      Date.now() + STATE_TTL_MS,
      };
      setStateCookie(reply, state);

      const url = provider.authorizeUrl({
        state:       state.nonce,
        redirectUri: buildRedirectUri(provider.id),
      });
      return reply.redirect(url);
    },
  );

  // ── GET /api/git/callback/:provider ───────────────────────────────────────
  fastify.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/git/callback/:provider',
    async (request, reply) => {
      if (request.query.error) {
        return reply.status(400).send({ error: `OAuth denied: ${request.query.error}` });
      }
      const stateCookie = readStateCookie(request);
      if (!stateCookie) {
        return reply.status(400).send({ error: 'Invalid or expired OAuth state' });
      }
      if (stateCookie.nonce !== request.query.state) {
        return reply.status(400).send({ error: 'OAuth state mismatch (possible CSRF)' });
      }
      if (stateCookie.provider !== request.params.provider) {
        return reply.status(400).send({ error: 'Provider mismatch in callback' });
      }
      const code = request.query.code;
      if (!code) return reply.status(400).send({ error: 'Missing OAuth code' });

      const provider = getGitProvider(stateCookie.provider);
      if (!provider) return reply.status(400).send({ error: 'Provider no longer configured' });

      try {
        const tokens = await provider.exchangeCode({
          code,
          redirectUri: buildRedirectUri(provider.id),
        });
        const account = await provider.whoami(tokens.accessToken);
        await connections.upsertFromOAuth({
          organizationId: stateCookie.organizationId,
          userId:         stateCookie.userId,
          provider:       provider.id,
          account,
          tokens,
        });

        // Clear the state cookie and bounce the user back to the redirect target.
        reply.header(
          'set-cookie',
          `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
        );
        return reply.redirect(stateCookie.redirect);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'unknown';
        request.log.error({ err }, 'OAuth callback failed');
        return reply.status(502).send({ error: `OAuth callback failed: ${msg}` });
      }
    },
  );
}
