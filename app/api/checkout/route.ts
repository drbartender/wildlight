export const runtime = 'nodejs';
import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { getStripe, getStripeConfig } from '@/lib/stripe';
import { qualifiesForFreeShipping, subtotalCents } from '@/lib/pricing';
import { logger } from '@/lib/logger';

const Body = z.object({
  lines: z
    .array(
      z.object({
        variantId: z.number().int(),
        quantity: z.number().int().min(1).max(20),
      }),
    )
    .min(1)
    .max(50),
});

interface VariantRow {
  id: number;
  price_cents: number;
  cost_cents: number;
  printful_sync_variant_id: number | null;
  type: string;
  size: string;
  finish: string | null;
  artwork_id: number;
  artwork_title: string;
  artwork_slug: string;
  image_web_url: string;
  image_print_url: string | null;
  collection_title: string | null;
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid cart' }, { status: 400 });
  }
  const { lines } = parsed.data;
  const ids = lines.map((l) => l.variantId);

  let rows: VariantRow[];
  try {
    const result = await pool.query<VariantRow>(
      `SELECT v.id, v.price_cents, v.cost_cents, v.printful_sync_variant_id,
              v.type, v.size, v.finish, v.artwork_id,
              a.title AS artwork_title, a.slug AS artwork_slug,
              a.image_web_url, a.image_print_url,
              c.title AS collection_title
       FROM artwork_variants v
       JOIN artworks a ON a.id = v.artwork_id
       LEFT JOIN collections c ON c.id = a.collection_id
       WHERE v.id = ANY($1::int[]) AND v.active AND a.status = 'published'`,
      [ids],
    );
    rows = result.rows;
  } catch (err) {
    logger.error('checkout variant lookup failed', err);
    return NextResponse.json({ error: 'checkout_init_failed' }, { status: 502 });
  }

  if (rows.length !== ids.length) {
    return NextResponse.json({ error: 'some items unavailable' }, { status: 400 });
  }

  const byId = new Map<number, VariantRow>(rows.map((r) => [r.id, r]));
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  // Free shipping threshold lives in lib/pricing.ts so the storefront can
  // show the "$X away from free shipping" hint with the same number.
  const subtotal = subtotalCents(
    lines.map((l) => ({
      price_cents: byId.get(l.variantId)!.price_cents,
      quantity: l.quantity,
    })),
  );
  const freeShipping = qualifiesForFreeShipping(subtotal);
  const shippingAmount = freeShipping ? 0 : 900;

  const stripe = getStripe();
  let session;
  try {
    session = await stripe.checkout.sessions.create({
      // Custom Checkout: server still owns line_items / shipping / automatic
      // tax, but the client renders the form via `initCheckoutElementsSdk`
      // and the Appearance API so the widget matches our theme.
      ui_mode: 'elements',
      mode: 'payment',
      automatic_tax: { enabled: true },
      shipping_address_collection: { allowed_countries: ['US', 'CA'] },
      billing_address_collection: 'required',
      line_items: lines.map((l) => {
        const v = byId.get(l.variantId)!;
        return {
          quantity: l.quantity,
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${v.artwork_title} — ${v.type}, ${v.size}${
                v.finish ? `, ${v.finish}` : ''
              }`,
              images: [v.image_web_url],
              metadata: {
                variant_id: String(v.id),
                artwork_id: String(v.artwork_id),
                artwork_slug: v.artwork_slug,
              },
              tax_code: 'txcd_99999999',
            },
            unit_amount: v.price_cents,
            tax_behavior: 'exclusive',
          },
        };
      }),
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            display_name: freeShipping ? 'Free shipping' : 'Standard shipping',
            fixed_amount: { amount: shippingAmount, currency: 'usd' },
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 4 },
              maximum: { unit: 'business_day', value: 10 },
            },
          },
        },
      ],
      // Stripe redirects to return_url after `confirm()` succeeds. Use the
      // public-token redirector so the session id stays out of address bars,
      // bookmarks, and outbound Referer headers.
      return_url: `${siteUrl}/api/orders/by-session/{CHECKOUT_SESSION_ID}`,
      metadata: {
        cart_json: JSON.stringify(lines),
      },
    });
  } catch (err) {
    logger.error('stripe session create failed', err);
    return NextResponse.json({ error: 'checkout_init_failed' }, { status: 502 });
  }

  if (!session.client_secret) {
    // Embedded mode is documented to always set client_secret. Fail loudly
    // rather than handing the client a null and forcing a generic error path.
    logger.error('stripe returned null client_secret', undefined, {
      sessionId: session.id,
    });
    return NextResponse.json({ error: 'checkout_init_failed' }, { status: 502 });
  }

  // Persist an immutable per-line snapshot keyed by the Stripe session id.
  // The webhook reads this to write order_items so a catalog edit between
  // checkout-creation and webhook delivery can't silently rewrite the
  // customer's order. Fail-soft: if the insert fails the webhook falls back
  // to the live catalog and flags needs_review.
  // Quantity lives in session.metadata.cart_json, so the snapshot only
  // needs catalog-derived fields. Keeping the snapshot shape aligned with
  // VariantInfo means no field drift between writer and webhook reader.
  const snapshot = lines.map((l) => {
    const v = byId.get(l.variantId)!;
    return {
      id: v.id,
      artwork_id: v.artwork_id,
      artwork_title: v.artwork_title,
      artwork_slug: v.artwork_slug,
      image_web_url: v.image_web_url,
      image_print_url: v.image_print_url,
      collection_title: v.collection_title,
      printful_sync_variant_id: v.printful_sync_variant_id,
      type: v.type,
      size: v.size,
      finish: v.finish,
      price_cents: v.price_cents,
      cost_cents: v.cost_cents,
    };
  });
  // Background the snapshot write so the response returns as soon as Stripe
  // answers — Neon round-trip stays off the user-blocking TTFB. Webhook
  // delivery takes seconds, so the insert lands well before the webhook
  // reads it. The webhook fallback covers the rare case where after() fails.
  const sessionId = session.id;
  after(async () => {
    try {
      await pool.query(
        `INSERT INTO checkout_intents (stripe_session_id, snapshot)
         VALUES ($1, $2)
         ON CONFLICT (stripe_session_id) DO NOTHING`,
        [sessionId, JSON.stringify(snapshot)],
      );
    } catch (err) {
      logger.error('checkout_intents persist failed', err, { sessionId });
    }
  });

  // Return the publishable key alongside the clientSecret so the embedded
  // widget loads the matching test/live Stripe.js without a separate
  // NEXT_PUBLIC env var. Honors the STRIPE_TEST_MODE_UNTIL timed fallback.
  return NextResponse.json({
    id: session.id,
    clientSecret: session.client_secret,
    publishableKey: getStripeConfig().publishable,
  });
}
