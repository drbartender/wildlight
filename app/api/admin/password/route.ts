export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { requireAdmin, setAdminSession } from '@/lib/session';
import { hashPassword, verifyPassword } from '@/lib/auth';

const Body = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12).max(200),
});

export async function POST(req: Request) {
  const s = await requireAdmin();
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const r = await pool.query<{ password_hash: string }>(
    'SELECT password_hash FROM admin_users WHERE id = $1',
    [s.id],
  );
  if (!r.rowCount) return NextResponse.json({ error: 'no such user' }, { status: 404 });
  if (!(await verifyPassword(p.data.currentPassword, r.rows[0].password_hash))) {
    return NextResponse.json({ error: 'wrong password' }, { status: 401 });
  }
  const hash = await hashPassword(p.data.newPassword);
  // Bump session_version so every other open session (different device,
  // stolen cookie) fails the per-request version check in getAdminSession.
  // The current admin keeps working because we re-issue their cookie with
  // the new version below.
  const u = await pool.query<{ session_version: number }>(
    `UPDATE admin_users
     SET password_hash = $2,
         session_version = session_version + 1,
         password_changed_at = NOW()
     WHERE id = $1
     RETURNING session_version`,
    [s.id, hash],
  );
  await setAdminSession({ id: s.id, email: s.email, v: u.rows[0].session_version });
  return NextResponse.json({ ok: true });
}
