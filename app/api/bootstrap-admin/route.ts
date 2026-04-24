/*
 * One-time admin seed endpoint. Secured by BOOTSTRAP_SECRET env var.
 *
 * Delete this file (and the BOOTSTRAP_SECRET env var) once the initial admin
 * is seeded. It's here so Dallas can seed without needing local DB access,
 * then we tear it down before any real customer traffic.
 */
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'node:crypto';
import { pool } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { logger } from '@/lib/logger';

const Body = z.object({
  secret: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(12),
});

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export async function POST(req: Request) {
  const expected = process.env.BOOTSTRAP_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'bootstrap disabled (BOOTSTRAP_SECRET not set)' },
      { status: 503 },
    );
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  if (!constantTimeEqual(parsed.data.secret, expected)) {
    logger.warn('bootstrap.bad_secret', {
      ip:
        req.headers.get('cf-connecting-ip') ||
        req.headers.get('x-real-ip') ||
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        null,
    });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const hash = await hashPassword(parsed.data.password);
  const res = await pool.query<{ id: number; email: string }>(
    `INSERT INTO admin_users (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id, email`,
    [parsed.data.email.toLowerCase(), hash],
  );
  const row = res.rows[0];
  logger.info('bootstrap.admin_seeded', { id: row.id, email: row.email });
  return NextResponse.json({ ok: true, id: row.id, email: row.email });
}
