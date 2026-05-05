/**
 * MCP Server Catalog
 *
 * Authoritative list of all supported MCP (Model Context Protocol) servers.
 * Each entry describes how to spawn the server and what it provides.
 *
 * These server configs are written to the agent's opencode.json at spawn time.
 */

export interface McpServerEntry {
  id: string;
  name: string;
  description: string;
  category: McpCategory;
  /** npm package that provides the MCP server */
  npmPackage: string;
  /** Command to run the server (usually npx) */
  command: string;
  args: string[];
  /** Environment variables required by the server */
  requiredEnv?: string[];
  docsUrl?: string;
}

export type McpCategory =
  | 'filesystem'   // file/code access
  | 'vcs'          // version control
  | 'database'     // databases & storage
  | 'browser'      // web / browser automation
  | 'cloud'        // cloud providers & infra
  | 'devtools'     // CI/CD, monitoring
  | 'communication' // Slack, email
  | 'search'       // search engines, SEO tools
  | 'knowledge';   // notes, documentation

export const MCP_CATALOG: McpServerEntry[] = [
  // ── Filesystem & Code ──────────────────────────────────────────────────────
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read and write files in the workspace. Core tool for all code-writing agents.',
    category: 'filesystem',
    npmPackage: '@modelcontextprotocol/server-filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    id: 'shell',
    name: 'Shell',
    description: 'Execute bash commands in the workspace (npm, tsc, tests, migrations).',
    category: 'filesystem',
    npmPackage: '@modelcontextprotocol/server-shell',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-shell'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/shell',
  },

  // ── Version Control ────────────────────────────────────────────────────────
  {
    id: 'git',
    name: 'Git',
    description: 'Git operations: log, diff, blame, commit history. Read-only by default.',
    category: 'vcs',
    npmPackage: '@modelcontextprotocol/server-git',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-git', '--repository', '/workspace'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'GitHub API: issues, PRs, repos, code search, workflows.',
    category: 'vcs',
    npmPackage: '@modelcontextprotocol/server-github',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    requiredEnv: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    description: 'GitLab API: merge requests, issues, pipelines, repositories.',
    category: 'vcs',
    npmPackage: '@modelcontextprotocol/server-gitlab',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gitlab'],
    requiredEnv: ['GITLAB_PERSONAL_ACCESS_TOKEN'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gitlab',
  },

  // ── Databases ──────────────────────────────────────────────────────────────
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Query PostgreSQL databases, inspect schemas, run migrations.',
    category: 'database',
    npmPackage: '@modelcontextprotocol/server-postgres',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', '${DATABASE_URL}'],
    requiredEnv: ['DATABASE_URL'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    description: 'Read and query SQLite databases.',
    category: 'database',
    npmPackage: '@modelcontextprotocol/server-sqlite',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite', '/workspace/data.db'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
  },
  {
    id: 'redis',
    name: 'Redis',
    description: 'Inspect Redis keys, values, pub/sub channels.',
    category: 'database',
    npmPackage: 'mcp-server-redis',
    command: 'npx',
    args: ['-y', 'mcp-server-redis'],
    requiredEnv: ['REDIS_URL'],
  },

  // ── Browser ────────────────────────────────────────────────────────────────
  {
    id: 'browser',
    name: 'Playwright Browser',
    description: 'Browser automation with Playwright: screenshots, clicks, form submission, visual QA.',
    category: 'browser',
    npmPackage: '@playwright/mcp',
    command: 'npx',
    args: ['-y', '@playwright/mcp'],
    docsUrl: 'https://github.com/microsoft/playwright-mcp',
  },
  {
    id: 'fetch',
    name: 'Fetch / HTTP',
    description: 'Make HTTP requests to external APIs and web pages.',
    category: 'browser',
    npmPackage: '@modelcontextprotocol/server-fetch',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },

  // ── Cloud & Infra ──────────────────────────────────────────────────────────
  {
    id: 'vercel',
    name: 'Vercel',
    description: 'Vercel deployments: deploy, inspect builds, manage environment variables.',
    category: 'cloud',
    npmPackage: '@vercel/mcp-adapter',
    command: 'npx',
    args: ['-y', '@vercel/mcp-adapter'],
    requiredEnv: ['VERCEL_TOKEN'],
    docsUrl: 'https://vercel.com/docs/mcp',
  },
  {
    id: 'hetzner',
    name: 'Hetzner Cloud',
    description: 'Manage Hetzner Cloud servers, load balancers, volumes, firewalls.',
    category: 'cloud',
    npmPackage: 'mcp-hetzner',
    command: 'npx',
    args: ['-y', 'mcp-hetzner'],
    requiredEnv: ['HETZNER_API_TOKEN'],
  },
  {
    id: 'openshift',
    name: 'OpenShift',
    description: 'OpenShift/Kubernetes: deployments, pods, services, config maps.',
    category: 'cloud',
    npmPackage: 'mcp-openshift',
    command: 'npx',
    args: ['-y', 'mcp-openshift'],
    requiredEnv: ['OPENSHIFT_TOKEN', 'OPENSHIFT_SERVER'],
  },
  {
    id: 'vault',
    name: 'HashiCorp Vault',
    description: 'Read secrets from Vault. Used for CEZ context secret injection.',
    category: 'cloud',
    npmPackage: 'mcp-vault',
    command: 'npx',
    args: ['-y', 'mcp-vault'],
    requiredEnv: ['VAULT_ADDR', 'VAULT_TOKEN'],
  },

  // ── Communication ──────────────────────────────────────────────────────────
  {
    id: 'slack',
    name: 'Slack',
    description: 'Send messages, read channels, search Slack workspace.',
    category: 'communication',
    npmPackage: '@modelcontextprotocol/server-slack',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    requiredEnv: ['SLACK_BOT_TOKEN'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
  },

  // ── Search & SEO ───────────────────────────────────────────────────────────
  {
    id: 'google-search-console',
    name: 'Google Search Console',
    description: 'Query GSC: impressions, clicks, CTR, position data per URL/query.',
    category: 'search',
    npmPackage: 'mcp-google-search-console',
    command: 'npx',
    args: ['-y', 'mcp-google-search-console'],
    requiredEnv: ['GOOGLE_OAUTH_TOKEN'],
  },
  {
    id: 'google-analytics',
    name: 'Google Analytics',
    description: 'GA4 data: sessions, events, conversions, user dimensions.',
    category: 'search',
    npmPackage: 'mcp-google-analytics',
    command: 'npx',
    args: ['-y', 'mcp-google-analytics'],
    requiredEnv: ['GOOGLE_OAUTH_TOKEN', 'GA4_PROPERTY_ID'],
  },

  // ── Knowledge & Notes ──────────────────────────────────────────────────────
  {
    id: 'obsidian',
    name: 'Obsidian Vault',
    description: 'Read/write project vault notes, ADRs, daily notes. Required for Document agent.',
    category: 'knowledge',
    npmPackage: 'mcp-obsidian',
    command: 'npx',
    args: ['-y', 'mcp-obsidian', '/workspace/.obsidian-vault'],
    docsUrl: 'https://github.com/kkdamoa/mcp-obsidian',
  },
];

/** Ordered list of categories for display grouping */
export const MCP_CATEGORIES: { id: McpCategory; label: string; icon: string }[] = [
  { id: 'filesystem', label: 'Filesystem & Shell', icon: 'i-lucide-folder' },
  { id: 'vcs',        label: 'Version Control',    icon: 'i-lucide-git-branch' },
  { id: 'database',   label: 'Databases',          icon: 'i-lucide-database' },
  { id: 'browser',    label: 'Browser',            icon: 'i-lucide-globe' },
  { id: 'cloud',      label: 'Cloud & Infra',      icon: 'i-lucide-cloud' },
  { id: 'communication', label: 'Communication',   icon: 'i-lucide-message-circle' },
  { id: 'search',     label: 'Search & SEO',       icon: 'i-lucide-search' },
  { id: 'knowledge',  label: 'Knowledge',          icon: 'i-lucide-book-open' },
];

export function getMcpServerById(id: string): McpServerEntry | undefined {
  return MCP_CATALOG.find((s) => s.id === id);
}

/**
 * Builds the MCP server config map for OPENCODE_CONFIG_CONTENT from a list of server IDs.
 * Returns the real OpenCode local server format: { type: "local", command: string[] }.
 * Replaces environment variable placeholders like '${DATABASE_URL}'.
 */
export function buildMcpServerConfigs(
  serverIds: string[],
  env: Record<string, string | undefined> = {},
): Record<string, { type: 'local'; command: string[]; enabled: true }> {
  const result: Record<string, { type: 'local'; command: string[]; enabled: true }> = {};

  for (const id of serverIds) {
    const entry = getMcpServerById(id);
    if (!entry) continue;

    // Substitute environment variable placeholders in args
    const resolvedArgs = entry.args.map((arg) =>
      arg.replace(/\$\{(\w+)\}/g, (_, key: string) => env[key] ?? ''),
    );

    // Real OpenCode format: command array = [binary, ...args]
    result[id] = {
      type: 'local',
      command: [entry.command, ...resolvedArgs],
      enabled: true,
    };
  }

  return result;
}
