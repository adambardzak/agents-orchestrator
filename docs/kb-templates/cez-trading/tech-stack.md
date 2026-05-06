# Tech Stack — CEZ Trading Application Defaults

**TL;DR:** Default stack for new CEZ Trading apps is TypeScript + Node.js 20 LTS
+ Fastify (backend) or Next.js 14 App Router (full-stack web), PostgreSQL via
Prisma, Kafka via @cez-trading/kafka-client, Redis for cache/queues, deployed
to internal Kubernetes (see `deployment.md`). Use this stack unless project
explicitly justifies an alternative — consistency across our portfolio matters
more than picking the latest framework.

## Backend services

- **Runtime**: Node.js __NODE_VERSION__ (currently 20 LTS)
- **Language**: TypeScript strict mode, ESM modules (NodeNext)
- **HTTP framework**: Fastify (NOT Express — performance and schema validation)
- **Validation**: Zod (request/response schemas, env validation, DTO contracts)
- **ORM**: Prisma against PostgreSQL
- **Migrations**: Prisma Migrate, applied via init container in K8s
- **Background jobs**: BullMQ on Redis
- **Streaming**: Kafka via `@cez-trading/kafka-client` (wraps kafkajs with
  schema registry, mTLS, and tracing)
- **Logger**: pino with JSON output, log level via env

## Web frontend

- **Framework**: Next.js __NEXT_VERSION__ (App Router only — no Pages Router for new projects)
- **Language**: TypeScript strict, ESM
- **UI components**: `@cez-trading/ui` (see `design-system.md`)
- **State**: Zustand for client state, React Query (TanStack Query) for server state
- **Forms**: React Hook Form + Zod resolver
- **Routing**: Next.js App Router file-based
- **Auth**: `@cez-trading/auth-client` OIDC integration (see `auth-and-access.md`)

## Data layer

- **Primary OLTP**: PostgreSQL __PG_VERSION__ (managed by platform, HA cluster)
- **Time-series**: __TSDB_NAME__ (e.g. TimescaleDB extension on PG, or InfluxDB)
- **Cache / queues**: Redis __REDIS_VERSION__ (Sentinel HA)
- **Object storage**: internal S3-compatible MinIO at `__MINIO_URL__`
- **Search**: OpenSearch cluster at `__OPENSEARCH_URL__` (NOT Algolia — data residency)

## Package management

- **Manager**: pnpm (NOT npm or yarn) — workspaces for monorepos
- **Registry**: `__NPM_REGISTRY__` (Verdaccio mirror with internal scopes
  `@cez-trading/*`)
- **Lockfile**: `pnpm-lock.yaml` MUST be committed
- **Node version pin**: `.nvmrc` and `engines.node` in `package.json`

## Testing

- **Unit / integration**: Vitest (NOT Jest — ESM friendly, faster)
- **E2E**: Playwright (NOT Cypress — multi-tab, multi-browser, better debugging)
- **Coverage threshold**: __COVERAGE_MIN__% (e.g. 70%) — enforced in CI
- **Test data**: factories via `@cez-trading/test-fixtures`
- **Mocked external services**: WireMock (`__WIREMOCK_URL__` for shared test env)

## Linting and formatting

- **Linter**: ESLint with `@cez-trading/eslint-config`
- **Formatter**: Prettier with `@cez-trading/prettier-config`
- **Pre-commit**: lint-staged via husky
- **Type-check in CI**: `tsc --noEmit` blocks merge on errors

## Observability

- **Logging**: pino → stdout (JSON) → Fluent Bit → Loki at `__LOKI_URL__`
- **Metrics**: Prometheus client → `/metrics` endpoint → scraped by platform
- **Tracing**: OpenTelemetry SDK → OTLP → Tempo at `__TEMPO_URL__`
- **Errors**: Sentry self-hosted at `__SENTRY_URL__` (NOT sentry.io SaaS)

## Configuration

Environment variables, validated with Zod at startup:
```typescript
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  KAFKA_BROKERS: z.string(),
  // ... fail fast on missing/invalid
})

export const env = envSchema.parse(process.env)
```

NEVER `process.env.X` directly throughout the codebase — always go through
the validated `env` object.

## API contracts

- **REST APIs**: OpenAPI 3.1 spec generated from Fastify schemas (Zod-to-JSON-Schema)
- **Internal APIs**: also publish Protobuf definitions to `__PROTO_REGISTRY__`
  for typed cross-service clients
- **Versioning**: URL-based (`/api/v1/...`), bump major for breaking changes
- **Error format**: RFC 7807 Problem Details JSON

## DO NOT use without justification
- ❌ **Bun, Deno** — not certified by platform team
- ❌ **Express, Hapi, Koa, NestJS** — Fastify standard
- ❌ **Drizzle, TypeORM, Sequelize, MikroORM, Knex** — Prisma standard
- ❌ **Pages Router (Next.js)** — App Router only for new projects
- ❌ **Remix, SvelteKit, Nuxt, SolidStart, Astro** — Next.js standard for web
- ❌ **Redux, MobX, Recoil, Jotai** — Zustand standard
- ❌ **Axios, ky, got** — native `fetch` with `@cez-trading/http-client` wrapper
- ❌ **Jest, Mocha, Jasmine** — Vitest standard
- ❌ **Cypress, TestCafe, Selenium** — Playwright standard
- ❌ **MongoDB, MySQL, MariaDB, DynamoDB, Firebase** — PostgreSQL standard for OLTP
- ❌ **RabbitMQ, NATS, SQS, Pulsar** — Kafka standard for streaming
- ❌ **Memcached, Hazelcast** — Redis standard for cache
- ❌ **Webpack, Parcel, Rollup configs hand-rolled** — use framework defaults (Vite, Next.js bundler)
- ❌ **npm, yarn, bun (package mgr)** — pnpm standard
- ❌ **GraphQL** for new internal APIs — REST + OpenAPI standard (existing GQL services kept as-is)
- ❌ **tRPC** — internal proto/OpenAPI standard for cross-team contracts
- ❌ **Public SaaS dependencies** without security review (Sentry SaaS, Datadog,
  New Relic, Algolia, Auth0, Clerk, Vercel KV, PlanetScale, Neon, etc.)

## Why these defaults

- Consistent stack across teams = faster onboarding, easier code review,
  shared library investment pays off.
- All choices are battle-tested in production at our scale (millions of
  trades/day, sub-second latency requirements).
- Platform team supports these explicitly with templates, monitoring
  dashboards, and runbooks.

## Adding a new tech to the stack

If you genuinely need something not on the approved list:
1. Open RFC in `__ARCHITECTURE_REPO__` describing problem + alternatives considered
2. Architecture review board meets bi-weekly
3. Approval includes: monitoring template, security review, knowledge sharing session
4. New tech added to this document upon approval
