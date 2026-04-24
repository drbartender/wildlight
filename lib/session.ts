import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  signAdminToken,
  verifyAdminToken,
  type AdminTokenPayload,
} from './auth';

const COOKIE = 'wl_admin';
const THIRTY_DAYS = 60 * 60 * 24 * 30;

export async function setAdminSession(payload: AdminTokenPayload) {
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
  try {
    return verifyAdminToken(token);
  } catch {
    return null;
  }
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
 * Use in Route Handlers (API routes). Throws a 401-shaped Response when unauthenticated.
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
