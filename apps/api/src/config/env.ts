import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),

  // PostgreSQL
  DATABASE_URL: z
    .string()
    .default('postgresql://orchestrator:orchestrator@localhost:5432/orchestrator'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Workspaces root — kde se mountují projekty pro OpenCode procesy
  WORKSPACES_ROOT: z.string().default('/workspaces'),

  // GitHub Copilot token pro OpenCode
  GITHUB_TOKEN: z.string().optional(),

  // OpenCode binary path — override for testing or custom installs
  // Default: 'opencode' (assumes it's on PATH with correct CLI flags)
  OPENCODE_BINARY: z.string().default('opencode'),

  // Session budget cap (USD) default
  DEFAULT_BUDGET_CAP_USD: z.coerce.number().default(5),

  // Maximální počet paralelně běžících OpenCode procesů
  MAX_PARALLEL_AGENTS: z.coerce.number().default(6),

  // CORS origins pro dashboard
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // code-server URL for "Open in VS Code" deep links
  // e.g. https://code.yourdomain.com or http://localhost:8080
  CODE_SERVER_URL: z.string().default('http://localhost:8080'),

  // ── Auth (Better Auth) ──────────────────────────────────────────────────
  /** App's public origin (used for cookies, OAuth redirects) */
  APP_URL: z.string().default('http://localhost:3010'),
  /** Secret used by Better Auth for signing sessions */
  BETTER_AUTH_SECRET: z.string().min(32).default('dev-only-please-replace-32+characters-key'),
  /** AES-256-GCM key (base64 of 32 bytes) for encrypting tokens at rest */
  APP_ENCRYPTION_KEY: z
    .string()
    .default('dev-only-replace-base64-32-bytes-key-XXXXXXXXXXXXXXXXXX==='),
  /** OAuth credentials — optional in dev, required for production sign-in */
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GITLAB_OAUTH_CLIENT_ID: z.string().optional(),
  GITLAB_OAUTH_CLIENT_SECRET: z.string().optional(),
  BITBUCKET_OAUTH_CLIENT_ID: z.string().optional(),
  BITBUCKET_OAUTH_CLIENT_SECRET: z.string().optional(),

  /** When true (default), API requires an authenticated session for non-public routes.
   *  Set to "false" only for local single-user dev where you've intentionally
   *  disabled auth for fast iteration. */
  REQUIRE_AUTH: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

  // ── Per-context env vars injected into agent processes ───────────────────

  // Personal context
  VERCEL_TOKEN: z.string().optional(),
  HETZNER_API_TOKEN: z.string().optional(),

  // CEZ context
  CEZ_VAULT_ADDR: z.string().optional(),       // HashiCorp Vault address
  CEZ_GITLAB_TOKEN: z.string().optional(),     // GitLab personal access token
  CEZ_OPENSHIFT_TOKEN: z.string().optional(),  // OpenShift/OKD API token
  CEZ_NEXUS_URL: z.string().optional(),        // Nexus registry URL
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment configuration:');
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
