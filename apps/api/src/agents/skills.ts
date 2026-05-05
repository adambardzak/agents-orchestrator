import type { AgentSkill } from '@agent-orchestrator/shared';

/**
 * Built-in Skill Catalog
 *
 * Skills are reusable knowledge blocks that get injected into an agent's system
 * prompt at spawn time. Each skill adds:
 *  - A knowledge block (appended to system prompt)
 *  - Additional rules (merged with agent rules)
 *  - Required MCP servers (merged with allowed servers)
 */
export const SKILL_CATALOG: AgentSkill[] = [
  {
    id: 'skill:typescript-strict',
    name: 'TypeScript Strict',
    description: 'TypeScript strict mode patterns, type safety, no-any discipline.',
    knowledgeBlock: `### TypeScript Strict Mode Patterns

Always configure tsconfig with: "strict": true, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true.

Type narrowing: use type guards (typeof, instanceof, in), discriminated unions, and assertion functions.
Never use \`as T\` except when parsing JSON — always narrow properly.

Prefer:
  - \`unknown\` over \`any\` for external data
  - \`readonly\` arrays for function parameters
  - Const enums → union literal types (const STATUSES = ['a','b'] as const; type Status = typeof STATUSES[number])
  - \`satisfies\` operator to validate objects against types without widening
  - Template literal types for string patterns
  - Utility types: \`Partial\`, \`Required\`, \`Pick\`, \`Omit\`, \`ReturnType\`, \`Awaited\`

Zod validation: always parse external inputs (\`z.parse()\` or \`safeParse()\`), generate TypeScript types from schemas (\`z.infer<typeof schema>\`).`,
    requiredMcpServers: [],
    rules: [
      'NEVER use `any` — use `unknown` and narrow with type guards',
      'ALWAYS use Zod to parse external inputs',
      'Use discriminated unions for state modeling',
      'Prefer `readonly` for function parameters',
    ],
  },

  {
    id: 'skill:nuxt3-patterns',
    name: 'Nuxt 3 Patterns',
    description: 'Nuxt 3 composables, auto-imports, SSR/CSR, state management.',
    knowledgeBlock: `### Nuxt 3 Development Patterns

Auto-imports: all composables in \`composables/\`, components in \`components/\`, and utils in \`utils/\` are auto-imported. Never import them manually.

Composables: wrap state with \`useState\` for SSR-safe state. Use \`useAsyncData\` or \`useFetch\` for server-side data fetching — never \`onMounted\` + fetch for initial data.

Pages: \`definePageMeta\` for middleware, layout, and route meta. Use \`useRoute\`, \`useRouter\` from auto-imports.

Plugins: \`defineNuxtPlugin\` for app-wide setup. Return \`provide\` object for composable injection.

State: prefer Pinia stores for shared state (auto-imported via \`useXxxStore()\`). Use \`storeToRefs\` to keep reactivity when destructuring.

Performance: \`<LazyComponent>\` prefix for lazy loading. \`useLazyAsyncData\` for deferred loading. \`defineAsyncComponent\` for heavy components.

SSR considerations: \`import.meta.server\` / \`import.meta.client\` guards for platform-specific code. Never access browser APIs (window, document) at top level.`,
    requiredMcpServers: [],
    rules: [
      'NEVER manually import auto-imported composables/components',
      'Use useFetch/useAsyncData for initial data — NEVER onMounted + fetch',
      'Use useState for SSR-safe shared state',
      'Guard browser-only code with import.meta.client',
    ],
  },

  {
    id: 'skill:fastify-patterns',
    name: 'Fastify Patterns',
    description: 'Fastify plugins, decorators, schema validation, lifecycle hooks.',
    knowledgeBlock: `### Fastify Development Patterns

Plugin architecture: every feature is a plugin via \`fastify-plugin\` (fp). Plugins decorated with \`fp()\` share state with the parent scope; without \`fp()\` they are encapsulated.

Decorators: extend \`FastifyInstance\` via \`fastify.decorate()\`. Declare types in \`declare module 'fastify'\` interface augmentation.

Schema validation: define JSON Schema for request body, params, query, and response. Use \`Type\` from \`@sinclair/typebox\` for TypeScript-integrated schemas.

Lifecycle hooks: \`onRequest\` → \`preParsing\` → \`preValidation\` → \`preHandler\` → handler → \`preSerialization\` → \`onSend\`. Use \`addHook\` for cross-cutting concerns.

Error handling: use \`fastify.setErrorHandler()\` for global errors. Throw \`createError()\` from \`@fastify/error\` for structured errors. Reply with \`reply.status(N).send()\`.

Performance: register routes with \`schema\` option — Fastify uses fast-json-stringify for serialization. Avoid \`JSON.stringify\` manually.`,
    requiredMcpServers: [],
    rules: [
      'ALWAYS use fastify-plugin (fp) for shared decorators',
      'ALWAYS define JSON Schema for route inputs and outputs',
      'NEVER use JSON.stringify in route handlers — let Fastify serialize',
      'Use addHook for cross-cutting concerns (auth, logging)',
    ],
  },

  {
    id: 'skill:postgres-optimization',
    name: 'PostgreSQL Optimization',
    description: 'Query optimization, indexes, CTEs, EXPLAIN ANALYZE, connection pooling.',
    knowledgeBlock: `### PostgreSQL Query Optimization

Indexes: B-tree for equality/range, GIN for JSONB/arrays/full-text, partial indexes for filtered queries (\`WHERE active = true\`). Always index foreign keys and ORDER BY columns.

Query patterns:
  - Use CTEs (\`WITH\`) for readable multi-step queries
  - Prefer \`EXISTS\` over \`COUNT(*) > 0\` for existence checks
  - Use \`RETURNING *\` to avoid round-trips after INSERT/UPDATE
  - Batch inserts with \`INSERT INTO ... VALUES (...), (...)\` or COPY
  - Use \`ON CONFLICT DO UPDATE\` for upserts

EXPLAIN ANALYZE: run on any query fetching >1000 rows. Look for: Seq Scan on large tables (add index), Nested Loop with high loops (use Hash Join), high cost estimates.

Connection pooling: use pg Pool with max=10-20. Never create new Pool per request. Use \`pool.connect()\` for transactions, release with \`client.release()\` in finally.

Migrations: always reversible (include DOWN migration). Never drop columns in same migration as rename — do it in separate deploy.`,
    requiredMcpServers: ['postgres'],
    rules: [
      'ALWAYS add indexes for JOIN, WHERE, and ORDER BY columns',
      'NEVER create Pool per request — use the shared pool',
      'ALWAYS use parameterized queries — never string interpolation',
      'Run EXPLAIN ANALYZE for queries on tables >10k rows',
    ],
  },

  {
    id: 'skill:tailwind-design-system',
    name: 'Tailwind Design System',
    description: 'Tailwind utility-first patterns, design tokens, responsive design.',
    knowledgeBlock: `### Tailwind + Design System Patterns

Design tokens: ALWAYS use CSS custom properties from \`tokens.css\` via Tailwind config. Never hardcode hex colors or pixel values.

Utility composition: extract repeated utility combinations into components. Use \`@apply\` sparingly — only in base styles, never in component-scoped CSS.

Responsive: mobile-first with \`sm:\`, \`md:\`, \`lg:\`, \`xl:\` prefixes. Use \`container\` with \`mx-auto\` and \`px-4\`.

Dark mode: use \`dark:\` prefix variants. Base colors on semantic CSS variables (--color-bg, --color-text) that flip in dark mode.

Typography: use \`text-sm/base/lg/xl\` from scale — never arbitrary values like \`text-[15px]\`. Heading/body fonts from font-heading/font-body classes.

State styles: always define \`hover:\`, \`focus:\`, \`disabled:\`, \`active:\` states. Use \`ring\` utilities for focus indicators (not outline).

Spacing: use 4px base grid (p-1=4px, p-4=16px, p-8=32px). Never mix spacing systems.`,
    requiredMcpServers: [],
    rules: [
      'NEVER hardcode colors — use CSS variables from tokens.css',
      'ALWAYS define hover, focus, and disabled states',
      'Use responsive prefixes (sm:, md:, lg:) — never media queries in JS',
      'Extract repeated utilities into components, not @apply',
    ],
  },

  {
    id: 'skill:testing-patterns',
    name: 'Testing Patterns',
    description: 'Vitest unit tests, testing-library integration tests, test structure.',
    knowledgeBlock: `### Testing Patterns (Vitest + Testing Library)

Test structure: Arrange-Act-Assert. One assertion focus per test. Describe blocks for grouping related tests.

Naming: \`it('should [behavior] when [condition]')\`. Test behavior, not implementation.

Vitest specifics:
  - \`vi.fn()\` for mocks, \`vi.spyOn()\` for spies
  - \`vi.mock('./module')\` at top level for module mocks
  - \`beforeEach(() => vi.clearAllMocks())\` to reset state
  - Use \`expect.objectContaining()\` for partial object matching
  - \`vi.useFakeTimers()\` for date/timer tests

API testing: use Fastify's \`inject()\` for route testing without HTTP. Test status codes, response shapes, and error cases.

Database testing: use transactions rolled back after each test (\`BEGIN\` → test → \`ROLLBACK\`). Never mock the database — test against a real test DB.

Coverage: aim for >80% on business logic. Never test implementation details (private methods, internal state).`,
    requiredMcpServers: [],
    rules: [
      'Test behavior, not implementation',
      'Use inject() for Fastify route testing — never start a real server',
      'Roll back transactions after each DB test — never use mocks',
      'Clear all mocks in beforeEach',
    ],
  },

  {
    id: 'skill:git-conventional-commits',
    name: 'Conventional Commits',
    description: 'Conventional commits format, branch naming, PR conventions.',
    knowledgeBlock: `### Git Conventional Commits

Commit format: \`type(scope): description\`

Types:
  - \`feat\`: new feature
  - \`fix\`: bug fix
  - \`refactor\`: code change with no behavior change
  - \`test\`: adding/updating tests
  - \`docs\`: documentation only
  - \`chore\`: build, deps, tooling
  - \`perf\`: performance improvement
  - \`ci\`: CI/CD changes

Rules:
  - Description: imperative mood, lowercase, no period, max 72 chars
  - Body: explain WHY, not what (what is in the diff)
  - Breaking changes: add \`!\` after type or \`BREAKING CHANGE:\` in footer

Branch naming: \`type/brief-description\` (e.g. \`feat/user-auth\`, \`fix/login-redirect\`)

Commits should be atomic: one logical change per commit. If you can't summarize in 72 chars, split the commit.`,
    requiredMcpServers: ['git'],
    rules: [
      'ALWAYS use conventional commit format: type(scope): description',
      'Commits must be atomic — one logical change per commit',
      'Commit messages: imperative mood, max 72 chars, no period',
      'Branch names: type/brief-description',
    ],
  },

  {
    id: 'skill:bullmq-patterns',
    name: 'BullMQ Patterns',
    description: 'BullMQ job queue patterns, retry logic, dead-letter queues.',
    knowledgeBlock: `### BullMQ Queue Patterns

Job definition: use typed \`JobData\` interfaces. Always include idempotency keys (\`jobId\`) to prevent duplicate processing.

Retry strategy: exponential backoff (\`type: 'exponential', delay: 1000\`). Set \`attempts: 3\` for transient failures, \`attempts: 1\` for non-retriable jobs.

Concurrency: set \`concurrency\` on Worker based on resource constraints. Use \`limiter\` to rate-limit external API calls.

Events: listen to \`completed\`, \`failed\`, \`progress\` on Queue (not Worker) for cross-process observability.

Dead letter: use \`removeOnFail: false\` + monitor failed jobs. Implement \`onFailed\` handler for alerting.

Flow/dependencies: use \`FlowProducer\` for parent-child job dependencies. Children complete before parent.

Cleanup: \`removeOnComplete: { count: 100 }\` to prevent Redis memory growth. Run \`queue.obliterate()\` in tests.`,
    requiredMcpServers: [],
    rules: [
      'ALWAYS set jobId for idempotent job deduplication',
      'Use exponential backoff for retry strategy',
      'Set removeOnComplete to prevent Redis memory growth',
      'Listen to Queue events, not Worker events, for observability',
    ],
  },

  {
    id: 'skill:seo-gsc',
    name: 'SEO & Google Search Console',
    description:
      'Technical SEO best practices, structured data, Core Web Vitals, Google Search Console API integration.',
    knowledgeBlock: `### SEO & Google Search Console Patterns

**Technical SEO checklist:**
- Canonical URLs on every page (\`<link rel="canonical">\`)
- Structured data (JSON-LD) for articles, products, breadcrumbs, FAQ
- Open Graph + Twitter Card meta tags for social sharing
- Sitemap.xml with \`lastmod\` and \`priority\` — submit to GSC
- robots.txt: disallow staging/admin, allow crawl of public pages
- Hreflang for multilingual sites
- 301 redirects for changed URLs (never 302 for permanent changes)

**Core Web Vitals targets (good thresholds):**
- LCP (Largest Contentful Paint): < 2.5s
- INP (Interaction to Next Paint): < 200ms
- CLS (Cumulative Layout Shift): < 0.1

**Nuxt 3 SEO:**
\`\`\`typescript
// pages/article.vue
useSeoMeta({
  title: () => article.value.title,
  description: () => article.value.excerpt,
  ogTitle: () => article.value.title,
  ogImage: () => article.value.coverImage,
  twitterCard: 'summary_large_image',
})
useSchemaOrg([
  defineArticle({ headline: article.value.title, ... })
])
\`\`\`

**Google Search Console API (via @googleapis/searchconsole):**
- Authenticate with service account or OAuth2
- \`searchanalytics.query\`: get clicks/impressions by query, page, country, device
- Dimensions: \`query\`, \`page\`, \`country\`, \`device\`, \`date\`
- Date range: last 90 days max; data has 2–4 day lag
- Filter by site: \`siteUrl: 'sc-domain:example.com'\` (domain property) or \`'https://example.com/'\` (URL-prefix)
- Row limit: max 25,000 per request; use \`startRow\` for pagination
- Impressions threshold: queries with < 10 impressions are aggregated as "(other)"

**Common GSC queries:**
\`\`\`javascript
// Top 10 landing pages by clicks last 30 days
await gsc.searchanalytics.query({
  siteUrl, requestBody: {
    startDate: thirtyDaysAgo, endDate: yesterday,
    dimensions: ['page'], rowLimit: 10,
    orderby: [{ fieldName: 'clicks', sortOrder: 'DESCENDING' }]
  }
})

// CTR by query for specific page
await gsc.searchanalytics.query({
  siteUrl, requestBody: {
    startDate, endDate, dimensions: ['query'],
    dimensionFilterGroups: [{
      filters: [{ dimension: 'page', operator: 'contains', expression: '/blog/' }]
    }]
  }
})
\`\`\`

**Indexing issues:** use \`urlInspection.index.inspect\` API to check index status, coverage, and rich results.`,
    requiredMcpServers: ['shell'],
    rules: [
      'ALWAYS add canonical URLs and structured data to every public page',
      'Use JSON-LD for structured data — NOT microdata or RDFa',
      'Core Web Vitals: LCP < 2.5s, INP < 200ms, CLS < 0.1',
      'GSC API: date range max 90 days, data has 2-4 day lag',
      'ALWAYS paginate GSC queries — max 25,000 rows per request',
      'Use domain property (sc-domain:) for full-site data when possible',
    ],
  },
];

export function getSkillById(id: string): AgentSkill | undefined {
  return SKILL_CATALOG.find((s) => s.id === id);
}

export function getSkillsByIds(ids: string[]): AgentSkill[] {
  return ids.map((id) => getSkillById(id)).filter((s): s is AgentSkill => s !== undefined);
}
