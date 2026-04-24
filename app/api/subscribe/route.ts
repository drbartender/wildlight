export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';

const Body = z.object({
  email: z.string().email(),
  source: z.string().max(80).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid email' }, { status: 400 });
  }
  const { email, source } = parsed.data;
  await pool.query(
    `INSERT INTO subscribers (email, source, confirmed_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (email) DO UPDATE SET
       unsubscribed_at = NULL,
       confirmed_at = COALESCE(subscribers.confirmed_at, EXCLUDED.confirmed_at)`,
    [email.toLowerCase(), source || 'footer'],
  );
  return NextResponse.json({ ok: true });
}
