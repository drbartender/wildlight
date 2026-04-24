'use client';
import { use, useEffect, useState, useCallback } from 'react';
import { formatUSD } from '@/lib/money';
import { StatusPill } from '@/components/admin/StatusPill';

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
}

interface Item {
  id: number;
  artwork_snapshot: { title: string; slug: string };
  variant_snapshot: { type: string; size: string; finish: string | null };
  price_cents_snapshot: number;
  quantity: number;
}

interface Data {
  order: Order;
  items: Item[];
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
    const r = await fetch(`/api/admin/orders/${id}/${path}`, { method: 'POST' });
    const d = (await r.json()) as { error?: string };
    if (!r.ok) setError(d.error || 'action failed');
    await load();
    setBusy(false);
  }

  if (!data) return <p>Loading…</p>;
  const o = data.order;

  return (
    <div>
      <h1 style={{ fontWeight: 400 }}>
        Order #{o.id} <StatusPill status={o.status} />
      </h1>
      <p style={{ color: '#777', fontSize: 13 }}>
        {o.customer_email} · {new Date(o.created_at).toLocaleString()}
      </p>
      {o.printful_order_id && (
        <p style={{ color: '#777', fontSize: 13 }}>
          Printful order: {o.printful_order_id}
        </p>
      )}
      {o.tracking_url && (
        <p>
          Tracking:{' '}
          <a href={o.tracking_url}>{o.tracking_number || 'view'}</a>
        </p>
      )}
      {o.notes && (
        <pre
          style={{
            background: '#fff4f4',
            padding: 12,
            border: '1px solid #fbb',
            whiteSpace: 'pre-wrap',
            fontSize: 13,
          }}
        >
          {o.notes}
        </pre>
      )}

      <div style={{ margin: '16px 0', display: 'flex', gap: 8 }}>
        <button
          onClick={() => act('resubmit')}
          disabled={busy || o.status !== 'needs_review'}
        >
          Resubmit to Printful
        </button>
        <button
          onClick={() => act('refund', 'Refund full amount + cancel Printful order?')}
          disabled={busy || ['refunded', 'canceled'].includes(o.status)}
          style={{ color: '#b22' }}
        >
          Refund
        </button>
      </div>
      {error && <p style={{ color: '#b22' }}>{error}</p>}

      <h3 style={{ marginTop: 24, fontWeight: 400 }}>Items</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <tbody>
          {data.items.map((i) => (
            <tr key={i.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 8 }}>
                {i.artwork_snapshot.title} — {i.variant_snapshot.type},{' '}
                {i.variant_snapshot.size}
                {i.variant_snapshot.finish ? `, ${i.variant_snapshot.finish}` : ''}
              </td>
              <td style={{ padding: 8 }}>×{i.quantity}</td>
              <td style={{ padding: 8, textAlign: 'right' }}>
                {formatUSD(i.price_cents_snapshot * i.quantity)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ textAlign: 'right', marginTop: 16, fontSize: 14 }}>
        Subtotal {formatUSD(o.subtotal_cents)} · Ship{' '}
        {formatUSD(o.shipping_cents)} · Tax {formatUSD(o.tax_cents)} ·{' '}
        <strong>Total {formatUSD(o.total_cents)}</strong>
      </p>
      {o.shipping_address && (
        <div style={{ marginTop: 16, fontSize: 13, color: '#555' }}>
          <strong>Ship to:</strong>{' '}
          {o.customer_name}
          <br />
          {o.shipping_address.line1}
          {o.shipping_address.line2 ? `, ${o.shipping_address.line2}` : ''}
          <br />
          {o.shipping_address.city}, {o.shipping_address.state}{' '}
          {o.shipping_address.postal_code} {o.shipping_address.country}
        </div>
      )}
    </div>
  );
}
