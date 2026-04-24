# Shop Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four small shop follow-ups — image-dimensions backfill, `/orders/[token]` shared StatusBadge, `published_at` column + home "Latest" fix, mood-switch mobile compact.

**Architecture:** Four independent items. Item 3 touches the schema + admin PATCH + home page query; Items 1/2/4 touch one or two files each. Follow the existing project patterns (raw SQL via `pg`, idempotent `schema.sql`, shop CSS in `app/globals.css`).

**Tech Stack:** Next.js 16 App Router, React, TypeScript, plain CSS, `probe-image-size` (new dep), `pg`, `tsx`.

**Spec:** `docs/superpowers/specs/2026-04-24-shop-polish.md`

---

## File Structure

**Create:**
- `components/shop/StatusBadge.tsx` — shop-scoped order status badge.
- `scripts/backfill-image-dims.ts` — one-shot backfill using `probe-image-size`.

**Modify:**
- `package.json` — add `probe-image-size` + `backfill:image-dims` npm script.
- `lib/schema.sql` — add `published_at` column + backfill + index.
- `app/api/admin/artworks/[id]/route.ts` — set `published_at = NOW()` on transition to `published`.
- `app/(shop)/page.tsx` — change home "Latest" query to use `MAX(published_at)`.
- `app/orders/[token]/page.tsx` — use shared `StatusBadge`.
- `app/globals.css` — `.wl-status-badge` rules + mood-switch mobile responsive rules.
- `components/shop/MoodSwitch.tsx` — add compact-variant markup (CSS drives visibility).

**No tests.** Shop polish is manual-verification per CLAUDE.md.

---

## Task 1: Add `published_at` column + backfill

**Files:**
- Modify: `lib/schema.sql`

- [ ] **Step 1: Append to `lib/schema.sql`**

At the end of `lib/schema.sql`, inside the "Idempotent post-create migrations" block (after the final `CREATE INDEX IF NOT EXISTS`), append:

```sql

-- Home "Latest" season — published_at column (Shop-Polish) ---------
-- Added 2026-04-24.
ALTER TABLE artworks
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- Backfill: for rows currently published without a published_at,
-- seed to updated_at. Idempotent — re-running never overwrites an
-- already-populated value.
UPDATE artworks
SET published_at = updated_at
WHERE status = 'published' AND published_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_artworks_published_at
  ON artworks(published_at DESC NULLS LAST)
  WHERE status = 'published';
```

- [ ] **Step 2: Run migrate**

```bash
npm run migrate
```

Expected: `schema applied`.

- [ ] **Step 3: Sanity check**

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM artworks WHERE status='published' AND published_at IS NOT NULL;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM artworks WHERE status='published' AND published_at IS NULL;"
```

Expected: all published rows have a timestamp (second query returns `0`).

- [ ] **Step 4: Commit**

```bash
git add lib/schema.sql
git commit -m "schema: artworks.published_at column + backfill + index"
```

---

## Task 2: Set `published_at` on publish transitions

**Files:**
- Modify: `app/api/admin/artworks/[id]/route.ts`

The PATCH route currently builds UPDATE columns from the parsed body. We need a special case: when `status` is being set to `'published'` AND the artwork's current status is not `'published'`, also set `published_at = NOW()`.

- [ ] **Step 1: Add the published_at logic**

In `app/api/admin/artworks/[id]/route.ts`, find the `await withTransaction(async (client) => { … })` block (approximately line 72). Before the `const updateCols: string[] = [];` line, add:

```ts
    // If status is transitioning to 'published', stamp published_at.
    let stampPublishedAt = false;
    if (d.status === 'published') {
      const prev = await client.query<{ status: string }>(
        'SELECT status FROM artworks WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (prev.rowCount && prev.rows[0].status !== 'published') {
        stampPublishedAt = true;
      }
    }
```

Then, right after the `for (const [k, v] of …)` loop that builds `updateCols`, add:

```ts
    if (stampPublishedAt) {
      updateCols.push(`published_at = NOW()`);
    }
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Smoke**

```bash
npm run dev
```

In admin, flip a draft artwork to published via the UI. Then:

```bash
psql "$DATABASE_URL" -c "SELECT id, status, published_at FROM artworks WHERE id = <the-id>;"
```

