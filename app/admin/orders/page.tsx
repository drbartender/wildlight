'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { formatUSD } from '@/lib/money';
import { AdminPill } from '@/components/admin/AdminPill';
import { AdminTopBar } from '@/components/admin/AdminTopBar';

interface Row {
  id: number;
  status: string;
  customer_email: string;
  customer_name: string | null;
  total_cents: number;
  created_at: string;
  printful_order_id: number | null;
  item_count: number;
}

const STATUS_TABS = [
  'all',
  'needs_review',
  'paid',
  'submitted',
  'shipped',
  'delivered',
  'refunded',
] as const;

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return `Today · ${time}`;
  const yd = new Date(now);
  yd.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yd.getFullYear() &&
    d.getMonth() === yd.getMonth() &&
    d.getDate() === yd.getDate()
  ) {
    return `Yesterday · ${time}`;
  }
  const days = Math.floor((now.getTime() - d.getTime()) / (24 * 3600 * 1000));
  if (days < 7) return `${days}d ago · ${time}`;
  return d.toLocaleDateString();
}

export default function AdminOrdersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<(typeof STATUS_TABS)[number]>('all');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/orders');
    if (res.ok) {
      const d = (await res.json()) as { rows: Row[] };
      setRows(d.rows);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = tab === 'all' ? rows : rows.filter((r) => r.status === tab);
  const count = (s: string) =>
    s === 'all' ? rows.length : rows.filter((r) => r.status === s).length;

  return (
    <>
      <AdminTopBar
        title="Orders"
        subtitle={`${rows.length} in the catalog`}
      />

      <div className="wl-adm-page tight">
        <div className="wl-adm-subhead">
          <div className="wl-adm-seg">
            {STATUS_TABS.map((f) => (
              <button
                key={f}
                className={tab === f ? 'on' : ''}
                onClick={() => setTab(f)}
              >
                {f === 'all' ? 'All' : f.replace('_', ' ')}
                <span className="sub">{count(f)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="wl-adm-card" style={{ overflow: 'hidden' }}>
          {loading ? (
            <div
              style={{
                padding: 20,
                color: 'var(--adm-muted)',
                fontSize: 13,
              }}
            >
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div
              style={{
                padding: 40,
                textAlign: 'center',
                color: 'var(--adm-muted)',
                fontSize: 13,
              }}
            >
              No orders{tab !== 'all' ? ` in "${tab.replace('_', ' ')}"` : ''}.
            </div>
          ) : (
            <table className="wl-adm-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Placed</th>
                  <th>Customer</th>
                  <th className="right">Items</th>
                  <th className="right">Total</th>
                  <th>Printful</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.id} className="clickable">
                    <td className="mono muted">
                      <Link href={`/admin/orders/${o.id}`}>#{o.id}</Link>
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {fmtWhen(o.created_at)}
                    </td>
                    <td>
                      <Link
                        href={`/admin/orders/${o.id}`}
                        style={{ color: 'var(--adm-ink)' }}
                      >
                        <div>{o.customer_name || '—'}</div>
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--adm-muted)',
                          }}
                        >
                          {o.customer_email}
                        </div>
                      </Link>
                    </td>
                    <td className="right mono muted">{o.item_count || '—'}</td>
                    <td className="right mono">
                      {formatUSD(o.total_cents)}
                    </td>
                    <td className="mono muted">
                      {o.printful_order_id
                        ? `P-${o.printful_order_id}`
                        : '—'}
                    </td>
                    <td>
                      <AdminPill status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
