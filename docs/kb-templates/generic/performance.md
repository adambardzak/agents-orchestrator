# Performance

**TL;DR:** Measure before optimizing — most code is fast enough and the bottleneck
is rarely where you guess. Use profilers (CPU, memory, network) to find real hot
paths. The biggest wins usually come from: removing N+1 queries, adding indexes,
caching expensive computations, parallelizing I/O, reducing payload sizes,
deferring non-critical work. Set explicit performance budgets (page load, API
p95, DB query time) and fail CI when they regress. Premature micro-optimization
is a waste; architectural choices (caching, async, batching) dominate.

## Measure first

The cardinal rule: **never optimize without data**.

Profilers and tools per layer:
- **Backend (Node.js)**: clinic.js, 0x, `--prof`, `--inspect` with Chrome DevTools
- **Backend (other)**: language-native profilers (py-spy, pprof, perf, async-profiler)
- **Database**: `EXPLAIN ANALYZE`, slow query log, pg_stat_statements
- **Frontend**: Chrome DevTools Performance tab, Lighthouse, WebPageTest
- **Network**: browser Network tab, Wireshark, eBPF tools
- **Production**: APM (Sentry Performance, Datadog, OpenTelemetry traces)

Process:
1. Reproduce the slow path
2. Profile with realistic data sizes (10x, 100x, 1000x prod)
3. Identify the top 3 hot spots
4. Optimize the worst one
5. Re-measure to confirm improvement
6. Repeat until under budget

## Performance budgets

Set explicit numeric targets, enforce in CI:

```yaml
budgets:
  api_p95_ms: 200          # 95th percentile API latency
  api_p99_ms: 500
  db_query_p99_ms: 50
  page_load_lcp_ms: 2500   # Largest Contentful Paint
  page_load_fid_ms: 100    # First Input Delay
  page_load_cls: 0.1       # Cumulative Layout Shift
  bundle_size_kb: 250      # JS gzipped, initial route
  image_size_kb: 200       # per image, optimized
```

Run synthetic checks (Lighthouse CI, k6, autocannon) on every PR; block merge
on regression beyond threshold (e.g. > 10% worse).

## Database is usually the bottleneck

Order of typical wins (biggest first):
1. **Add missing index** — query goes from 5s to 5ms
2. **Eliminate N+1** — single query instead of 100 (see `database-patterns.md`)
3. **Cache reads** — Redis hit avoids DB roundtrip (1ms vs 50ms)
4. **Pagination** — return 50 rows not 50,000
5. **Denormalize hot reads** — pre-compute aggregates instead of join
6. **Read replica** — offload analytics from OLTP
7. **Materialized view** — refreshed periodically for expensive aggregations

Use `EXPLAIN ANALYZE` on every slow query. Look for:
- Sequential scans on big tables → missing index
- Nested loop joins on big tables → wrong join strategy or missing index
- High `Buffers: shared read` → cold cache (warm or shrink working set)
- Sort operations spilling to disk → tune `work_mem` or rewrite query

## Caching

Cache levels (cheapest first):
1. **HTTP cache** (`Cache-Control` headers) — browser/CDN does the work
2. **CDN edge cache** — static assets, public API responses
3. **In-memory cache** within the process (lru-cache, Map with TTL)
4. **Redis / Memcached** — shared across instances
5. **Database query cache** — built into many ORMs (use carefully — staleness)

Cache invalidation rules:
- **TTL** for tolerant data (lists that update slowly)
- **Event-driven invalidation** for hot data (write triggers cache delete)
- **Stale-while-revalidate** for low-stakes data (serve stale, refresh in background)
- **Versioned keys** for cache busting on schema change (`user:v2:{id}`)

Don't cache:
- Per-request data only used once
- Highly personalized data with low cache hit rate
- Anything where staleness causes correctness bugs (financial balances, inventory)

## I/O parallelization

Slow operations should run concurrently when independent:

```typescript
// ❌ Serial — sum of latencies
const user = await fetchUser(id)
const orders = await fetchOrders(id)
const prefs = await fetchPrefs(id)
// Total: 100 + 80 + 60 = 240ms

// ✅ Parallel — max latency
const [user, orders, prefs] = await Promise.all([
  fetchUser(id),
  fetchOrders(id),
  fetchPrefs(id),
])
// Total: 100ms (the slowest)
```

For dependent operations, you cannot parallelize — but consider batching:
```typescript
// ❌ N requests
for (const id of userIds) await fetchUser(id)

// ✅ Single batched request
const users = await fetchUsersByIds(userIds)
```

DataLoader pattern: collect requests within a tick, dispatch batched.

## Payload size

Frontend perceived speed correlates strongly with bytes-over-the-wire.

JS bundles:
- **Code splitting**: route-based chunks (Next.js / framework defaults handle this)
- **Dynamic imports** for heavy non-critical libs (chart libraries, rich text editors)
- **Tree-shaking**: ensure imports are specific (`import { x } from 'lib'` not `import lib from 'lib'`)
- **Bundle analysis**: `webpack-bundle-analyzer`, `source-map-explorer`, `next build` output
- **Replace heavy libs**: moment.js → date-fns (5kb), lodash → individual functions or native

