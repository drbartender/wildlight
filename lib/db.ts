import { Pool, type PoolClient } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var __wildlight_pool: Pool | undefined;
}

function wantsNoSsl(url: string | undefined): boolean {
  if (!url) return false;
  // Local dev hosts or an explicit sslmode=disable in the connection string.
  return (
    /@(localhost|127\.0\.0\.1|::1)(:\d+)?\//.test(url) ||
    /[?&]sslmode=disable\b/i.test(url)
  );
}

function createPool(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    // Verify cert chain on managed hosts (Neon, RDS, etc serve valid public
    // certs). If you hit SELF_SIGNED_CERT errors, flip to `false`.
    ssl: wantsNoSsl(process.env.DATABASE_URL)
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

/**
 * Coerce a URL path segment to a positive integer id. Returns null for
 * non-numeric / fractional / out-of-range input so callers can 400 early
 * instead of letting Postgres reject the query with an integer-parse
 * error that leaks SQL fragments into the response body.
 */
export function parsePathId(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Recognises transient pg connection drops (WILDLIGHT-1 in Sentry —
 * Neon idle-kills pool connections faster than pg notices). Use to
 * decide whether to retry a single failed query rather than surfacing
 * an opaque 500 to the client.
 */
export function isTransientPgError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (/connection terminated/i.test(err.message)) return true;
  const code = (err as { code?: string }).code;
  // ECONNRESET — TCP drop. 57P01 admin_shutdown / 57P02 crash_shutdown —
  // Postgres-side connection close.
  return code === 'ECONNRESET' || code === '57P01' || code === '57P02';
}

/**
 * Run `fn` once, and if it fails with a transient connection drop,
 * retry it exactly once. The pg pool will hand out a fresh connection
 * on the second attempt. Caller is responsible for keeping `fn`
 * idempotent — slug-uniquify loops, INSERT-ON-CONFLICT, and naked
 * single-statement inserts are safe (a failed attempt rolls back, so
 * no row is left behind; a sequence gap is harmless). Multi-statement
 * fn() that wraps `withTransaction` is also safe in the common case
 * — only a COMMIT-ack loss could cause a duplicate write, which is
 * rare under Neon's typical idle-drop pattern.
 *
 * 50 ms pause before retry so we don't hammer a Neon endpoint that's
 * currently rotating connections; cheap relative to the ~300 ms a
 * fresh pool connect already costs.
 */
export async function withConnRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isTransientPgError(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, 50));
    return await fn();
  }
}
