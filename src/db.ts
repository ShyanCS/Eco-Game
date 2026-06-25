import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://eco:eco@localhost:5432/eco',
});

/**
 * Run a callback inside a single database transaction.
 * Automatically handles BEGIN, COMMIT, and ROLLBACK on error.
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run a simple query outside a transaction (for reads, health checks, etc.)
 */
export async function query(text: string, params?: unknown[]) {
  return pool.query(text, params);
}

/**
 * Gracefully shut down the pool.
 */
export async function closePool() {
  await pool.end();
}

export default pool;
