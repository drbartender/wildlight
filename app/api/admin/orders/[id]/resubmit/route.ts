export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { printful } from '@/lib/printful';
import { signedPrivateUrl } from '@/lib/r2';
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

  // Atomic state guard — only accept the resubmit if the order is currently
  // in `needs_review` AND has no `printful_order_id`. Prevents double-submission
  // when an admin double-clicks the button or the page is stale.
  const claim = await pool.query<OrderRow>(
    `UPDATE orders
     SET status = 'resubmitting', updated_at = NOW()
     WHERE id = $1 AND status = 'needs_review' AND printful_order_id IS NULL
     RETURNING id, customer_email, customer_name, shipping_address`,
    [id],
  );
  if (!claim.rowCount) {
    const row = await pool.query<{ status: string }>(
      'SELECT status FROM orders WHERE id = $1',
      [id],
    );
    if (!row.rowCount) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(
      { error: `order is in state "${row.rows[0].status}"; only needs_review orders can be resubmitted` },
      { status: 409 },
    );
  }
  const o = claim.rows[0];

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
    // Sign each distinct private R2 key ONCE — customers who buy multiple
    // sizes of the same artwork would otherwise cause duplicate sign calls.
    const signCache = new Map<string, Promise<string>>();
    const sign = (key: string) => {
      const existing = signCache.get(key);
      if (existing) return existing;
      const p = signedPrivateUrl(key, 7 * 24 * 3600);
      signCache.set(key, p);
      return p;
    };
    const pfItems = await Promise.all(
      items.rows.map(async (r) => ({
        sync_variant_id: r.printful_sync_variant_id!,
        quantity: r.quantity,
        files: [{ url: await sign(r.image_print_url!) }],
      })),
    );
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
      items: pfItems,
      confirm: true,
    });
    await pool.query(
      `UPDATE orders SET status='submitted', printful_order_id=$2, notes=NULL, updated_at=NOW() WHERE id = $1`,
      [id, pf.id],
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('resubmit failed', err, { orderId: id });
    // Roll back intermediate `resubmitting` state so admin can retry.
    await pool.query(
      `UPDATE orders SET status = 'needs_review', notes = $2, updated_at = NOW()
       WHERE id = $1 AND status = 'resubmitting'`,
      [id, `resubmit failed: ${err instanceof Error ? err.message : String(err)}`],
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
