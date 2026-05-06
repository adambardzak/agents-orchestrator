# Logging and Observability

**TL;DR:** Treat logs, metrics, and traces as the three pillars of observability —
together they answer "what happened, how often, and why". Log structured JSON
to stdout (let infrastructure ship it). Use levels meaningfully (error / warn /
info / debug). Include a correlation ID on every request and propagate it
across services. Never log secrets, tokens, full PANs, or PII at INFO level.
Set up alerts on what matters (user-impact, error budgets) — not on every
warning.

## The three pillars

| Pillar  | Question answered                | Example tool                |
|---------|-----------------------------------|------------------------------|
| Logs    | What happened (specific event)?   | Loki, Splunk, ELK, CloudWatch |
| Metrics | How much, how often, how fast?    | Prometheus, Datadog          |
| Traces  | Where did time go (across services)? | Tempo, Jaeger, Honeycomb |

Modern stacks unify these (Datadog, New Relic, Honeycomb, Grafana Cloud).
Open standard: **OpenTelemetry** (OTLP) for instrumentation; backend agnostic.

## Logging

### Structured JSON to stdout

```typescript
import pino from 'pino'
const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

logger.info({
  user_id: 'usr_01HX...',
  request_id: req.id,
  route: req.routerPath,
  duration_ms: 142,
}, 'request handled')
```

Output:
```json
{"level":30,"time":1714665600000,"user_id":"usr_01HX...","request_id":"...","route":"/api/v1/projects","duration_ms":142,"msg":"request handled"}
```

Why JSON to stdout:
- **stdout** — container runtimes / process managers collect and ship; no
  filesystem to manage, no rotation needed in the app
- **JSON** — machine-parseable; query by field in Loki/Splunk/etc.
- **Structured** — search by `user_id`, aggregate by `route`, filter by `duration_ms > 1000`

Never write logs to files in containerized apps. Never use plain text "$LEVEL
$MESSAGE" — you cannot query it well.

### Log levels

Used consistently:
- **fatal** — unrecoverable, process exiting (use sparingly)
- **error** — operation failed; user-visible impact (will produce 5xx usually)
- **warn** — degraded but recovered (retry succeeded, fallback used, deprecated API called)
- **info** — normal lifecycle events (startup, shutdown, periodic, request handled)
- **debug** — detailed flow (off in production by default; toggle via env var)
- **trace** — extremely verbose (rarely used)

Production default: **info**. Spike to **debug** for troubleshooting via env
change without redeploy if possible.

### What to log on every request

Middleware should log:
- `request_id` (correlation ID — generate if not present in `X-Request-Id`)
- `method`, `route`, `status_code`
- `duration_ms`
- `user_id` (if authenticated)
- `source_ip` (consider class only at INFO, full IP at audit level)
- `user_agent` (truncated)

Per-request logger child (pino) so all logs within the request automatically
include these fields:
```typescript
fastify.addHook('onRequest', (req, reply, done) => {
  req.log = logger.child({ request_id: req.id, route: req.routerPath })
  done()
})
```

### Correlation IDs

Every request gets one, propagated to:
- Downstream HTTP calls (`X-Request-Id` header)
- Database queries (PostgreSQL: `SET application_name`, comments)
- Background jobs (pass via job payload)
- External service calls
- Logs in every component

When debugging, you can follow a single request across services:
```
Loki query: { request_id="01HX..." }
```

OpenTelemetry trace IDs serve the same purpose; if you have OTel, use the
`trace_id` as the correlation ID.

### What NEVER to log

- Passwords, even hashed
- Authentication tokens (full JWT, OAuth tokens, API keys, session cookies)
- Full credit card numbers, CVCs (PCI requirement)
- Full national IDs (SSN, RČ, PESEL)
- Private keys, client secrets
- Email body contents (could contain PII / business secrets)
- Full HTTP bodies on POST/PUT (may contain any of the above)

### What to redact / truncate

- IP addresses → consider class-only (`/24`) or hashed for analytics
- Email addresses at INFO → use `user_id` only; email goes to audit channel if needed
- User agents → truncate to first 200 chars
- URLs with query strings → strip sensitive params before logging

Use a redaction library / pino built-in:
```typescript
const logger = pino({
  redact: ['req.headers.authorization', 'req.headers.cookie', 'password', '*.token'],
})
```

### Log volume

A noisy app costs money (log storage, ingestion fees) and drowns signal in noise.
Rules:
- One log per request at INFO is enough — not 5
- Don't log every line of business logic — use traces if you need step-by-step
- Sample high-volume events (e.g. log 1% of health-check pings)
- Retention: 7-30 days for INFO, 1+ year for audit/security events

## Metrics

Numeric measurements aggregated over time. Cheap to store, fast to query.

### Four signals (Google SRE)
- **Latency** — how long requests take (p50, p95, p99)
- **Traffic** — how many requests per second
- **Errors** — error rate (5xx percentage)
- **Saturation** — how full the system is (CPU, memory, queue depth)