API responses:
- **Don't return what client doesn't display** — GraphQL or sparse fieldsets (`?fields=id,name`)
- **Compress** with gzip / brotli at the proxy layer
- **Pagination** for collections
- **Avoid deeply nested objects** when client only needs ids

Images:
- **Modern formats**: WebP, AVIF (browsers handle fallback)
- **Responsive**: `srcset` and `sizes` attributes; serve smaller for mobile
- **Lazy loading**: `loading="lazy"` for below-fold
- **Optimize**: `imagemin`, `sharp`, or CDN with auto-optimization (Cloudflare Images,
  imgix, Cloudinary)
- **Width/height attributes**: prevents layout shift (CLS)

## Frontend rendering performance

Core Web Vitals:
- **LCP** (Largest Contentful Paint): main content visible — target < 2.5s
- **INP** (Interaction to Next Paint): tap responsiveness — target < 200ms
- **CLS** (Cumulative Layout Shift): visual stability — target < 0.1

Wins:
- **SSR / SSG / ISR** for first paint speed (Next.js, Remix, Astro patterns)
- **Streaming** server-rendered HTML (`renderToReadableStream`)
- **Suspense + skeleton screens** for perceived performance
- **Avoid blocking main thread**: heavy JS work in Web Workers
- **Defer non-critical scripts**: `defer` / `async` attributes
- **Critical CSS inlined**, rest deferred

React-specific:
- `React.memo` for expensive components in lists
- `useMemo` / `useCallback` only when proven beneficial (often counterproductive overhead)
- Virtualization (react-virtuoso, tanstack-virtual) for lists > 100 rows
- Avoid context for high-frequency updates (re-renders all consumers)
- Production build (`NODE_ENV=production`) is 5-10x faster than dev

## Asynchronous work

Move work off the request path when the user doesn't need to wait:

```typescript
// User-facing endpoint
async function createOrder(req) {
  const order = await db.order.create({ data: req.body })
  await emailQueue.add('send-confirmation', { orderId: order.id })  // background
  return order   // user gets response now; email sends later
}
```

Background job queues: BullMQ, Sidekiq, Celery, RQ. Use them for:
- Sending emails / notifications
- Generating reports / PDFs
- Image / video processing
- Data sync to external systems
- Periodic cleanup, aggregation

## Concurrency limits

More parallelism is not always better:
- Database connection pool: typically 10-50 per app instance (depends on DB capacity)
- HTTP client: limit concurrent outbound requests to upstream (`p-limit`, `bottleneck`)
- Background workers: tune to CPU cores and DB capacity

Without limits, a slow upstream causes:
- Connection pool exhaustion
- Memory growth (queued requests pile up)
- Cascading failure to dependent services

## Memory

Check for leaks:
- Heap snapshots (Chrome DevTools → Memory)
- Compare snapshots over time; growing object counts = leak
- Common causes: unbounded caches, listeners not removed, closures holding refs

Reduce memory:
- Stream large responses instead of loading into memory
- Process large files in chunks (`fs.createReadStream`, not `fs.readFile`)
- Bound queues, caches, in-memory collections explicitly

## Networking

- **HTTP/2 or HTTP/3** at the edge (multiplexing, header compression)
- **Keep-alive** connections for upstream calls (reuse TCP/TLS overhead)
- **DNS pre-resolve** for known external endpoints
- **CDN** for static assets and cacheable API responses
- **Compression**: gzip / brotli at proxy; not at app (frees CPU)

## Real user monitoring (RUM)

Synthetic tests miss real-world variance (slow networks, old devices, geographic
spread). Add RUM:
- web-vitals JS lib → send LCP/INP/CLS/TTFB to your analytics
- Sentry Performance / Datadog RUM / New Relic Browser
- Segment by country, device, connection type

Use percentiles (p50, p75, p95, p99), not averages — averages hide the long tail.

## When NOT to optimize

- Code that runs once at startup
- Admin endpoints used by 5 people
- Anything below the noise floor of your latency budget
- Trivial functions (compiler will inline; you cannot beat it)
- Before measuring (you'll guess wrong)

Optimization adds complexity. Each optimization is a maintenance cost. Spend
the effort where it returns user value.

## DO NOT
- ❌ Optimize without profiling — you'll waste effort on cold paths
- ❌ Cache without invalidation strategy — stale data bugs are subtle and damaging
- ❌ Use `await` in a loop when items are independent — parallelize with `Promise.all`
- ❌ Send 1 MB JSON when 50 KB would do
- ❌ Use `SELECT *` in production code — fetch only what you display
- ❌ Run schema migrations during peak hours
- ❌ Block the event loop with sync I/O or CPU-heavy code (offload to worker)
- ❌ Store large blobs in your OLTP DB — use object storage
- ❌ Trust dev-environment performance numbers — measure on prod-like infra
- ❌ Compare averages — use p95 / p99
- ❌ Add `useMemo`/`useCallback` everywhere — measure first, they have overhead
- ❌ Skip indexes "until later" — adding them after a table grows is painful
