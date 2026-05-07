/**
 * Fastify auth plugin
 *
 * 1. Mounts Better Auth's HTTP handler under `/api/auth/*` (login/logout/
 *    OAuth callbacks/etc.) by translating Fastify's req/reply ↔ web Fetch API
 *    Request/Response that Better Auth speaks.
 * 2. Decorates every request with `request.user` and `request.session`,
 *    resolved from the session cookie (or null if absent).
 * 3. Adds `request.requireUser()` and `request.requireOrg()` helpers that
 *     throw 401/403 when the auth requirement isn't met.
 *
 * Routes that need auth call `await request.requireUser()` at the top.
 * Routes that need an org context call `await request.requireOrg()`.
 *
 * In single-user dev mode (REQUIRE_AUTH=false), `requireUser` becomes a no-op
 * that synthesizes a stable bootstrap user — convenient for local hacking.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { getAuth } from '../services/auth/auth.js';
import { env } from '../config/env.js';

interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
}

interface AuthSession {
  id: string;
  userId: string;
  activeOrganizationId: string | null;
  expiresAt: Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
    session: AuthSession | null;
    /** Throws 401 if not signed in. Returns the user otherwise. */
    requireUser(): Promise<AuthUser>;
    /** Throws 401 if not signed in or 403 if no active org. Returns { user, orgId }. */
    requireOrg(): Promise<{ user: AuthUser; orgId: string }>;
  }
}

// ── Bootstrap "single user" identity for REQUIRE_AUTH=false dev mode ───────
const BOOTSTRAP_USER: AuthUser = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'dev@local',
  name: 'Local Dev',
};
const BOOTSTRAP_ORG_ID = '00000000-0000-0000-0000-000000000010';

