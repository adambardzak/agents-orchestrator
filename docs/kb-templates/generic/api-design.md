# API Design Conventions

**TL;DR:** REST APIs use JSON, kebab-case URLs, plural resource names,
HTTP semantics for verbs, RFC 7807 Problem Details for errors, ISO 8601
for timestamps in UTC, cursor pagination for collections, and explicit URL
versioning (`/api/v1`). Document with OpenAPI 3.1 generated from request/response
schemas. NEVER use snake_case in URLs, mix verbs in path segments, return 200 OK
for errors, or invent custom error formats per endpoint.

## URL structure

```
GET    /api/v1/projects                       — list
POST   /api/v1/projects                       — create
GET    /api/v1/projects/{id}                  — get one
PATCH  /api/v1/projects/{id}                  — partial update
PUT    /api/v1/projects/{id}                  — replace (rare; prefer PATCH)
DELETE /api/v1/projects/{id}                  — delete
GET    /api/v1/projects/{id}/tasks            — nested collection
POST   /api/v1/projects/{id}/tasks            — create nested
POST   /api/v1/projects/{id}/actions/archive  — non-CRUD action under /actions/
```

Rules:
- Resource names are plural nouns (`projects`, not `project`)
- IDs in URL path, never in query string for the primary resource
- Maximum two levels of nesting; deeper structures use top-level resources
  with filter (`/api/v1/tasks?project_id=X`) instead of `/projects/X/phases/Y/tasks/Z`
- Non-CRUD operations under `/actions/<verb>` (POST only)

## HTTP methods

| Method  | Idempotent | Safe | Request body | Response body |
|---------|-----------|------|--------------|----------------|
| GET     | yes       | yes  | NO           | yes            |
| POST    | no        | no   | usually yes  | yes            |
| PUT     | yes       | no   | yes (full)   | yes            |
| PATCH   | no¹       | no   | yes (partial)| yes            |
| DELETE  | yes       | no   | usually no   | optional       |

¹ PATCH idempotency depends on payload semantics; document it.

## Status codes

Use these and ONLY these unless you have a strong reason:
- **200 OK** — successful GET, PATCH, PUT
- **201 Created** — successful POST that created a resource (include `Location` header)
- **202 Accepted** — async operation queued; include status URL in response
- **204 No Content** — successful DELETE or operations with no body
- **301 Moved Permanently** / **307 Temporary Redirect** — redirects
- **400 Bad Request** — request malformed, validation failed
- **401 Unauthorized** — missing or invalid authentication
- **403 Forbidden** — authenticated but not authorized
- **404 Not Found** — resource does not exist (or hidden for auth reasons)
- **409 Conflict** — resource state prevents operation (duplicate, version conflict)
- **410 Gone** — resource deleted permanently
- **422 Unprocessable Entity** — well-formed but semantically invalid (use 400 unless you need to distinguish)
- **429 Too Many Requests** — rate limited; include `Retry-After`
- **500 Internal Server Error** — unhandled server error
- **502 / 503 / 504** — upstream / unavailable / timeout

Never return 200 with `{ "error": "..." }` body — clients won't catch it.

## Error response format (RFC 7807)

```json
{
  "type": "https://api.example.com/errors/validation",
  "title": "Request validation failed",
  "status": 400,
  "detail": "Field 'email' must be a valid email address",
  "instance": "/api/v1/users",
  "request_id": "01HXXXXXXXXXXXXXXX",
  "errors": [
    { "field": "email", "code": "invalid_format", "message": "must be valid email" },
    { "field": "age", "code": "out_of_range", "message": "must be between 18 and 120" }
  ]
}
```

Content-Type: `application/problem+json`.

## Naming conventions

- **JSON keys**: snake_case (`created_at`, `user_id`, `is_active`)
- **URL path segments**: kebab-case (`/order-books`, `/api-keys`)
- **Query parameters**: snake_case (`?sort_by=created_at&page_size=50`)
- **Headers**: standard PascalCase-Kebab (`X-Request-Id`, `X-Rate-Limit-Remaining`)

(Some teams use camelCase JSON to match JS — pick one and stay consistent
across the org. snake_case avoids friction with Python/Go consumers.)

## Timestamps

