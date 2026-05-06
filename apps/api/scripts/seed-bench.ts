#!/usr/bin/env tsx
/**
 * seed-bench.ts
 *
 * Idempotent pre-seed for the context-budget benchmark harness.
 * Inserts (or upserts):
 *   - One bench project (org = bootstrap org, owner = bootstrap user)
 *   - One main session + one branch session (with scope_globs)
 *   - One custom agent_definition with a 5-skill snapshot for the
 *     "skill-heavy" scenario
 *   - Workspace directory tree:
 *       <workspace>/design-system/frontend-rules.md  (~5 KB)
 *       <workspace>/src/{server,users,db}.ts         (small fixture files,
 *                                                     content for @file refs)
 *       <workspace>/src/large-file.ts                (~45 KB, near per-file cap)
 *
 * Re-run safe: uses ON CONFLICT DO UPDATE / mkdir -p / overwrites files.
 *
 * Usage:
 *   tsx apps/api/scripts/seed-bench.ts
 *
 * After running, the script prints the IDs you need to feed into the
 * benchmark harness (project, session-main, session-branch, custom-agent).
 */

import { Pool } from 'pg';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// NOTE: We deliberately do NOT import env.ts here because benchmark-context.ts
// imports BENCH_IDS from this file and needs to override OPENCODE_BINARY before
// env.ts captures it. Read process.env directly instead.
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://orchestrator:orchestrator@localhost:5435/orchestrator';

const BOOTSTRAP_USER = '00000000-0000-0000-0000-000000000001';
const BOOTSTRAP_ORG  = '00000000-0000-0000-0000-000000000010';

export const BENCH_IDS = {
  project:       '22222222-2222-2222-2222-222222222222',
  sessionMain:   '33333333-3333-3333-3333-333333333333',
  sessionBranch: '44444444-4444-4444-4444-444444444444',
  customAgent:   '55555555-5555-5555-5555-555555555555',
} as const;

const FRONTEND_RULES = `# Frontend Design System Rules

## Component Architecture
- Use Vue 3 Composition API with \`<script setup>\` syntax
- Prefer composables for reusable stateful logic
- Keep components under 300 lines; split into sub-components otherwise
- Co-locate component-specific types in the same file

## Styling
- Tailwind CSS utility-first; no custom CSS unless absolutely necessary
- Design tokens live in \`design-system/tokens.css\` as CSS custom properties
- Spacing scale: 4px base (Tailwind default)
- Typography scale: text-xs, text-sm, text-base, text-lg, text-xl, text-2xl
- Color palette: primary (blue-600), neutral (gray-50 to gray-900), success (emerald-600), warning (amber-500), danger (red-600)

## State Management
- Component-local state: \`ref\` / \`reactive\`
- Cross-component state: Pinia stores; one store per logical domain
- Server state: \`useFetch\` (Nuxt) or TanStack Query

## Forms
- Use VeeValidate + Zod schemas for validation
- Show inline error messages below each field
- Disable submit button while \`isSubmitting === true\`

## Accessibility
- All interactive elements must have visible focus rings (\`focus-visible:ring-2\`)
- Form fields: every \`<input>\` has an associated \`<label for="...">\`
- Buttons inside icon-only contexts must have \`aria-label\`
- Color contrast: minimum WCAG AA (4.5:1 for normal text)
- Keyboard navigation: all flows must be operable without a mouse

## Performance
- Lazy-load route-level components via \`defineAsyncComponent\`
- Images: \`loading="lazy"\` and \`<picture>\` with WebP sources
- Avoid v-for over 1000+ items without virtualization (use \`@tanstack/vue-virtual\`)
- Memoize expensive computed properties

## Testing
- Component unit tests: Vitest + @vue/test-utils
- E2E: Playwright; one happy path per critical user flow
- Visual regression: Chromatic or percy.io for the design-system package

## i18n
- Use \`vue-i18n\` with key-based lookups (no inline strings)
- Locale files: \`locales/{en,cs,de}.json\`
- Date/number formatting: \`Intl\` API, never manual

## Error Handling
- Wrap async actions in try/catch; surface user-facing errors via toast
- Log unexpected errors to \`/api/errors\` with stack trace + breadcrumbs
- Never swallow errors silently
`;

