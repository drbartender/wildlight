export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { pool, withTransaction } from '@/lib/db';
import { sendOrderShipped, sendNeedsReviewAlert } from '@/lib/email';
import { logger } from '@/lib/logger';

// Printful's v1 webhook API does not issue a signing secret or HMAC the body —
// authentication is via a high-entropy token embedded in the registered URL.
// We compare it constant-time against PRINTFUL_WEBHOOK_SECRET. Rotate by
// re-registering the webhook (POST /webhooks) with a fresh token in the URL.
function verify(req: Request): boolean {
  const expected = process.env.PRINTFUL_WEBHOOK_SECRET;
  if (!expected) return false;
  const provided = new URL(req.url).searchParams.get('token');
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

interface PfEvent {
  type: string;
  data?: {
    id?: number;
    external_id?: string;
    shipment?: {
      tracking_url?: string;
      tracking_number?: string;
    };
  };
}

export async function POST(req: Request) {
  if (!verify(req)) {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 });
  }
  const body = await req.text();

  let event: PfEvent;
  try {
    event = JSON.parse(body) as PfEvent;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const eventId = event?.data?.id
    ? `pf_${event.data.id}_${event.type}`
    : `pf_${Date.now()}_${event.type}`;

  // Race-free dedupe via INSERT ON CONFLICT — see app/api/webhooks/stripe/route.ts.
  const claim = await pool.query<{ id: number }>(
    `INSERT INTO webhook_events (source, event_id, payload)
     VALUES ('printful', $1, $2)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING id`,
    [eventId, event],
  );
  if (!claim.rowCount) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    // external_id formats:
    //   order_<id>_<attempt>   — current (post-attempt-counter)
    //   order_<id>             — legacy (pre-counter; matches attempt=0)
    // Mismatched (id, attempt) pairs mean a stale Printful order is firing
    // for an order that has since been resubmitted — ignore silently.
    const externalId = String(event?.data?.external_id || '');
    const m = /^order_(\d+)(?:_(\d+))?$/.exec(externalId);
    const ourId = m ? parseInt(m[1], 10) : 0;
    const attempt = m && m[2] != null ? parseInt(m[2], 10) : 0;
    if (!ourId || !Number.isSafeInteger(ourId)) {
      await pool.query(
        'UPDATE webhook_events SET processed_at = NOW() WHERE event_id = $1',
        [eventId],
      );
      return NextResponse.json({ ok: true, ignored: 'no external_id' });
    }

    if (event.type === 'package_shipped') {
      const shipment = event.data?.shipment;
      const trackingUrl = shipment?.tracking_url || null;
      const trackingNumber = shipment?.tracking_number || null;
      // UPDATE + event INSERT share one txn so a crash can't leave orders
      // as shipped without a matching ledger row. The (id, attempt) match
      // ensures a stale shipment event doesn't mark a resubmitted order
      // as shipped against the wrong Printful order id.
      const emailCtx = await withTransaction(async (client) => {
        const r = await client.query<{
          customer_email: string;
          public_token: string;
        }>(
          `UPDATE orders SET status='shipped', tracking_url=$3, tracking_number=$4, updated_at=NOW()
           WHERE id = $1 AND printful_attempt = $2
           RETURNING customer_email, public_token`,
          [ourId, attempt, trackingUrl, trackingNumber],
        );
        if (!r.rowCount) return null;
        await client.query(
          `INSERT INTO order_events (order_id, type, who, payload)
           VALUES ($1, 'shipped', 'printful', $2::jsonb)`,
          [
            ourId,
            JSON.stringify({
              tracking_number: trackingNumber,
              tracking_url: trackingUrl,
            }),
          ],
        );
        return r.rows[0];
      });
      if (emailCtx) {
        const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        try {
          await sendOrderShipped(
            emailCtx.customer_email,
            emailCtx.public_token,
            trackingUrl,
            trackingNumber,
            siteUrl,
          );
        } catch (err) {
          logger.warn('shipped email failed', { err, orderId: ourId });
        }
      } else {
        logger.warn('printful webhook ignored: stale attempt', {
          orderId: ourId,
          attempt,
          type: event.type,
        });
      }
    } else if (event.type === 'package_delivered') {
      await withTransaction(async (client) => {
        const r = await client.query<{ id: number }>(
          `UPDATE orders SET status='delivered', updated_at=NOW()
           WHERE id = $1 AND printful_attempt = $2 RETURNING id`,
          [ourId, attempt],
        );
        if (r.rowCount) {
          await client.query(
            `INSERT INTO order_events (order_id, type, who, payload)
             VALUES ($1, 'delivered', 'printful', '{}'::jsonb)`,
            [ourId],
          );
        }
      });
    } else if (
      event.type === 'package_returned' ||
      event.type === 'order_canceled'
    ) {
      await withTransaction(async (client) => {
        const r = await client.query(
          `UPDATE orders SET status='canceled', updated_at=NOW()
           WHERE id = $1 AND printful_attempt = $2`,
          [ourId, attempt],
        );
        if (r.rowCount) {
          await client.query(
            `INSERT INTO order_events (order_id, type, who, payload)
             VALUES ($1, 'canceled', 'printful', $2::jsonb)`,
            [ourId, JSON.stringify({ via: event.type })],
          );
        }
      });
    } else if (
      event.type === 'order_failed' ||
      event.type === 'order_put_hold'
    ) {
      // event.type is a known Printful enum today, but if Printful ever
      // starts sending a free-form reason we don't want it bypassing the
      // 500-char note cap that admin-authored notes respect.
      const reason = String(event.type).slice(0, 500);
      const updated = await withTransaction(async (client) => {
        const r = await client.query(
          `UPDATE orders SET status='needs_review', notes=$3, updated_at=NOW()
           WHERE id = $1 AND printful_attempt = $2`,
          [ourId, attempt, reason],
        );
        if (r.rowCount) {
          await client.query(
            `INSERT INTO order_events (order_id, type, who, payload)
             VALUES ($1, 'printful_flagged', 'printful', $2::jsonb)`,
            [ourId, JSON.stringify({ reason })],
          );
        }
        return r.rowCount ?? 0;
      });
      if (updated) {
        try {
          await sendNeedsReviewAlert(ourId, `Printful: ${reason}`);
        } catch (err) {
          logger.warn('needs_review alert failed', { err, orderId: ourId });
        }
      }
    }

    await pool.query(
      'UPDATE webhook_events SET processed_at = NOW() WHERE event_id = $1',
      [eventId],
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('printful webhook processing error', err);
    await pool.query(
      'UPDATE webhook_events SET error = $2 WHERE event_id = $1',
      [eventId, err instanceof Error ? err.message : String(err)],
    );
    return NextResponse.json({ ok: false });
  }
}