Expected: `published_at` is freshly set to "just now". Flip it back to draft; `published_at` retains its value (we don't clear).

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/artworks/[id]/route.ts
git commit -m "api: artworks PATCH stamps published_at on transition to published"
```

---

## Task 3: Home "Latest" reads from `published_at`

**Files:**
- Modify: `app/(shop)/page.tsx`

- [ ] **Step 1: Change the query**

In `app/(shop)/page.tsx`, find the `pool.query<CountsRow>(…)` call (approximately line 25-28). Replace the SQL with:

```ts
    pool.query<CountsRow>(
      `SELECT COUNT(*)::int AS n, MAX(published_at)::text AS latest
       FROM artworks WHERE status='published'`,
    ),
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Smoke**

```bash
npm run dev
```

Visit `/`. The "Latest" season label should reflect the most recent publish event, not the most recent metadata edit. If testing locally on a seed DB with recent edits, flip a draft to published; the label bumps. Edit another field on an already-published piece; the label does NOT bump.

- [ ] **Step 4: Commit**

```bash
git add app/\(shop\)/page.tsx
git commit -m "shop: home 'Latest' reads MAX(published_at) — tracks publishes, not edits"
```

---

## Task 4: Shared `StatusBadge` for `/orders/[token]`

**Files:**
- Create: `components/shop/StatusBadge.tsx`
- Modify: `app/orders/[token]/page.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Create the component**

Write `components/shop/StatusBadge.tsx`:

```tsx
import type { ReactNode } from 'react';

export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'submitted'
  | 'fulfilled'
  | 'shipped'
  | 'delivered'
  | 'needs_review'
  | 'refunding'
  | 'refunded'
  | 'canceled'
  | 'resubmitting';

const LABELS: Record<OrderStatus, string> = {
  pending:      'Pending',
  paid:         'Paid',
  submitted:    'Submitted',
  fulfilled:    'Fulfilled',
  shipped:      'Shipped',
  delivered:    'Delivered',
  needs_review: 'Needs review',
  refunding:    'Refunding',
  refunded:     'Refunded',
  canceled:     'Canceled',
  resubmitting: 'Resubmitting',
};

export function StatusBadge({ status }: { status: string }): ReactNode {
  const label = (LABELS as Record<string, string>)[status] ?? status.replace('_', ' ');
  return (
    <span className="wl-status-badge" data-status={status}>
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Add shop CSS**

Append to `app/globals.css`:

```css
/* Shop — order status badge (used on /orders/[token]). */
.wl-status-badge {
  display: inline-block;
  margin-left: 10px;
  padding: 2px 8px;
  background: var(--paper-2, #ebe4d3);
  color: var(--ink-3, #555);
  font-family: var(--f-mono), ui-monospace, Menlo, monospace;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  border-radius: 2px;
}
.wl-status-badge[data-status='paid'],
.wl-status-badge[data-status='submitted'],
.wl-status-badge[data-status='fulfilled'] {
  background: rgba(42, 58, 42, 0.08);
  color: #2a3a2a;
}
.wl-status-badge[data-status='shipped'],
.wl-status-badge[data-status='delivered'] {
  background: rgba(42, 58, 42, 0.12);
  color: #1e2a1e;
}
.wl-status-badge[data-status='needs_review'] {
  background: rgba(160, 60, 50, 0.1);
  color: #9a3c32;
}
.wl-status-badge[data-status='refunded'],
.wl-status-badge[data-status='refunding'],
.wl-status-badge[data-status='canceled'] {
  background: #ebe4d3;
  color: #8a8474;
}
```

- [ ] **Step 3: Use the component on `/orders/[token]`**

In `app/orders/[token]/page.tsx`, delete the `function OrderStatus(…)` block (approximately lines 5-26). Replace the import block near the top to include the new component:

```tsx
import Link from 'next/link';
import { pool } from '@/lib/db';
import { formatUSD } from '@/lib/money';
import { StatusBadge } from '@/components/shop/StatusBadge';
```

Then find the `<OrderStatus status={order.status} />` usage (approximately line 117) and replace with:

```tsx
<StatusBadge status={order.status} />
```

- [ ] **Step 4: Typecheck + smoke**

```bash
npm run typecheck && npm run dev
```

Visit an existing `/orders/<token>` URL. Pill renders with skin-appropriate tint. Inspect HTML: class is `wl-status-badge`, not an inline-style span.

- [ ] **Step 5: Commit**

```bash
git add components/shop/StatusBadge.tsx app/orders/\[token\]/page.tsx app/globals.css
git commit -m "shop: shared StatusBadge component for /orders/[token]"
```

---

## Task 5: Mood switch mobile compact

**Files:**
- Modify: `components/shop/MoodSwitch.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Update the component to render both labels + icons**

The current `MoodSwitch` renders a text label + a small dot icon. We want mobile (≤480px) to hide the text. No JS change needed — just make sure the label is wrapped in a span we can hide.

In `components/shop/MoodSwitch.tsx`, find the `.wl-mood-opt` render block (approximately lines 44-55). Replace with:

```tsx
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          className={`wl-mood-opt ${mood === o.key ? 'on' : ''}`}
          aria-pressed={mood === o.key}
          aria-label={o.label}
          onClick={() => choose(o.key)}
        >
          <span className={`wl-mood-dot ${o.key}`} aria-hidden="true" />
          <span className="wl-mood-label">{o.label}</span>
        </button>
      ))}
