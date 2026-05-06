# Error Handling Patterns

**TL;DR:** Use Result types (or tagged unions) for expected errors in business
logic, throw exceptions only at boundaries (HTTP handlers, CLI entry points).
Every error MUST have a stable code, a human-readable message, and enough
context to diagnose without reproduction. Never swallow errors silently.
Never expose stack traces or SQL fragments to end users. Always include
correlation IDs so you can find the full story across services.

## Two categories of errors

### Expected (domain) errors
Things that can happen in normal operation:
- Validation failed
- Resource not found
- Insufficient funds / inventory / quota
- Conflict with current state
- External service unavailable

These are **part of your API contract**. Model them explicitly.

### Unexpected (programmer) errors
Things that should never happen:
- Null pointer where you assumed non-null
- Off-by-one in loop
- Type mismatch
- Out-of-memory
- Database schema mismatch

These are **bugs**. Crash loudly, log fully, alert.

## Result type pattern (recommended for TS/Rust/Go-style code)

```typescript
type Result<T, E = AppError> =
  | { ok: true;  value: T }
  | { ok: false; error: E }

function findUser(id: string): Promise<Result<User, NotFoundError | DatabaseError>> {
  // ...
}

const result = await findUser(id)
if (!result.ok) {
  // handle exhaustively — TS narrows the union
  return result
}
const user = result.value
```

Benefits:
- Errors visible in function signature
- Caller forced to handle (no silent skipping)
- No try/catch noise
- Composable with railroad-oriented helpers (`map`, `flatMap`, `mapError`)

## Throwing exceptions (when appropriate)

Use throw for:
- **Programmer errors** (assertion failures, invariant violations)
- **Boundaries** (HTTP request handler converts thrown error to response)
- **Cross-cutting concerns** (auth middleware throws 401)

Never use throw for:
- Normal control flow (e.g. "user not found" in a finder function)
- Expected validation failures (return Result instead)

## Stable error codes

Every error MUST have a code that:
- Is **stable** (don't rename across versions; clients depend on it)
- Is **machine-readable** (`USER_NOT_FOUND`, not "User Not Found")
- Is **specific** (avoid `INTERNAL_ERROR` catch-all)
- Is **prefixed** by domain when ambiguous (`AUTH_TOKEN_EXPIRED`, `DB_CONSTRAINT_UNIQUE`)

```typescript
class NotFoundError extends AppError {
  code = 'RESOURCE_NOT_FOUND' as const
  status = 404
  constructor(public resourceType: string, public resourceId: string) {
    super(`${resourceType} ${resourceId} not found`)
  }
}
```

## Error structure (HTTP response)

Use RFC 7807 Problem Details (see `api-design.md`):
```json
{
  "type": "https://api.example.com/errors/resource-not-found",
  "title": "Resource not found",
  "status": 404,
  "code": "USER_NOT_FOUND",
  "detail": "User with id usr_01HX... does not exist",
  "instance": "/api/v1/users/usr_01HX...",
  "request_id": "01HXXXXXXXXXXXXXXX"
}
```

Include `request_id` (correlation ID) in EVERY error response so users can
quote it when reporting issues.

## What NOT to leak in error messages

To end users (HTTP responses, UI):
- ❌ Stack traces
- ❌ SQL queries or fragments
- ❌ File paths from the server filesystem
- ❌ Internal service names, hostnames, IPs
- ❌ Other users' data ("this email is already taken by jan.novak@cez.cz")
- ❌ Exact reasons for auth failure ("password incorrect" vs "user does not exist"
  enables enumeration — use generic "invalid credentials")

What you CAN leak:
- Validation problems on user-provided input
- Business state ("you have insufficient balance")
- Action they can take ("please log in again")

To logs (server-side):
- ✅ Full stack trace
- ✅ Input that caused the error (with PII redaction)
- ✅ Request ID, user ID, session ID
- ✅ Relevant state at time of error
- ✅ Upstream error details if any

## Logging errors

```typescript
logger.error({
  err: error,                            // pino serializes Error objects properly
  request_id: req.id,
  user_id: session?.userId,
  route: req.routerPath,
  // domain-specific context
  project_id: params.projectId,
}, 'failed to update project')
```

Log levels:
- **error** — request failed, action could not complete (will produce 5xx response usually)
- **warn** — degraded but recovered (retry succeeded, fallback used)
- **info** — normal lifecycle events (startup, shutdown, periodic)
- **debug** — verbose flow detail (off in production by default)

## Retries

Retry only **transient** failures:
- Network timeouts
- 5xx from upstream
- Rate limit (429) with Retry-After
- Database deadlocks

Never retry:
- 4xx errors (except 408, 429)
- Validation failures
- Auth failures
- Operations without idempotency guarantee

Pattern:
```typescript
import pRetry from 'p-retry'

await pRetry(() => fetch(url), {
  retries: 3,
  factor: 2,         // exponential
  minTimeout: 200,
  maxTimeout: 2000,
  onFailedAttempt: (err) => logger.warn({ err, attempt: err.attemptNumber }, 'retry'),
})
```

For idempotency-sensitive operations, use `Idempotency-Key` header so retries
do not duplicate side effects.

## Circuit breakers

For calls to external services that might fail in waves (DB outage, partner API down):
- Open the breaker after N consecutive failures (e.g. 5 in 30s)
- Reject fast for cooldown period (e.g. 30s)
- Probe with single request after cooldown
- Use a library (`opossum`, `cockatiel`) — do not roll your own

Circuit-breaker open returns `503 Service Unavailable` with `Retry-After`.

## Async errors

```typescript
// ❌ Unhandled rejection — kills process or logs cryptically
sendEmail(user).catch(console.log)

// ✅ Either await + try/catch, or queue with dedicated retry handler
try {
  await sendEmail(user)
} catch (err) {
  logger.error({ err, user_id: user.id }, 'email send failed')
  await enqueueDeadLetter({ kind: 'email', payload: user })
}
```

Background jobs MUST have a dead-letter queue or alerting on failure — silent
loss of background work is a common production bug.

## Validation errors

Return ALL failures at once, not first-fail:
```json
{
  "code": "VALIDATION_FAILED",
  "errors": [
    { "field": "email", "code": "INVALID_FORMAT", "message": "must be a valid email" },
    { "field": "age", "code": "OUT_OF_RANGE", "message": "must be between 18 and 120" },
    { "field": "country", "code": "REQUIRED", "message": "field is required" }
  ]
}
```

User submits form once, sees all problems, fixes once.

## Sentinel values vs errors

Avoid magic return values for error states:
```typescript
// ❌ Easy to forget the check
function findUser(id: string): User | null { ... }
const user = findUser(id)
console.log(user.name)  // crashes if null

// ✅ Forces handling
function findUser(id: string): Result<User, NotFoundError> { ... }
```

Same for `-1`, empty string, `undefined` as "not found" — use Option/Result.

## DO NOT
- ❌ `catch (e) {}` — empty catch blocks hide real bugs
- ❌ `catch (e) { throw e }` — pointless, just re-throws
- ❌ `catch (e) { console.log(e) }` — use real logger, not console
- ❌ Throw strings or numbers — always Error subclass
- ❌ `try { ... } catch (e) { return null }` — silently turning errors into nulls
- ❌ Custom `errno`-style number codes — use string codes (greppable, self-documenting)
- ❌ Different error formats per endpoint — one shape across the API
- ❌ Localized error messages on the wire — send `code`, localize on client
- ❌ Mutating errors after creation
- ❌ Leaking PII in error messages or logs at non-audit levels
