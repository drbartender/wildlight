export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { sendBroadcast } from '@/lib/email';
import { logger } from '@/lib/logger';

const Body = z.object({
  subject: z.string().min(1).max(200),
  html: z.string().min(1).max(50_000),
  testTo: z.string().email().optional(),
  idempotencyKey: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  const session = await requireAdmin();
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  // Test sends bypass the log — they go to a single address and don't
  // need idempotency (admins can re-send tests at will).
  if (p.data.testTo) {
    await sendBroadcast(p.data.subject, p.data.html, [p.data.testTo], {
      siteUrl,
      plainEmails: true,
    });
    return NextResponse.json({ sentTest: true });
  }

  const idemKey = p.data.idempotencyKey;
  if (!idemKey) {
    return NextResponse.json(
      { error: 'idempotency key required for full send' },
      { status: 400 },
    );
  }

  const { rows: subs } = await pool.query<{ id: number; email: string }>(
    `SELECT id, email FROM subscribers
     WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL`,
  );
  if (!subs.length) return NextResponse.json({ sent: 0 });

  // Claim the idempotency key. INSERT ON CONFLICT DO NOTHING returns
  // zero rows if another request already claimed the same UUID.
  let logId = 0;
  await withTransaction(async (client) => {
    const claim = await client.query<{ id: number }>(
      `INSERT INTO broadcast_log (subject, html, recipient_count, sent_by, idempotency_key)
       VALUES ($1, $2, 0, $3, $4)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [p.data.subject, p.data.html, session.email, idemKey],
    );
    if (claim.rowCount) logId = claim.rows[0].id;
  });
  if (!logId) {
    return NextResponse.json({ error: 'duplicate' }, { status: 409 });
  }

  try {
    await sendBroadcast(p.data.subject, p.data.html, subs, { siteUrl });
    await pool.query(
      `UPDATE broadcast_log SET recipient_count = $1 WHERE id = $2`,
      [subs.length, logId],
    );
    return NextResponse.json({ sent: subs.length });
  } catch (err) {
    // Preserve the log row. Resend may have partially sent before the
    // failure, and deleting the row would allow a retry with the same
    // idempotency key to re-send to everyone. Admin must mint a fresh
    // UUID to retry.
    await pool.query(
      `UPDATE broadcast_log
       SET recipient_count = 0
       WHERE id = $1 AND recipient_count = 0`,
      [logId],
    );
    logger.error('broadcast send failed', err, { logId });
    return NextResponse.json({ error: 'send failed' }, { status: 502 });
  }
}
