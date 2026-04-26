import crypto from 'node:crypto';
import { pool } from './db';

export { getClientIp } from './rate-limit';

const WINDOW_MINUTES = 15;
const MAX_FAILS_PER_IP = 10;
const MAX_FAILS_PER_EMAIL = 5;

/**
 * Hash the IP with the JWT secret as salt. Storing plaintext IPs in a
 * security log is a privacy-leak vector if the table is ever exfiltrated;
 * the hash still allows rate-limit grouping but defangs correlation.
 */
function hashIp(ip: string): string {
  const salt = process.env.JWT_SECRET;
  if (!salt) throw new Error('JWT_SECRET required for login rate limit');
  return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

export interface LoginGate {
  blocked: boolean;
  /** Seconds until next attempt is allowed, when blocked. */
  retryAfter?: number;
}

/**
 * Read-only check — does NOT record an attempt. Call this before bcrypt
 * to short-circuit rate-limited requests.
 */
export async function checkLoginAttempts(
  ip: string,
  email: string,
): Promise<LoginGate> {
  const ipHash = hashIp(ip);
  const emailLc = email.toLowerCase();
  const r = await pool.query<{ by_ip: string; by_email: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE ip_hash = $1) AS by_ip,
       COUNT(*) FILTER (WHERE email_normalized = $2) AS by_email
     FROM login_attempts
     WHERE success = FALSE
       AND attempted_at >= NOW() - INTERVAL '${WINDOW_MINUTES} minutes'
       AND (ip_hash = $1 OR email_normalized = $2)`,
    [ipHash, emailLc],
  );
  const byIp = Number(r.rows[0]?.by_ip ?? 0);
  const byEmail = Number(r.rows[0]?.by_email ?? 0);
  if (byIp >= MAX_FAILS_PER_IP || byEmail >= MAX_FAILS_PER_EMAIL) {
    return { blocked: true, retryAfter: WINDOW_MINUTES * 60 };
  }
  return { blocked: false };
}

export async function recordLoginAttempt(
  ip: string,
  email: string,
  success: boolean,
): Promise<void> {
  await pool.query(
    `INSERT INTO login_attempts (ip_hash, email_normalized, success)
     VALUES ($1, $2, $3)`,
    [hashIp(ip), email.toLowerCase(), success],
  );

  // Sampled cleanup so the table doesn't grow unbounded. Window is 15min;
  // 30 days is a comfortable buffer for forensics. Best-effort — failures
  // here don't affect the login flow.
  if (Math.random() < 0.01) {
    pool
      .query(
        `DELETE FROM login_attempts WHERE attempted_at < NOW() - INTERVAL '30 days'`,
      )
      .catch(() => {});
  }
}
