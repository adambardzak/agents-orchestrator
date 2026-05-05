import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Runs all SQL migration files in order.
 * Safe to run multiple times — uses IF NOT EXISTS throughout.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });

  try {
    await client.connect();

    // Create migrations tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id        SERIAL PRIMARY KEY,
        filename  TEXT NOT NULL UNIQUE,
        ran_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Get already-run migrations
    const { rows } = await client.query<{ filename: string }>(
      'SELECT filename FROM _migrations ORDER BY id',
    );
    const ran = new Set(rows.map((r) => r.filename));

    // Discover all .sql files in the migrations directory and run any
    // that haven't been applied yet, in lexicographic order (NNN_*.sql).
    const migrationsDir = join(__dirname, 'migrations');
    const allFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const files = allFiles.filter((f) => !ran.has(f));

    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), 'utf-8');
      console.log(`Running migration: ${file}`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Migration ${file} completed`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }

    if (files.length === 0) {
      console.log('All migrations already applied');
    }
  } finally {
    await client.end();
  }
}
