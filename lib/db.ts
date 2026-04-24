import { Pool, type PoolClient } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var __wildlight_pool: Pool | undefined;
}

function createPool(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    // Neon serves a valid public cert chain; verify it. If you hit
    // SELF_SIGNED_CERT errors on some managed hosts, flip to `false`.
    ssl: process.env.DATABASE_URL?.includes('localhost')
      ? false
      : { rejectUnauthorized: true },
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000, // fail-fast if Neon cold start stalls
    // Hard server-side statement cap — any single query taking >15s is a bug.
    statement_timeout: 15_000,
  });
}

export const pool: Pool = global.__wildlight_pool ?? createPool();
if (process.env.NODE_ENV !== 'production') global.__wildlight_pool = pool;

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
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
