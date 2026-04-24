export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { getStripe } from '@/lib/stripe';

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
  type: string;
  size: string;
  finish: string | null;
  artwork_id: number;
  artwork_title: string;
  artwork_slug: string;
  image_web_url: string;
  collection_title: string | null;
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid cart' }, { status: 400 });
  }
  const { lines } = parsed.data;
  const ids = lines.map((l) => l.variantId);

  const { rows } = await pool.query<VariantRow>(
    `SELECT v.id, v.price_cents, v.type, v.size, v.finish, v.artwork_id,
            a.title AS artwork_title, a.slug AS artwork_slug, a.image_web_url,
            c.title AS collection_title
     FROM artwork_variants v
     JOIN artworks a ON a.id = v.artwork_id
     LEFT JOIN collections c ON c.id = a.collection_id
     WHERE v.id = ANY($1) AND v.active AND a.status = 'published'`,
    [ids],
  );

  if (rows.length !== ids.length) {
    return NextResponse.json({ error: 'some items unavailable' }, { status: 400 });
  }

  const byId = new Map<number, VariantRow>(rows.map((r) => [r.id, r]));
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
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
          display_name: 'Standard shipping',
          fixed_amount: { amount: 900, currency: 'usd' },
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 4 },
            maximum: { unit: 'business_day', value: 10 },
          },
        },
      },
    ],
    success_url: `${siteUrl}/orders/{CHECKOUT_SESSION_ID}?success=1`,
    cancel_url: `${siteUrl}/cart?canceled=1`,
    metadata: {
      cart_json: JSON.stringify(lines),
    },
  });

  return NextResponse.json({ id: session.id, url: session.url });
}
