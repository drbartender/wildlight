import crypto from 'node:crypto';
import { pool, withTransaction } from './db';

/**
 * Per-Vercel-function-instance rate limiting won't work — Fluid Compute
 * recycles instances across concurrent requests, and Vercel's edge has
 * no shared memory store wired up here. So we use the DB.
 *
 * For each scope (e.g. "subscribe", "contact"), we store one row per
 * attempt keyed by a hash of the client identifier (typically IP). The
 * count over a rolling window decides whether to block.
 */

function hashKey(scope: string, key: string): string {
  const salt = process.env.JWT_SECRET;
  if (!salt) throw new Error('JWT_SECRET required for rate limit');
  return crypto
    .createHash('sha256')
    .update(`${salt}:${scope}:${key}`)
    .digest('hex')
    .slice(0, 32);
}

export function getClientIp(req: Request): string {
  const ip =
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (ip) return ip;
  // No reliable IP header — proxy misconfig, internal probe, or a request
  // that bypassed Vercel's edge. Bucket on User-Agent so a bot deliberately
  // stripping IP headers can't pin all anonymous traffic to one shared
  // rate-limit key (which would DoS legitimate header-less traffic). UA
  // rotation defeats this segmentation, but at the bot's resource cost.
  const ua = req.headers.get('user-agent') || 'no-ua';
  return `noip:${ua.slice(0, 80)}`;
}

export interface RateLimitGate {
  blocked: boolean;
  /** Seconds until the next attempt is allowed. Only set when blocked. */
  retryAfter?: number;
}

/**
 * Records the current attempt then checks if the caller is over the
 * window threshold. The current attempt counts toward the limit so the
 * first request over the cap gets blocked.
 *
 * Wrapped in a transaction with pg_advisory_xact_lock keyed by
 * (scope, key_hash) so concurrent requests serialize per-key — the
 * naive INSERT+SELECT under READ COMMITTED would let a parallel burst
 * each see only its own row and slip past the cap together.
 *
 * The window literal is interpolated into SQL — callers must pass a
 * controlled integer, not user input.
 */
export async function recordAndCheckRateLimit(
  scope: string,
  key: string,
  windowSeconds: number,
  maxAttempts: number,
): Promise<RateLimitGate> {
  if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) {
    throw new Error('windowSeconds must be a positive integer');
  }
  const keyHash = hashKey(scope, key);

  const count = await withTransaction(async (client) => {
    // Two-arg advisory lock with hashtext gives a stable bigint per key.
    // Released automatically at txn end.
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))`,
      [scope, keyHash],
    );
    await client.query(
      `INSERT INTO rate_limit_events (scope, key_hash) VALUES ($1, $2)`,
      [scope, keyHash],
    );
    const r = await client.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count
       FROM rate_limit_events
       WHERE scope = $1 AND key_hash = $2
         AND attempted_at >= NOW() - INTERVAL '${windowSeconds} seconds'`,
      [scope, keyHash],
    );
    return Number(r.rows[0]?.count ?? 0);
  });

  // Sampled cleanup so the table doesn't grow unbounded. Outside the txn
  // so the lock isn't held during the DELETE.
  if (Math.random() < 0.01) {
    pool
      .query(
        `DELETE FROM rate_limit_events WHERE attempted_at < NOW() - INTERVAL '7 days'`,
      )
      .catch(() => {});
  }

  if (count > maxAttempts) {
    return { blocked: true, retryAfter: windowSeconds };
  }
  return { blocked: false };
}
