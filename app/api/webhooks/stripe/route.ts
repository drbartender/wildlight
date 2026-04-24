export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { pool, withTransaction } from '@/lib/db';
import { getStripe, getStripeConfig } from '@/lib/stripe';
import { printful } from '@/lib/printful';
import { signedPrivateUrl } from '@/lib/r2';
import {
  sendOrderConfirmation,
  sendNeedsReviewAlert,
} from '@/lib/email';
import { formatUSD } from '@/lib/money';
import { logger } from '@/lib/logger';

interface CartLine {
  variantId: number;
  quantity: number;
}

interface VariantInfo {
  id: number;
  artwork_id: number;
  artwork_title: string;
  artwork_slug: string;
  image_web_url: string;
  image_print_url: string | null;
  collection_title: string | null;
  printful_sync_variant_id: number | null;
  type: string;
  size: string;
  finish: string | null;
  price_cents: number;
  cost_cents: number;
}

export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature');
  const { webhookSecret } = getStripeConfig();
  if (!sig || !webhookSecret) {
    return NextResponse.json({ error: 'missing signature' }, { status: 400 });
  }

  const body = await req.text();
  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
  } catch (err) {
    logger.error('stripe signature verification failed', err);
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  // Race-free dedupe: INSERT ON CONFLICT. If the row is already present
  // (another delivery got here first), we acknowledge and let that in-flight
  // request own the processing. Stripe's at-least-once delivery is fine with
  // a 200 here — the owning request will mark processed_at.
  const claim = await pool.query<{ id: number }>(
    `INSERT INTO webhook_events (source, event_id, payload)
     VALUES ('stripe', $1, $2)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING id`,
    [event.id, event],
  );
  if (!claim.rowCount) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
    } else if (event.type === 'charge.refunded') {
      await handleChargeRefunded(event.data.object as Stripe.Charge);
    }
    await pool.query(
      'UPDATE webhook_events SET processed_at = NOW() WHERE event_id = $1',
      [event.id],
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('stripe webhook processing error', err);
    await pool.query(
      'UPDATE webhook_events SET error = $2 WHERE event_id = $1',
      [event.id, err instanceof Error ? err.message : String(err)],
    );
    // Return 200 so Stripe doesn't retry forever — the event is stored and we
    // have a needs_review path for operator intervention.
    return NextResponse.json({ ok: false });
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const cart = JSON.parse(
    (session.metadata?.cart_json as string) || '[]',
  ) as CartLine[];
  if (!cart.length) throw new Error('empty cart metadata');
  const ids = cart.map((l) => l.variantId);

  const { rows: variants } = await pool.query<VariantInfo>(
    `SELECT v.id, v.artwork_id, v.printful_sync_variant_id, v.type, v.size, v.finish,
            v.price_cents, v.cost_cents,
            a.title AS artwork_title, a.slug AS artwork_slug,
            a.image_web_url, a.image_print_url,
            c.title AS collection_title
     FROM artwork_variants v
     JOIN artworks a ON a.id = v.artwork_id
     LEFT JOIN collections c ON c.id = a.collection_id
     WHERE v.id = ANY($1)`,
    [ids],
  );
  const byId = new Map<number, VariantInfo>(variants.map((v) => [v.id, v]));

  // Sanity-check: the sum of our DB prices × quantities should match what
  // Stripe says the customer paid for the subtotal. If it doesn't, someone
  // edited a variant price between checkout session creation and webhook
  // delivery — the order is still valid (Stripe's session froze the price)
  // but our `price_cents_snapshot` would disagree with what the customer
  // actually paid. Flag for operator review.
  const dbSubtotal = cart.reduce((sum, l) => {
    const v = byId.get(l.variantId);
    return sum + (v ? v.price_cents * l.quantity : 0);
  }, 0);
  const priceDrift = dbSubtotal !== (session.amount_subtotal || 0);

  const addr = session.customer_details?.address;
  let orderId = 0;
  let orderToken = '';

  await withTransaction(async (client) => {
    const orderRes = await client.query<{ id: number; public_token: string }>(
      `INSERT INTO orders (stripe_session_id, stripe_payment_id, customer_email, customer_name,
                           shipping_address, subtotal_cents, shipping_cents, tax_cents, total_cents, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'paid')
       ON CONFLICT (stripe_session_id) DO NOTHING
       RETURNING id, public_token`,
      [
        session.id,
        typeof session.payment_intent === 'string' ? session.payment_intent : null,
        session.customer_details?.email,
        session.customer_details?.name,
        addr || null,
        session.amount_subtotal || 0,
        session.shipping_cost?.amount_total || 0,
        session.total_details?.amount_tax || 0,
        session.amount_total || 0,
      ],
    );
    if (!orderRes.rowCount) return; // duplicate stripe event, silently no-op
    orderId = orderRes.rows[0].id;
    orderToken = orderRes.rows[0].public_token;

    // Lifecycle events: placed + paid happen together under Stripe Checkout.
    await client.query(
      `INSERT INTO order_events (order_id, type, who, payload)
       VALUES ($1, 'placed', 'customer', '{}'::jsonb)`,
      [orderId],
    );
    await client.query(
      `INSERT INTO order_events (order_id, type, who, payload)
       VALUES ($1, 'paid', 'stripe', $2::jsonb)`,
      [orderId, JSON.stringify({ amount_cents: session.amount_total ?? 0 })],
    );

    for (const l of cart) {
      const v = byId.get(l.variantId);
      if (!v) throw new Error(`variant ${l.variantId} missing`);
      await client.query(
        `INSERT INTO order_items
           (order_id, variant_id, artwork_snapshot, variant_snapshot,
            price_cents_snapshot, cost_cents_snapshot, quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          orderId,
          v.id,
          {
            title: v.artwork_title,
            slug: v.artwork_slug,
            collection_title: v.collection_title,
            image_web_url: v.image_web_url,
          },
          {
            type: v.type,
            size: v.size,
            finish: v.finish,
            printful_sync_variant_id: v.printful_sync_variant_id,
          },
          v.price_cents,
          v.cost_cents,
          l.quantity,
        ],
      );
    }
  });

  if (!orderId) return;

  // If price drift was detected above, hold the order for operator review
  // instead of auto-fulfilling. Stripe already took the payment, so the
  // customer is fine — we want a human to reconcile the price mismatch.
  // Atomic helper: status UPDATE + lifecycle event INSERT in the same txn.
  // A process crash between these two writes would leave orders.status and
  // the ledger disagreeing.
  const flagOrder = async (reason: string) => {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE orders SET status='needs_review', notes=$2, updated_at=NOW() WHERE id=$1`,
        [orderId, reason],
      );
      await client.query(
        `INSERT INTO order_events (order_id, type, who, payload)
         VALUES ($1, 'printful_flagged', 'system', $2::jsonb)`,
        [orderId, JSON.stringify({ reason })],
      );
    });
  };

  if (priceDrift) {
    const reason = `price drift: db subtotal ${dbSubtotal} vs stripe amount_subtotal ${
      session.amount_subtotal || 0
    } — verify pricing before fulfilling`;
    await flagOrder(reason);
    await sendNeedsReviewAlert(
      orderId,
      'price drift between DB and Stripe checkout — review before fulfilling',
    );
  } else if (cart.some((l) => !byId.get(l.variantId)?.image_print_url)) {
    await flagOrder('missing image_print_url on one or more artworks');
    await sendNeedsReviewAlert(
      orderId,
      'image_print_url missing — upload print file in /admin/artworks/<id>',
    );
  } else if (cart.some((l) => !byId.get(l.variantId)?.printful_sync_variant_id)) {
    await flagOrder('printful_sync_variant_id missing on one or more variants');
    await sendNeedsReviewAlert(
      orderId,
      'printful_sync_variant_id missing — run `npm run sync:printful <artworkId>`',
    );
  } else {
    try {
      // Printful needs to download the print file — sign each DISTINCT private
      // R2 key once (a customer buying multiple sizes of the same artwork
      // would otherwise sign the same key repeatedly).
      const signCache = new Map<string, Promise<string>>();
      const sign = (key: string) => {
        const existing = signCache.get(key);
        if (existing) return existing;
        const p = signedPrivateUrl(key, 7 * 24 * 3600);
        signCache.set(key, p);
        return p;
      };
      const pfItems = await Promise.all(
        cart.map(async (l) => {
          const v = byId.get(l.variantId)!;
          return {
            sync_variant_id: v.printful_sync_variant_id!,
            quantity: l.quantity,
            files: [{ url: await sign(v.image_print_url!) }],
          };
        }),
      );
      const pfOrder = await printful.createOrder({
        external_id: `order_${orderId}`,
        recipient: {
          name: session.customer_details?.name || '',
          address1: addr?.line1 || '',
          address2: addr?.line2 || undefined,
          city: addr?.city || '',
          state_code: addr?.state || '',
          country_code: addr?.country || 'US',
          zip: addr?.postal_code || '',
          email: session.customer_details?.email || undefined,
        },
        items: pfItems,
        retail_costs: {
          currency: 'usd',
          subtotal: ((session.amount_subtotal || 0) / 100).toFixed(2),
          shipping: ((session.shipping_cost?.amount_total || 0) / 100).toFixed(2),
          tax: ((session.total_details?.amount_tax || 0) / 100).toFixed(2),
          total: ((session.amount_total || 0) / 100).toFixed(2),
        },
        confirm: true,
      });
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE orders SET status='submitted', printful_order_id=$2, updated_at=NOW() WHERE id=$1`,
          [orderId, pfOrder.id],
        );
        await client.query(
          `INSERT INTO order_events (order_id, type, who, payload)
           VALUES ($1, 'printful_submitted', 'printful', $2::jsonb)`,
          [orderId, JSON.stringify({ printful_order_id: pfOrder.id })],
        );
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error('printful submit failed', err, { orderId });
      await flagOrder(reason);
      await sendNeedsReviewAlert(orderId, reason);
    }
  }

  // Handled below: order confirmation email.
  // (handleChargeRefunded is defined after this function.)

  // Confirmation email — send regardless of fulfillment status.
  try {
    const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    await sendOrderConfirmation({
      to: session.customer_details?.email || '',
      orderToken,
      items: cart.map((l) => {
        const v = byId.get(l.variantId)!;
        return {
          title: v.artwork_title,
          variant: `${v.type}, ${v.size}${v.finish ? `, ${v.finish}` : ''}`,
          price: formatUSD(v.price_cents),
          qty: l.quantity,
          image_url: v.image_web_url,
        };
      }),
      subtotal: formatUSD(session.amount_subtotal || 0),
      shipping: formatUSD(session.shipping_cost?.amount_total || 0),
      tax: formatUSD(session.total_details?.amount_tax || 0),
      total: formatUSD(session.amount_total || 0),
      siteUrl,
    });
  } catch (err) {
    logger.warn('order confirmation email failed', { err, orderId });
  }
}

async function handleChargeRefunded(charge: Stripe.Charge) {
  const paymentIntent =
    typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
  if (!paymentIntent) return;

  // Race-safe: admin refund route and this handler can both fire against
  // the same order. The partial unique index uniq_order_events_refunded
  // (order_id) WHERE type='refunded' arbitrates via ON CONFLICT DO NOTHING.
  // The INSERT's `rowCount` tells us whether we're the first writer; only
  // the first writer updates orders.status.
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: number }>(
      `SELECT id FROM orders WHERE stripe_payment_id = $1 FOR UPDATE`,
      [paymentIntent],
    );
    if (!rows.length) return;
    const orderId = rows[0].id;

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO order_events (order_id, type, who, payload)
       VALUES ($1, 'refunded', 'stripe', $2::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [orderId, JSON.stringify({ amount_cents: charge.amount_refunded ?? 0 })],
    );
    if (inserted.rowCount) {
      await client.query(
        `UPDATE orders SET status='refunded', updated_at=NOW()
         WHERE id = $1 AND status <> 'refunded'`,
        [orderId],
      );
    }
  });
}
