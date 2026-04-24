export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { pool, withTransaction } from '@/lib/db';
import { sendOrderShipped } from '@/lib/email';
import { logger } from '@/lib/logger';

function verify(bodyRaw: string, headerSig: string | null): boolean {
  const secret = process.env.PRINTFUL_WEBHOOK_SECRET;
  if (!secret || !headerSig) return false;
  const expected = crypto.createHmac('sha256', secret).update(bodyRaw).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(headerSig), Buffer.from(expected));
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
  const body = await req.text();
  const sig = req.headers.get('x-pf-signature');
  if (!verify(body, sig)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

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
    const externalId = event?.data?.external_id; // our "order_<id>"
    const ourId = Number(String(externalId || '').replace(/^order_/, ''));
    if (!ourId) {
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
      // as shipped without a matching ledger row.
      const emailCtx = await withTransaction(async (client) => {
        const r = await client.query<{
          customer_email: string;
          public_token: string;
        }>(
          `UPDATE orders SET status='shipped', tracking_url=$2, tracking_number=$3, updated_at=NOW()
           WHERE id = $1
           RETURNING customer_email, public_token`,
          [ourId, trackingUrl, trackingNumber],
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
      }
    } else if (event.type === 'package_delivered') {
      await withTransaction(async (client) => {
        const r = await client.query<{ id: number }>(
          `UPDATE orders SET status='delivered', updated_at=NOW() WHERE id = $1 RETURNING id`,
          [ourId],
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
        await client.query(
          `UPDATE orders SET status='canceled', updated_at=NOW() WHERE id = $1`,
          [ourId],
        );
        await client.query(
          `INSERT INTO order_events (order_id, type, who, payload)
           VALUES ($1, 'canceled', 'printful', $2::jsonb)`,
          [ourId, JSON.stringify({ via: event.type })],
        );
      });
    } else if (
      event.type === 'order_failed' ||
      event.type === 'order_put_hold'
    ) {
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE orders SET status='needs_review', notes=$2, updated_at=NOW() WHERE id = $1`,
          [ourId, event.type],
        );
        await client.query(
          `INSERT INTO order_events (order_id, type, who, payload)
           VALUES ($1, 'printful_flagged', 'printful', $2::jsonb)`,
          [ourId, JSON.stringify({ reason: event.type })],
        );
      });
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
