export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { setAdminSession } from '@/lib/session';
import { logger } from '@/lib/logger';

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

// Real bcrypt-cost-12 hash of a random string nobody knows. Used when the
// email doesn't exist so verifyPassword exercises the full bcrypt path and
// timing is indistinguishable from a wrong-password-for-real-user attempt.
// (Generated once via: `node -e "require('bcryptjs').hash(require('crypto').randomBytes(32).toString('hex'), 12).then(console.log)"`.)
const DUMMY_HASH = '$2a$12$CIWQqTkAjCqRQvOBS.X3QuBKyg/Ku701UJ7VKV4vczm9ujgopU/Om';

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const res = await pool.query<{ id: number; email: string; password_hash: string }>(
    'SELECT id, email, password_hash FROM admin_users WHERE email = $1',
    [email.toLowerCase()],
  );
  const row = res.rows[0];
  const hash = row?.password_hash || DUMMY_HASH;
  const ok = await verifyPassword(password, hash);

  if (!row || !ok) {
    logger.warn('auth.login_failed', {
      email: email.toLowerCase(),
      ip:
        req.headers.get('cf-connecting-ip') ||
        req.headers.get('x-real-ip') ||
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        null,
      ua: req.headers.get('user-agent') || null,
    });
    return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
  }
  await setAdminSession({ id: row.id, email: row.email });
  logger.info('auth.login_ok', { id: row.id, email: row.email });
  return NextResponse.json({ ok: true });
}
