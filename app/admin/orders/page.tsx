import Link from 'next/link';
import { pool } from '@/lib/db';
import { formatUSD } from '@/lib/money';
import { StatusPill } from '@/components/admin/StatusPill';

export const dynamic = 'force-dynamic';

interface Row {
  id: number;
  public_token: string;
  status: string;
  customer_email: string;
  total_cents: number;
  created_at: string;
  printful_order_id: number | null;
}

export default async function AdminOrders() {
  const { rows } = await pool.query<Row>(
    `SELECT id, public_token, status, customer_email, total_cents, created_at, printful_order_id
     FROM orders ORDER BY created_at DESC LIMIT 500`,
  );
  return (
    <div>
      <h1 style={{ fontWeight: 400 }}>Orders ({rows.length})</h1>
      {rows.length === 0 ? (
        <p style={{ color: '#777', marginTop: 16 }}>No orders yet.</p>
      ) : (
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            marginTop: 16,
            fontSize: 14,
          }}
        >
          <thead>
            <tr style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>
              <th style={{ padding: 8 }}>#</th>
              <th style={{ padding: 8 }}>When</th>
              <th style={{ padding: 8 }}>Customer</th>
              <th style={{ padding: 8 }}>Total</th>
              <th style={{ padding: 8 }}>Printful</th>
              <th style={{ padding: 8 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: 8 }}>
                  <Link href={`/admin/orders/${r.id}`}>{r.id}</Link>
                </td>
                <td style={{ padding: 8 }}>
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td style={{ padding: 8 }}>{r.customer_email}</td>
                <td style={{ padding: 8 }}>{formatUSD(r.total_cents)}</td>
                <td style={{ padding: 8, color: '#777' }}>
                  {r.printful_order_id || '—'}
                </td>
                <td style={{ padding: 8 }}>
                  <StatusPill status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