### Standard metrics every service exposes

```
http_requests_total{method, route, status}        counter
http_request_duration_seconds{method, route}      histogram
db_query_duration_seconds{operation, table}       histogram
queue_depth{queue_name}                           gauge
external_call_duration_seconds{service, status}   histogram
process_open_fds                                  gauge
nodejs_eventloop_lag_seconds                      gauge
```

Expose at `/metrics` in Prometheus exposition format; let Prometheus scrape.

### Metric naming conventions

- snake_case
- Suffix with unit: `_seconds`, `_bytes`, `_total` (counter)
- Labels for dimensions you'll group by (low cardinality — never `user_id` as label)

High-cardinality labels (user_id, request_id, full URL) **explode time-series
storage**. Use logs or traces for that detail; keep metrics aggregated.

### RED method (for services)
- **R**ate, **E**rrors, **D**uration

### USE method (for resources)
- **U**tilization, **S**aturation, **E**rrors

## Tracing

Distributed traces show how a single request flowed across services and where
time went.

OpenTelemetry SDK auto-instruments many libraries (HTTP server, HTTP client,
DB drivers, queues). Add custom spans for business operations:

```typescript
import { trace } from '@opentelemetry/api'
const tracer = trace.getTracer('orders')

await tracer.startActiveSpan('create_order', async (span) => {
  span.setAttribute('user.id', userId)
  span.setAttribute('order.value', total)
  try {
    const order = await createOrder(...)
    span.setStatus({ code: 1 })  // OK
    return order
  } catch (err) {
    span.recordException(err)
    span.setStatus({ code: 2 })  // ERROR
    throw err
  } finally {
    span.end()
  }
})
```

Send traces to OTLP collector → backend (Tempo, Jaeger, Honeycomb, Datadog).

### Sampling

100% trace sampling is expensive and noisy:
- **Head sampling**: decide at start (1% of requests, all 5xx, all > 1s)
- **Tail sampling**: collect all spans then decide based on outcome
  (more accurate, more infra)

Always trace 100% of errors and slow requests; sample the happy path.

## Alerting

Alert on:
- **User-impacting symptoms**: error rate spike, latency p95 above budget
- **SLO/SLI breaches**: error budget burn rate
- **Saturation approaching limits**: disk > 85%, connection pool > 90%
- **Critical paths down**: payment provider unreachable, DB primary failover

DON'T alert on:
- Every WARN log
- Every CPU spike
- Single failed requests
- Things you won't act on at 3 AM

Each alert needs:
- A clear name and description
- A runbook URL (what to check, how to mitigate)
- Severity (page, ticket, FYI)
- Owner team

## Dashboards

Per-service dashboard with:
- Request rate, error rate, latency (p50/p95/p99) — RED
- DB query time, queue depth, external dependency latency
- Resource utilization (CPU, memory, file descriptors)
- Recent deployments overlaid (correlate spikes with releases)

Per-business-domain dashboard with:
- Orders per minute, signup conversion, payment success rate
- Show the metrics that map to product KPIs

## Audit logs (separate channel)

Compliance / security events have different requirements:
- **Immutable storage** — append-only, tamper-evident
- **Long retention** — years (legal, regulatory)
- **Restricted access** — security/audit team only
- **Separate from app logs** — different volume, query patterns, lifecycle

Examples: login/logout, role changes, data exports, admin operations,
financial transactions.

Send via dedicated stream:
```typescript
await auditLog.emit({
  actor: { type: 'user', id: session.userId, ip: req.ip },
  action: 'role.granted',
  resource: { type: 'user', id: targetUserId },
  changes: { role: { from: 'viewer', to: 'admin' } },
  context: { request_id: req.id },
})
```

## Health and readiness

Two endpoints, distinct semantics:
- **/health/live** — process is up; restart on failure (kubelet uses this)
- **/health/ready** — process can serve traffic; remove from load balancer if not
  (DB connected, dependencies reachable, warmup done)

Don't make health checks expensive — they run every few seconds. A simple
"DB ping + can-respond" is fine; deep checks belong in synthetics.

## DO NOT
- ❌ Write logs to files in containerized apps — stdout / stderr only
- ❌ Use printf / console.log instead of a structured logger
- ❌ Log secrets, tokens, full PII at any level except dedicated audit
- ❌ Use high-cardinality labels in metrics (user_id, full URL)
- ❌ Sample 100% of traces in production — too expensive
- ❌ Alert on every warning — alert fatigue makes real alerts ignored
- ❌ Log without correlation IDs — debugging across services becomes guesswork
- ❌ Use the same channel for app logs and audit logs
- ❌ Log full request/response bodies by default — large payloads, leakage
- ❌ Skip metrics/traces because "logs are enough" — different questions need different tools
- ❌ Hard-code log levels — make them runtime-configurable
- ❌ Trust client-supplied request IDs without validation (could be malicious)
