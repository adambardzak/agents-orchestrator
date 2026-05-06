# Database Patterns

**TL;DR:** PostgreSQL is the default. Use UUID v7 / ULID for primary keys
(sortable, no enumeration). Add `created_at`/`updated_at` to every table.
Index foreign keys and frequent query patterns. Use migrations for ALL schema
changes (no manual SQL in production). Wrap multi-write operations in
transactions. Soft-delete only when audit requires; otherwise hard-delete.
Never expose database errors to end users. Avoid N+1 queries — measure
or use ORM batching.

## Primary keys

Use **UUID v7** (sortable, time-based) or **ULID** (similar, base32):
```sql
id  UUID  PRIMARY KEY  DEFAULT gen_random_uuid()
-- pgcrypto extension for gen_random_uuid()
-- For UUID v7 specifically, use uuidv7-pg extension or generate in app
```

Why not auto-increment integers:
- Enumeration attacks (`/users/1`, `/users/2`...)
- Leak business metrics (order count visible)
- Merge conflicts in distributed systems
- Migration headaches

When integers ARE fine: internal-only tables, lookup tables (countries, currencies).

## Common columns

Every domain table:
```sql
id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
created_at  TIMESTAMPTZ  NOT NULL    DEFAULT now(),
updated_at  TIMESTAMPTZ  NOT NULL    DEFAULT now()
```

Always `TIMESTAMPTZ` (timestamp with time zone), never `TIMESTAMP` —
prevents timezone confusion.

`updated_at` auto-update via trigger:
```sql
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

## Naming

- **Tables**: snake_case, plural (`users`, `order_items`)
- **Columns**: snake_case (`created_at`, `user_id`)
- **Foreign keys**: `<referenced_table_singular>_id` (`user_id`, `project_id`)
- **Indexes**: `<table>_<columns>_idx` for regular, `_unique` for unique
- **Constraints**: `<table>_<column>_check` for check constraints

## Foreign keys

ALWAYS declare them — get referential integrity, automatic indexes (in some DBs;
NOT in PostgreSQL — index FK columns explicitly):

```sql
CREATE TABLE tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- ...
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tasks_project_id_idx ON tasks(project_id);
```

`ON DELETE` options:
- **CASCADE** — child rows deleted with parent (use for true ownership: ProjectFiles)
- **SET NULL** — child column nulled (use for optional references: assigned_to_user_id)
- **RESTRICT** (default) — block parent delete if children exist (use for safety)

## Indexes

Index:
- Every foreign key column (PostgreSQL doesn't auto-index FKs)
- Columns in WHERE clauses on hot queries
- Columns in ORDER BY when paired with WHERE
- Composite indexes for multi-column filters (column order matters: most-selective first)

Don't over-index:
- Each index slows writes
- Tables < 10K rows: indexes often don't matter
- Use `EXPLAIN ANALYZE` to verify usage before adding

```sql
CREATE INDEX projects_owner_id_status_idx
  ON projects(owner_id, status)
  WHERE deleted_at IS NULL;  -- partial index, smaller, faster
```

## Migrations

ALL schema changes via migrations. Never `psql` against production to fix things.

Tools: Prisma Migrate, Knex, Flyway, Liquibase, Sqitch — pick one per project.

Rules:
- Migrations are **append-only** — never edit a migration that ran in any environment
- Each migration **idempotent if possible** (use `IF NOT EXISTS`)
- **Reversible** when feasible (provide `down`)
- Test migrations on staging with production-like data BEFORE prod
- Long-running migrations (large data backfills) split into:
  1. Schema change (fast, transactional)
  2. Backfill in batches (background job)
  3. Add NOT NULL / constraint after backfill complete

## Transactions

Wrap multi-write operations:
```typescript
await db.$transaction(async (tx) => {
  const order = await tx.order.create({ data: { ... } })
  await tx.orderItem.createMany({ data: items.map(i => ({ orderId: order.id, ...i })) })
  await tx.user.update({ where: { id: userId }, data: { creditBalance: { decrement: total } } })
})
```

If any step throws, all roll back.

Pitfalls:
- Long transactions hold locks → contention. Keep short.
- External calls (HTTP, email) inside transactions → if external succeeds but
  transaction rolls back, you have a side effect with no DB record. Use
  outbox pattern: insert into `outbox` table inside transaction, separate worker
  reads outbox and makes the external call.
- Nested transactions are usually savepoints — read your ORM's docs.

## Soft delete vs hard delete

Default: **hard delete** (DELETE row). Simpler, GDPR-friendly.

Soft delete (`deleted_at TIMESTAMPTZ`) only when:
- Regulatory requirement to retain (audit, finance)
- Undelete UX is required (trash bin)
- Foreign key references must remain valid

If soft-deleting:
- Add `WHERE deleted_at IS NULL` to EVERY query (use ORM scopes/middleware)
- Beware unique constraints conflicting with soft-deleted rows — use partial
  unique indexes: `UNIQUE (email) WHERE deleted_at IS NULL`
- Provide a hard-delete path for GDPR right-to-be-forgotten

## N+1 queries

The most common performance bug:
```typescript
// ❌ N+1
const projects = await db.project.findMany()
for (const p of projects) {
  p.tasks = await db.task.findMany({ where: { projectId: p.id } })
}

