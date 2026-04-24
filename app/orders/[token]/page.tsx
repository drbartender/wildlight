import Link from 'next/link';
import { pool } from '@/lib/db';
import { formatUSD } from '@/lib/money';
import { StatusBadge } from '@/components/shop/StatusBadge';

export const dynamic = 'force-dynamic';

interface OrderRow {
  id: number;
  public_token: string;
  stripe_session_id: string | null;
  status: string;
  customer_email: string;
  subtotal_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  tracking_url: string | null;
  tracking_number: string | null;
  created_at: string;
}

interface ItemRow {
  id: number;
  artwork_snapshot: { title: string; slug: string; collection_title?: string };
  variant_snapshot: { type: string; size: string; finish: string | null };
  price_cents_snapshot: number;
  quantity: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findOrder(tokenOrSession: string) {
  // Index-efficient lookup: the OR-on-cast version forced a seq scan because
  // `public_token::text = $1` defeats the btree. Route by input shape instead.
  const sql = `SELECT id, public_token, stripe_session_id, status, customer_email,
                      subtotal_cents, shipping_cents, tax_cents, total_cents,
                      tracking_url, tracking_number, created_at
               FROM orders
               WHERE ${UUID_RE.test(tokenOrSession) ? 'public_token' : 'stripe_session_id'} = $1
               LIMIT 1`;
  const r = await pool.query<OrderRow>(sql, [tokenOrSession]);
  return r.rows[0] || null;
}

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ success?: string }>;
}) {
  const { token } = await params;
  const { success } = await searchParams;

  const order = await findOrder(token);

  // Race: Stripe redirected us here before the webhook created the order row.
  // Show a friendly "processing" state instead of 404. The page is dynamic, so
  // a manual refresh (or the email link later) will pick up the real row.
  if (!order) {
    return (
      <section
        className="container"
        style={{ padding: '40px 0', maxWidth: 560, fontFamily: 'Georgia, serif' }}
      >
        <h1>Thank you — processing.</h1>
        <p>
          Your payment succeeded. We're finalizing your order — this usually takes a few
          seconds. A confirmation email will arrive shortly with your full order details
          and a link you can bookmark.
        </p>
        <p style={{ marginTop: 24 }}>
          <Link className="button" href="/collections">
            Back to collections
          </Link>
        </p>
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 24 }}>
          Reference: {token}
        </p>
      </section>
    );
  }

  const items = await pool.query<ItemRow>(
    `SELECT id, artwork_snapshot, variant_snapshot, price_cents_snapshot, quantity
     FROM order_items WHERE order_id = $1`,
    [order.id],
  );

  return (
    <section className="container" style={{ padding: '40px 0', maxWidth: 720, fontFamily: 'Georgia, serif' }}>
      {success && <p style={{ color: 'var(--muted)' }}>Thank you — your order has been received.</p>}
      <h1 style={{ fontWeight: 400 }}>
        Order {order.public_token.slice(0, 8)} <StatusBadge status={order.status} />
      </h1>
      <p style={{ color: 'var(--muted)', fontSize: 13 }}>
        Placed {new Date(order.created_at).toLocaleString()}
      </p>
      {order.tracking_url && (
        <p>
          Tracking:{' '}
          <a href={order.tracking_url}>
            {order.tracking_number || 'view tracking'}
          </a>
        </p>
      )}

      <h3 style={{ marginTop: 32, fontWeight: 400 }}>Items</h3>
      {items.rows.map((i) => (
        <div
          key={i.id}
          style={{
            display: 'flex',
            gap: 16,
            borderBottom: '1px solid var(--rule)',
            padding: '12px 0',
          }}
        >
          <div style={{ flex: 1 }}>
            <strong>{i.artwork_snapshot.title}</strong>
            <div style={{ color: 'var(--muted)', fontSize: 14 }}>
              {i.variant_snapshot.type}, {i.variant_snapshot.size}
              {i.variant_snapshot.finish ? `, ${i.variant_snapshot.finish}` : ''} ·
              ×{i.quantity}
            </div>
          </div>
          <div>{formatUSD(i.price_cents_snapshot * i.quantity)}</div>
        </div>
      ))}

      <div style={{ marginTop: 24, textAlign: 'right' }}>
        <p>Subtotal: {formatUSD(order.subtotal_cents)}</p>
        <p>Shipping: {formatUSD(order.shipping_cents)}</p>
        <p>Tax: {formatUSD(order.tax_cents)}</p>
        <p>
          <strong>Total: {formatUSD(order.total_cents)}</strong>
        </p>
      </div>
    </section>
  );
}