async function authPluginImpl(fastify: FastifyInstance): Promise<void> {
  const auth = getAuth();

  // 0) In bootstrap mode, ensure the synthetic dev user exists in the DB so
  //    foreign keys (organizations.created_by → auth_user.id, etc.) hold.
  if (!env.REQUIRE_AUTH) {
    try {
      await fastify.pg.pool.query(
        `INSERT INTO auth_user (id, email, email_verified, name, created_at, updated_at)
         VALUES ($1, $2, true, $3, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [BOOTSTRAP_USER.id, BOOTSTRAP_USER.email, BOOTSTRAP_USER.name ?? null],
      );
      // Also seed a default org so the dev session has a valid active_organization_id.
      await fastify.pg.pool.query(
        `INSERT INTO organizations (id, slug, name, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [BOOTSTRAP_ORG_ID, 'personal', 'Personal workspace', BOOTSTRAP_USER.id],
      );
      await fastify.pg.pool.query(
        `INSERT INTO organization_memberships (organization_id, user_id, role)
         VALUES ($1, $2, 'owner')
         ON CONFLICT (organization_id, user_id) DO NOTHING`,
        [BOOTSTRAP_ORG_ID, BOOTSTRAP_USER.id],
      );
      // Persist a synthetic bootstrap session row so dev mode can remember
      // the user's last active workspace across API restarts. The row uses a
      // fixed id ('bootstrap') and never expires for practical purposes.
      await fastify.pg.pool.query(
        `INSERT INTO auth_session (id, user_id, token, active_organization_id, expires_at, created_at, updated_at)
         VALUES ('bootstrap', $1, 'bootstrap', $2, NOW() + INTERVAL '100 years', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [BOOTSTRAP_USER.id, BOOTSTRAP_ORG_ID],
      );
      fastify.log.info({ userId: BOOTSTRAP_USER.id, orgId: BOOTSTRAP_ORG_ID }, 'bootstrap user/org seeded');
    } catch (err) {
      fastify.log.error({ err }, 'failed to seed bootstrap user/org');
    }
  }

  // 1) Mount Better Auth's request handler. It expects a Web Fetch Request
  //    and returns a Response. Fastify gives us node IncomingMessage; we
  //    translate via the route URL prefix.
  // 1a) In bootstrap (no-auth) dev mode, intercept /api/auth/get-session so
  //     the frontend `useAuth.refresh()` sees a synthetic session instead of
  //     the literal `null` Better Auth returns when nobody is signed in.
  //     This must be registered BEFORE the catch-all auth handler below.
  if (!env.REQUIRE_AUTH) {
    fastify.get('/api/auth/get-session', async (request) => {
      // Read current active org from the persistent bootstrap session row.
      let activeOrgId: string = BOOTSTRAP_ORG_ID;
      try {
        const { rows: [r] } = await fastify.pg.pool.query<{ active_organization_id: string | null }>(
          `SELECT active_organization_id FROM auth_session WHERE id = 'bootstrap'`,
        );
        if (r?.active_organization_id) activeOrgId = r.active_organization_id;
      } catch { /* ignore */ }
      void request;
      return {
        user: {
          id:    BOOTSTRAP_USER.id,
          email: BOOTSTRAP_USER.email,
          name:  BOOTSTRAP_USER.name,
          image: null,
        },
        session: {
          id:                      'bootstrap',
          expiresAt:               new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          active_organization_id:  activeOrgId,
        },
      };
    });
  }

  fastify.all('/api/auth/*', async (request, reply) => {
    const url = new URL(request.url, env.APP_URL);
    const headers = new Headers();
    for (const [k, v] of Object.entries(request.headers)) {
      if (Array.isArray(v)) v.forEach((vv) => headers.append(k, vv));
      else if (typeof v === 'string') headers.set(k, v);
    }

    const init: RequestInit = {
      method: request.method,
      headers,
    };
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
      init.body =
        typeof request.body === 'string'
          ? request.body
          : JSON.stringify(request.body);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    }

    const webRequest = new Request(url.toString(), init);
    const webResponse = await auth.handler(webRequest);

    reply.status(webResponse.status);
    webResponse.headers.forEach((value, key) => {
      // Pass-through Set-Cookie carefully (multiple headers possible)
      if (key.toLowerCase() === 'set-cookie') {
        reply.header('set-cookie', value);
      } else {
        reply.header(key, value);
      }
    });
    const text = await webResponse.text();
    return reply.send(text);
  });

  // 2) Resolve session from cookie on every request, attach to request.
  //    We always try Better Auth first — if there's a real signed-in user,
  //    use them. Only when no session exists *and* REQUIRE_AUTH=false do we
  //    fall back to the bootstrap user (single-user dev mode).
  fastify.addHook('preHandler', async (request: FastifyRequest, _reply: FastifyReply) => {
    request.user = null;
    request.session = null;

    try {
      const headers = new Headers();
      for (const [k, v] of Object.entries(request.headers)) {
        if (typeof v === 'string') headers.set(k, v);
      }
      const result = await auth.api.getSession({ headers });
      if (result?.user) {
        request.user = {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          image: result.user.image,
        };
      }
      if (result?.session) {
        const s = result.session as Record<string, unknown>;
        const sessionId = String(s['id']);

        // Better Auth's getSession does not surface our custom
        // `active_organization_id` column on auth_session. Read it directly so
        // requireOrg() can enforce tenant isolation. Cheap (PK lookup) and the
        // result is per-request only.
        let activeOrgId = (s['activeOrganizationId'] as string | null) ?? null;
        if (!activeOrgId) {
          try {
            const { rows: [r] } = await fastify.pg.pool.query<{ active_organization_id: string | null }>(
              `SELECT active_organization_id FROM auth_session WHERE id = $1`,
              [sessionId],
            );
            if (r?.active_organization_id) activeOrgId = r.active_organization_id;
          } catch (err) {
            request.log.warn({ err, sessionId }, 'failed to load active_organization_id');
          }
        }

        request.session = {
          id: sessionId,
          userId: String(s['userId']),
          activeOrganizationId: activeOrgId,
          expiresAt: new Date(s['expiresAt'] as string),
        };
      }
    } catch (err) {
      request.log.warn({ err }, 'failed to resolve session');
    }

    // Bootstrap fallback for dev mode — only when no real session.
    if (!request.user && !env.REQUIRE_AUTH) {
      // Read the persistent bootstrap session so the active org survives
      // API restarts. Falls back to BOOTSTRAP_ORG_ID if the row was wiped.
      let activeOrgId: string = BOOTSTRAP_ORG_ID;
      try {
        const { rows: [r] } = await fastify.pg.pool.query<{ active_organization_id: string | null }>(
          `SELECT active_organization_id FROM auth_session WHERE id = 'bootstrap'`,
        );
        if (r?.active_organization_id) activeOrgId = r.active_organization_id;
      } catch { /* ignore — fall back to default */ }

      request.user = BOOTSTRAP_USER;
      request.session = {
        id: 'bootstrap',
        userId: BOOTSTRAP_USER.id,
        activeOrganizationId: activeOrgId,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      };
    }
  });

  // 3) Convenience helpers
  fastify.decorateRequest('requireUser', async function (this: FastifyRequest) {
    if (!this.user) {
      throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    }
    return this.user;
  } as FastifyRequest['requireUser']);

  fastify.decorateRequest('requireOrg', async function (this: FastifyRequest) {
    const user = await this.requireUser();
    const orgId = this.session?.activeOrganizationId ?? null;
    if (!orgId) {
      throw Object.assign(new Error('No active organization. Create or select one first.'), {
        statusCode: 403,
      });
    }
    return { user, orgId };
  } as FastifyRequest['requireOrg']);

  fastify.decorateRequest('user', null);
  fastify.decorateRequest('session', null);
}

export default fp(authPluginImpl, { name: 'auth' });
