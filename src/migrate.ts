import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

/**
 * Minimal migration runner.
 * - Reads .sql files from the migrations/ directory in sorted order.
 * - Tracks applied migrations in a `_migrations` table.
 * - Each migration runs in its own transaction.
 */
async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://eco:eco@localhost:5433/eco';
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  // Ensure the migrations tracking table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Read all .sql files from migrations/ directory
  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    // Check if already applied
    const { rows } = await client.query(
      'SELECT name FROM _migrations WHERE name = $1',
      [file]
    );

    if (rows.length > 0) {
      console.log(`  ✓ ${file} (already applied)`);
      continue;
    }

    // Read and execute the migration
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO _migrations (name) VALUES ($1)',
        [file]
      );
      await client.query('COMMIT');
      console.log(`  ✔ ${file} applied`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ✗ ${file} failed:`, err);
      throw err;
    }
  }

  await client.end();
  console.log('Migrations complete.');
}

runMigrations().catch((err) => {
  console.error('Migration runner failed:', err);
  process.exit(1);
});
