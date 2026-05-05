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
