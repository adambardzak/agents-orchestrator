/**
 * Better Auth — multi-tenant authentication for the orchestrator.
 *
 * Backed by Postgres (custom adapter using the `pg` Pool already initialized
 * in the Fastify plugin). Tables created in migration 006.
 *
 * Supported sign-in methods (configured below; OAuth providers only enabled
 * when the corresponding *_OAUTH_CLIENT_ID env vars are set):
 *   • Email + password (always available)
 *   • GitHub OAuth (also stores access token reusable for git operations)
 *   • Google OAuth (sign-in only)
 *
 * Once signed in, Better Auth issues an HTTP-only cookie session.
 * The `requireUser` Fastify decorator (registered in plugins/auth.ts)
 * resolves the session from the cookie on every request.
 *
 * The user → organization mapping (memberships, active org context) is
 * managed by the orchestrator itself outside Better Auth, since the built-in
 * organization plugin assumes a SaaS model with billing roles we'd just have
 * to override anyway.
 */
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import pg from 'pg';
import { env } from '../../config/env.js';

type AuthInstance = ReturnType<typeof betterAuth>;

let cached: AuthInstance | null = null;

export function getAuth(): AuthInstance {
  if (cached) return cached;

  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

  const socialProviders: Record<string, { clientId: string; clientSecret: string; scope?: string[] }> = {};

  if (env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET) {
    socialProviders['github'] = {
      clientId: env.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
      // 'repo' scope so we can later create + push to repos on user's behalf
      scope: ['read:user', 'user:email', 'repo'],
    };
  }
  if (env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET) {
    socialProviders['google'] = {
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    };
  }

  const options: BetterAuthOptions = {
    database: pool,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
    trustedOrigins: env.CORS_ORIGINS.split(',').map((s: string) => s.trim()).filter(Boolean),

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false, // dev-friendly; toggle in prod
      minPasswordLength: 8,
    },

    socialProviders,

    session: {
      // 30 days, refreshed when within 1 day of expiry
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,
      },
      modelName: 'auth_session',
      // Map Better Auth's camelCase property names to our snake_case columns
      fields: {
        userId:    'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      additionalFields: {
        active_organization_id: { type: 'string', required: false },
      },
    },

    // We provide our own table names so the migration owns the schema (not
    // Better Auth's CLI generator).
    user: {
      modelName: 'auth_user',
      fields: {
        emailVerified: 'email_verified',
        createdAt:     'created_at',
        updatedAt:     'updated_at',
      },
    },
    account: {
      modelName: 'auth_account',
      fields: {
        accountId:             'account_id',
        providerId:            'provider_id',
        userId:                'user_id',
        accessToken:           'access_token',
        refreshToken:          'refresh_token',
        idToken:               'id_token',
        accessTokenExpiresAt:  'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt:             'created_at',
        updatedAt:             'updated_at',
      },
    },
    verification: {
      modelName: 'auth_verification',
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },

    advanced: {
      // Cookies must be readable by the Nuxt app served on a different port
      // in dev. In prod we run them on the same origin behind nginx.
      defaultCookieAttributes: {
        sameSite: 'lax',
        secure: env.NODE_ENV === 'production',
      },
    },
  };

  cached = betterAuth(options);
  return cached;
}
