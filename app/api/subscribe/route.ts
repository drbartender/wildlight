export const runtime = 'nodejs';
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { sendSubscribeConfirmation } from '@/lib/email';
import { recordAndCheckRateLimit, getClientIp } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

const Body = z.object({
  email: z.string().email(),
  source: z.string().max(80).optional(),
});

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid email' }, { status: 400 });
  }
  const { email, source } = parsed.data;
  const emailLc = email.toLowerCase();
  const ip = getClientIp(req);

  // Already-confirmed addresses re-subscribe cheaply (no email, no rate
  // limit). Skipping the gate here means an attacker pinging a victim's
  // confirmed email can't burn the legitimate user's IP quota.
  const existing = await pool.query<{ id: number; confirmed_at: string | null }>(
    'SELECT id, confirmed_at FROM subscribers WHERE email = $1',
    [emailLc],
  );
  if (existing.rowCount && existing.rows[0].confirmed_at) {
    await pool.query(
      `UPDATE subscribers SET unsubscribed_at = NULL WHERE id = $1`,
      [existing.rows[0].id],
    );
    return NextResponse.json({ ok: true });
  }

  // Pending or new. Key on (ip, email) so a burst against one victim email
  // burns that bucket only — IP-globally would let an attacker exhaust a
  // legitimate user's signup capacity.
  const gate = await recordAndCheckRateLimit(
    'subscribe',
    `${ip}:${emailLc}`,
    900,
    3,
  );
  if (gate.blocked) {
    return NextResponse.json(
      { error: 'too many requests' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfter ?? 900) } },
    );
  }

  // Plaintext token goes in the email; only its SHA-256 hash hits the DB.
  // A leak of the subscribers table can't be replayed against /confirm.
  const tokenPlain = crypto.randomBytes(24).toString('base64url');
  const tokenHash = hashToken(tokenPlain);

  const r = await pool.query<{ id: number }>(
    `INSERT INTO subscribers (email, source, confirm_token)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET
       unsubscribed_at = NULL,
       confirm_token = CASE
         WHEN subscribers.confirmed_at IS NULL THEN EXCLUDED.confirm_token
         ELSE subscribers.confirm_token
       END
     RETURNING id`,
    [emailLc, source || 'footer', tokenHash],
  );
  const subId = r.rows[0].id;

  try {
    const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    await sendSubscribeConfirmation(emailLc, subId, tokenPlain, siteUrl);
  } catch (err) {
    // Don't surface to the caller — they shouldn't learn whether the email
    // is reachable. Logged for ops if it's a Resend outage.
    logger.warn('subscribe confirmation email failed', { err });
  }

  return NextResponse.json({ ok: true });
}
