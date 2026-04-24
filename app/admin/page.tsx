import Link from 'next/link';
import { pool } from '@/lib/db';
import { formatUSD } from '@/lib/money';
import { AdminTopBar } from '@/components/admin/AdminTopBar';
import { AdminPill } from '@/components/admin/AdminPill';
import { DashboardMetricToggle } from '@/components/admin/DashboardMetricToggle';

export const dynamic = 'force-dynamic';

interface RevRow {
  total: number;
  n: number;
  avg: number;
}
interface StatusCount {
  status: string;
  n: number;
}
interface SubRow {
  n: number;
}
interface DailyRow {
  d: string;
  c: number;
}
interface CatalogRow {
  status: string;
  n: number;
}
interface MissingRow {
  n: number;
}
interface NeedsReviewRow {
  id: number;
  customer_name: string | null;
  customer_email: string;
  total_cents: number;
  notes: string | null;
}
interface RecentRow {
  id: number;
  customer_name: string | null;
  customer_email: string;
  total_cents: number;
  status: string;
  created_at: string;
}
interface TopArtworkRow {
  id: number;
  slug: string;
  title: string;
  image_web_url: string;
  collection_title: string | null;
  units_sold: number;
  revenue_cents: number;
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today · ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return `Yesterday · ${time}`;
  }
  const days = Math.floor((now.getTime() - d.getTime()) / (24 * 3600 * 1000));
  if (days < 14) return `${days}d ago · ${time}`;
  return d.toLocaleDateString();
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ metric?: string }>;
}) {
  const { metric: rawMetric } = await searchParams;
  const topMetric: 'units' | 'revenue' =
    rawMetric === 'revenue' ? 'revenue' : 'units';

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
  });

  const [rev, sub, daily, catalog, missing, needs, recent, topArts] = await Promise.all([
    pool.query<RevRow>(
      `SELECT COALESCE(SUM(total_cents), 0)::int AS total,
              COUNT(*)::int AS n,
              COALESCE(AVG(total_cents), 0)::int AS avg
       FROM orders
       WHERE status IN ('paid','submitted','fulfilled','shipped','delivered')
         AND created_at >= NOW() - INTERVAL '30 days'`,
    ),
    pool.query<SubRow>(
      `SELECT COUNT(*)::int AS n FROM subscribers
       WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL`,
    ),
    pool.query<DailyRow>(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS d,
              COALESCE(SUM(total_cents), 0)::int AS c
       FROM orders
       WHERE status IN ('paid','submitted','fulfilled','shipped','delivered')
         AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY 1 ORDER BY 1`,
    ),
    pool.query<CatalogRow>(
      `SELECT status, COUNT(*)::int AS n FROM artworks GROUP BY status`,
    ),
    pool.query<MissingRow>(
      `SELECT COUNT(*)::int AS n FROM artworks
       WHERE status = 'published' AND image_print_url IS NULL`,
    ),
    pool.query<NeedsReviewRow>(
      `SELECT id, customer_name, customer_email, total_cents, notes
       FROM orders WHERE status = 'needs_review'
       ORDER BY created_at DESC LIMIT 5`,
    ),
    pool.query<RecentRow>(
      `SELECT id, customer_name, customer_email, total_cents, status, created_at::text
       FROM orders ORDER BY created_at DESC LIMIT 5`,
    ),
    pool.query<TopArtworkRow>(
      `SELECT
         a.id, a.slug, a.title, a.image_web_url,
         c.title AS collection_title,
         COALESCE(SUM(oi.quantity), 0)::int                           AS units_sold,
         COALESCE(SUM(oi.quantity * oi.price_cents_snapshot), 0)::int AS revenue_cents
       FROM order_items oi
       JOIN orders   o ON o.id = oi.order_id
       JOIN artworks a ON a.slug = (oi.artwork_snapshot->>'slug')
       LEFT JOIN collections c ON c.id = a.collection_id
       WHERE o.created_at >= NOW() - INTERVAL '30 days'
         AND o.status IN ('paid','submitted','fulfilled','shipped','delivered')
       GROUP BY a.id, c.title
       ORDER BY
         CASE WHEN $1::text = 'revenue'
              THEN SUM(oi.quantity * oi.price_cents_snapshot)
              ELSE SUM(oi.quantity)
         END DESC NULLS LAST
       LIMIT 5`,
      [topMetric],
    ),
  ]);

  // Build a continuous 30-day bucket so the sparkline doesn't collapse on days
  // with zero orders.
  const dailyMap = new Map(daily.rows.map((r) => [r.d, r.c]));
  const spark: { d: string; c: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const dt = new Date();
    dt.setUTCDate(dt.getUTCDate() - i);
    const key = dt.toISOString().slice(0, 10);
    spark.push({ d: key, c: dailyMap.get(key) ?? 0 });
  }
  const maxR = Math.max(...spark.map((s) => s.c), 1);
  const firstLabel = new Date(spark[0].d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  const midLabel = new Date(spark[15].d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  const lastLabel = new Date(spark[spark.length - 1].d).toLocaleDateString(
    undefined,
    { month: 'short', day: 'numeric' },
  );

  const catMap: Record<string, number> = { published: 0, draft: 0, retired: 0 };
  for (const r of catalog.rows) catMap[r.status] = r.n;
  const missingCount = missing.rows[0]?.n ?? 0;
  const needsReviewCount = needs.rows.length;
  const subCount = sub.rows[0]?.n ?? 0;
  const revTotal = rev.rows[0]?.total ?? 0;
  const revN = rev.rows[0]?.n ?? 0;
  const revAvg = revN > 0 ? Math.round(revTotal / revN) : 0;

  return (
    <>
      <AdminTopBar title="Overview" subtitle={`Today · ${today}`} />

      <div className="wl-adm-page">
        <div className="wl-adm-kpis">
          <div className="wl-adm-kpi">
            <div className="k">Revenue · 30d</div>
            <div className="v">{formatUSD(revTotal)}</div>
            <div className="d">
              {revN} paid {revN === 1 ? 'order' : 'orders'}
            </div>
          </div>
          <div className="wl-adm-kpi">
            <div className="k">Orders · 30d</div>
            <div className="v">{revN}</div>
            <div className="d">
              {needsReviewCount > 0 ? (
                <span className="down">
                  {needsReviewCount} needs review
                </span>
              ) : (
                'all processed'
              )}
            </div>
          </div>
          <div className="wl-adm-kpi">
            <div className="k">Avg. order</div>
            <div className="v">{formatUSD(revAvg)}</div>
            <div className="d">last 30 days</div>
          </div>
          <div className="wl-adm-kpi">
            <div className="k">Subscribers</div>
            <div className="v">{subCount.toLocaleString()}</div>
            <div className="d">confirmed, not unsubscribed</div>
          </div>
        </div>

        <div className="wl-adm-kpis-darkroom">
          <div className="wl-adm-kpi-d">
            <div className="k">revenue_30d</div>
            <div className="v">{formatUSD(revTotal)}</div>
            <div className="d up">
              {revN > 0 ? `▲ ${revN} paid` : 'no sales yet'}
            </div>
          </div>
          <div className="wl-adm-kpi-d">
            <div className="k">orders_30d</div>
            <div className="v">{revN}</div>
            <div className="d">last 30 days</div>
          </div>
          <div className="wl-adm-kpi-d">
            <div className="k">aov</div>
            <div className="v">{formatUSD(revAvg)}</div>
            <div className="d">avg per order</div>
          </div>
          <div className="wl-adm-kpi-d">
            <div className="k">subscribers</div>
            <div className="v">{subCount.toLocaleString()}</div>
            <div className="d">confirmed</div>
          </div>
          <div className={`wl-adm-kpi-d ${needsReviewCount > 0 ? 'alert' : ''}`}>
            <div className="k">needs_review</div>
            <div className="v">{needsReviewCount}</div>
            <div className="d">{needsReviewCount > 0 ? 'action' : 'clear'}</div>
          </div>
        </div>

        <div className="wl-adm-row2">
          {/* Atelier: bar sparkline */}
          <div className="wl-adm-card wl-adm-revenue-atelier">
            <div className="h">
              <h3>Revenue · last 30 days</h3>
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 11,
                  color: 'var(--adm-muted)',
                }}
              >
                daily · USD
              </span>
            </div>
            <div className="body wl-adm-spark">
              <svg viewBox="0 0 600 140" preserveAspectRatio="none">
                {spark.map((s, i) => {
                  const x = (i / (spark.length - 1)) * 580 + 10;
                  const h = maxR ? (s.c / maxR) * 120 : 0;
                  const isLast = i === spark.length - 1;
                  return (
                    <rect
                      key={i}
                      x={x - 6}
                      y={130 - (h || 1)}
                      width="10"
                      height={h || 1}
                      fill={
                        isLast ? 'var(--adm-green)' : 'var(--adm-green-soft)'
                      }
                    />
                  );
                })}
                <line
                  x1="10"
                  y1="130"
                  x2="590"
                  y2="130"
                  stroke="var(--adm-rule)"
                />
              </svg>
              <div className="wl-adm-spark-axis">
                <span>{firstLabel}</span>
                <span>{midLabel}</span>
                <span>{lastLabel}</span>
              </div>
            </div>
          </div>

          {/* Darkroom: line + gradient */}
          <div className="wl-adm-panel wl-adm-revenue-darkroom">
            <div className="h2">
              <span className="t">revenue · 30d · usd</span>
              <div className="pills">
                {['7d', '30d', '90d', '12m'].map((p) => (
                  <span key={p} className={p === '30d' ? 'on' : ''}>
                    {p}
                  </span>
                ))}
              </div>
            </div>
            <svg viewBox="0 0 600 140" preserveAspectRatio="none" className="chart">
              <defs>
                <linearGradient id="dg" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--adm-green)" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="var(--adm-green)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0, 1, 2, 3].map((i) => (
                <line
                  key={i}
                  x1="0"
                  x2="600"
                  y1={10 + i * 35}
                  y2={10 + i * 35}
                  stroke="var(--adm-rule)"
                  strokeDasharray="2 3"
                />
              ))}
              <path
                d={`M ${spark
                  .map(
                    (s, i) =>
                      `${(i / (spark.length - 1)) * 600},${130 - (s.c / maxR) * 120}`,
                  )
                  .join(' L ')}`}
                fill="none"
                stroke="var(--adm-green)"
                strokeWidth="1.5"
              />
              <path
                d={`M 0,130 L ${spark
                  .map(
                    (s, i) =>
                      `${(i / (spark.length - 1)) * 600},${130 - (s.c / maxR) * 120}`,
                  )
                  .join(' L ')} L 600,130 Z`}
                fill="url(#dg)"
              />
              {spark.map((s, i) => {
                const x = (i / (spark.length - 1)) * 600;
                const y = 130 - (s.c / maxR) * 120;
                const isLast = i === spark.length - 1;
                return (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r={isLast ? 3 : 1.5}
                    fill="var(--adm-green)"
                  />
                );
              })}
            </svg>
            <div className="axis">
              <span>{firstLabel}</span>
              <span>{midLabel}</span>
              <span>{lastLabel}</span>
            </div>
          </div>

          <div className="wl-adm-card">
            <div className="h">
              <h3>Needs review</h3>
              <span
                style={{
                  background: 'var(--adm-red)',
                  color: 'var(--adm-paper)',
                  fontSize: 10,
                  padding: '1px 7px',
                  borderRadius: 999,
                }}
              >
                {needsReviewCount}
              </span>
              <Link
                className="wl-adm-btn ghost small"
                href="/admin/orders"
                style={{ marginLeft: 'auto' }}
              >
                View all →
              </Link>
            </div>
            <div className="body">
              {needs.rows.length === 0 ? (
                <p
                  style={{
                    fontSize: 13,
                    color: 'var(--adm-muted)',
                    padding: '8px 0',
                  }}
                >
                  Nothing flagged. Quiet queue.
                </p>
              ) : (
                <div className="wl-adm-review-list">
                  {needs.rows.map((o) => (
                    <Link
                      key={o.id}
                      href={`/admin/orders/${o.id}`}
                      className="wl-adm-review-row"
                    >
                      <span className="id">#{o.id}</span>
                      <span className="reason">
                        {o.notes || o.customer_name || o.customer_email}
                      </span>
                      <span className="total">
                        {formatUSD(o.total_cents)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="wl-adm-row2">
          <div className="wl-adm-card">
            <div className="h">
              <h3>Recent orders</h3>
              <Link
                className="wl-adm-btn ghost small"
                href="/admin/orders"
                style={{ marginLeft: 'auto' }}
              >
                View all →
              </Link>
            </div>
            {recent.rows.length === 0 ? (
              <div
                className="body"
                style={{ color: 'var(--adm-muted)', fontSize: 13 }}
              >
                No orders yet.
              </div>
            ) : (
              <table className="wl-adm-table">
                <tbody>
                  {recent.rows.map((o) => (
                    <tr key={o.id} className="clickable">
                      <td className="mono muted" style={{ width: 60, paddingLeft: 20 }}>
                        <Link href={`/admin/orders/${o.id}`}>#{o.id}</Link>
                      </td>
                      <td className="muted" style={{ width: 140 }}>
                        {fmtWhen(o.created_at)}
                      </td>
                      <td>
                        <Link
                          href={`/admin/orders/${o.id}`}
                          style={{ color: 'var(--adm-ink)' }}
                        >
                          {o.customer_name || o.customer_email}
                        </Link>
                      </td>
                      <td className="mono" style={{ width: 90 }}>
                        {formatUSD(o.total_cents)}
                      </td>
                      <td className="right" style={{ paddingRight: 20 }}>
                        <AdminPill status={o.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="wl-adm-card wl-adm-catalog-atelier">
            <div className="h">
              <h3>Catalog</h3>
              <Link
                className="wl-adm-btn ghost small"
                href="/admin/artworks"
                style={{ marginLeft: 'auto' }}
              >
                Catalog →
              </Link>
            </div>
            <div className="body">
              <div className="wl-adm-catalog-stats">
                <div className="wl-adm-catalog-stat">
                  <div className="k">Published</div>
                  <div className="v">{catMap.published ?? 0}</div>
                </div>
                <div className="wl-adm-catalog-stat">
                  <div className="k">Draft</div>
                  <div className="v">{catMap.draft ?? 0}</div>
                </div>
                <div className="wl-adm-catalog-stat">
                  <div className="k">Retired</div>
                  <div className="v">{catMap.retired ?? 0}</div>
                </div>
                <div
                  className={`wl-adm-catalog-stat ${missingCount > 0 ? 'warn' : ''}`}
                >
                  <div className="k">Missing print file</div>
                  <div className="v">{missingCount}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Darkroom: top-artworks panel (replaces Catalog card) */}
          <div className="wl-adm-panel wl-adm-top-darkroom">
            <div className="h">
              <span className="t">top_artworks · 30d</span>
              <DashboardMetricToggle />
            </div>
            {topArts.rows.length === 0 ? (
              <div className="empty">Not enough sales yet.</div>
            ) : (
              topArts.rows.map((a, i) => (
                <Link
                  key={a.id}
                  href={`/admin/artworks/${a.id}`}
                  className="row"
                  style={{
                    borderTop: i ? '1px solid var(--adm-rule)' : 'none',
                  }}
                >
                  <img src={a.image_web_url} alt="" />
                  <div className="meta">
                    <div className="t">{a.title}</div>
                    <div className="c">
                      {a.collection_title?.toLowerCase() ?? '—'}
                    </div>
                  </div>
                  <div className="n">
                    {topMetric === 'revenue' ? (
                      formatUSD(a.revenue_cents)
                    ) : (
                      <>
                        {a.units_sold}
                        <span className="s"> sold</span>
                      </>
                    )}
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
