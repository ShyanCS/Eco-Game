import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

/**
 * Get or create the connection pool.
 * Lazy initialization so tests can set DATABASE_URL before the first use.
 */
function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL ?? 'postgresql://eco:eco@localhost:5433/eco',
    });
  }
  return pool;
}

/**
 * Run a callback inside a single database transaction.
 * Automatically handles BEGIN, COMMIT, and ROLLBACK on error.
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
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
  return getPool().query(text, params);
}

/**
 * Gracefully shut down the pool.
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export default getPool;
