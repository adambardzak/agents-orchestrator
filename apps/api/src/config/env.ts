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

  /**
   * Self-hosted Git provider base URLs. When set, the registry points the
   * provider at your on-prem instance instead of the SaaS default.
   *
   *   GITHUB_API_BASE     → e.g. https://github.your-corp.com (GitHub Enterprise Server)
   *                         The OAuth UI lives at the same host with /login/oauth/* paths.
   *                         The REST API lives at <host>/api/v3 (Octokit handles this with baseUrl).
   *   GITLAB_API_BASE     → e.g. https://gitlab.apps.corp
   *                         OAuth UI: <host>/oauth/* ; REST: <host>/api/v4. The provider
   *                         already templates both off the same apiBase, so a single var suffices.
   *
   * Single-instance per deploy: if you point at on-prem you cannot also connect
   * to gitlab.com / github.com from the same orchestrator instance. Re-deploy
   * with different envs if you need both.
   */
  GITHUB_API_BASE: z.string().url().optional(),
  GITLAB_API_BASE: z.string().url().optional(),

  // ── Context optimization knobs ──────────────────────────────────────────
  /**
   * Minimum cosine similarity (0..1) for a RAG/KB chunk to be injected into
   * the agent system prompt. Hits below the threshold are dropped entirely.
   * 0 = disabled (legacy behaviour: always inject top-K).
   * Recommended: 0.40–0.50 — empirically filters most off-topic noise while
   * preserving genuinely relevant matches.
   */
  RAG_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.45),
  KB_MIN_SCORE:  z.coerce.number().min(0).max(1).default(0.45),

  /**
   * Minimum cosine similarity (0..1) for a built-in/custom skill's knowledge
   * block to be injected into a sub-agent's system prompt. Skills below the
   * threshold are dropped (their `rules` are still preserved). 0 disables
   * (legacy: always inject every declared skill).
   *
   * Defaulted lower than RAG/KB because skill blocks describe abstract
   * patterns ("TypeScript strict mode") rather than concrete code/docs, so
   * cosine scores against a task prompt run lower even when relevant.
   *
   * Safety net: when the filter would reject ALL skills it instead keeps the
   * single highest-scoring one, so agents never lose all specialization.
   */
  SKILL_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.30),

  /**
   * Hard cap on the verbatim `design-system/frontend-rules.md` body when
   * injected into the Frontend agent's system prompt. If the file exceeds
   * this many characters it is truncated and a warning is logged so the
   * user knows their rules doc is being clipped. Set to 0 to disable cap.
   */
  FRONTEND_RULES_MAX_CHARS: z.coerce.number().int().nonnegative().default(4000),

  /**
   * Per-file size cap (chars) when loading user-referenced files via `@file`
   * mentions into the agent's system prompt. Files larger than this are
   * truncated head-first with a `<!-- truncated: N chars omitted -->` marker.
   * Default 50_000 chars ≈ 12.5K tokens — enough for typical source files
   * without blowing the context budget on a single reference.
   */
  REFERENCED_FILES_PER_FILE_MAX_CHARS: z.coerce.number().int().nonnegative().default(50_000),

  /**
   * Total cap (chars) on the combined `## Referenced Files` block. Once the
   * running total exceeds this, additional files are dropped with a warning
   * logged for operator visibility. Default 200_000 chars ≈ 50K tokens.
   */
  REFERENCED_FILES_TOTAL_MAX_CHARS: z.coerce.number().int().nonnegative().default(200_000),

  /**
   * Hard cap on the number of `@file` references accepted per task. Prevents
   * pathological prompts from enumerating the entire repo. Validated at the
   * API ingest layer; requests exceeding this are rejected with 400.
   */
  REFERENCED_FILES_MAX_COUNT: z.coerce.number().int().positive().default(20),

  /** When true (default), API requires an authenticated session for non-public routes.
   *  Set to "false" only for local single-user dev where you've intentionally
   *  disabled auth for fast iteration. */
  REQUIRE_AUTH: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

  /** Set Secure flag on auth cookies. Defaults to true in production, but
   *  must be disabled when serving over plain HTTP (e.g. before LE on a
   *  public IP) — otherwise the browser drops the session cookie. */
  AUTH_COOKIES_SECURE: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),

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