// ✅ Use ORM include / join
const projects = await db.project.findMany({ include: { tasks: true } })
```

Detect: log SQL queries in dev, count per request. Tools: `prisma-extension-trace`,
`sequelize:logging`, `EXPLAIN`. Fix with `include`, `join`, or DataLoader pattern.

## Pagination

- **Cursor pagination** for large or live datasets:
  `WHERE id > $cursor ORDER BY id LIMIT 50`
- **Offset pagination** only for small bounded sets and admin UIs:
  `LIMIT 50 OFFSET 200` — gets slow at high offsets

Always include a stable secondary sort:
```sql
ORDER BY created_at DESC, id DESC  -- id breaks ties when timestamps collide
```

## JSON columns

PostgreSQL JSONB is great for:
- Flexible attributes that vary per row (configs, metadata, feature flags)
- Avoiding EAV (entity-attribute-value) anti-pattern
- Fast indexing with GIN: `CREATE INDEX ON t USING GIN (jsonb_col)`

Do NOT use JSONB for:
- Data you query/aggregate frequently — use proper columns
- Relationships — use proper FK joins
- Anything you'd join across (impossible cleanly)

Rule of thumb: if a JSONB key is queried in WHERE on every request, promote
it to a column.

## Concurrency control

For "read-modify-write" with conflict potential:

**Optimistic locking** (recommended default):
```sql
ALTER TABLE projects ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

UPDATE projects
SET name = $1, version = version + 1
WHERE id = $2 AND version = $3;

-- If 0 rows affected, someone else updated; retry or surface conflict
```

**Pessimistic locking** (when actual contention is expected):
```sql
SELECT * FROM accounts WHERE id = $1 FOR UPDATE;
-- holds row lock until commit
```

## Migrations and zero-downtime

Breaking schema changes need a multi-step rollout:
1. Add new column / table (backwards compatible)
2. Deploy code that writes to BOTH old and new
3. Backfill old data into new
4. Deploy code that reads from new only
5. Drop old column / table

Never simultaneously rename, drop, and deploy code expecting the new name.

## Security

- ALWAYS parameterize queries (no string concatenation):
  ```typescript
  // ❌ SQL injection
  db.query(`SELECT * FROM users WHERE email = '${email}'`)
  // ✅ Parameterized
  db.query('SELECT * FROM users WHERE email = $1', [email])
  ```
- Apps connect with **least privilege** account (no DROP, no schema changes)
- Migrations run with separate higher-privilege account
- Sensitive columns encrypted at app layer (e.g. `pgcrypto` or app-side AES-GCM)
- TLS to DB always, even in same VPC

## Observability

- Slow query log enabled (queries > 100ms)
- Connection pool metrics monitored
- Index hit rate (`pg_stat_user_indexes`) reviewed monthly
- Vacuum and bloat monitoring (or use managed PG that handles this)

## DO NOT
- ❌ Auto-increment integer PKs in public APIs
- ❌ `TIMESTAMP` without `TZ` — always `TIMESTAMPTZ`
- ❌ Skip foreign key indexes in PostgreSQL (other DBs auto-index; PG does not)
- ❌ Run schema changes outside migration system in any environment
- ❌ String-concatenate user input into SQL — parameterize always
- ❌ Hold transactions open during HTTP calls or user input
- ❌ Soft-delete by default — hard-delete unless audit requires
- ❌ Use `SELECT *` in production code — list columns explicitly
- ❌ Use ORM lazy-loading without measuring (N+1 explosions)
- ❌ Run cross-DB joins or distributed transactions — denormalize or use events
- ❌ Use MongoDB / DynamoDB as default for relational data — PostgreSQL handles
  document use cases via JSONB and gives you ACID and joins on top