```

The only change is wrapping the label text in a `<span className="wl-mood-label">` and adding `aria-label`.

- [ ] **Step 2: Add responsive CSS**

In `app/globals.css`, find the existing `.wl-mood-switch` rules (search for `wl-mood-switch` — add them if none exist; the class is currently styled mostly via nearby `.wl-` tokens). Add at the end of the Mood Switch section:

```css
/* Mood switch — mobile compact (icon-only under 480px). */
@media (max-width: 480px) {
  .wl-mood-switch .wl-mood-label {
    display: none;
  }
  .wl-mood-switch .wl-mood-opt {
    padding-left: 6px;
    padding-right: 6px;
  }
}
```

- [ ] **Step 3: Typecheck + smoke**

```bash
npm run typecheck && npm run dev
```

Resize browser to 360-480px width. Mood switch shrinks to icon-only; screen reader still announces Bone/Ink via `aria-label`.

- [ ] **Step 4: Commit**

```bash
git add components/shop/MoodSwitch.tsx app/globals.css
git commit -m "shop: mood switch compact variant under 480px (icon-only)"
```

---

## Task 6: `probe-image-size` dep + backfill script

**Files:**
- Modify: `package.json`
- Create: `scripts/backfill-image-dims.ts`

- [ ] **Step 1: Install the dep**

```bash
npm install probe-image-size
```

This adds an entry to `package.json` + updates `package-lock.json`.

- [ ] **Step 2: Add the npm script**

Open `package.json`. In the `"scripts"` object, add:

```json
"backfill:image-dims": "tsx scripts/backfill-image-dims.ts"
```

Keep existing scripts unchanged.

- [ ] **Step 3: Write the script**

Create `scripts/backfill-image-dims.ts`:

```ts
import 'dotenv/config';
import probe from 'probe-image-size';
import { pool } from '../lib/db';

interface Row {
  id: number;
  image_web_url: string;
}

async function main() {
  const { rows } = await pool.query<Row>(
    `SELECT id, image_web_url
     FROM artworks
     WHERE (image_width IS NULL OR image_height IS NULL)
       AND image_web_url IS NOT NULL`,
  );
  console.log(`${rows.length} artworks missing dimensions.`);

  for (const row of rows) {
    try {
      const dims = await probe(row.image_web_url);
      await pool.query(
        `UPDATE artworks SET image_width = $1, image_height = $2 WHERE id = $3`,
        [dims.width, dims.height, row.id],
      );
      console.log(`ok  ${String(row.id).padStart(4)}  ${dims.width}×${dims.height}`);
    } catch (err) {
      console.error(
        `err ${String(row.id).padStart(4)}  ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Run against dev DB**

```bash
npm run backfill:image-dims
```

Expected output: one line per artwork that was missing dimensions, either `ok id W×H` or `err id message`. Re-running the script should output `0 artworks missing dimensions.`

- [ ] **Step 6: Verify**

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM artworks WHERE status='published' AND (image_width IS NULL OR image_height IS NULL);"
```

Expected: `0`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json scripts/backfill-image-dims.ts
git commit -m "scripts: backfill image_width/image_height via probe-image-size"
```

---

## Task 7: Manual smoke verification + typecheck

**Files:** none.

- [ ] **Step 1: Typecheck + tests**

```bash
npm run typecheck && npm test
```

Expected: no errors, all tests pass.

- [ ] **Step 2: Walk the shop**

```bash
npm run dev
```

- Home `/`: "Latest <Season>" label tracks the most recent publish, not the most recent metadata edit.
- Artwork page: renders with `<Image>` at correct dimensions (no CLS; inspect for `srcset`).
- `/orders/<token>`: status pill uses `.wl-status-badge` classes (check in devtools).
- Nav at 360-420px width: mood switch is icon-only; `aria-label` gives the name to a screen reader.

- [ ] **Step 3: Confirm clean**

```bash
git status
```

Expected: clean. 6 commits.

---

## Exit criteria

- `npm run typecheck` passes.
- `npm test` passes.
- `published_at` column exists; `MAX(published_at)` drives the home Latest label; the PATCH route stamps it only on transition to `published`.
- `/orders/<token>` uses the shared `StatusBadge` component.
- Nav mood switch is usable at 360px without wrapping.
- `scripts/backfill-image-dims.ts` runs cleanly and leaves no published row with null dimensions.
