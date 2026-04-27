'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatUSD } from '@/lib/money';
import { AdminPill } from '@/components/admin/AdminPill';
import { AdminTopBar } from '@/components/admin/AdminTopBar';

interface Row {
  id: number;
  status: string;
  customer_email: string;
  customer_name: string | null;
  total_cents: number;
  shipping_address: Record<string, string> | null;
  created_at: string;
  printful_order_id: number | null;
  item_count: number;
  is_test: boolean;
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'needs_review', label: 'Needs review' },
  { key: 'paid', label: 'Paid' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'refunded', label: 'Refunded' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
}

function cityOf(
  addr: Record<string, string> | null | undefined,
): string {
  if (!addr) return '';
  return [addr.city, addr.state].filter(Boolean).join(', ');
}

export default function AdminOrdersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('all');

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

  // Filter strips render in both skins (Atelier + Darkroom), so the
  // count helper would otherwise run rows.filter() 2 × FILTERS.length
  // times per render on every keystroke. Precompute once per rows
  // change.
  const counts = useMemo(() => {
    const out: Record<string, number> = { all: rows.length };
    for (const f of FILTERS) {
      if (f.key === 'all') continue;
      out[f.key] = 0;
    }
    for (const r of rows) {
      if (out[r.status] != null) out[r.status] += 1;
    }
    return out;
  }, [rows]);

  const filtered = useMemo(
    () =>
      filter === 'all' ? rows : rows.filter((r) => r.status === filter),
    [rows, filter],
  );
  const count = (s: FilterKey) => counts[s] ?? 0;

  return (
    <>
      <AdminTopBar
        title="Orders"
        subtitle={`${rows.length} in the catalog`}
      />

      <div className="wl-adm-page tight">
        {/* Atelier filter strip */}
        <div className="wl-adm-orders-filters-atelier">
          <div className="chips">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={f.key === filter ? 'on' : ''}
                onClick={() => setFilter(f.key)}
              >
                {f.label}{' '}
                <span className="count">{count(f.key)}</span>
              </button>
            ))}
          </div>
          <div className="actions">
            <button
              type="button"
              className="wl-adm-btn small"
              disabled
              title="Coming soon"
            >
              Export CSV
            </button>
          </div>
        </div>

        {/* Darkroom filter strip */}
        <div className="wl-adm-orders-filters-darkroom">
          <div className="chips">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={f.key === filter ? 'on' : ''}
                onClick={() => setFilter(f.key)}
              >
                {f.key} <span className="count">{count(f.key)}</span>
              </button>
            ))}
          </div>
          <span className="note">· range: last 30d</span>
          <div className="actions">
            <button
              type="button"
              className="wl-adm-btn small"
              disabled
              title="Coming soon"
            >
              export csv
            </button>
            <button
              type="button"
              className="wl-adm-btn small"
              disabled
              title="Coming soon"
            >
              resync printful
            </button>
          </div>
        </div>

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
            No orders
            {filter !== 'all' ? ` in "${filter.replace('_', ' ')}"` : ''}.
          </div>
        ) : (
          <>
            {/* Atelier table */}
            <div
              className="wl-adm-card wl-adm-orders-atelier"
              style={{ overflow: 'hidden' }}
            >
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
                  {filtered.map((r) => (
                    <tr
                      key={r.id}
                      className="clickable"
                      onClick={() => router.push(`/admin/orders/${r.id}`)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td className="mono muted">#{r.id}</td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {fmtWhen(r.created_at)}
                      </td>
                      <td>
                        <div>{r.customer_name || '—'}</div>
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--adm-muted)',
                          }}
                        >
                          {r.customer_email}
                        </div>
                      </td>
                      <td className="right mono muted">
                        {r.item_count || '—'}
                      </td>
                      <td className="right mono">
                        {formatUSD(r.total_cents)}
                      </td>
                      <td className="mono muted">
                        {r.printful_order_id
                          ? `P-${r.printful_order_id}`
                          : '—'}
                      </td>
                      <td>
                        {r.is_test && (
                          <span className="wl-adm-test-pill" aria-label="Test order">
                            TEST
                          </span>
                        )}
                        <AdminPill status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Darkroom table */}
            <div className="wl-adm-panel wl-adm-orders-darkroom">
              <table className="wl-adm-table mono">
                <thead>
                  <tr>
                    <th>id</th>
                    <th>placed</th>
                    <th>customer</th>
                    <th>ship_to</th>
                    <th className="right">items</th>
                    <th className="right">total</th>
                    <th>printful</th>
                    <th>status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={r.id}
                      className="clickable"
                      onClick={() => router.push(`/admin/orders/${r.id}`)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td style={{ color: 'var(--adm-green)' }}>#{r.id}</td>
                      <td className="muted">{fmtWhen(r.created_at)}</td>
                      <td>{r.customer_email}</td>
                      <td className="muted">
                        {cityOf(r.shipping_address) || '—'}
                      </td>
                      <td className="right">{r.item_count}</td>
                      <td className="right">{formatUSD(r.total_cents)}</td>
                      <td className="muted">
                        {r.printful_order_id
                          ? `#${r.printful_order_id}`
                          : '—'}
                      </td>
                      <td>
                        {r.is_test && (
                          <span className="wl-adm-test-pill" aria-label="Test order">
                            TEST
                          </span>
                        )}
                        <AdminPill status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
