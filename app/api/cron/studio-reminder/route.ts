// Vercel cron: 0 9 1 */3 * (9 AM on 1st of every 3rd month).
// Vercel signs cron requests; we additionally accept an
// authorization header for local testing.
export const runtime = 'nodejs';
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { researchSeoTrends, type SeoAngle } from '@/lib/studio';
import { sendStudioReminderEmail } from '@/lib/email';
import { logger } from '@/lib/logger';

function isAuthorizedCron(req: Request): boolean {
  // Vercel sets x-vercel-cron-signature on cron-triggered requests.
  if (req.headers.get('x-vercel-cron-signature')) return true;
  // Local + manual trigger: shared secret.
  const authz = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (secret && authz === `Bearer ${secret}`) return true;
  return false;
}

export async function POST(req: Request) {
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

  // Stats for the email body.
  const statsRes = await pool.query<{
    drafts: number;
    published: number;
    last_pub: string | null;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE published = FALSE)::int AS drafts,
       COUNT(*) FILTER (WHERE published = TRUE)::int AS published,
       MAX(published_at)::text AS last_pub
     FROM blog_posts`,
  );
  const stats = statsRes.rows[0] ?? { drafts: 0, published: 0, last_pub: null };

  // Persist log entry first (so even if email send fails we have a record).
  const log = await pool.query<{ id: number }>(
    `INSERT INTO studio_reminders (delivered, trend_angles)
     VALUES (FALSE, $1)
     RETURNING id`,
    [JSON.stringify(angles)],
  );
  const logId = log.rows[0].id;

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

  await pool.query(
    `UPDATE studio_reminders SET delivered = $1 WHERE id = $2`,
    [delivered, logId],
  );

  return NextResponse.json({ delivered, logId, angles: angles.length });
}
