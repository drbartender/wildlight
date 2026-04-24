export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { printful } from '@/lib/printful';
import { logger } from '@/lib/logger';

interface OrderRow {
  id: number;
  customer_email: string;
  customer_name: string | null;
  shipping_address: Record<string, string> | null;
}

interface ItemRow {
  printful_sync_variant_id: number | null;
  image_print_url: string | null;
  quantity: number;
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id } = await ctx.params;

  const or = await pool.query<OrderRow>(
    `SELECT id, customer_email, customer_name, shipping_address FROM orders WHERE id = $1`,
    [id],
  );
  if (!or.rowCount) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const o = or.rows[0];

  const items = await pool.query<ItemRow>(
    `SELECT v.printful_sync_variant_id, a.image_print_url, oi.quantity
     FROM order_items oi
     LEFT JOIN artwork_variants v ON v.id = oi.variant_id
     LEFT JOIN artworks a ON a.id = v.artwork_id
     WHERE oi.order_id = $1`,
    [id],
  );

  const missingPrint = items.rows.find((r) => !r.image_print_url);
  if (missingPrint) {
    await pool.query(
      `UPDATE orders SET status='needs_review', notes=$2, updated_at=NOW() WHERE id = $1`,
      [id, 'image_print_url still missing'],
    );
    return NextResponse.json({ error: 'missing print file' }, { status: 400 });
  }
  const missingSync = items.rows.find((r) => !r.printful_sync_variant_id);
  if (missingSync) {
    await pool.query(
      `UPDATE orders SET status='needs_review', notes=$2, updated_at=NOW() WHERE id = $1`,
      [id, 'printful_sync_variant_id still missing'],
    );
    return NextResponse.json({ error: 'missing sync variant id' }, { status: 400 });
  }

  const addr = o.shipping_address || {};
  try {
    const pf = await printful.createOrder({
      external_id: `order_${o.id}`,
      recipient: {
        name: o.customer_name || '',
        address1: addr.line1 || '',
        address2: addr.line2 || undefined,
        city: addr.city || '',
        state_code: addr.state || '',
        country_code: addr.country || 'US',
        zip: addr.postal_code || '',
        email: o.customer_email,
      },
      items: items.rows.map((r) => ({
        sync_variant_id: r.printful_sync_variant_id!,
        quantity: r.quantity,
        files: [{ url: r.image_print_url! }],
      })),
      confirm: true,
    });
    await pool.query(
      `UPDATE orders SET status='submitted', printful_order_id=$2, notes=NULL, updated_at=NOW() WHERE id = $1`,
      [id, pf.id],
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('resubmit failed', err, { orderId: id });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
