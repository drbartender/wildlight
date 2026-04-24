export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { getStripe } from '@/lib/stripe';
import { printful } from '@/lib/printful';
import { logger } from '@/lib/logger';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id } = await ctx.params;
  const { rows } = await pool.query<{
    stripe_payment_id: string | null;
    printful_order_id: number | null;
  }>(
    'SELECT stripe_payment_id, printful_order_id FROM orders WHERE id = $1',
    [id],
  );
  if (!rows.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const { stripe_payment_id, printful_order_id } = rows[0];

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
    await pool.query(
      `UPDATE orders SET status='refunded', updated_at=NOW() WHERE id = $1`,
      [id],
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('refund failed', err, { orderId: id });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
