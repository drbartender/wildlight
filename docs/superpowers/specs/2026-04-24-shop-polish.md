# Shop Polish — Four Small Follow-ups

**Date:** 2026-04-24
**Status:** Spec
**Scope:** Shop (public storefront). Independent of the admin
redesign ladder.

## What this is

Four small, independent items surfaced by the 2026-04-24 HANDOFF
doc's deferred list. Bundled into one spec because each is too small
to justify its own cycle and all four are shop-surface quality
improvements touching disjoint code paths.

## The four items

| # | Item                                     | Surface                                                        |
|---|------------------------------------------|----------------------------------------------------------------|
| 1 | Image dimensions backfill                | `artworks.image_width` / `image_height`; shop artwork page     |
| 2 | `/orders/[token]` status pill parity     | `app/orders/[token]/page.tsx` — extract shared StatusBadge     |
| 3 | Home "Latest" season accuracy            | `artworks.published_at` column + home query in `app/(shop)/page.tsx` |
| 4 | Mood switch mobile compact               | `components/shop/MoodSwitch.tsx` + `components/shop/Nav.tsx`   |

## Non-goals

- No layout changes to the shop beyond these four items.
- No redesign of `/orders/[token]`. Only the status pill.
- No navigation restructuring. Only the mood switch responsive
  treatment within the existing nav.
- No regeneration of web-size images. We only read dimensions from
  the existing objects.

## Current state

### Item 1 — Image dimensions

- `artworks.image_width` and `image_height` already exist in
  `lib/schema.sql` (lines 27–28). Columns are nullable.
- Artworks imported through the manifest (see `scripts/curate.html`
  generator + `app/api/bootstrap/...` cleanup) did not populate these
  columns. `<Image>` usage in `app/(shop)/artwork/[slug]/page.tsx`
  falls back to raw `<img>` (or to a default aspect) when dimensions
  are missing, which means Next.js optimization is disabled on those
  images.
- Backfill is a script, not a migration.

### Item 2 — Order status pill

- `app/orders/[token]/page.tsx` has an inline `OrderStatus` span
  component. `AdminPill` is scoped to admin (`.wl-admin-surface`) and
  can't be used on the shop.
