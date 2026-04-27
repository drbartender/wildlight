import Image from 'next/image';
import Link from 'next/link';
import { pool } from '@/lib/db';
import { formatUSD } from '@/lib/money';
import { StatusBadge } from '@/components/shop/StatusBadge';

export const dynamic = 'force-dynamic';

interface OrderRow {
  id: number;
  public_token: string;
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
  artwork_snapshot: {
    title: string;
    slug: string;
    collection_title?: string;
    image_web_url?: string;
  };
  variant_snapshot: { type: string; size: string; finish: string | null };
  price_cents_snapshot: number;
  quantity: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findOrder(token: string) {
  // public_token only — the stripe_session_id flavor used to be a second
  // public access path that leaked through carrier Referer headers. Stripe
  // success_url now goes through /api/orders/by-session which 302s here
  // with the public_token, so /orders/[token] has only one canonical URL.
  if (!UUID_RE.test(token)) return null;
  const r = await pool.query<OrderRow>(
    `SELECT id, public_token, status, customer_email,
            subtotal_cents, shipping_cents, tax_cents, total_cents,
            tracking_url, tracking_number, created_at
     FROM orders
     WHERE public_token = $1
     LIMIT 1`,
    [token],
  );
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
      <section className="wl-cart">
        <h1>
          Thank you <em>—</em> processing.
        </h1>
        <div className="sub">Reference {token.slice(0, 8)}</div>
        <div className="wl-receipt-pending">
          <p>
            Your payment succeeded. We&apos;re finalizing your order — this usually
            takes a few seconds. A confirmation email will arrive shortly with
            your full order details and a link you can bookmark.
          </p>
          <p className="wl-sum-note">
            <Link href="/collections">Back to collections →</Link>
          </p>
        </div>
      </section>
    );
  }

  const items = await pool.query<ItemRow>(
    `SELECT id, artwork_snapshot, variant_snapshot, price_cents_snapshot, quantity
     FROM order_items WHERE order_id = $1`,
    [order.id],
  );

  return (
    <section className="wl-cart">
      <h1>
        {success ? 'Thank you' : 'Your order'}
        <em>.</em>
      </h1>
      <div className="sub">
        Order {order.public_token.slice(0, 8)} · placed{' '}
        {new Date(order.created_at).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}
      </div>

      <div className="wl-cart-grid">
        <div>
          <div className="wl-receipt-status">
            <span className="wl-summary-label">Status</span>
            <StatusBadge status={order.status} />
            {order.tracking_url && (
              <a
                className="wl-receipt-tracking"
                href={order.tracking_url}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                {order.tracking_number || 'View tracking →'}
              </a>
            )}
          </div>

          {items.rows.map((i) => (
            <div key={i.id} className="wl-ci">
              <div className="wl-ci-img">
                {i.artwork_snapshot.image_web_url && (
                  <Image
                    src={i.artwork_snapshot.image_web_url}
                    alt={i.artwork_snapshot.title}
                    fill
                    sizes="96px"
                    style={{ objectFit: 'cover' }}
                  />
                )}
              </div>
              <div>
                <div className="wl-ci-title">{i.artwork_snapshot.title}</div>
                <div className="wl-ci-sub">
                  {i.variant_snapshot.type} · {i.variant_snapshot.size}
                  {i.variant_snapshot.finish ? ` · ${i.variant_snapshot.finish}` : ''}{' '}
                  · ×{i.quantity}
                </div>
              </div>
              <div className="wl-ci-price">
                {formatUSD(i.price_cents_snapshot * i.quantity)}
              </div>
            </div>
          ))}
        </div>

        <aside className="wl-summary">
          <span className="wl-summary-label">Receipt</span>
          <div className="wl-sum-row">
            <span>Subtotal</span>
            <span>{formatUSD(order.subtotal_cents)}</span>
          </div>
          <div className="wl-sum-row">
            <span>Shipping</span>
            <span>{formatUSD(order.shipping_cents)}</span>
          </div>
          <div className="wl-sum-row">
            <span>Tax</span>
            <span>{formatUSD(order.tax_cents)}</span>
          </div>
          <div className="wl-sum-row total">
            <span>Total</span>
            <span>{formatUSD(order.total_cents)}</span>
          </div>
          <p className="wl-sum-note">
            {success
              ? `A confirmation has been sent to ${order.customer_email}. We'll send tracking once it ships.`
              : `Confirmation sent to ${order.customer_email}.`}
          </p>
        </aside>
      </div>
    </section>
  );
}
