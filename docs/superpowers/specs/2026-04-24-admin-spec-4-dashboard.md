# Admin Redesign — Sub-project 4: Dashboard

**Date:** 2026-04-24
**Status:** Spec
**Parent:** `2026-04-24-admin-redesign-overview.md`

## Design invariant

Atelier and Darkroom are independent visual languages over the same
data. The two dashboards look intentionally different — Atelier is an
editorial one-page with bar sparkline and catalog stats; Darkroom is a
mono instrument panel with a 5-wide KPI strip (including
`needs_review`), a line+gradient chart, and a top-artworks list.
"Parity" means each skin matches its own mockup target.

## Target mockup

- `atelier.jsx:193–301` — `ADashboard`. 4-wide KPI strip
  (`Revenue · 30d`, `Orders · 30d`, `Avg. order`, `Subscribers`).
  Bar sparkline `<rect>`s, most recent bar in `A.green`, rest in
  `A.greenSoft`. Needs-review card with red badge + single-line rows.
  Recent-orders table. Catalog card with Published / Draft / Retired
  / Missing-print-file counts + "Go to catalog →" button.
- `darkroom.jsx:162–291` — `DDashboard`. 5-wide KPI strip
  (`revenue_30d`, `orders_30d`, `aov`, `subscribers`, `needs_review`).
  Line chart with gradient fill, 7d/30d/90d/12m range pills (only
  30d highlighted; others decorative). Needs-review panel
  (`needs_review [N]` red header + list). Recent-orders panel
  (mono). Top-artworks panel (`top_artworks · 30d` header + 5 rows:
  thumbnail + title + collection + units sold).
- Open `Wildlight Admin.html` locally for side-by-side view.

## Scope

1. Each skin renders its own dashboard shape. No convergence.
2. **New data**: top-artworks aggregation over last 30 days.
   User-selectable metric: units or dollars — one server prop
   `topArtworksMetric: 'units' | 'revenue'` controlled by a small
   toggle on the Darkroom dashboard; Atelier hides the toggle but
   still honours the computed prop if we decide to surface top
   artworks on the Atelier Catalog card in a future pass (not
   required here).
3. **Dashboard stays fully SSR.** No client-fetched dashboard data
   beyond the existing `needsReview` count used by the sidebar badge.
4. **KPI parity — per skin**: Atelier shows its 4 tiles as today,
   Darkroom adds the `needs_review` tile and re-lays to 5-wide.
5. **Chart treatment**: Atelier keeps bars, Darkroom gains the line
   chart + gradient fill + 4 grid dashes + final-point dot.

## Non-goals

- No schema changes.
- No per-hour / per-week charts. 30-day daily buckets are the
  horizon.
- No interactive range pills on Darkroom (`7d`/`90d`/`12m`). They
  render as decorative muted labels this pass; wiring is a
  follow-up.
- No live update on the dashboard. Page-load freshness only.
- No Atelier top-artworks panel. Mockup has catalog stats instead;
  keep it.

## Current state

- `app/admin/page.tsx` — SSR dashboard. Renders a KPI strip, a bar
  sparkline, a needs-review card, a recent-orders table, and a
  catalog card. One DOM shape today; both skins share it.
- Data: revenue sum + count over last 30d from `orders` where status
  ∈ paid lineage; 30-day daily buckets zero-filled; catalog Published
  / Draft / Retired counts; dedicated "Missing print file" count;
  `needsReview` count passed to sidebar.
- Needs:
  - 5th KPI tile in Darkroom only.
  - Line chart treatment in Darkroom only.
  - Top-artworks panel in Darkroom only, with unit/revenue toggle.
  - Recent-orders table per skin (table row shape differs).

## Data

Existing queries remain. Add one aggregation:

```sql
-- Top artworks last 30 days.
-- Returns id, slug, title, image_web_url, collection_title,
-- units_sold, revenue_cents.
SELECT
  a.id, a.slug, a.title, a.image_web_url,
  c.title AS collection_title,
  COALESCE(SUM(oi.quantity), 0)                           AS units_sold,
  COALESCE(SUM(oi.quantity * oi.price_cents_snapshot), 0) AS revenue_cents
FROM order_items oi
JOIN orders   o ON o.id = oi.order_id
JOIN artworks a ON a.id = (oi.artwork_snapshot->>'id')::int
LEFT JOIN collections c ON c.id = a.collection_id
WHERE o.created_at >= NOW() - INTERVAL '30 days'
  AND o.status IN ('paid', 'submitted', 'fulfilled', 'shipped', 'delivered')
GROUP BY a.id, c.title
ORDER BY
  CASE WHEN $1 = 'revenue' THEN SUM(oi.quantity * oi.price_cents_snapshot)
       ELSE SUM(oi.quantity)
  END DESC NULLS LAST
LIMIT 5;
```

Notes:

- `oi.artwork_snapshot->>'id'` is how the artwork link back to the
  catalog survives even if an artwork is later deleted. Coalesce
  to make re-renaming safe; the `JOIN artworks a` drops rows whose
  snapshot id no longer exists, which is correct — we only list
  currently-known artworks.