- ALWAYS UTC, ISO 8601 with `Z` suffix: `"2025-04-21T14:30:00.123Z"`
- Field names: `created_at`, `updated_at`, `deleted_at`, `expires_at`,
  `scheduled_for`, `completed_at`
- NEVER unix epoch numbers (ambiguous, no timezone visible)
- NEVER local time without timezone
- Date-only values: `"2025-04-21"` (ISO 8601 date)

## IDs

- Use **UUID v7** (sortable, no MAC leak) or **ULID** for new resources
- Avoid auto-increment integers in public APIs (enumeration attacks, leaks scale)
- Prefix IDs in client-facing contexts to disambiguate type (`proj_01HX...`,
  `usr_01HX...`) — Stripe-style, optional but helpful for debugging

## Pagination

**Cursor-based**, not offset:
```
GET /api/v1/tasks?cursor=eyJpZCI6Li4ufQ&limit=50

200 OK
{
  "data": [...],
  "pagination": {
    "next_cursor": "eyJpZCI6Li4ufQ",
    "prev_cursor": "eyJpZC...",
    "has_more": true
  }
}
```

Why cursor: stable across inserts, no skipping/duplication on concurrent writes,
performant (no `OFFSET 100000`).

Limit: bounded (`min: 1, max: 200, default: 50`). Document defaults.

## Filtering and sorting

```
GET /api/v1/tasks?status=running&project_id=X&sort=-created_at&limit=20
```

- Multi-value: `status=running,failed` (CSV) OR `status=running&status=failed` (repeated)
  — pick one and document
- Sort: `-` prefix for descending (`-created_at` = newest first)
- Allowed fields enumerated in OpenAPI; reject unknown filters with 400

## Versioning

- **URL path version** for major: `/api/v1/`, `/api/v2/`
- Bump major ONLY for breaking changes:
  - Removing or renaming a field
  - Changing field type
  - Changing required/optional status of input
  - Changing semantics of existing field
- Backward-compatible additions (new optional field, new endpoint) stay in
  same version
- Run N and N-1 in parallel for at least 6 months on retirement

## Authentication

- **Authorization header** with bearer token: `Authorization: Bearer <token>`
- NEVER pass tokens in URL query strings (logs leak)
- Document required scopes/roles per endpoint in OpenAPI
- 401 if no/bad token, 403 if token valid but insufficient permissions

## Rate limiting

Headers on every response:
```
X-Rate-Limit-Limit: 1000
X-Rate-Limit-Remaining: 942
X-Rate-Limit-Reset: 1714665600
```
On 429, include `Retry-After: <seconds>` header.

## Idempotency

POST operations that create resources should accept `Idempotency-Key` header:
```
POST /api/v1/payments
Idempotency-Key: 01HXXXXXXXXXXXXXXX
```
Server stores key + response for 24 hours; replays return the original response.
Critical for payments, trades, irreversible operations.

## OpenAPI

- Schema-first OR code-first (generated from Zod / Pydantic / etc.) — both fine
- Publish at `/openapi.json` and human-readable at `/docs` (Swagger UI / Scalar)
- Include examples in every schema
- Mark deprecated fields/endpoints with `deprecated: true`
- CI-enforced backward compatibility check (e.g. `oasdiff`)

## Webhooks (if applicable)

- POST event payload to subscriber URL
- HMAC signature in `X-Signature` header (subscribers verify with shared secret)
- Retry with exponential backoff (5 attempts over 24h)
- Subscriber returns 2xx within 10s = success; anything else = retry
- Event IDs unique; subscribers should dedupe

## DO NOT
- ❌ Verb-in-URL (`/api/v1/getUserById/123`) — use HTTP methods
- ❌ Mix singular and plural resource names — always plural
- ❌ Return 200 OK with error body — use proper status codes
- ❌ Invent per-endpoint error formats — use one shape (RFC 7807)
- ❌ Use offset pagination for large datasets — cursor only
- ❌ Expose internal database IDs sequentially — UUID/ULID
- ❌ Return wall-of-text errors without machine-readable codes
- ❌ Break compatibility within a major version
- ❌ Skip OpenAPI documentation — undocumented endpoints WILL be misused
- ❌ Use HTTP for sensitive APIs — TLS only, HSTS enabled
