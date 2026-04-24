export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { sendBroadcast } from '@/lib/email';

const Body = z.object({
  subject: z.string().min(1).max(200),
  html: z.string().min(1).max(50_000),
  testTo: z.string().email().optional(),
});

export async function POST(req: Request) {
  await requireAdmin();
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  if (p.data.testTo) {
    await sendBroadcast(p.data.subject, p.data.html, [p.data.testTo], {
      siteUrl,
      plainEmails: true,
    });
    return NextResponse.json({ sentTest: true });
  }

  const { rows } = await pool.query<{ id: number; email: string }>(
    `SELECT id, email FROM subscribers
     WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL`,
  );
  if (!rows.length) return NextResponse.json({ sent: 0 });
  await sendBroadcast(p.data.subject, p.data.html, rows, { siteUrl });
  return NextResponse.json({ sent: rows.length });
}
