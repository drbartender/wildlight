import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  signAdminToken,
  verifyAdminToken,
  type AdminTokenPayload,
} from './auth';
import { pool } from './db';
import { logger } from './logger';

const COOKIE = 'wl_admin';
const THIRTY_DAYS = 60 * 60 * 24 * 30;

export async function setAdminSession(payload: AdminTokenPayload) {
  // Defense-in-depth: never mint the admin cookie on a non-admin host. The
  // middleware already redirects cookie-minting endpoints (/login,
  // /api/auth/login) to ADMIN_HOST, but if a future endpoint forgets to do
  // that — or middleware is bypassed — the cookie would otherwise scope to
  // apex and become a cross-host credential. Throw instead.
  const adminHost = process.env.ADMIN_HOST?.toLowerCase();
  if (adminHost) {
    const h = await headers();
    const host = (h.get('host') ?? '').split(':')[0].toLowerCase();
    if (host !== adminHost) {
      throw new Error(
        `setAdminSession refused on host '${host}' — must be called on ADMIN_HOST`,
      );
    }
  }
  const token = signAdminToken(payload);
  const c = await cookies();
  c.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: THIRTY_DAYS,
  });
}

export async function clearAdminSession() {
  const c = await cookies();
  c.delete(COOKIE);
}

export async function getAdminSession(): Promise<AdminTokenPayload | null> {
  const c = await cookies();
  const token = c.get(COOKIE)?.value;
  if (!token) return null;
  let payload: AdminTokenPayload;
  try {
    payload = verifyAdminToken(token);
  } catch {
    return null;
  }
  // Per-request lookup so a stolen cookie is invalidated the moment the
  // owner rotates their password (which bumps session_version) or the
  // admin row is deleted. One indexed PK query — ~1ms on a warm pool.
  try {
    const r = await pool.query<{ session_version: number }>(
      'SELECT session_version FROM admin_users WHERE id = $1',
      [payload.id],
    );
    if (!r.rowCount || r.rows[0].session_version !== payload.v) {
      return null;
    }
  } catch (err) {
    // Fail closed on DB error — better to log out an admin than to grant
    // access against a stale version check. Surface in logs so a Neon
    // outage manifests as visible warnings instead of silent unauth.
    logger.warn('session.version_lookup_failed', { err, id: payload.id });
    return null;
  }
  return payload;
}

/**
 * Use in Server Components and Server Actions — redirects to /login
 * when the visitor isn't authenticated.
 */
export async function requireAdminOrRedirect(): Promise<AdminTokenPayload> {
  const s = await getAdminSession();
  if (!s) redirect('/login');
  return s;
}

/**
 * Use in Route Handlers (API routes). Throws a 401 Response when unauthenticated.
 *
 * The throw only reaches the client as a 401 if the handler is wrapped in
 * `adminRoute` (lib/admin-route.ts). Next does NOT surface a thrown Response
 * from a route handler on its own: it rethrows, and the caller gets a bare 500
 * with an empty body. Every handler under app/api/admin is wrapped; a new one
 * must be too, or it will fail closed but lie about why.
 */
export async function requireAdmin(): Promise<AdminTokenPayload> {
  const s = await getAdminSession();
  if (!s) {
    throw new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return s;
}
