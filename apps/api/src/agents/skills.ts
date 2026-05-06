import type { AgentSkill } from '@agent-orchestrator/shared';

/**
 * Built-in Skill Catalog
 *
 * Skills are reusable knowledge blocks that get injected into an agent's system
 * prompt at spawn time. Each skill adds:
 *  - A knowledge block (appended to system prompt)
 *  - Additional rules (merged with agent rules)
 *  - Required MCP servers (merged with allowed servers)
 *  - A coarse category for catalog grouping
 *  - An iconify id for visual identification
 *
 * Users can override a built-in by creating a custom skill with the same slug
 * (resulting in the same id `skill:<slug>`); the DB row wins in that case.
 */
export const SKILL_CATALOG: AgentSkill[] = [
  // ── Frontend ────────────────────────────────────────────────────────────
  {
    id: 'skill:typescript-strict',
    name: 'TypeScript Strict',
    description: 'TypeScript strict mode patterns, type safety, no-any discipline.',
    icon: 'i-ph-code-light',
    category: 'frontend',
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
    icon: 'i-ph-mountains-light',
    category: 'frontend',
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
    id: 'skill:vue3-composition',
    name: 'Vue 3 Composition API',
    description: 'Reactivity primitives, composables, lifecycle, script setup.',
    icon: 'i-ph-atom-light',
    category: 'frontend',
    knowledgeBlock: `### Vue 3 Composition API Patterns

\`<script setup lang="ts">\` is the preferred syntax — top-level bindings are auto-exposed to template, props/emits use compiler macros.

Reactivity:
  - \`ref()\` for primitives and replacements; access via \`.value\` in JS, auto-unwrapped in template
  - \`reactive()\` for objects (deep proxy) — never destructure (loses reactivity); use \`toRefs\`
  - \`computed()\` for derived state with caching; pass getter/setter for writable computeds
  - \`shallowRef\` / \`shallowReactive\` for large frozen data (e.g. third-party instances)

Watchers:
  - \`watch(source, cb)\` for explicit deps; supports arrays of sources
  - \`watchEffect()\` auto-tracks reactive reads inside the callback
  - \`{ immediate: true }\` to run on mount; \`{ flush: 'post' }\` after DOM update; \`{ deep: true }\` for nested

Props/emits (script setup):
  - \`const props = defineProps<{ foo: string; bar?: number }>()\`
  - \`const emit = defineEmits<{ change: [value: string] }>()\`
  - \`defineModel<T>()\` for two-way binding (Vue 3.4+)

Lifecycle: \`onMounted\`, \`onUnmounted\`, \`onUpdated\` from 'vue'. No this-context — use composables for shared logic.

Composables: pure functions named \`useXxx()\` returning reactive state + methods. Encapsulate side effects with \`onMounted\`/\`onUnmounted\`.`,
    requiredMcpServers: [],
    rules: [
      'ALWAYS use <script setup lang="ts"> — never Options API in new code',
      'NEVER destructure reactive() — use toRefs() or computed()',
      'Extract reusable logic into useXxx() composables',
      'Type props/emits via generic arguments to defineProps/defineEmits',
    ],
  },

  {
    id: 'skill:react-modern',
    name: 'React 18+ Patterns',
    description: 'Hooks, Server Components, Suspense, transitions, performance.',
    icon: 'i-ph-atom-light',
    category: 'frontend',
    knowledgeBlock: `### React 18+ Modern Patterns

Hooks rules: only call at top level of components/hooks; only call from React functions; rule names start with \`use\`.

State:
  - \`useState\` for local state; pass updater function for state derived from previous (\`setX(x => x + 1)\`)
  - \`useReducer\` for complex state with multiple sub-values or transitions
  - Lift state up; colocate state with consumers; never store derived data in state — compute it

Effects:
  - \`useEffect\` is for synchronizing with external systems, NOT for transformations (use derived values)
  - Always include all reactive deps; let \`react-hooks/exhaustive-deps\` lint
  - Cleanup function for subscriptions, timers, fetch abort controllers
  - \`useLayoutEffect\` only for DOM measurements before paint

Performance:
  - \`useMemo\` / \`useCallback\` only when measured benefit (referential equality crossing memo boundary)
  - \`memo()\` for components rendered with same props in hot lists
  - \`useTransition\` for non-urgent updates (filtering large lists), \`useDeferredValue\` to defer prop updates
  - \`startTransition\` outside components for marking updates as non-urgent

Server Components (RSC, Next.js App Router):
  - Default to server components; add \`'use client'\` only at the leaf where state/effects begin
  - Server components can be async — \`await fetch()\` directly; results stream via Suspense
  - Pass server data as props; never serialize functions across the boundary

Forms: \`useFormStatus\` for pending state, \`useActionState\` (React 19) for action results, \`useOptimistic\` for optimistic UI.`,
    requiredMcpServers: [],
    rules: [
      'NEVER store derived values in useState — compute or useMemo',
      'ALWAYS list all reactive deps in useEffect',
      'Default to server components in Next.js App Router; add "use client" at leaves',
      'Use useTransition / useDeferredValue for non-urgent updates',
    ],
  },

  {
    id: 'skill:tailwind-design-system',
    name: 'Tailwind Design System',
    description: 'Tailwind utility-first patterns, design tokens, responsive design.',
    icon: 'i-ph-paint-brush-light',
    category: 'frontend',
    knowledgeBlock: `### Tailwind + Design System Patterns

Design tokens: ALWAYS use CSS custom properties from \`tokens.css\` via Tailwind config. Never hardcode hex colors or pixel values.

Utility composition: extract repeated utility combinations into components. Use \`@apply\` sparingly — only in base styles, never in component-scoped CSS.

Responsive: mobile-first with \`sm:\`, \`md:\`, \`lg:\`, \`xl:\` prefixes. Use \`container\` with \`mx-auto\` and \`px-4\`.

Dark mode: use \`dark:\` prefix variants. Base colors on semantic CSS variables (--color-bg, --color-text) that flip in dark mode.

Typography: use \`text-sm/base/lg/xl\` from scale — never arbitrary values like \`text-[15px]\`. Heading/body fonts from font-heading/font-body classes.

State styles: always define \`hover:\`, \`focus:\`, \`disabled:\`, \`active:\` states. Use \`ring\` utilities for focus indicators (not outline).

Spacing: use 4px base grid (p-1=4px, p-4=16px, p-8=32px). Never mix spacing systems.

Tailwind v4 specifics: CSS-first config via \`@theme\` directive in CSS; \`@import "tailwindcss"\` replaces the three @tailwind directives; no PostCSS plugin needed.`,
    requiredMcpServers: [],
    rules: [
      'NEVER hardcode colors — use CSS variables from tokens.css',
      'ALWAYS define hover, focus, and disabled states',
      'Use responsive prefixes (sm:, md:, lg:) — never media queries in JS',
      'Extract repeated utilities into components, not @apply',
    ],
  },

  {
    id: 'skill:accessibility-wcag',
    name: 'Accessibility (WCAG 2.2)',
    description: 'Semantic HTML, ARIA, keyboard nav, screen reader patterns.',
    icon: 'i-ph-eye-light',
    category: 'frontend',
    knowledgeBlock: `### Accessibility (WCAG 2.2 AA)

Semantic HTML first — ARIA second. Use \`<button>\`, \`<a>\`, \`<nav>\`, \`<main>\`, \`<header>\`, \`<footer>\` for their meaning. Never \`<div onClick>\` for interactive elements.

Keyboard:
  - All interactive elements must be focusable (\`tabindex="0"\` only when needed; never positive tabindex)
  - Visible focus indicators with min 3:1 contrast (\`focus-visible:ring-2\`)
  - ESC closes modals/menus, arrow keys navigate within composite widgets (menubar, listbox, tabs)
  - Skip link as first focusable: \`<a href="#main">Skip to content</a>\`

Forms:
  - Every \`<input>\` has a \`<label>\` (use \`htmlFor\`/\`for\`); never rely on placeholder as label
  - Group related fields with \`<fieldset>\` + \`<legend>\`
  - Errors via \`aria-describedby\` linking to error message; \`aria-invalid="true"\` on bad fields
  - Required fields: \`required\` attribute + visual indicator (not just color)

Color & contrast:
  - Text: 4.5:1 (3:1 for >=18pt or 14pt bold); UI components and graphics: 3:1
  - Never use color alone to convey meaning — pair with icon or text

Screen readers:
  - \`<img alt="...">\` describes meaning (or empty \`alt=""\` if decorative)
  - Live regions: \`aria-live="polite"\` for status, \`"assertive"\` for errors
  - Hide decorative-only with \`aria-hidden="true"\`; visually hide but expose with \`.sr-only\` class

Motion: respect \`prefers-reduced-motion\` — disable parallax, autoplay, large transforms.

Testing: axe DevTools, Lighthouse a11y audit, manual keyboard pass, screen reader (VoiceOver/NVDA) on critical flows.`,
    requiredMcpServers: [],
    rules: [
      'Use semantic HTML elements before reaching for ARIA',
      'Every form input must have a programmatically associated label',
      'Visible focus indicator on all interactive elements (3:1 contrast min)',
      'Never convey meaning with color alone',
      'Respect prefers-reduced-motion',
    ],
  },

  // ── Backend ─────────────────────────────────────────────────────────────
  {
    id: 'skill:fastify-patterns',
    name: 'Fastify Patterns',
    description: 'Fastify plugins, decorators, schema validation, lifecycle hooks.',
    icon: 'i-ph-lightning-light',
    category: 'backend',
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
    id: 'skill:rest-api-design',
    name: 'REST API Design',
    description: 'Resource modeling, status codes, pagination, versioning, idempotency.',
    icon: 'i-ph-tree-structure-light',
    category: 'backend',
    knowledgeBlock: `### REST API Design Principles

Resource modeling:
  - Nouns, not verbs: \`/api/orders\` not \`/api/getOrders\`
  - Plural collection + singular id: \`GET /orders\`, \`GET /orders/:id\`
  - Hierarchy mirrors ownership: \`/orgs/:id/projects/:pid\`; flatten if non-trivial nesting

HTTP methods:
  - GET: safe + idempotent, never has body, never mutates
  - POST: create, non-idempotent (use Idempotency-Key header for retries)
  - PUT: full replace, idempotent
  - PATCH: partial update, idempotent
  - DELETE: idempotent (404 OR 204 on already-deleted is fine, be consistent)

Status codes (use the right one):
  - 200 OK with body / 204 No Content for empty success
  - 201 Created with \`Location\` header pointing to new resource
  - 400 Bad Request (validation), 401 Unauthorized (no auth), 403 Forbidden (auth but not allowed)
  - 404 Not Found, 409 Conflict (uniqueness), 422 Unprocessable Entity (semantic validation)
  - 429 Too Many Requests (with \`Retry-After\` header), 5xx for server errors only

Pagination:
  - Cursor-based for large/infinite lists: \`?cursor=xxx&limit=50\` → return \`{ items, nextCursor }\`
  - Offset only for small bounded lists or admin tables: \`?page=1&pageSize=20\`
  - Always return \`limit\` you actually used (caps protect server)

Versioning: URL prefix (\`/api/v1\`) is simplest; header-based (\`Accept: application/vnd.api.v2+json\`) is purer but harder to debug. Avoid breaking changes by adding fields, not removing.

Errors: return JSON \`{ error: { code, message, details? } }\`. Code is machine-readable enum, message is human, details is field-level for 400/422.

Authentication: prefer short-lived bearer tokens or session cookies (HttpOnly, Secure, SameSite=Lax). Never put tokens in URLs.

Idempotency: for POSTs that may be retried, accept \`Idempotency-Key\` header; store key + response for 24h; return same response for repeat key.`,
    requiredMcpServers: [],
    rules: [
      'Use plural nouns for collections; singular for items by id',
      'Match HTTP method semantics: GET safe, PUT/PATCH/DELETE idempotent',
      'Cursor pagination for large lists; never load unbounded data',
      'Return structured error objects with stable error codes',
      'Accept Idempotency-Key on retriable POST endpoints',
    ],
  },

  {
    id: 'skill:bullmq-patterns',
    name: 'BullMQ Patterns',
    description: 'BullMQ job queue patterns, retry logic, dead-letter queues.',
    icon: 'i-ph-queue-light',
    category: 'backend',
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
    id: 'skill:python-typing',
    name: 'Modern Python Typing',
    description: 'Type hints, Pydantic, async patterns, packaging.',
    icon: 'i-ph-snake-light',
    category: 'backend',
    knowledgeBlock: `### Modern Python Patterns (3.11+)

Typing:
  - Always type hints on public functions (\`def f(x: int) -> str:\`)
  - PEP 604 union syntax: \`int | None\` (drop \`Optional[]\`/\`Union[]\` in new code)
  - \`TypedDict\` for structured dicts; \`dataclass\` or Pydantic \`BaseModel\` for objects
  - \`Self\` (PEP 673) for fluent return types; \`Never\` for unreachable
  - Generic syntax: PEP 695 (\`def first[T](xs: list[T]) -> T:\`) on 3.12+

Pydantic v2:
  - \`BaseModel\` with \`model_config = ConfigDict(frozen=True)\` for immutable DTOs
  - \`@field_validator('x')\` and \`@model_validator(mode='after')\` for validation
  - \`.model_dump()\` / \`.model_dump_json()\` instead of \`.dict()\`/\`.json()\`
  - \`TypeAdapter\` for ad-hoc validation outside models

Async:
  - \`asyncio.TaskGroup\` (3.11+) for structured concurrency — replaces \`gather()\` boilerplate
  - \`asyncio.timeout()\` context manager for cancellation
  - Never call sync blocking I/O from async — use \`asyncio.to_thread()\` or aiohttp/httpx

Packaging:
  - \`pyproject.toml\` is the single source of truth (PEP 621)
  - Use \`uv\` or \`pdm\` for fast resolver; \`ruff\` for lint+format (replaces flake8/black/isort)
  - Lock dependencies (\`uv.lock\`, \`pdm.lock\`) — commit them

Errors: derive custom exceptions from \`Exception\`; chain with \`raise X from y\` to preserve cause.`,
    requiredMcpServers: [],
    rules: [
      'ALWAYS add type hints on public functions',
      'Use PEP 604 union syntax (X | None) over Optional[X]',
      'Use asyncio.TaskGroup for structured concurrency on 3.11+',
      'pyproject.toml is the single source of truth — no setup.py',
      'Use ruff for lint+format; never mix multiple tools',
    ],
  },

  // ── Database ────────────────────────────────────────────────────────────
  {
    id: 'skill:postgres-optimization',
    name: 'PostgreSQL Optimization',
    description: 'Query optimization, indexes, CTEs, EXPLAIN ANALYZE, connection pooling.',
    icon: 'i-ph-database-light',
    category: 'database',
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
    id: 'skill:drizzle-orm',
    name: 'Drizzle ORM',
    description: 'Type-safe SQL with Drizzle, schema, migrations, relations.',
    icon: 'i-ph-database-light',
    category: 'database',
    knowledgeBlock: `### Drizzle ORM Patterns

Schema definition:
\`\`\`typescript
import { pgTable, uuid, text, timestamp, integer, boolean, jsonb } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id:        uuid('id').primaryKey().defaultRandom(),
  email:     text('email').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
\`\`\`

Relations: define with \`relations()\` helper for type-safe joins via \`with: { ... }\`.

Queries:
  - \`db.select().from(users).where(eq(users.id, id)).limit(1)\` — explicit and SQL-shaped
  - \`db.query.users.findFirst({ where: eq(...), with: { posts: true } })\` — relational query API
  - Always use prepared statements for hot queries (\`.prepare('name')\`)

Migrations:
  - \`drizzle-kit generate\` produces SQL files in \`drizzle/\` — always commit
  - \`drizzle-kit push\` only for prototyping — never in CI/prod
  - \`drizzle-kit migrate\` runs SQL files in order; track applied via \`__drizzle_migrations\` table

Transactions: \`await db.transaction(async (tx) => { ... })\` — pass \`tx\` to all calls inside; throw to roll back.

Type inference: \`type User = typeof users.$inferSelect\`; \`type NewUser = typeof users.$inferInsert\`.

Don'ts: never \`db.select().from(table)\` without \`limit\` on large tables; never construct WHERE strings — use \`eq\`, \`and\`, \`or\`, \`inArray\`, \`like\` builders.`,
    requiredMcpServers: ['postgres'],
    rules: [
      'NEVER use drizzle-kit push in CI/production — generate + migrate only',
      'ALWAYS commit generated migration SQL files',
      'Use prepared statements for queries on hot paths',
      'Use the relational query API (db.query.x.findX) for nested data',
    ],
  },

  {
    id: 'skill:prisma-orm',
    name: 'Prisma ORM',
    description: 'Schema-first ORM, migrations, type-safe queries, performance.',
    icon: 'i-ph-database-light',
    category: 'database',
    knowledgeBlock: `### Prisma ORM Patterns

Schema (\`schema.prisma\`):
\`\`\`prisma
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  posts     Post[]
  createdAt DateTime @default(now())
  @@index([createdAt])
}
\`\`\`

Migrations:
  - \`prisma migrate dev --name xxx\` for local dev (creates SQL + applies)
  - \`prisma migrate deploy\` in CI/prod — applies pending migrations only
  - Never \`prisma db push\` outside prototyping

Queries:
  - Avoid N+1 with \`include\` or \`select\` for nested relations
  - \`select\` to fetch only required fields (huge perf win)
  - \`take\` for pagination, \`cursor\` for keyset pagination on large lists
  - \`prisma.$transaction([...])\` for atomic batch ops; \`$transaction(async tx => {})\` for interactive

Performance:
  - Connection pooling via PgBouncer or Prisma Accelerate (serverless) — set \`?pgbouncer=true&connection_limit=1\` for serverless
  - Use \`prisma.$queryRaw\` for complex queries with index hints
  - Beware of \`findMany\` without \`take\` — always paginate

Type generation: \`prisma generate\` after every schema change. Output goes to \`@prisma/client\`. Commit \`schema.prisma\` and migrations; never commit generated client.

Soft deletes: model with \`deletedAt: DateTime?\` + middleware filtering — Prisma has no built-in soft delete.`,
    requiredMcpServers: [],
    rules: [
      'ALWAYS use select to limit fetched fields on large rows',
      'NEVER findMany without take/cursor — paginate everything',
      'Use prisma migrate (not db push) for any tracked environment',
      'Avoid N+1: use include/select for nested data, never loop with findUnique',
    ],
  },

  // ── DevOps ──────────────────────────────────────────────────────────────
  {
    id: 'skill:docker-compose',
    name: 'Docker & Compose',
    description: 'Multi-stage builds, image layering, Compose for local dev, healthchecks.',
    icon: 'i-ph-cube-light',
    category: 'devops',
    knowledgeBlock: `### Docker & Docker Compose Patterns

Dockerfile:
  - Multi-stage builds: \`FROM node:20 AS build\` → \`FROM node:20-slim AS runtime\`; copy only artifacts
  - Pin base image versions (\`node:20.11.0-alpine\`) — never \`:latest\` in production
  - Order layers from least to most frequently changing: \`COPY package.json\` → \`RUN install\` → \`COPY src\`
  - Run as non-root: \`USER node\` after install
  - Use \`.dockerignore\` (node_modules, .git, dist, .env)
  - \`HEALTHCHECK\` for container orchestrators
  - Single process per container; \`CMD ["node", "server.js"]\` (exec form, not shell)

docker-compose.yml:
  - Use \`depends_on\` with \`condition: service_healthy\` to gate startup
  - Named volumes for stateful data (\`pgdata:/var/lib/postgresql/data\`); bind mounts only for dev source
  - Networks: explicit named networks > default \`bridge\`
  - \`restart: unless-stopped\` for services that should survive reboots
  - Env files: \`env_file: .env\` for non-secret config; secrets via Docker secrets or external vault

Image size:
  - Use \`-slim\` or \`-alpine\` base images when possible
  - Combine RUN steps with \`&&\` and clean caches: \`apt-get update && apt-get install -y x && rm -rf /var/lib/apt/lists/*\`
  - Scan with Trivy or Snyk; remove dev dependencies in final stage

BuildKit: enable with \`DOCKER_BUILDKIT=1\` for parallel builds, cache mounts (\`RUN --mount=type=cache,target=/root/.npm\`), and secrets (\`--mount=type=secret\`).`,
    requiredMcpServers: [],
    rules: [
      'ALWAYS use multi-stage builds for compiled languages',
      'NEVER use :latest tag — pin specific versions',
      'Run containers as non-root user',
      'Use HEALTHCHECK + depends_on condition for ordered startup',
      'Single process per container — no init scripts spawning multiple services',
    ],
  },

  {
    id: 'skill:kubernetes-basics',
    name: 'Kubernetes Basics',
    description: 'Pods, Deployments, Services, ConfigMaps, Secrets, Ingress.',
    icon: 'i-ph-network-light',
    category: 'devops',
    knowledgeBlock: `### Kubernetes Workload Patterns

Core resources:
  - **Pod**: smallest unit; one+ containers sharing network/volumes. Don't create directly — use a controller.
  - **Deployment**: declarative rolling updates for stateless apps; manages ReplicaSets.
  - **StatefulSet**: stable identity + ordered startup for stateful apps (DBs).
  - **DaemonSet**: one pod per node (logging, monitoring agents).
  - **Job / CronJob**: run-to-completion / scheduled tasks.

Service types:
  - **ClusterIP**: internal only (default)
  - **NodePort**: exposes on each node IP at static port (rarely used directly)
  - **LoadBalancer**: cloud LB pointing at the service
  - **ExternalName**: DNS CNAME to external host

Config & secrets:
  - **ConfigMap**: non-secret config; mount as files or env vars
  - **Secret**: base64-encoded sensitive data; ALWAYS use a real secrets manager (Sealed Secrets, External Secrets, Vault) in production
  - Never bake secrets into images

Resource limits & requests:
  - \`requests\`: scheduler reservation (always set)
  - \`limits\`: hard cap; CPU throttles, memory OOMKills
  - Set both for production workloads; ratio of limits:requests determines QoS class

Health probes:
  - **livenessProbe**: restart pod if failing (only for stuck-process detection)
  - **readinessProbe**: remove from Service endpoints if failing (use for dependency checks)
  - **startupProbe**: gate liveness/readiness during slow startup

Networking: NetworkPolicy for ingress/egress rules; Ingress controller (nginx, Traefik) for HTTP routing.

Rolling update strategy: \`maxSurge\` and \`maxUnavailable\` control rollout speed. Use PodDisruptionBudget for graceful drains.

GitOps: declare desired state in Git; reconcile with ArgoCD or Flux. Never \`kubectl apply\` ad-hoc in production.`,
    requiredMcpServers: [],
    rules: [
      'NEVER create Pods directly — use Deployment/StatefulSet/Job controllers',
      'ALWAYS set both resource requests and limits for production workloads',
      'Use readinessProbe to gate traffic; livenessProbe only for hung-process recovery',
      'Use a real secrets manager in production — k8s Secret alone is base64, not encrypted',
      'Manage cluster state via GitOps (ArgoCD/Flux), not kubectl apply',
    ],
  },

  // ── Testing ─────────────────────────────────────────────────────────────
  {
    id: 'skill:testing-patterns',
    name: 'Testing Patterns',
    description: 'Vitest unit tests, testing-library integration tests, test structure.',
    icon: 'i-ph-test-tube-light',
    category: 'testing',
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
    id: 'skill:playwright-e2e',
    name: 'Playwright E2E',
    description: 'End-to-end tests with Playwright: locators, fixtures, network, parallelism.',
    icon: 'i-ph-play-circle-light',
    category: 'testing',
    knowledgeBlock: `### Playwright E2E Patterns

Locators (the right way to find elements):
  - Prefer user-facing locators: \`getByRole\`, \`getByLabel\`, \`getByPlaceholder\`, \`getByText\`
  - \`getByTestId('foo')\` only when nothing else fits — couples test to implementation
  - NEVER CSS selectors like \`.btn-primary\` for tests; they break on refactor
  - Locators auto-wait — no \`waitForSelector\` needed before \`.click()\`

Assertions:
  - \`await expect(page.getByRole('button')).toBeVisible()\` — auto-retries with timeout
  - \`expect.poll()\` for non-locator state polling
  - Soft assertions: \`expect.soft(...)\` continues on fail (group related checks)

Fixtures:
  - \`test.extend\` for project-specific fixtures (logged-in user, seeded DB, etc.)
  - \`test.beforeEach\` runs in same worker; use fixtures over beforeEach for cleaner isolation

Network:
  - \`page.route()\` to mock/modify requests: \`page.route('**/api/x', r => r.fulfill({ body: '{}' }))\`
  - \`page.waitForResponse(/\\/api\\/foo/)\` to assert/extract API responses

Parallelism:
  - Each test file runs in its own worker by default; use \`test.describe.configure({ mode: 'serial' })\` for shared state
  - \`fullyParallel: true\` in config to parallelize within files too
  - \`storageState\` to share auth across tests without re-login

Tracing & debugging:
  - \`--trace on\` in CI to capture trace.zip for failures (open with \`npx playwright show-trace\`)
  - \`--ui\` mode for local dev — time-travel through actions
  - \`page.pause()\` drops into Playwright Inspector

CI:
  - Use official Docker image (\`mcr.microsoft.com/playwright:v1.x.x-jammy\`) with browsers pre-installed
  - Shard tests across machines: \`--shard 1/4\``,
    requiredMcpServers: [],
    rules: [
      'ALWAYS use user-facing locators (getByRole/getByLabel/getByText) over CSS selectors',
      'Locators auto-wait — never add manual waitForSelector before actions',
      'Use storageState fixtures to skip login in tests that need auth',
      'Enable --trace on in CI for post-mortem debugging',
    ],
  },

  // ── Security ────────────────────────────────────────────────────────────
  {
    id: 'skill:oauth-flows',
    name: 'OAuth 2.1 / OIDC',
    description: 'Authorization Code + PKCE, refresh tokens, OIDC ID tokens, security pitfalls.',
    icon: 'i-ph-shield-check-light',
    category: 'security',
    knowledgeBlock: `### OAuth 2.1 + OpenID Connect

Use **Authorization Code + PKCE** for all clients (SPAs, native, server). Implicit flow is dead — never use it. Resource Owner Password Credentials is dead too.

Flow (browser-based):
1. Client generates \`code_verifier\` (random 43-128 char string) → \`code_challenge = base64url(sha256(code_verifier))\`
2. Redirect to authorize endpoint with: \`response_type=code\`, \`client_id\`, \`redirect_uri\`, \`code_challenge\`, \`code_challenge_method=S256\`, \`state\`, \`scope\`
3. User authenticates → IdP redirects back with \`?code=xxx&state=yyy\`
4. Validate \`state\` matches what you sent (CSRF protection)
5. POST to token endpoint with \`code\`, \`code_verifier\`, \`client_id\`, \`redirect_uri\` → get \`access_token\` + \`refresh_token\` + (OIDC) \`id_token\`

Token storage:
  - **Server-side sessions** (HttpOnly Secure SameSite=Lax cookie) — best for first-party web apps
  - **Memory only** for SPAs that absolutely need client-side tokens; refresh in iframe via silent renewal
  - **NEVER localStorage** for access tokens — XSS exfiltration risk

OIDC ID tokens (JWT):
  - Validate signature against IdP JWKS (\`jwks_uri\` from \`/.well-known/openid-configuration\`)
  - Verify \`iss\`, \`aud\`, \`exp\`, \`nonce\` (matches what you sent in auth request)
  - ID token = identity assertion; access token = API authorization. Don't confuse them.

Refresh tokens:
  - Rotate on every use (server returns new RT, invalidates old)
  - Bind to client + use one-time-use detection to catch leaks
  - Long-lived only with refresh token rotation; otherwise short like access tokens

Scopes: minimal least-privilege. \`openid\` required for OIDC; \`offline_access\` for refresh tokens; custom scopes for resource-specific permissions.

PKCE for confidential clients too (defense in depth) — RFC 9700 (OAuth 2.1) requires it for everyone.

Common mistakes:
  - Skipping \`state\` validation → CSRF
  - Not validating ID token signature → identity spoofing
  - Putting tokens in URLs → leak via referrer/logs
  - Using implicit flow → token in fragment, no client auth`,
    requiredMcpServers: [],
    rules: [
      'ALWAYS use Authorization Code + PKCE — never implicit flow',
      'ALWAYS validate state parameter on callback (CSRF protection)',
      'Store access tokens in HttpOnly cookies, never localStorage',
      'Validate ID token signature, iss, aud, exp, nonce',
      'Rotate refresh tokens on every use with one-time-use detection',
    ],
  },

  {
    id: 'skill:security-headers',
    name: 'Web Security Headers',
    description: 'CSP, HSTS, COOP/COEP, X-Frame-Options, secure cookies.',
    icon: 'i-ph-lock-light',
    category: 'security',
    knowledgeBlock: `### Web Security Headers Cheatsheet

**Content-Security-Policy (CSP)** — strongest XSS defense:
  - Strict starting point: \`default-src 'self'; script-src 'self' 'strict-dynamic' 'nonce-{random}'; object-src 'none'; base-uri 'self'\`
  - Nonce-based or hash-based — never \`'unsafe-inline'\` for scripts
  - Use \`Report-To\` + \`report-uri\` to collect violations before enforcing

**Strict-Transport-Security (HSTS)**: \`max-age=63072000; includeSubDomains; preload\` — 2 years, all subdomains, eligible for browser preload list.

**X-Content-Type-Options**: \`nosniff\` (always; prevents MIME sniffing).

**Referrer-Policy**: \`strict-origin-when-cross-origin\` (sensible default; sends origin to cross-origin, full URL same-origin).

**Permissions-Policy**: lock down powerful features you don't use: \`geolocation=(), microphone=(), camera=()\`.

**X-Frame-Options**: \`DENY\` (or use CSP \`frame-ancestors\` which is more flexible).

**Cross-Origin-* (for SharedArrayBuffer / cross-origin isolation)**:
  - \`Cross-Origin-Opener-Policy: same-origin\`
  - \`Cross-Origin-Embedder-Policy: require-corp\`
  - \`Cross-Origin-Resource-Policy: same-origin\` (on responses)

**Cookies**:
  - \`HttpOnly\`: not accessible to JS (always for auth cookies)
  - \`Secure\`: HTTPS only (always)
  - \`SameSite=Lax\` (or \`Strict\` for sensitive); \`None\` requires \`Secure\` and is for cross-site flows
  - \`__Host-\` prefix for tightest binding (no Domain attr, must be Secure + Path=/)

**CORS**: \`Access-Control-Allow-Origin\` should NEVER be \`*\` for credentialed requests — echo the validated origin and \`Vary: Origin\`.

Test with: SecurityHeaders.com, Mozilla Observatory, browser DevTools network panel.`,
    requiredMcpServers: [],
    rules: [
      'ALWAYS set Content-Security-Policy — never rely on input sanitization alone',
      'NEVER use unsafe-inline in script-src — use nonces or hashes',
      'Auth cookies: HttpOnly + Secure + SameSite=Lax (or Strict)',
      'CORS: never wildcard for credentialed requests; echo validated origin + Vary: Origin',
      'Enable HSTS with includeSubDomains for production HTTPS sites',
    ],
  },

  // ── Tooling ─────────────────────────────────────────────────────────────
  {
    id: 'skill:git-conventional-commits',
    name: 'Conventional Commits',
    description: 'Conventional commits format, branch naming, PR conventions.',
    icon: 'i-ph-git-commit-light',
    category: 'tooling',
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

  // ── AI / LLM ────────────────────────────────────────────────────────────
  {
    id: 'skill:llm-prompting',
    name: 'LLM Prompting & Tool Use',
    description: 'Structured prompts, function/tool calling, RAG, output parsing.',
    icon: 'i-ph-brain-light',
    category: 'ai-llm',
    knowledgeBlock: `### LLM Prompting & Tool Use

**System prompt structure** (top-down priority):
1. Role / persona — one sentence
2. Hard rules (never/always) — bullet list, capitalized verbs
3. Capabilities & tools available
4. Output format spec (JSON schema, markdown structure)
5. Few-shot examples (input → output pairs)
6. Context (RAG retrievals, memory) — last so it's most recent in attention

**Tool / function calling**:
  - Declare tools with JSON Schema; let the model pick + supply args
  - Validate args against schema before execution; fail fast with structured error back to model
  - Loop: model proposes tool call → execute → return result → model decides next step or final answer
  - Cap iterations (e.g. max 10) to avoid runaway loops
  - Make tool descriptions verb-first and concrete: "Searches the codebase for files matching a glob pattern" not "Searches"

**Structured output**:
  - Prefer provider-native structured output (OpenAI \`response_format: { type: 'json_schema' }\`, Anthropic tool-use)
  - Validate with Zod after parsing — never trust the model to follow schema perfectly
  - For Anthropic: define a single tool whose input_schema is your output schema; force \`tool_choice\`

**RAG (retrieval-augmented generation)**:
  - Chunk by semantic boundaries (paragraphs, headings) not fixed token windows
  - Embed with the same model used at query time
  - Re-rank top-N with a cross-encoder for quality
  - Inject retrievals as \`<context>...</context>\` before user message; cite by id in answer
  - Always include "If the context doesn't contain the answer, say you don't know" — reduces hallucination

**Token economy**:
  - Cache long static prompts (Anthropic prompt caching, OpenAI prompt caching)
  - Strip irrelevant code/whitespace from context — every token costs latency + money
  - Prefer streaming for UX (\`stream: true\`); aggregate tool calls until completion

**Evaluation**: golden-set tests with deterministic assertions (regex, JSON parse, semantic similarity threshold). Track latency, cost, and accuracy per release.`,
    requiredMcpServers: [],
    rules: [
      'ALWAYS validate model output with Zod (or equivalent) — never trust schema adherence',
      'Cap tool-use loop iterations to prevent runaway agents',
      'Use provider-native structured output APIs over prompt-engineered JSON',
      'In RAG, instruct the model to say "I don\'t know" when context is insufficient',
      'Cache long static prompts to cut latency and cost',
    ],
  },

  // ── SEO ─────────────────────────────────────────────────────────────────
  {
    id: 'skill:seo-gsc',
    name: 'SEO & Google Search Console',
    description:
      'Technical SEO best practices, structured data, Core Web Vitals, Google Search Console API integration.',
    icon: 'i-ph-magnifying-glass-light',
    category: 'seo',
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

  // ── Backend / Event-driven ──────────────────────────────────────────────
  {
    id: 'skill:kafka-patterns',
    name: 'Kafka Producer/Consumer Patterns',
    description: 'KafkaJS producer/consumer setup, partitioning, idempotence, dead-letter queues, exactly-once semantics.',
    icon: 'i-ph-broadcast-light',
    category: 'backend',
    knowledgeBlock: `### Kafka Producer/Consumer Patterns (Node.js + KafkaJS)

#### Producer

Always create the client with explicit \`clientId\` (visible in broker logs/metrics) and \`brokers\` array. Use \`ssl\` + \`sasl\` blocks for production — never connect cleartext to a non-localhost broker.

Idempotent producer (REQUIRED for exactly-once-ish):
\`\`\`ts
const producer = kafka.producer({
  idempotent: true,           // dedup retries within a producer session
  maxInFlightRequests: 5,     // safe with idempotence
  transactionalId: undefined, // set only if using transactions
});
\`\`\`

Partitioning rules:
- ALWAYS set a deterministic \`key\` for messages that must keep order (entity id, user id, trade id). Without a key, messages round-robin and ordering is lost.
- Same key → same partition → ordered consumption per partition.
- For random/parallel work (telemetry, logs), omit key — broker round-robins.

Batching: \`producer.send({ topic, messages: [...] })\` accepts an array. Prefer batches over per-message sends to amortize network overhead.

Error handling:
- \`acks: -1\` (all in-sync replicas) for durability — default in newer KafkaJS.
- Retries: KafkaJS retries automatically on transient errors. For business errors (schema validation), DO NOT retry — log + push to DLQ.
- ALWAYS \`await producer.connect()\` before \`send\`. Do it once at startup, reuse the producer instance.
- ALWAYS \`producer.disconnect()\` on graceful shutdown (SIGTERM handler).

#### Consumer

Group ID semantics: each \`groupId\` is an independent stream cursor. Multiple consumer processes with the same groupId share partitions (scale-out). Different groupIds get the same messages independently (fan-out).

\`\`\`ts
const consumer = kafka.consumer({
  groupId: 'orders-processor',
  sessionTimeout: 30000,        // member dead if no heartbeat in 30s
  heartbeatInterval: 3000,      // send heartbeat every 3s
  maxWaitTimeInMs: 5000,        // max wait per fetch
});
await consumer.connect();
await consumer.subscribe({ topic: 'orders', fromBeginning: false });
\`\`\`

\`fromBeginning\`:
- \`true\` for new groupIds → reads entire history. ONLY for backfills.
- \`false\` (default) → reads from current offset. Standard for live processing.

Manual vs auto commit:
- DEFAULT: KafkaJS auto-commits after \`eachMessage\` returns successfully.
- For at-least-once with manual control:
  \`\`\`ts
  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message }) => {
      await processMessage(message);
      await consumer.commitOffsets([{ topic, partition, offset: (Number(message.offset) + 1).toString() }]);
    },
  });
  \`\`\`
- NEVER commit before processing succeeds — you'll lose messages on crash.

#### Dead-letter pattern

For poison messages (parse errors, repeated business failures):
\`\`\`ts
try {
  const order = OrderSchema.parse(JSON.parse(message.value!.toString()));
  await processOrder(order);
} catch (err) {
  await dlqProducer.send({
    topic: 'orders.dlq',
    messages: [{
      key: message.key,
      value: message.value,
      headers: {
        ...message.headers,
        'x-original-topic': topic,
        'x-error': String(err),
        'x-failed-at': new Date().toISOString(),
      },
    }],
  });
  // commit to skip — DLQ owns the message now
}
\`\`\`

#### Schema management

For typed payloads use Confluent Schema Registry (Avro/Protobuf) OR enforce Zod schemas at producer + consumer boundaries. NEVER trust raw JSON across services without validation.

#### Common pitfalls

- Forgetting to handle \`CRASH\` event: \`consumer.on(consumer.events.CRASH, (e) => { logger.fatal(e); process.exit(1); });\`
- Long-running \`eachMessage\` blocks heartbeats → rebalance storm. Either keep handlers fast (<5s) or extend \`sessionTimeout\` and use \`pause()\`/\`resume()\` for backpressure.
- Topic auto-create in dev hides config drift in prod. Pre-create topics with explicit partitions + retention.
- Mixing keyed and unkeyed messages on the same topic breaks ordering guarantees consumers expect.

DO NOT:
- DO NOT use Kafka as a request/response RPC channel — it's an append-only log.
- DO NOT process messages in parallel within a partition without losing ordering. Use \`partitionsConsumedConcurrently\` only across DIFFERENT partitions.
- DO NOT store secrets in headers — they're plaintext.
- DO NOT skip ACL/SASL config in prod just because the broker is "internal".`,
    requiredMcpServers: [],
    rules: [
      'ALWAYS set a deterministic message key when ordering matters',
      'ALWAYS use idempotent: true on producers',
      'NEVER commit consumer offset before message processing succeeds',
      'ALWAYS implement DLQ pattern for poison messages',
      'NEVER use Kafka as request/response RPC',
      'ALWAYS validate message payloads with Zod (or schema registry) at consumer boundary',
      'Keep eachMessage handlers under 5s; use pause()/resume() for backpressure',
    ],
  },

  // ── Database / Vector search ────────────────────────────────────────────
  {
    id: 'skill:pgvector-rag',
    name: 'pgvector RAG Patterns',
    description: 'Postgres pgvector index choice (IVFFlat vs HNSW), embedding storage, hybrid search, distance operators.',
    icon: 'i-ph-vector-three-light',
    category: 'database',
    knowledgeBlock: `### pgvector RAG Patterns

#### Storage

Column type: \`vector(N)\` where N is the embedding dimension. ALWAYS hard-code N to match your model — mismatched dims throw at INSERT, not migration time.

Common dimensions:
- OpenAI text-embedding-3-small: 1536 (default, can be reduced)
- OpenAI text-embedding-3-large: 3072
- Voyage voyage-3-lite: 512
- Cohere embed-multilingual-v3: 1024
- BGE-M3: 1024

Schema:
\`\`\`sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE chunks (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id    UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ord       INT  NOT NULL,
  text      TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  metadata  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
\`\`\`

#### Distance operators

- \`<->\` L2 / Euclidean
- \`<#>\` negative inner product (use for normalized vectors → equivalent to cosine, faster)
- \`<=>\` cosine distance (1 - cosine_similarity)

For OpenAI / most LLM embeddings (already L2-normalized), \`<=>\` and \`<#>\` give equivalent rankings; \`<#>\` is marginally faster.

Convert distance to similarity score for UI: \`(1 - (embedding <=> query_vec))\` returns 0..1 cosine similarity.

#### Index choice — the critical decision

\`\`\`
                      | IVFFlat                  | HNSW
----------------------+--------------------------+--------------------------
Build time            | Fast (~1s/100k rows)     | Slow (~30s/100k rows)
Build memory          | Low                      | High
Query speed           | Fast                     | Faster (2-3x)
Recall                | Good (tune lists/probes) | Excellent
Updates after build   | Recall degrades          | Stable
Add rows post-build   | Cheap                    | Expensive (full rebuild
                      |                          | quality, but online)
Best for              | Static / batch-rebuilt   | Live / continuous updates
\`\`\`

**Default choice: HNSW.** Use IVFFlat only if (a) you have >5M vectors AND (b) you can rebuild on a schedule.

\`\`\`sql
-- HNSW (recommended for most cases)
CREATE INDEX chunks_embedding_hnsw
  ON chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- IVFFlat (large corpora, infrequent updates)
-- lists = sqrt(N) is a reasonable starting point for N < 1M
-- lists = N/1000 for N > 1M
CREATE INDEX chunks_embedding_ivfflat
  ON chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
\`\`\`

#### Query-time tuning

HNSW: \`SET hnsw.ef_search = 40;\` (default 40, raise for better recall, lower for speed)
IVFFlat: \`SET ivfflat.probes = 10;\` (default 1 → terrible recall; raise to ~sqrt(lists))

ALWAYS set this per-session/transaction, never globally — different queries have different recall needs.

#### Standard retrieval query

\`\`\`sql
SELECT
  id,
  text,
  metadata,
  1 - (embedding <=> $1::vector) AS score
FROM chunks
WHERE doc_id IN (SELECT id FROM documents WHERE org_id = $2)
ORDER BY embedding <=> $1::vector
LIMIT $3;
\`\`\`

CRITICAL: Filters BEFORE \`ORDER BY embedding <=>\` defeat the index. Pre-filter via JOIN or subquery returning a small candidate set, OR use partial indexes:
\`\`\`sql
CREATE INDEX chunks_org42_hnsw
  ON chunks USING hnsw (embedding vector_cosine_ops)
  WHERE org_id = 42;
\`\`\`

For multi-tenant: usually \`embedding <=> $1\` over the full table + post-filter on org_id is faster than per-tenant indexes (unless one tenant dominates).

#### Hybrid search (vector + BM25/keyword)

pgvector + tsvector full-text search merged with Reciprocal Rank Fusion:
\`\`\`sql
WITH vec AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $1) AS rank
  FROM chunks ORDER BY embedding <=> $1 LIMIT 50
),
fts AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(tsv, plainto_tsquery($2)) DESC) AS rank
  FROM chunks WHERE tsv @@ plainto_tsquery($2) LIMIT 50
)
SELECT id, COALESCE(1.0/(60 + vec.rank), 0) + COALESCE(1.0/(60 + fts.rank), 0) AS rrf
FROM vec FULL OUTER JOIN fts USING (id)
ORDER BY rrf DESC LIMIT 10;
\`\`\`

#### Chunking discipline

- Chunk size: 1000–2000 chars typical; larger = less precise, smaller = more index bloat.
- Overlap: 100–250 chars to keep cross-chunk context (sentence on a boundary).
- Chunk on semantic boundaries (\\n\\n paragraphs, headings) BEFORE falling back to fixed length.
- Store \`chunk_index\` (ordinal within doc) so you can re-stitch surrounding context for the LLM.

#### Embedding generation

- Batch API calls (OpenAI accepts up to 2048 inputs per request, much cheaper).
- Cache embeddings keyed by SHA-256 of normalized input — re-runs are common during dev.
- Re-embed entire corpus when changing model — vectors from different models are NOT interchangeable.
- Track \`embedding_model\` column so you can detect mixed corpora at query time.

DO NOT:
- DO NOT mix embedding models in the same index — distances become meaningless.
- DO NOT index without \`vector_cosine_ops\` / matching distance op the query uses.
- DO NOT forget to \`SET ivfflat.probes\` — defaults yield ~1% recall.
- DO NOT pre-filter inside ORDER BY without a partial index — index is bypassed.
- DO NOT store unnormalized vectors when using \`<#>\` — results are wrong.`,
    requiredMcpServers: [],
    rules: [
      'Default to HNSW index unless you have >5M vectors with rare updates',
      'ALWAYS SET hnsw.ef_search or ivfflat.probes per query — defaults are bad',
      'Match index opclass (vector_cosine_ops) to the distance operator (<=>) used at query time',
      'NEVER mix embedding models in the same index — re-embed everything when switching',
      'Cache embeddings by content hash to avoid re-paying API costs during development',
      'Pre-filter via partial indexes or candidate-set CTE — never inline WHERE in ORDER BY',
      'Always store the source embedding model name in a column for forensics',
    ],
  },

  // ── Backend / Multi-tenant SaaS ─────────────────────────────────────────
  {
    id: 'skill:multi-tenant-saas',
    name: 'Multi-tenant SaaS Patterns',
    description: 'Tenant isolation strategies, RLS, scoped queries, Better Auth orgs, role-based access.',
    icon: 'i-ph-buildings-light',
    category: 'backend',
    knowledgeBlock: `### Multi-tenant SaaS Patterns

#### Isolation strategy decision

Three patterns, in increasing isolation/cost:

1. **Shared schema, tenant_id column** — single DB, single schema, every tenant-owned table has \`organization_id UUID NOT NULL\`. Cheapest, easiest migrations, most leak risk.
2. **Shared schema, Postgres RLS** — same as above but enforce isolation at the database via row-level security policies. Defense in depth.
3. **Schema-per-tenant** — \`SET search_path TO tenant_42, public\`. Hard isolation, hard migrations, breaks at ~1000 tenants.
4. **DB-per-tenant** — full isolation, biggest infra cost. Only for regulated/enterprise tiers.

**Default to #1 with discipline + #2 for sensitive tables.** #3 and #4 are escape hatches you migrate to per-customer when contracts demand.

#### Row-level security (RLS) — the safety net

Even if your application code is perfect, RLS catches the day someone forgets a \`WHERE org_id = $1\`:

\`\`\`sql
ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_documents FORCE ROW LEVEL SECURITY; -- include table owner

CREATE POLICY tenant_isolation ON knowledge_documents
  USING (organization_id = current_setting('app.current_org_id')::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org_id')::uuid);
\`\`\`

In your request middleware:
\`\`\`ts
await client.query("SELECT set_config('app.current_org_id', $1, true)", [req.user.activeOrgId]);
\`\`\`
The \`true\` makes it transaction-scoped — never leaks across pooled connections.

CRITICAL: when using a connection pool, EVERY query that touches RLS tables must run inside a transaction OR you must reset the GUC at checkout. Easiest: use a tx wrapper for tenant-scoped requests.

#### Scoped query helper

Don't hand-thread \`org_id\` through every query — wrap it:
\`\`\`ts
class TenantScopedDb {
  constructor(private pool: Pool, private orgId: string) {}
  async query<T>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [this.orgId]);
      const result = await client.query<T>(sql, params);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
\`\`\`

#### User ↔ Org M:N model

Most SaaS needs one user in many orgs (consultants, agencies, employees switching jobs). Schema:
\`\`\`sql
CREATE TABLE organizations (id UUID PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL);
CREATE TABLE memberships (
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, organization_id)
);
CREATE INDEX ON memberships(organization_id);
\`\`\`

Active org: store \`active_org_id\` on the session (NOT on the user — same user has different active orgs in different browser tabs/devices). Validate on every request that user is still a member.

#### Better Auth integration

Better Auth has a first-party \`organization\` plugin:
\`\`\`ts
import { organization } from 'better-auth/plugins';
export const auth = betterAuth({
  plugins: [organization({
    allowUserToCreateOrganization: true,
    organizationLimit: 5, // per user
    membershipLimit: 100, // per org
  })],
});
\`\`\`
It exposes \`auth.api.setActiveOrganization({ organizationId })\` and stores it on the session.

In your route handler: \`const session = await auth.api.getSession({ headers }); const orgId = session.session.activeOrganizationId;\` — REJECT requests where this is null.

#### Roles & permissions

Keep it simple at first: 4 roles, hardcoded permission matrix in code:
\`\`\`ts
const PERMISSIONS = {
  owner:  { 'org:delete': true, 'billing:write': true, 'member:invite': true, 'project:write': true, 'project:read': true },
  admin:  { 'org:delete': false, 'billing:write': true, 'member:invite': true, 'project:write': true, 'project:read': true },
  member: { 'org:delete': false, 'billing:write': false, 'member:invite': false, 'project:write': true, 'project:read': true },
  viewer: { 'org:delete': false, 'billing:write': false, 'member:invite': false, 'project:write': false, 'project:read': true },
} as const;

function can(role: keyof typeof PERMISSIONS, perm: string): boolean {
  return Boolean(PERMISSIONS[role]?.[perm as keyof typeof PERMISSIONS.owner]);
}
\`\`\`

Migrate to per-permission storage (\`role_permissions\` table) ONLY when customers ask for custom roles. Don't over-engineer.

#### Cross-tenant operations

Some endpoints legitimately span tenants (admin dashboards, support tools). Mark them explicitly:
- Separate route prefix: \`/api/admin/*\` — requires \`is_platform_admin\` flag, NOT org membership.
- BYPASS RLS via \`SET LOCAL ROLE platform_admin\` (a Postgres role with \`BYPASSRLS\`).
- LOG every cross-tenant query for audit (org_id_accessed, accessor_user_id, timestamp, sql).

#### Billing per-org

Stripe Customer per organization, not per user. \`organizations.stripe_customer_id\`. Subscription belongs to org. When user is member of multiple orgs, each org has its own bill.

#### Common leak vectors — review checklist

- [ ] Every tenant-owned table has \`organization_id\` + index
- [ ] Every list endpoint filters by active org
- [ ] Every detail endpoint validates \`row.organization_id === session.activeOrgId\`
- [ ] File uploads stored under \`<orgId>/...\` prefix with bucket policy
- [ ] Background jobs carry \`organization_id\` in payload (not implicit from "current user")
- [ ] WebSocket subscriptions filter events by org before broadcast
- [ ] Search/RAG indexes are partitioned or filter by org
- [ ] Logs/metrics tag \`org_id\` for triage but NEVER include other tenants' data

DO NOT:
- DO NOT trust client-supplied \`org_id\` query params — always derive from authenticated session
- DO NOT use auto-incrementing IDs for tenant-owned resources — UUIDs prevent enumeration attacks
- DO NOT share Redis keys across tenants without prefix (\`org:\${orgId}:cache:...\`)
- DO NOT skip RLS "because the app filters" — every leak in history started this way`,
    requiredMcpServers: [],
    rules: [
      'Every tenant-owned table MUST have organization_id NOT NULL + index',
      'Default to shared-schema + tenant_id column; add Postgres RLS for sensitive tables',
      'NEVER trust client-supplied org_id — always derive from authenticated session',
      'When using RLS with a connection pool, wrap requests in a transaction with set_config(... true)',
      'Background jobs MUST carry organization_id in payload — never infer from current user',
      'Use UUIDs (not auto-increment) for tenant-owned resource IDs',
      'Active org belongs on the session, not the user — same user can have different active orgs per device',
      'Stripe Customer per organization, not per user',
    ],
  },
];

export function getSkillById(id: string): AgentSkill | undefined {
  return SKILL_CATALOG.find((s) => s.id === id);
}

export function getSkillsByIds(ids: string[]): AgentSkill[] {
  return ids.map((id) => getSkillById(id)).filter((s): s is AgentSkill => s !== undefined);
}

/** All distinct categories present in the built-in catalog, in display order. */
export const SKILL_CATEGORIES = [
  'frontend',
  'backend',
  'database',
  'devops',
  'testing',
  'security',
  'ai-llm',
  'seo',
  'tooling',
  'other',
] as const;
