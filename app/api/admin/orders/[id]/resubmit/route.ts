export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool, parsePathId, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { printful } from '@/lib/printful';
import { signedPrivateUrl } from '@/lib/r2';
import { logger } from '@/lib/logger';

interface OrderRow {
  id: number;
  customer_email: string;
  customer_name: string | null;
  shipping_address: Record<string, string> | null;
  printful_attempt: number;
  is_test: boolean;
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
  const { id: raw } = await ctx.params;
  const id = parsePathId(raw);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  // Atomic state guard — only accept the resubmit if the order is currently
  // in `needs_review` AND has no `printful_order_id`. Prevents double-submission
  // when an admin double-clicks the button or the page is stale. We also bump
  // printful_attempt here so the new submit's external_id can't collide with
  // any in-flight webhooks from the prior attempt.
  const claim = await pool.query<OrderRow>(
    `UPDATE orders
     SET status = 'resubmitting',
         printful_attempt = printful_attempt + 1,
         updated_at = NOW()
     WHERE id = $1 AND status = 'needs_review' AND printful_order_id IS NULL
     RETURNING id, customer_email, customer_name, shipping_address, printful_attempt, is_test`,
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

  // Helper: atomic status rollback + resubmit_attempted(failed) event.
  const bounceBack = async (reason: string) => {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE orders SET status='needs_review', notes=$2, updated_at=NOW() WHERE id = $1`,
        [id, reason],
      );
      await client.query(
        `INSERT INTO order_events (order_id, type, who, payload)
         VALUES ($1, 'resubmit_attempted', 'admin', $2::jsonb)`,
        [id, JSON.stringify({ outcome: 'failed', reason })],
      );
    });
  };

  const missingPrint = items.rows.find((r) => !r.image_print_url);
  if (missingPrint) {
    await bounceBack('image_print_url still missing');
    return NextResponse.json({ error: 'missing print file' }, { status: 400 });
  }
  const missingSync = items.rows.find((r) => !r.printful_sync_variant_id);
  if (missingSync) {
    await bounceBack('printful_sync_variant_id still missing');
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
      external_id: `order_${o.id}_${o.printful_attempt}`,
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
      // Mirror the webhook contract: a test-flagged order resubmits as a
      // Printful draft. The flag travels with the order row, so this is
      // correct even if the env's testMode has flipped since the order
      // was created.
      confirm: !o.is_test,
    });
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE orders SET status='submitted', printful_order_id=$2, notes=NULL, updated_at=NOW() WHERE id = $1`,
        [id, pf.id],
      );
      await client.query(
        `INSERT INTO order_events (order_id, type, who, payload)
         VALUES ($1, 'resubmit_attempted', 'admin', $2::jsonb)`,
        [id, JSON.stringify({ outcome: 'ok', printful_order_id: pf.id })],
      );
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('resubmit failed', err, { orderId: id });
    const reason = err instanceof Error ? err.message : String(err);
    // Roll back intermediate `resubmitting` state so admin can retry.
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE orders SET status = 'needs_review', notes = $2, updated_at = NOW()
         WHERE id = $1 AND status = 'resubmitting'`,
        [id, `resubmit failed: ${reason}`],
      );
      await client.query(
        `INSERT INTO order_events (order_id, type, who, payload)
         VALUES ($1, 'resubmit_attempted', 'admin', $2::jsonb)`,
        [id, JSON.stringify({ outcome: 'failed', reason })],
      );
    });
    // Don't leak Printful internals to the browser; the operator sees
    // the full reason in orders.notes and the server log.
    return NextResponse.json({ error: 'resubmit failed' }, { status: 500 });
  }
}
