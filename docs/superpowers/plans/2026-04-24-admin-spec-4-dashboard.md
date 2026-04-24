# Admin Spec 4 — Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the admin dashboard per skin — Atelier keeps the existing bar sparkline + 4-wide KPI + Catalog card; Darkroom gets a 5-wide KPI strip (incl. `needs_review`), a line chart with gradient fill, and a top-artworks panel with units/$ toggle.

**Architecture:** Dashboard stays SSR. Extend the existing `pool.query` block in `app/admin/page.tsx` with one new top-artworks query (metric-configurable via `searchParams`). Emit both Atelier and Darkroom DOM trees in the same component; CSS toggles visibility by `[data-theme]`. No new components.

**Tech Stack:** Next.js 16 App Router (server component), React, TypeScript, raw SQL via `pg`, plain CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-04-24-admin-spec-4-dashboard.md`

**Design invariant:** Atelier and Darkroom are independent visual languages over the same data. Atelier bars stay bars; Darkroom gets a line+gradient chart. The 4-wide vs 5-wide KPI grids differ on purpose. Do not converge.

---

## File Structure

**Modify:**
- `app/admin/page.tsx` — extend server queries with top-artworks; emit dual-DOM per skin; read `?metric=` from `searchParams`.
- `app/admin/admin.css` — add Darkroom-specific rules for: 5-wide KPI strip, line-chart wrapper, top-artworks panel, metric toggle, and the default-hide rules that keep Darkroom DOM invisible in Atelier.

**No new files.** Keep the dashboard as a single server component; it's already cohesive.

---

## Task 1: Extend the server queries with a top-artworks aggregation

**Files:**
- Modify: `app/admin/page.tsx`

- [ ] **Step 1: Accept `searchParams`**

In `app/admin/page.tsx`, change the function signature (around line 71):

```tsx
export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ metric?: string }>;
}) {
```

Immediately inside the function body, resolve the metric:

```tsx
  const { metric: rawMetric } = await searchParams;
  const topMetric: 'units' | 'revenue' =
    rawMetric === 'revenue' ? 'revenue' : 'units';
```

- [ ] **Step 2: Add the top-artworks interface and query**

Near the top of the file, add to the interfaces block:

```tsx
interface TopArtworkRow {
  id: number;
  slug: string;
  title: string;
  image_web_url: string;
  collection_title: string | null;
  units_sold: number;
  revenue_cents: number;
}
```

In the `Promise.all` destructure (around line 78), add a 8th entry. Change the tuple to include `topArts`:

```tsx
  const [rev, sub, daily, catalog, missing, needs, recent, topArts] = await Promise.all([
    // ... existing 7 queries unchanged
    pool.query<TopArtworkRow>(
      `SELECT
         a.id, a.slug, a.title, a.image_web_url,
         c.title AS collection_title,
         COALESCE(SUM(oi.quantity), 0)::int                                         AS units_sold,
         COALESCE(SUM(oi.quantity * oi.price_cents_snapshot), 0)::int               AS revenue_cents
       FROM order_items oi
       JOIN orders   o ON o.id = oi.order_id
       JOIN artworks a ON a.id = (oi.artwork_snapshot->>'id')::int
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
```

The `oi.artwork_snapshot->>'id'` path: the order_items snapshot may or may not include `id` (see `app/api/webhooks/stripe/route.ts` for the insert). If not, this join silently drops rows, which is fine — we only want currently-resolvable artworks. If the snapshot doesn't include `id`, fall back to joining by `slug` instead:

```sql
JOIN artworks a ON a.slug = (oi.artwork_snapshot->>'slug')
```

Verify the snapshot shape by reading `app/api/webhooks/stripe/route.ts` lines 159-166. Use the matching key — `slug` is present, `id` may not be. Adjust the query to use `slug` if needed.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Smoke**

```bash
npm run dev
```

Visit `/admin`. Existing dashboard should render unchanged (we haven't wired the new data into UI yet). No runtime error in the terminal.

- [ ] **Step 5: Commit**

```bash
git add app/admin/page.tsx
git commit -m "admin: top-artworks query on dashboard (units/$ configurable)"
```

---

## Task 2: Darkroom 5-wide KPI strip

**Files:**
- Modify: `app/admin/page.tsx`
- Modify: `app/admin/admin.css`

Atelier's existing `.wl-adm-kpis` is 4-wide. Render both DOM trees and hide per skin.

- [ ] **Step 1: Add the Darkroom KPI strip JSX**

In `app/admin/page.tsx`, find the existing `<div className="wl-adm-kpis">` block (approximately line 155-186). Immediately AFTER its closing `</div>`, add:

```tsx
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
```

- [ ] **Step 2: Add CSS for the Darkroom KPI strip**

In `app/admin/admin.css`, find the existing `.wl-adm-kpis` rules. Immediately after them, append:

```css
/* Darkroom 5-wide KPI strip */
.wl-adm-kpis-darkroom {
  display: none; /* hidden in Atelier */
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
}
.wl-admin-surface[data-theme='dark'] .wl-adm-kpis {
  display: none;
}
.wl-admin-surface[data-theme='dark'] .wl-adm-kpis-darkroom {
  display: grid;
}
.wl-adm-kpi-d {
  background: var(--adm-panel);
  border: 1px solid var(--adm-rule);
  border-radius: 4px;
  padding: 10px 12px;
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
}
.wl-adm-kpi-d .k {
  font-size: 10px;
  color: var(--adm-muted);
}
.wl-adm-kpi-d .v {
  font-size: 22px;
  margin-top: 4px;
  color: var(--adm-ink);
  letter-spacing: -0.02em;
}
.wl-adm-kpi-d .d {
  font-size: 10px;
  margin-top: 2px;
  color: var(--adm-muted);
}
.wl-adm-kpi-d .d.up { color: var(--adm-green); }
.wl-adm-kpi-d.alert .v { color: var(--adm-red); }
.wl-adm-kpi-d.alert .d { color: var(--adm-red); }
```

- [ ] **Step 3: Typecheck + smoke**

```bash
npm run typecheck
```

Then:

```bash
npm run dev
```

Reload `/admin` in both skins. Atelier still shows 4-wide; Darkroom shows 5-wide with `needs_review` tile.

- [ ] **Step 4: Commit**

```bash
git add app/admin/page.tsx app/admin/admin.css
git commit -m "admin: Darkroom 5-wide KPI strip with needs_review tile"
```

---

## Task 3: Darkroom line+gradient chart

**Files:**
- Modify: `app/admin/page.tsx`
- Modify: `app/admin/admin.css`

Atelier's bar sparkline stays. Add a Darkroom variant immediately below, with CSS-based visibility.

- [ ] **Step 1: Add the Darkroom chart JSX**

Find the existing Atelier revenue card (the `<div className="wl-adm-card">` with `<h3>Revenue · last 30 days</h3>`, approximately lines 189-236). Inside the same grid parent (`<div className="wl-adm-row2">`), replace the first child `<div className="wl-adm-card">` with a wrapper that holds both shapes:

```tsx
          <div className="wl-adm-revenue-card">
            {/* Atelier: bar sparkline */}
            <div className="wl-adm-card wl-adm-revenue-atelier">
              <div className="h">
                <h3>Revenue · last 30 days</h3>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--adm-muted)' }}>
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
                        fill={isLast ? 'var(--adm-green)' : 'var(--adm-green-soft)'}
                      />
                    );
                  })}
                  <line x1="10" y1="130" x2="590" y2="130" stroke="var(--adm-rule)" />
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
                    <span key={p} className={p === '30d' ? 'on' : ''}>{p}</span>
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
                    stroke="var(--adm-rule-soft, var(--adm-rule))"
                    strokeDasharray="2 3"
                  />
                ))}
                <path
                  d={`M ${spark
                    .map((s, i) => `${(i / (spark.length - 1)) * 600},${130 - (s.c / maxR) * 120}`)
                    .join(' L ')}`}
                  fill="none"
                  stroke="var(--adm-green)"
                  strokeWidth="1.5"
                />
                <path
                  d={`M 0,130 L ${spark
                    .map((s, i) => `${(i / (spark.length - 1)) * 600},${130 - (s.c / maxR) * 120}`)
                    .join(' L ')} L 600,130 Z`}
                  fill="url(#dg)"
                />
                {spark.map((s, i) => {
                  const x = (i / (spark.length - 1)) * 600;
                  const y = 130 - (s.c / maxR) * 120;
                  const isLast = i === spark.length - 1;
                  return (
                    <circle key={i} cx={x} cy={y} r={isLast ? 3 : 1.5} fill="var(--adm-green)" />
                  );
                })}
              </svg>
              <div className="axis">
                <span>{firstLabel}</span>
                <span>{midLabel}</span>
                <span>{lastLabel}</span>
              </div>
            </div>
          </div>
```

- [ ] **Step 2: Add CSS for visibility + Darkroom chart panel**

Append to `app/admin/admin.css`:

```css
/* Dashboard revenue chart — Atelier default, Darkroom replaces */
.wl-adm-revenue-atelier  { display: block; }
.wl-adm-revenue-darkroom { display: none; }
.wl-admin-surface[data-theme='dark'] .wl-adm-revenue-atelier  { display: none; }
.wl-admin-surface[data-theme='dark'] .wl-adm-revenue-darkroom { display: block; }

.wl-adm-revenue-darkroom {
  padding: 14px;
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
}
.wl-adm-revenue-darkroom .h2 {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.wl-adm-revenue-darkroom .t { font-size: 11px; color: var(--adm-ink); }
.wl-adm-revenue-darkroom .pills {
  margin-left: auto;
  display: flex;
  gap: 4px;
  font-size: 10px;
}
.wl-adm-revenue-darkroom .pills span {
  padding: 2px 7px;
  border-radius: 2px;
  color: var(--adm-muted);
}
.wl-adm-revenue-darkroom .pills span.on {
  background: var(--adm-panel-2);
  color: var(--adm-green);
}
.wl-adm-revenue-darkroom .chart { width: 100%; height: 140px; margin-top: 4px; }
.wl-adm-revenue-darkroom .axis {
  display: flex;
  justify-content: space-between;
  font-size: 9px;
  color: var(--adm-muted);
  margin-top: 4px;
}
```

- [ ] **Step 3: Typecheck + smoke**

```bash
npm run typecheck && npm run dev
```

Reload `/admin`. Atelier: bars. Darkroom: line with gradient fill + grid lines + final-point dot + range pills.

- [ ] **Step 4: Commit**

```bash
git add app/admin/page.tsx app/admin/admin.css
git commit -m "admin: Darkroom revenue chart — line + gradient fill"
```

---

## Task 4: Darkroom top-artworks panel with units/$ toggle

**Files:**
- Modify: `app/admin/page.tsx`
- Modify: `app/admin/admin.css`

Atelier keeps its Catalog card. Darkroom replaces it with a top-artworks panel, and the metric pill changes the sort via `router.push('?metric=…')`.

- [ ] **Step 1: Extract the metric toggle as a tiny client component (inline file)**

The dashboard is a server component; the metric toggle needs an onClick. Create a tiny client-only component inline at the top of a new file.

Create `app/admin/_dashboard-metric-toggle.tsx` (note: under `app/admin/`, but `_`-prefixed → still works for imports; Next.js excludes `_*` from routing but not from module resolution). Actually, per CLAUDE.md "`_`-prefixed folders under `app/` are private" — use a different location to avoid confusion. Put it at `components/admin/DashboardMetricToggle.tsx`:

```tsx
'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export function DashboardMetricToggle() {
  const router = useRouter();
  const sp = useSearchParams();
  const current = sp.get('metric') === 'revenue' ? 'revenue' : 'units';
  function choose(next: 'units' | 'revenue') {
    if (next === current) return;
    const qp = new URLSearchParams(sp.toString());
    qp.set('metric', next);
    router.push(`?${qp.toString()}`);
  }
  return (
    <div className="wl-adm-top-metric">
      <span
        className={current === 'units' ? 'on' : ''}
        onClick={() => choose('units')}
      >
        units
      </span>
      <span
        className={current === 'revenue' ? 'on' : ''}
        onClick={() => choose('revenue')}
      >
        $
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Add the Darkroom top-artworks panel JSX**

In `app/admin/page.tsx`, find the existing Catalog card (the last `<div className="wl-adm-card">` at the bottom, approximately lines 344-378). Replace it with a wrapper that holds both shapes:

```tsx
          <div className="wl-adm-catalog-wrap">
            {/* Atelier: Catalog stats */}
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
                  <div className={`wl-adm-catalog-stat ${missingCount > 0 ? 'warn' : ''}`}>
                    <div className="k">Missing print file</div>
                    <div className="v">{missingCount}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Darkroom: top artworks */}
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
                    style={{ borderTop: i ? '1px solid var(--adm-rule-soft, var(--adm-rule))' : 'none' }}
                  >
                    <img src={a.image_web_url} alt="" />
                    <div className="meta">
                      <div className="t">{a.title}</div>
                      <div className="c">{a.collection_title?.toLowerCase() ?? '—'}</div>
                    </div>
                    <div className="n">
                      {topMetric === 'revenue'
                        ? formatUSD(a.revenue_cents)
                        : <>{a.units_sold}<span className="s"> sold</span></>}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
```

At the top of `app/admin/page.tsx`, add the import:

```tsx
import { DashboardMetricToggle } from '@/components/admin/DashboardMetricToggle';
```

- [ ] **Step 3: Add CSS for the top-artworks panel**

Append to `app/admin/admin.css`:

```css
/* Dashboard top-artworks — Atelier hides, Darkroom shows */
.wl-adm-catalog-atelier { display: block; }
.wl-adm-top-darkroom    { display: none; }
.wl-admin-surface[data-theme='dark'] .wl-adm-catalog-atelier { display: none; }
.wl-admin-surface[data-theme='dark'] .wl-adm-top-darkroom    { display: block; }

.wl-adm-top-darkroom .h {
  padding: 10px 14px;
  border-bottom: 1px solid var(--adm-rule);
  display: flex;
  align-items: center;
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--adm-ink);
}
.wl-adm-top-darkroom .empty {
  padding: 20px;
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  color: var(--adm-muted);
  font-size: 11px;
}
.wl-adm-top-darkroom .row {
  padding: 8px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: inherit;
}
.wl-adm-top-darkroom .row img {
  width: 28px;
  height: 28px;
  object-fit: cover;
  border-radius: 2px;
}
.wl-adm-top-darkroom .row .meta { flex: 1; overflow: hidden; }
.wl-adm-top-darkroom .row .meta .t {
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--adm-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wl-adm-top-darkroom .row .meta .c {
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  font-size: 9px;
  color: var(--adm-muted);
}
.wl-adm-top-darkroom .row .n {
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--adm-ink-2);
  text-align: right;
}
.wl-adm-top-darkroom .row .n .s { color: var(--adm-dim, var(--adm-muted)); margin-left: 2px; }

.wl-adm-top-metric {
  margin-left: auto;
  display: flex;
  gap: 4px;
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  font-size: 10px;
}
.wl-adm-top-metric span {
  padding: 2px 7px;
  border-radius: 2px;
  color: var(--adm-muted);
  cursor: pointer;
}
.wl-adm-top-metric span.on {
  background: var(--adm-panel-2);
  color: var(--adm-green);
}
```

- [ ] **Step 4: Typecheck + smoke**

```bash
npm run typecheck && npm run dev
```

Reload `/admin`. Atelier: Catalog stats. Darkroom: top-artworks panel with 5 artworks (if any). Click `$`; URL becomes `?metric=revenue`, list reorders, thousands.

- [ ] **Step 5: Commit**

```bash
git add app/admin/page.tsx app/admin/admin.css components/admin/DashboardMetricToggle.tsx
git commit -m "admin: Darkroom top-artworks panel with units/$ metric toggle"
```

---

## Task 5: Manual smoke verification + typecheck

**Files:** none.

- [ ] **Step 1: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 2: Tests**

```bash
npm test
```

Expected: existing tests pass. (No new tests for this plan; the work is server-component data + CSS.)

- [ ] **Step 3: Cross-skin smoke**

Start the dev server and walk both skins:

```bash
npm run dev
```

- Atelier: 4-wide KPI grid, bar sparkline, needs-review card, recent orders table, Catalog card.
- Darkroom: 5-wide KPI (incl. `needs_review` red when > 0), line+gradient chart with range pills, needs-review panel, recent-orders panel, top-artworks panel.
- Click `$` on the Darkroom top-artworks toggle — URL becomes `?metric=revenue`, list re-sorts.
- Hard-refresh with `?metric=revenue` in the URL — state persists via `searchParams`.
- Flip to Atelier — Darkroom-specific panels hide cleanly.

- [ ] **Step 4: Confirm clean**

```bash
git status
```

Expected: clean. 4 commits on the branch.

---

## Exit criteria

- `npm run typecheck` passes.
- `npm test` passes.
- Atelier dashboard renders unchanged in content (4-wide KPIs, bar sparkline, Catalog card).
- Darkroom dashboard renders 5-wide KPIs (incl. `needs_review` tile), line+gradient chart with 4 grid lines + final-point dot + decorative range pills, and top-artworks panel.
- Top-artworks metric toggle (`units` / `$`) survives hard-refresh via `?metric=…`.
- Both skins SSR — no client data fetch.
