export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { setAdminSession } from '@/lib/session';

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

// Dummy bcrypt hash used when the email doesn't exist, to equalize the cost
// of the code path and avoid leaking whether an account exists.
const DUMMY_HASH = '$2b$12$inVAl1dInVAl1dInVAl1du0h0h0h0h0h0h0h0h0h0h0h0h0h0h';

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
    return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
  }
  await setAdminSession({ id: row.id, email: row.email });
  return NextResponse.json({ ok: true });
}
