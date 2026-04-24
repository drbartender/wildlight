import { pool } from '@/lib/db';
import { formatUSD } from '@/lib/money';

export const dynamic = 'force-dynamic';

interface RevRow {
  total: number;
  n: number;
}
interface StatusCount {
  status: string;
  n: number;
}
interface SubRow {
  n: number;
}

export default async function AdminDashboard() {
  const [revRes, statusRes, subRes] = await Promise.all([
    pool.query<RevRow>(
      `SELECT COALESCE(SUM(total_cents), 0)::int AS total, COUNT(*)::int AS n
       FROM orders
       WHERE status IN ('paid','submitted','fulfilled','shipped','delivered')
         AND created_at >= NOW() - INTERVAL '30 days'`,
    ),
    pool.query<StatusCount>(`SELECT status, COUNT(*)::int AS n FROM orders GROUP BY status`),
    pool.query<SubRow>(
      `SELECT COUNT(*)::int AS n FROM subscribers
       WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL`,
    ),
  ]);

  const rev = revRes.rows[0] ?? { total: 0, n: 0 };
  const needsReview = statusRes.rows.find((r) => r.status === 'needs_review')?.n ?? 0;
  const subCount = subRes.rows[0]?.n ?? 0;

  return (
    <div>
      <h1 style={{ fontWeight: 400 }}>Dashboard</h1>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 16,
          marginTop: 24,
        }}
      >
        <Tile label="Revenue (30d)" value={formatUSD(rev.total)} />
        <Tile label="Orders (30d)" value={String(rev.n)} />
        <Tile
          label="Needs review"
          value={String(needsReview)}
          warn={needsReview > 0}
        />
        <Tile label="Subscribers" value={String(subCount)} />
      </div>
      {statusRes.rows.length > 0 && (
        <div style={{ marginTop: 40 }}>
          <h3 style={{ fontWeight: 400 }}>Order status breakdown</h3>
          <table style={{ width: '100%', maxWidth: 400, borderCollapse: 'collapse' }}>
            <tbody>
              {statusRes.rows.map((s) => (
                <tr key={s.status} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '8px 0' }}>{s.status}</td>
                  <td style={{ padding: '8px 0', textAlign: 'right' }}>{s.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div
      style={{
        border: '1px solid #e5e5e5',
        padding: 16,
        background: warn ? '#fff4f4' : undefined,
      }}
    >
      <div style={{ color: '#777', fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 24, marginTop: 4 }}>{value}</div>
    </div>
  );
}