- Target: `components/shop/StatusBadge.tsx` — shared, shop-scoped,
  reuses the paper/ink palette (not admin's colors).

### Item 3 — Home "Latest"

- Home page (`app/(shop)/page.tsx`) currently computes "Latest
  `<season>`" from `MAX(updated_at)` over published artworks. This
  updates on any metadata edit — wrong signal.
- Need a `published_at` column on `artworks`, set at the moment a
  draft becomes published. Backfill `published_at = updated_at` for
  existing rows at migration time.

### Item 4 — Mood switch mobile

- `components/shop/MoodSwitch.tsx` renders two labels (`Bone` /
  `Ink`) plus a switch glyph. On narrow screens the nav can feel
  cramped.
- Target: responsive variant below ~480px — show icon-only (sun /
  moon glyphs, or `◐` toggle), keep labels on tablet+.

## Schema

Append to `lib/schema.sql`, in the "Idempotent post-create migrations"
block. Safe to re-run.

```sql
-- Item 3: Home "Latest" season — published_at column -----------------
ALTER TABLE artworks
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- Backfill: for rows currently published, set published_at = updated_at
-- if null. Never overwrite existing values. Idempotent.
UPDATE artworks
SET published_at = updated_at
WHERE status = 'published' AND published_at IS NULL;

-- Index for the home query.
CREATE INDEX IF NOT EXISTS idx_artworks_published_at
  ON artworks(published_at DESC NULLS LAST)
  WHERE status = 'published';
```

Items 1, 2, 4 need no schema changes.

## Implementation per item

### Item 1 — Image dimensions backfill

New `scripts/backfill-image-dims.ts`. Reads every `artworks` row
where `image_width IS NULL OR image_height IS NULL`, HEADs the R2
public URL, uses `sharp` to read dimensions from the object body (or
the `probe-image-size` package for a bytes-efficient read — preferred
because it only downloads the first few KB).

```ts
import 'dotenv/config';
import probe from 'probe-image-size';
import { pool } from '../lib/db';

async function main() {
  const { rows } = await pool.query<{
    id: number; image_web_url: string;
  }>(
    `SELECT id, image_web_url
     FROM artworks
     WHERE image_width IS NULL OR image_height IS NULL`,
  );
  for (const row of rows) {
    try {
      const dims = await probe(row.image_web_url);
      await pool.query(
        `UPDATE artworks SET image_width = $1, image_height = $2 WHERE id = $3`,
        [dims.width, dims.height, row.id],
      );
      console.log(`ok  ${row.id}  ${dims.width}×${dims.height}`);
    } catch (err) {
      console.error(`err ${row.id}  ${err instanceof Error ? err.message : err}`);
    }
  }
  await pool.end();
}

main();
```

- Add `probe-image-size` to `package.json`.
- Script is idempotent (skips rows with dimensions already set).
- Package script: `"backfill:image-dims": "tsx scripts/backfill-image-dims.ts"`.
- Run manually with `DATABASE_URL` set.

Also: once backfill runs, the shop artwork page's `<Image>` call
already receives `width` / `height` from the query — no code change
needed in the page template.

### Item 2 — Shared shop StatusBadge

New `components/shop/StatusBadge.tsx`:

```tsx
import type { ReactNode } from 'react';

export type OrderStatus =
  | 'pending' | 'paid' | 'submitted' | 'fulfilled'
  | 'shipped' | 'delivered' | 'needs_review'
  | 'refunding' | 'refunded' | 'canceled';

const LABELS: Record<OrderStatus, string> = {
  pending: 'Pending', paid: 'Paid', submitted: 'Submitted',
  fulfilled: 'Fulfilled', shipped: 'Shipped', delivered: 'Delivered',
  needs_review: 'Needs review', refunding: 'Refunding',
  refunded: 'Refunded', canceled: 'Canceled',
};

export function StatusBadge({ status }: { status: OrderStatus }): ReactNode {
  return <span className={`wl-status-badge s-${status}`}>{LABELS[status]}</span>;
}
```

Shop CSS gets a `.wl-status-badge` block in `app/globals.css` with a
palette pulled from the print-room tokens. States map to neutral /
green / amber / red tiers.

`app/orders/[token]/page.tsx` imports `StatusBadge` and replaces the
inline span.

### Item 3 — Home "Latest"

- In the artwork PATCH route at
  `app/api/admin/artworks/[id]/route.ts`, when `status` transitions
  from non-`published` to `published`, set
  `published_at = NOW()` in the same UPDATE. Do not overwrite
  `published_at` on any other edit. Going back to `draft` or
  `retired` leaves `published_at` alone — it's the last-published
  timestamp, not a current state.
- In `app/(shop)/page.tsx`, change the home "Latest" computation
  from `MAX(updated_at)` to `MAX(published_at)` over published rows.
- `seasonOf()` helper stays as-is — it only needs a date.

### Item 4 — Mood switch mobile compact

- In `components/shop/MoodSwitch.tsx`, render small icon markup
  alongside the labels. Text is hidden on `max-width: 480px` via
  CSS (no JS-driven breakpoint).
- Add a `.wl-mood-switch` responsive block in `app/globals.css`.

## Testing

No automated tests added. Manual:

- Home page: latest-season label updates only when a draft is
  promoted to published.
- `/orders/[token]`: status pill renders for each status; colors
  legible in Bone + Ink moods.
- Nav at 360px (iPhone SE width): mood switch fits without wrap.
- After backfill: artwork page on an artwork that was missing
  dimensions renders with Next.js image optimization
  (inspect `<img>` for `srcset`).

## Rollout

Four commits in one PR, in the order above. Schema migration (for
item 3) goes first so item 3's UI change doesn't hit a missing
column.

## Open questions

1. **`probe-image-size` availability.** It's a maintained package
   used by lots of projects, so I'd expect stability. If we want
   to avoid a new dep, `sharp` is already present for other Printful
   paths — but `sharp` reads the entire file, and `probe-image-size`
   only streams the first few KB. Recommendation: add `probe-image-size`.
2. **`published_at` backfill time window.** Existing
   `updated_at` is the best approximation; there's no perfect answer.
   Flag in the migration comment.

## Exit criteria

- Migration idempotent; `published_at` populated on all existing
  published rows.
- `MAX(published_at)` drives home's Latest label.
- Shared `StatusBadge` component used on `/orders/[token]`.
- Mood switch remains usable at 360px without wrapping.
- `scripts/backfill-image-dims.ts` exists, runs clean, backfills
  all rows with null dimensions.