const SKILL_SNAPSHOT_5 = [
  {
    id:      'skill:typescript-strict',
    name:    'TypeScript Strict Mode',
    rules:   [
      'No `any` without justification comment',
      'Prefer `unknown` over `any` for untyped inputs',
      'Use `satisfies` for literal types where inference matters',
      'Enable `noUncheckedIndexedAccess` in tsconfig',
    ],
    requiredMcpServers: [],
  },
  {
    id:      'skill:fastify-patterns',
    name:    'Fastify Best Practices',
    rules:   [
      'Use plugin pattern for shared services (decorate)',
      'Validate request bodies with Zod schema before handler',
      'Return typed responses; never `reply.send(any)`',
      'Use `request.requireUser()` for protected routes',
    ],
    requiredMcpServers: [],
  },
  {
    id:      'skill:postgres-pg',
    name:    'PostgreSQL with node-pg',
    rules:   [
      'Use parameterized queries; never string-interpolate values',
      'Wrap multi-statement work in `BEGIN`/`COMMIT` transactions',
      'Use `RETURNING` to avoid extra SELECT after INSERT/UPDATE',
      'Index foreign keys',
    ],
    requiredMcpServers: [],
  },
  {
    id:      'skill:bullmq-jobs',
    name:    'BullMQ Job Patterns',
    rules:   [
      'Idempotent job handlers — assume retry will happen',
      'Use `jobId` for deduplication',
      'Set explicit `attempts` and `backoff` per queue',
      'Persist business state in DB, not only in job data',
    ],
    requiredMcpServers: [],
  },
  {
    id:      'skill:zod-validation',
    name:    'Zod Schema Validation',
    rules:   [
      'Define schemas next to types they validate',
      'Use `.parse()` for hard validation, `.safeParse()` for soft',
      'Compose schemas with `.and()` / `.or()` instead of duplicating',
      'Use `z.discriminatedUnion` for tagged unions',
    ],
    requiredMcpServers: [],
  },
];

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL });

  const workspacePath = path.resolve('/tmp/orchestrator-workspaces/bench-project');

  console.log('▶ Seeding bench project at', workspacePath);

  // 1. Workspace directory tree
  await fs.mkdir(path.join(workspacePath, 'design-system'), { recursive: true });
  await fs.mkdir(path.join(workspacePath, 'src'),           { recursive: true });
  await fs.mkdir(path.join(workspacePath, 'sessions'),      { recursive: true });
  await fs.mkdir(path.join(workspacePath, '.opencode'),     { recursive: true });

  await fs.writeFile(path.join(workspacePath, 'design-system/frontend-rules.md'), FRONTEND_RULES, 'utf8');

  // Small fixture files (good for @file refs)
  await fs.writeFile(
    path.join(workspacePath, 'src/server.ts'),
    `import Fastify from 'fastify';\n\nconst app = Fastify({ logger: true });\napp.get('/healthz', async () => ({ status: 'ok' }));\nawait app.listen({ port: 3000 });\n`,
    'utf8',
  );

  await fs.writeFile(
    path.join(workspacePath, 'src/users.ts'),
    `import type { FastifyInstance } from 'fastify';\nimport { z } from 'zod';\n\nconst CreateUserSchema = z.object({ email: z.string().email(), name: z.string().min(1) });\n\nexport async function userRoutes(app: FastifyInstance): Promise<void> {\n  app.post('/users', async (req, reply) => {\n    const body = CreateUserSchema.parse(req.body);\n    return reply.status(201).send({ id: crypto.randomUUID(), ...body });\n  });\n}\n`,
    'utf8',
  );

  await fs.writeFile(
    path.join(workspacePath, 'src/db.ts'),
    `import { Pool } from 'pg';\n\nexport const pool = new Pool({ connectionString: process.env.DATABASE_URL });\n\nexport async function withTx<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {\n  const client = await pool.connect();\n  try {\n    await client.query('BEGIN');\n    const result = await fn(client);\n    await client.query('COMMIT');\n    return result;\n  } catch (err) {\n    await client.query('ROLLBACK');\n    throw err;\n  } finally {\n    client.release();\n  }\n}\n`,
    'utf8',
  );

  // Large fixture file — ~45 KB, near per-file cap (50 KB default).
  // Stress-tests truncation marker behaviour.
  const largeBlock = `// padding line to inflate file size for benchmark scenarios\n`;
  const largeContent =
    `export const PADDING_LINES_FOLLOW = true;\n\n` +
    largeBlock.repeat(700) +
    `\nexport const PADDING_LINES_END = true;\n`;
  await fs.writeFile(path.join(workspacePath, 'src/large-file.ts'), largeContent, 'utf8');

  console.log(`  ✓ workspace files written (large-file.ts ≈ ${Math.round(largeContent.length / 1024)} KB)`);

  // 2. Project row
  await pool.query(
    `INSERT INTO projects (id, name, organization_id, created_by, context_type, workspace_path, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE
       SET workspace_path = EXCLUDED.workspace_path,
           updated_at = NOW()`,
    [BENCH_IDS.project, 'bench-project', BOOTSTRAP_ORG, BOOTSTRAP_USER, 'personal', workspacePath],
  );
  console.log('  ✓ project row');

  // 3. Sessions
  // Main session
  await pool.query(
    `INSERT INTO sessions (id, project_id, context_type, status, user_prompt, total_cost_usd, budget_cap_usd, kind, parent_session_id, scope_globs, created_at, updated_at)
     VALUES ($1, $2, 'personal', 'active', 'Benchmark session', 0, 100, 'main', NULL, '[]'::jsonb, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
    [BENCH_IDS.sessionMain, BENCH_IDS.project],
  );

  // Branch session with scope_globs (~ 4 entries — typical real usage)
  await pool.query(
    `INSERT INTO sessions (id, project_id, context_type, status, user_prompt, total_cost_usd, budget_cap_usd, kind, parent_session_id, scope_globs, created_at, updated_at)
     VALUES ($1, $2, 'personal', 'active', 'Branch chat — auth refactor', 0, 100, 'branch', $3, $4::jsonb, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE
       SET scope_globs = EXCLUDED.scope_globs,
           updated_at  = NOW()`,
    [
      BENCH_IDS.sessionBranch,
      BENCH_IDS.project,
      BENCH_IDS.sessionMain,
      JSON.stringify([
        'src/auth/**',
        'src/middleware/auth*.ts',
        'tests/auth/**',
        'docs/auth-flow.md',
      ]),
    ],
  );

  // Per-session workspace dirs (worker expects them to exist as cwd).
  // We intentionally do NOT mirror project-root content here — design files
  // (e.g. design-system/frontend-rules.md) are read from the project root
  // by the worker. This catches regressions of that path-resolution fix.
  for (const sid of [BENCH_IDS.sessionMain, BENCH_IDS.sessionBranch]) {
    const sessionDir = path.join(workspacePath, 'sessions', sid);
    await fs.rm(sessionDir, { recursive: true, force: true });
    await fs.mkdir(sessionDir, { recursive: true });
  }
  console.log('  ✓ sessions (main + branch)');

  // 4. Custom agent_definition with skills snapshot (for "skill-heavy" scenario)
  await pool.query(
    `INSERT INTO agent_definitions (
        id, name, description, icon, agent_type, default_complexity, can_escalate_to,
        system_prompt, rules, skills, allowed_mcp_servers, allowed_tools,
        max_steps, timeout_minutes, triggers, is_built_in, is_active,
        created_by, created_at, updated_at
     )
     VALUES ($1, 'Bench Backend (5 skills)', 'Custom backend agent for benchmark — 5 skill snapshot',
             'database', 'backend', 'standard', 'expert',
             'You are a backend engineer.', $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb,
             30, 10, '{}'::jsonb, false, true,
             'bench', NOW(), NOW())
     ON CONFLICT (id) DO UPDATE
       SET skills     = EXCLUDED.skills,
           updated_at = NOW()`,
    [
      BENCH_IDS.customAgent,
      JSON.stringify([]),                          // rules
      JSON.stringify(SKILL_SNAPSHOT_5),            // skills (the variable bit)
      JSON.stringify([]),                          // allowed_mcp_servers
      JSON.stringify(['read_file', 'write_file', 'bash']), // allowed_tools
    ],
  );
  console.log('  ✓ custom agent (5 skills)');

  // 5. Cleanup any leftover bench tasks from prior runs
  const { rowCount } = await pool.query(
    `DELETE FROM agent_tasks WHERE session_id IN ($1, $2)`,
    [BENCH_IDS.sessionMain, BENCH_IDS.sessionBranch],
  );
  if (rowCount && rowCount > 0) {
    console.log(`  ✓ cleaned up ${rowCount} prior bench task rows`);
  }

  await pool.end();

  console.log('\n✅ Seed complete. IDs:');
  console.log(JSON.stringify(BENCH_IDS, null, 2));
}

// Allow direct execution; export IDs for reuse from harness.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err: unknown) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