- `$1` is the metric param. Default `units`.
- If the query returns < 5 rows (small catalog), render whatever
  comes back; show an empty-state hint ("Not enough sales yet") if
  zero.

## Metric toggle

Darkroom dashboard only. Simple two-button pill group in the
top-artworks header: `units` / `$`. Stored client-side via
`localStorage.wl_admin_top_metric` to survive navigation. On change,
the client re-fetches the dashboard — the cheapest way to keep
everything SSR is a `router.push('?metric=revenue')` pattern +
reading `searchParams.metric` in the server component. No client
state, no fetch API, no request-splitting.

```tsx
// app/admin/page.tsx (signature excerpt)
export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ metric?: 'units' | 'revenue' }>;
}) {
  const { metric: raw } = await searchParams;
  const topMetric = raw === 'revenue' ? 'revenue' : 'units';
  // ... query with $1 = topMetric
}
```

## Layout per skin

### Atelier (`ADashboard`)

- `padding: 28`, vertical 24px gap.
- **KPI strip**: 4 tiles, 1px-ruled cells inside a single rounded
  card (`gap: 1, background: rule, border rule, radius 8`). Each
  tile:
  - Uppercase-mono label (`letterSpacing: .18em, muted`).
  - Serif 30px value.
  - Diff line — `green` if up, `red` if down.
- **Row 1**: 1.4fr / 1fr.
  - Left: Revenue card with serif "Revenue · last 30 days" + "daily
    · USD" muted, bar sparkline (`<rect>` per day, last bar green,
    rest green-soft), axis labels in mono muted.
  - Right: Needs review card. Red pill badge with count. Rows are
    small button-like links with `#id`, reason text, total.
- **Row 2**: 1.4fr / 1fr.
  - Left: Recent orders card with serif "Recent orders" + "View all
    →" muted link. Table rows: mono `#id` (60px), muted date (120px),
    customer name, mono total, right-aligned `AdminPill`.
  - Right: Catalog card with serif "Catalog" header + 2×2 grid of
    stats (Published / Draft / Retired / Missing print file). Each
    stat has a rule-top 1px, uppercase-mono label, serif 24px value;
    Missing print file goes red when > 0. Footer "Go to catalog →"
    button in `paperAlt`.

### Darkroom (`DDashboard`)

- `padding: 16`, vertical 12px gap.
- **KPI strip**: 5 separate panels, 4px radius, 1px rule border,
  12px gap (not ruled-together like Atelier's single card). Each
  panel:
  - Mono `lowercase_label` muted.
  - Mono 22px value (red if tile is `needs_review`).
  - Mono 10px diff line with `▲` teal / `▼` amber / — muted glyph;
    `needs_review` shows `action` in red.
- **Row 1**: 1.3fr / 1fr.
  - Left: Revenue panel. Header `revenue · 30d · usd` mono ink +
    decorative range pills (`7d`/`30d`/`90d`/`12m`, only 30d is
    highlighted). SVG chart:
    - 4 dashed horizontal grid lines.
    - Line path in teal, `strokeWidth 1.5`.
    - Gradient-fill area path using a `linearGradient` from teal
      30% opacity to 0%.
    - Circles per point (r=1.5), final point r=3 solid teal.
  - Right: Needs review panel. Header `needs_review [N]` in red.
    Rows: `#id` teal + total ink + time muted; below, reason in red.
- **Row 2**: 1.3fr / 1fr.
  - Left: Recent orders panel. Mono header `recent_orders` + view-all
    link. Mono table with columns: `#id` teal, date, customer ink2,
    total ink (right), `AdminPill` (right).
  - Right: Top-artworks panel. Header `top_artworks · 30d` + metric
    toggle (`units` / `$`). 5 rows: 28×28 thumbnail, title (ink,
    truncated), collection (muted, lowercase), right-aligned count
    + `sold` suffix (when `units`) or `formatUSD` (when `revenue`).

## Testing

- Manual end-to-end after deploy:
  - Verify KPI counts match `SELECT count(*)` and sum queries.
  - Toggle Darkroom metric between `units` and `$`; confirm ordering
    changes.
  - Empty-state: if no orders in last 30d, expect zero rows and a
    "Not enough sales yet" hint.
- Unit tests: none added here — existing `tests/lib/` covers money
  and date helpers that the dashboard uses.

## Rollout

Single PR. No schema migration. Deploy and refresh `/admin` in both
skins.

## Open questions

None. The `ADashboard`-vs-`DDashboard` disparity is specification,
not a gap.

## Exit criteria

- Atelier dashboard unchanged from current structure plus a small
  polish pass against `ADashboard`.
- Darkroom dashboard renders 5-wide KPI strip, line+gradient chart,
  top-artworks panel with working metric toggle.
- Both skins render only from SSR data; no client data fetches
  added.
- Darkroom `?metric=revenue` URL survives hard-refresh.
