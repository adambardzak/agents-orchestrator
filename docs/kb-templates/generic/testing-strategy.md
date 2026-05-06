# Testing Strategy

**TL;DR:** Test pyramid: many unit tests (fast, isolated), fewer integration
tests (real DB, in-memory broker), few end-to-end tests (full stack against
deployed app). Aim for behaviour, not implementation. Keep tests deterministic
(no random, no real time, no real network without explicit fixtures). Run unit
tests on every save, integration on every push, E2E on every PR. Never skip
flaky tests — fix them or delete them.

## Test pyramid

```
            /\
           /E2\        ← few (5-30 per app)
          /----\         slow, brittle, real browsers/services
         /  IT  \      ← some (50-500)
        /--------\       real DB/Redis/Kafka in containers
       / Unit Test\    ← many (500-5000)
      /------------\     fast, in-memory, no I/O
```

Goal: 70% unit / 25% integration / 5% E2E (rough guideline, not gospel).

## Unit tests

Test a single function/class in isolation. No DB, no HTTP, no filesystem,
no real time.

```typescript
import { describe, it, expect } from 'vitest'

describe('calculateOrderTotal', () => {
  it('applies discount when coupon is valid', () => {
    const total = calculateOrderTotal({
      items: [{ price: 100, qty: 2 }],
      coupon: { code: 'SAVE10', percent: 10 },
    })
    expect(total).toEqual({ subtotal: 200, discount: 20, total: 180 })
  })

  it('rejects expired coupons', () => {
    const result = applyCoupon({ code: 'OLD', expiresAt: new Date('2020-01-01') })
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('COUPON_EXPIRED')
  })
})
```

Rules:
- One assertion focus per test (multiple `expect()` calls fine if they verify
  the same logical outcome)
- Test name describes behaviour, not method (`rejects expired coupons`
  not `applyCoupon test 3`)
- Arrange / Act / Assert structure
- No shared mutable state between tests

## Integration tests

Test multiple components together with real dependencies (DB, Redis, queue).
Use containers (Testcontainers) or compose stack.

```typescript
import { test, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer } from '@testcontainers/postgresql'

let pg: StartedPostgreSqlContainer

beforeAll(async () => {
  pg = await new PostgreSqlContainer().start()
  process.env.DATABASE_URL = pg.getConnectionUri()
  await runMigrations()
})

afterAll(() => pg?.stop())

test('createProject persists and returns project with id', async () => {
  const project = await createProject({ name: 'Test', ownerId: 'usr_1' })
  expect(project.id).toMatch(/^proj_/)
  const fetched = await db.project.findUnique({ where: { id: project.id } })
  expect(fetched?.name).toBe('Test')
})
```

Rules:
- Reset DB state between tests (truncate or transaction rollback)
- Do NOT share containers across unrelated test files (parallelism issues)
- Use real implementations of YOUR code; mock only external SaaS

## End-to-end tests

Test the full stack as a user would, through the real UI or HTTP API.

```typescript
import { test, expect } from '@playwright/test'

test('user can create a project and add a task', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'test@example.com')
  await page.fill('input[name=password]', 'test-password')
  await page.click('button[type=submit]')

  await page.goto('/projects/new')
  await page.fill('input[name=name]', 'My Project')
  await page.click('button:has-text("Create")')

  await expect(page).toHaveURL(/\/projects\/[a-z0-9_]+$/)
  await expect(page.locator('h1')).toHaveText('My Project')
})
```

Rules:
- Test critical user journeys, not every UI permutation
- Use stable selectors (`data-testid` attributes), NOT CSS class names or text
  that change with copywriting
- Each test independent — does not depend on previous test's leftover state
- Run against an environment specifically for E2E (seeded test data, isolated)
- Parallelize only if test design permits (no shared mutable state)

## What to test

- ✅ Business rules (discounts apply correctly, validation rejects invalid input)
- ✅ Edge cases (empty inputs, max sizes, boundary conditions, unicode, leap years, DST)
- ✅ Error paths (DB down, upstream times out, rate limit hit)
- ✅ Permissions (user A cannot access user B's data)
- ✅ Bug regressions (write a failing test FIRST, then fix)

## What NOT to test

- ❌ Framework internals (don't test that React renders or Zod validates)
- ❌ Third-party libraries (assume they work; if not, file an upstream issue)
- ❌ Trivial getters / pass-throughs
- ❌ Generated code (Prisma client, OpenAPI clients)
- ❌ UI styling pixel-perfect (use visual regression separately if needed)

## Test data

Use **factories** with sensible defaults, override per test:
```typescript
import { userFactory, projectFactory } from '@/test/factories'

const owner = userFactory.build({ email: 'owner@test' })
const proj = projectFactory.build({ ownerId: owner.id, name: 'Custom' })
```

Avoid:
- Massive fixture JSON files (brittle, hard to read)
- Snapshot tests for anything beyond stable output (every refactor breaks all snapshots)
- Real production data copied into tests

## Determinism

Tests MUST produce the same result every time. Sources of non-determinism to control:

```typescript
// Date
import { vi } from 'vitest'
vi.setSystemTime(new Date('2025-01-15T10:00:00Z'))

// Random
vi.spyOn(Math, 'random').mockReturnValue(0.5)
// or use seeded RNG

// UUID
vi.mock('uuid', () => ({ v4: () => 'fixed-uuid' }))

// Network — never let tests reach real internet
// Use msw (Mock Service Worker) or nock for HTTP
```

## Mocking — when and how

Mock at the boundary, not internally:
- ✅ Mock the HTTP client wrapper (one place)
- ✅ Mock the email service abstraction
- ❌ Mock 17 internal functions inside your service to test 1 line

Prefer **fakes** (working in-memory implementation) over **mocks** (assert exact calls).

## Coverage

- Set a minimum (`__COVERAGE_MIN__%`, e.g. 70%) and enforce in CI
- 100% coverage is NOT a meaningful goal — it just means every line ran, not that
  every behaviour is tested
- Critical paths (payments, auth, security) deserve >90%; cosmetic UI <50% is fine
- Coverage reports identify untested code; reading them periodically catches gaps

## Flaky tests

A test that passes sometimes and fails sometimes is **worse than no test** — it
trains people to ignore failures.

When you find one:
1. Reproduce locally (run 100x: `pnpm test --run --repeat 100 path/to/spec.ts`)
2. Identify cause: usually timing, ordering, shared state, real network/clock
3. Fix the cause OR delete the test (do NOT skip it indefinitely)

Never merge a `.skip()` or `.only()` to main — CI should reject these.

## CI integration

```
on push to PR:
  - lint
  - typecheck
  - unit tests (parallelize across CPU cores)
  - integration tests (containerized deps)
  - build
  - publish coverage report

on PR ready / nightly:
  - E2E suite against deployed preview env

on merge to main:
  - all of the above
  - deploy to staging
  - smoke tests against staging
```

## DO NOT
- ❌ Commit `.only()` or `.skip()` (CI should fail on these)
- ❌ Use `setTimeout` in tests to "wait for stuff" — use proper async waits
- ❌ Share state via module-level variables across tests
- ❌ Hit real external APIs in unit/integration (use msw / fixtures)
- ❌ Test implementation details (private methods, internal state) — test behaviour
- ❌ Leave failing tests in main — revert or fix immediately
- ❌ Write tests AFTER PR review — write them WITH the code
- ❌ Use Math.random / Date.now without controlling them
- ❌ Combine unit and integration tests in the same `describe` block
- ❌ Print to console from tests — use proper assertions
