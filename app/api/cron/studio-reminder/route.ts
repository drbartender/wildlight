// Vercel cron: 0 9 1 */3 * (9 AM on 1st of every 3rd month).
//
// Vercel cron sends GET (not POST), so the handler exports GET.
// Auth: Vercel signs cron requests with `Authorization: Bearer ${CRON_SECRET}`
// when CRON_SECRET is set in the project. We use timing-safe comparison
// against CRON_SECRET — no presence-only header check (which would let
// any caller forge `x-vercel-cron-signature`).
export const runtime = 'nodejs';
export const maxDuration = 60;
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { researchSeoTrends, type SeoAngle } from '@/lib/studio';
import { sendStudioReminderEmail } from '@/lib/email';
import { logger } from '@/lib/logger';

function isAuthorizedCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authz = req.headers.get('authorization');
  if (!authz) return false;
  const expected = `Bearer ${secret}`;
  const given = Buffer.from(authz);
  const want = Buffer.from(expected);
  if (given.length !== want.length) return false;
  try {
    return crypto.timingSafeEqual(given, want);
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  if (!adminEmail) {
    logger.warn('studio reminder skipped — ADMIN_ALERT_EMAIL not set');
    return NextResponse.json({ skipped: 'no admin email' });
  }

  // Best-effort: research three angles for the email. If web_search fails,
  // the reminder still goes out without angles.
  let angles: SeoAngle[] = [];
  try {
    angles = await researchSeoTrends();
  } catch (err) {
    logger.error('studio reminder — angles research failed', err);
  }

  // Stats for the email body. DB hiccup shouldn't kill the reminder; fall
  // back to zeros and proceed.
  let stats = { drafts: 0, published: 0, last_pub: null as string | null };
  try {
    const statsRes = await pool.query<typeof stats>(
      `SELECT
         COUNT(*) FILTER (WHERE published = FALSE)::int AS drafts,
         COUNT(*) FILTER (WHERE published = TRUE)::int AS published,
         MAX(published_at)::text AS last_pub
       FROM blog_posts`,
    );
    stats = statsRes.rows[0] ?? stats;
  } catch (err) {
    logger.error('studio reminder — stats lookup failed', err);
  }

  // Persist log entry first (so even if email send fails we have a record).
  let logId = 0;
  try {
    const log = await pool.query<{ id: number }>(
      `INSERT INTO studio_reminders (delivered, trend_angles)
       VALUES (FALSE, $1)
       RETURNING id`,
      [JSON.stringify(angles)],
    );
    logId = log.rows[0].id;
  } catch (err) {
    logger.error('studio reminder — log insert failed', err);
  }

  let delivered = false;
  try {
    await sendStudioReminderEmail({
      to: adminEmail,
      siteUrl:
        process.env.NEXT_PUBLIC_APP_URL || 'https://wildlightimagery.shop',
      stats,
      angles,
    });
    delivered = true;
  } catch (err) {
    logger.error('studio reminder email send failed', err);
  }

  if (logId > 0) {
    await pool.query(
      `UPDATE studio_reminders SET delivered = $1 WHERE id = $2`,
      [delivered, logId],
    );
  }

  return NextResponse.json({ delivered, logId, angles: angles.length });
}
