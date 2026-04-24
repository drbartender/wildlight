export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool, parsePathId, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { getStripe } from '@/lib/stripe';
import { printful } from '@/lib/printful';
import { logger } from '@/lib/logger';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = parsePathId(raw);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  // Atomic state guard — only refund orders that aren't already refunded or
  // canceled. Stash to an intermediate state so a double-click can't double-call Stripe.
  const claim = await pool.query<{
    stripe_payment_id: string | null;
    printful_order_id: number | null;
  }>(
    `UPDATE orders
     SET status = 'refunding', updated_at = NOW()
     WHERE id = $1 AND status NOT IN ('refunded','canceled','refunding')
     RETURNING stripe_payment_id, printful_order_id`,
    [id],
  );
  if (!claim.rowCount) {
    const row = await pool.query<{ status: string }>(
      'SELECT status FROM orders WHERE id = $1',
      [id],
    );
    if (!row.rowCount) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(
      { error: `order is in state "${row.rows[0].status}"; cannot refund` },
      { status: 409 },
    );
  }
  const { stripe_payment_id, printful_order_id } = claim.rows[0];

  await pool.query(
    `INSERT INTO order_events (order_id, type, who, payload)
     VALUES ($1, 'refund_initiated', 'admin', '{}'::jsonb)`,
    [id],
  );

  try {
    if (stripe_payment_id) {
      const stripe = getStripe();
      await stripe.refunds.create({ payment_intent: stripe_payment_id });
    }
    if (printful_order_id) {
      try {
        await printful.cancelOrder(printful_order_id);
      } catch (e) {
        logger.warn('printful cancel failed (refund proceeds anyway)', {
          err: e,
          orderId: id,
        });
      }
    }
    // Atomic pair: status transition + ledger entry must not diverge.
    // The partial unique index uniq_order_events_refunded arbitrates
    // against a concurrent Stripe charge.refunded webhook via ON CONFLICT.
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE orders SET status='refunded', updated_at=NOW() WHERE id = $1`,
        [id],
      );
      await client.query(
        `INSERT INTO order_events (order_id, type, who, payload)
         VALUES ($1, 'refunded', 'admin', '{}'::jsonb)
         ON CONFLICT (order_id) WHERE type = 'refunded' DO NOTHING`,
        [id],
      );
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('refund failed', err, { orderId: id });
    // Roll back the intermediate state so admin can retry. Keep the
    // upstream error text in `notes` (admin-visible), but don't surface
    // Stripe/Printful internals to the browser response body.
    await pool.query(
      `UPDATE orders SET status = 'needs_review', notes = $2, updated_at = NOW()
       WHERE id = $1 AND status = 'refunding'`,
      [id, `refund failed: ${err instanceof Error ? err.message : String(err)}`],
    );
    return NextResponse.json({ error: 'refund failed' }, { status: 500 });
  }
}
