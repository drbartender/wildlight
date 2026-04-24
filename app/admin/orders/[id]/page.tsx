'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { formatUSD } from '@/lib/money';
import { AdminPill } from '@/components/admin/AdminPill';
import { AdminTopBar } from '@/components/admin/AdminTopBar';

interface Order {
  id: number;
  status: string;
  customer_email: string;
  customer_name: string | null;
  created_at: string;
  subtotal_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  notes: string | null;
  tracking_url: string | null;
  tracking_number: string | null;
  shipping_address: Record<string, string> | null;
  printful_order_id: number | null;
  updated_at?: string;
}

interface Item {
  id: number;
  artwork_snapshot: { title: string; slug: string; image_web_url?: string };
  variant_snapshot: { type: string; size: string; finish: string | null };
  price_cents_snapshot: number;
  quantity: number;
}

interface Data {
  order: Order;
  items: Item[];
}

const TYPE_LABEL: Record<string, string> = {
  fine_art: 'Fine art print',
  canvas: 'Canvas',
  framed: 'Framed',
  metal: 'Metal',
};

function fmtFull(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function AdminOrderDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/orders/${id}`);
    if (r.ok) setData((await r.json()) as Data);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(path: string, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/admin/orders/${id}/${path}`, {
      method: 'POST',
    });
    const d = (await r.json()) as { error?: string };
    if (!r.ok) setError(d.error || 'action failed');
    await load();
    setBusy(false);
  }

  if (!data) {
    return (
      <>
        <AdminTopBar title="Order" subtitle="Commerce" />
        <div className="wl-adm-page">
          <p style={{ color: 'var(--adm-muted)' }}>Loading…</p>
        </div>
      </>
    );
  }

  const o = data.order;
  const addr = o.shipping_address || {};
  const isNeedsReview = o.status === 'needs_review';
  const canRefund = !['refunded', 'canceled'].includes(o.status);

  // Build a minimal timeline from the data we have. This isn't a proper
  // event log yet — it's assembled from order fields so admins still get a
  // recognizable "what happened" column.
  interface TlEntry {
    when: string;
    who: string;
    what: string;
    tone?: 'ok' | 'err';
  }
  const tl: TlEntry[] = [];
  tl.push({
    when: fmtShort(o.created_at),
    who: 'customer',
    what: 'Order placed · Stripe',
    tone: 'ok',
  });
  if (o.total_cents > 0) {
    tl.push({
      when: fmtShort(o.created_at),
      who: 'system',
      what: `Payment captured · ${formatUSD(o.total_cents)}`,
      tone: 'ok',
    });
  }
  if (o.printful_order_id) {
    tl.push({
      when: o.updated_at ? fmtShort(o.updated_at) : '—',
      who: 'system',
      what: `Submitted to Printful · P-${o.printful_order_id}`,
      tone: 'ok',
    });
  } else if (o.status === 'needs_review' && o.notes) {
    tl.push({
      when: o.updated_at ? fmtShort(o.updated_at) : '—',
      who: 'system',
      what: 'Flagged needs_review',
      tone: 'err',
    });
  }
  if (o.tracking_number) {
    tl.push({
      when: o.updated_at ? fmtShort(o.updated_at) : '—',
      who: 'system',
      what: `Shipped · ${o.tracking_number}`,
      tone: 'ok',
    });
  }

  return (
    <>
      <AdminTopBar title={`Order #${o.id}`} subtitle="Commerce" />

      <div className="wl-adm-page">
        <Link
          href="/admin/orders"
          style={{
            color: 'var(--adm-muted)',
            fontSize: 12,
            marginTop: -12,
          }}
        >
          ← All orders
        </Link>

        <div className="wl-adm-order-head">
          <h1>Order #{o.id}</h1>
          <AdminPill status={o.status} />
          <span className="when">{fmtFull(o.created_at)}</span>
        </div>

        {isNeedsReview && (
          <div className="wl-adm-needs-banner">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16h.01" />
            </svg>
            <div className="msg">
              <strong>Needs review.</strong>{' '}
              {o.notes || 'Order could not be submitted to Printful.'}
            </div>
            <div className="acts">
              <button
                type="button"
                className="wl-adm-btn small primary"
                disabled={busy}
                onClick={() => act('resubmit')}
              >
                Resubmit to Printful
              </button>
              {canRefund && (
                <button
                  type="button"
                  className="wl-adm-btn small danger"
                  disabled={busy}
                  onClick={() =>
                    act(
                      'refund',
                      'Refund full amount + cancel Printful order?',
                    )
                  }
                >
                  Refund
                </button>
              )}
            </div>
          </div>
        )}

        {error && (
          <p
            style={{
              color: 'var(--adm-red)',
              fontFamily: 'var(--f-serif)',
              fontSize: 13,
            }}
          >
            {error}
          </p>
        )}

        <div className="wl-adm-order-grid">
          <div>
            <div className="wl-adm-card">
              <div className="h">
                <h3>Items</h3>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 12,
                    color: 'var(--adm-muted)',
                  }}
                >
                  {data.items.length}{' '}
                  {data.items.length === 1 ? 'line' : 'lines'}
                </span>
              </div>
              {data.items.map((i) => (
                <div key={i.id} className="wl-adm-order-item">
                  <div className="thumb">
                    {i.artwork_snapshot.image_web_url && (
                      <Image
                        src={i.artwork_snapshot.image_web_url}
                        alt=""
                        fill
                        sizes="58px"
                        style={{ objectFit: 'cover' }}
                      />
                    )}
                  </div>
                  <div className="ttl">
                    <div className="t">{i.artwork_snapshot.title}</div>
                    <div className="v">
                      {TYPE_LABEL[i.variant_snapshot.type] ||
                        i.variant_snapshot.type}{' '}
                      · {i.variant_snapshot.size}
                      {i.variant_snapshot.finish
                        ? ` · ${i.variant_snapshot.finish}`
                        : ''}
                    </div>
                  </div>
                  <div className="qty">×{i.quantity}</div>
                  <div className="line">
                    {formatUSD(i.price_cents_snapshot * i.quantity)}
                  </div>
                </div>
              ))}
              <div className="wl-adm-totals">
                <div className="r">
                  <span>Subtotal</span>
                  <span className="num">{formatUSD(o.subtotal_cents)}</span>
                </div>
                <div className="r">
                  <span>Shipping</span>
                  <span className="num">{formatUSD(o.shipping_cents)}</span>
                </div>
                <div className="r">
                  <span>Tax</span>
                  <span className="num">{formatUSD(o.tax_cents)}</span>
                </div>
                <div className="total">
                  <span>Total</span>
                  <span className="num">{formatUSD(o.total_cents)}</span>
                </div>
              </div>
            </div>

            {!isNeedsReview && (
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button
                  type="button"
                  className="wl-adm-btn small"
                  disabled={busy || o.status !== 'paid'}
                  onClick={() => act('resubmit')}
                  title="Only available when status is paid"
                >
                  Submit to Printful
                </button>
                {canRefund && (
                  <button
                    type="button"
                    className="wl-adm-btn small danger"
                    disabled={busy}
                    onClick={() =>
                      act(
                        'refund',
                        'Refund full amount + cancel Printful order?',
                      )
                    }
                  >
                    Refund
                  </button>
                )}
              </div>
            )}

            {tl.length > 0 && (
              <div className="wl-adm-panel" style={{ marginTop: 20 }}>
                <h3 style={{ fontSize: 16, marginBottom: 12 }}>Timeline</h3>
                <div className="wl-adm-timeline">
                  {tl.map((t, i) => (
                    <div
                      key={i}
                      className={`entry ${t.tone === 'err' ? 'err' : t.tone === 'ok' ? 'ok' : ''}`}
                    >
                      <span className="when">{t.when}</span>
                      <span className="dot" />
                      <span className="what">{t.what}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {o.tracking_url && (
              <p
                style={{
                  marginTop: 12,
                  fontSize: 13,
                  color: 'var(--adm-ink-2)',
                }}
              >
                Tracking:{' '}
                <a
                  href={o.tracking_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    textDecoration: 'underline',
                    color: 'var(--adm-blue)',
                  }}
                >
                  {o.tracking_number || 'view'}
                </a>
              </p>
            )}
          </div>

          <div className="wl-adm-side">
            <div className="wl-adm-panel">
              <div className="head">Customer</div>
              <div className="big">{o.customer_name || '—'}</div>
              <div className="line">{o.customer_email}</div>
            </div>
            <div className="wl-adm-panel">
              <div className="head">Ship to</div>
              <div className="line">
                {o.customer_name && (
                  <>
                    {o.customer_name}
                    <br />
                  </>
                )}
                {addr.line1}
                {addr.line2 ? (
                  <>
                    <br />
                    {addr.line2}
                  </>
                ) : null}
                {addr.city || addr.state || addr.postal_code ? (
                  <>
                    <br />
                    {[addr.city, addr.state].filter(Boolean).join(', ')}{' '}
                    {addr.postal_code}
                  </>
                ) : null}
                {addr.country ? (
                  <>
                    <br />
                    {addr.country}
                  </>
                ) : null}
              </div>
            </div>
            <div className="wl-adm-panel">
              <div className="head">Printful</div>
              <div className="line">
                {o.printful_order_id
                  ? `P-${o.printful_order_id}`
                  : 'Not submitted'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
