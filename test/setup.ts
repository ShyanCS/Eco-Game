import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { type FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { closePool } from '../src/db.js';

const { Client, Pool } = pg;

const TEST_DB = 'eco_test';
const TEST_DB_URL = `postgresql://eco:eco@localhost:5433/${TEST_DB}`;

let pool: pg.Pool | null = null;

/**
 * Create the test database if it doesn't exist, then run migrations.
 * Called once before the entire test suite.
 */
export async function setupTestDb() {
  // Connect to the default 'eco' database to create the test database
  const adminClient = new Client({
    connectionString: 'postgresql://eco:eco@localhost:5433/eco',
  });
  await adminClient.connect();

  // Create test database if it doesn't exist
  const { rows } = await adminClient.query(
    `SELECT 1 FROM pg_database WHERE datname = $1`,
    [TEST_DB]
  );
  if (rows.length === 0) {
    await adminClient.query(`CREATE DATABASE ${TEST_DB}`);
  }
  await adminClient.end();

  // Run migrations on the test database
  const migrationClient = new Client({ connectionString: TEST_DB_URL });
  await migrationClient.connect();

  await migrationClient.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await migrationClient.query(
      'SELECT name FROM _migrations WHERE name = $1',
      [file]
    );
    if (rows.length > 0) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    await migrationClient.query('BEGIN');
    try {
      await migrationClient.query(sql);
      await migrationClient.query(
        'INSERT INTO _migrations (name) VALUES ($1)',
        [file]
      );
      await migrationClient.query('COMMIT');
    } catch (err) {
      await migrationClient.query('ROLLBACK');
      throw err;
    }
  }

  await migrationClient.end();

  // Create a pool for tests to use
  pool = new Pool({ connectionString: TEST_DB_URL });
}

/**
 * Truncate all data tables between tests (keeps schema intact).
 */
export async function cleanDb() {
  if (!pool) throw new Error('Test DB not initialized — call setupTestDb() first');
  await pool.query(`
    TRUNCATE accounts, ledger, inventory, reward_claims, idempotency_keys
    CASCADE
  `);
}

/**
 * Build a Fastify server instance pointed at the test database.
 * Uses Fastify's inject() — no port binding needed.
 */
export function buildTestServer(): FastifyInstance {
  // Override DATABASE_URL so the db module connects to the test database
  process.env.DATABASE_URL = TEST_DB_URL;
  return buildServer();
}

/**
 * Shut down the test pool. Called once after the entire test suite.
 */
export async function teardownTestDb() {
  // Close the app's database pool (used by routes)
  await closePool();
  // Close the test helper pool
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export { pool, TEST_DB_URL };
