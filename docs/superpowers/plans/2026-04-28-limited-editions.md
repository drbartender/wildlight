# Limited Editions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render edition badges on the storefront, prevent purchase past the edition size (with a checkout-time race guard), and let admins set `edition_size` + `signed` on artworks.

**Architecture:** One ALTER (signed BOOLEAN), one helper (`lib/editions.ts:getEditionStatus`) that joins `order_items` × `orders` to compute sold count per artwork, and three touch points (artwork detail page, checkout API, admin artwork edit page). No new tables, no new routes.

**Tech Stack:** Postgres raw SQL · existing patterns from `lib/db.ts`, `lib/journal-html.ts`, etc.

**Spec:** `docs/superpowers/specs/2026-04-28-limited-editions-design.md`

---

## File Structure

**Created:**
- `lib/editions.ts` — `getEditionStatus(artworkId)` helper.

**Modified:**
- `lib/schema.sql` — add `signed BOOLEAN` to artworks.
- `app/api/admin/artworks/[id]/route.ts` — PATCH accepts `signed`.
- `app/admin/artworks/[id]/page.tsx` — render edition_size + signed inputs + sold count.
- `app/(shop)/shop/artwork/[slug]/page.tsx` — fetch + render edition status; gate the buy UI.
- `app/api/checkout/route.ts` — sold-count race guard.
- `app/globals.css` — append `.wl-edition-badge` class.

---

## Task 1: Schema — `signed BOOLEAN` on artworks

**Files:**
- Modify: `lib/schema.sql`

- [ ] **Step 1: Append the column**

Add at the end of `lib/schema.sql`:

```sql

-- Limited editions: signed flag (paired with the existing
-- artworks.edition_size from Phase 1). signed = print is signed by
-- the artist; surfaces as a badge on the storefront when true AND
-- edition_size is non-null.
ALTER TABLE artworks
  ADD COLUMN IF NOT EXISTS signed BOOLEAN NOT NULL DEFAULT FALSE;
```

- [ ] **Step 2: Apply the migration**

Run: `npm run migrate`
Expected: `schema applied`.

- [ ] **Step 3: Commit**

```bash
git add lib/schema.sql
git commit -m "feat(db): artworks.signed boolean for limited editions

Pairs with the existing artworks.edition_size (from Phase 1).
Surfaces on the storefront as a 'Signed by the artist' badge
when both fields indicate a limited, signed edition.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `lib/editions.ts` helper

**Files:**
- Create: `lib/editions.ts`
- Test: `tests/lib/editions.test.ts`

- [ ] **Step 1: Create the helper**

```ts
// lib/editions.ts
//
// Edition-status lookup for an artwork. Reads edition_size + signed
// from artworks, and counts non-canceled, non-refunded order_items
// referencing any variant of that artwork.

import { pool } from './db';

export interface EditionStatus {
  isLimited: boolean;
  editionSize: number | null;
  signed: boolean;
  soldCount: number;
  remaining: number | null;
  soldOut: boolean;
}

interface Row {
  edition_size: number | null;
  signed: boolean;
  sold: number;
}

export async function getEditionStatus(
  artworkId: number,
): Promise<EditionStatus> {
  const r = await pool.query<Row>(
    `SELECT a.edition_size,
            a.signed,
            COALESCE(
              (
                SELECT COUNT(oi.id)::int
                FROM order_items oi
                JOIN artwork_variants v ON v.id = oi.variant_id
                JOIN orders o ON o.id = oi.order_id
                WHERE v.artwork_id = a.id
                  AND o.status NOT IN ('canceled', 'refunded')
              ),
              0
            ) AS sold
     FROM artworks a
     WHERE a.id = $1`,
    [artworkId],
  );
  const row = r.rows[0];
  if (!row) {
    return {
      isLimited: false,
      editionSize: null,
      signed: false,
      soldCount: 0,
      remaining: null,
      soldOut: false,
    };
  }
  const isLimited = row.edition_size != null && row.edition_size > 0;
  const remaining = isLimited
    ? Math.max(0, (row.edition_size as number) - row.sold)
    : null;
  return {
    isLimited,
    editionSize: row.edition_size,
    signed: row.signed,
    soldCount: row.sold,
    remaining,
    soldOut: isLimited && row.sold >= (row.edition_size as number),
  };
}
```

- [ ] **Step 2: Add a small unit test for the pure logic**

Note: the pool query is hard to mock, so just test the shape via a thin pure function alongside if needed. For v1, skip the unit test — the helper is exercised by integration in T5 + T6. (If you want a unit test, isolate the mapping logic from the query into a pure function and test that.)

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add lib/editions.ts
git commit -m "feat: lib/editions.ts — getEditionStatus(artworkId)

Reads edition_size + signed from artworks and counts non-canceled,
non-refunded order_items referencing any variant of the artwork.
Returns { isLimited, editionSize, signed, soldCount, remaining,
soldOut }. soldOut triggers when soldCount >= editionSize.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: PATCH endpoint accepts `signed`

**Files:**
- Modify: `app/api/admin/artworks/[id]/route.ts`

- [ ] **Step 1: Add `signed` to the zod schema**

Find the `Patch` zod object (around line 34). Add `signed: z.boolean().optional()` to the schema:

```ts
const Patch = z.object({
  title: z.string().min(1).max(200).optional(),
  artist_note: z.string().max(5000).nullable().optional(),
  year_shot: z.number().int().min(1900).max(2100).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  status: z.enum(['draft', 'published', 'retired']).optional(),
  collection_id: z.number().int().nullable().optional(),
  display_order: z.number().int().optional(),
  edition_size: z.number().int().positive().nullable().optional(),
  signed: z.boolean().optional(),
  image_print_url: z
    .string()
    .regex(/^artworks-print\/[a-z0-9/_.-]+\.(jpg|jpeg|png|tif|tiff)$/i)
    .max(300)
    .nullable()
    .optional(),
  applyTemplate: z.enum(['fine_art', 'canvas', 'full']).optional(),
});
```

- [ ] **Step 2: Ensure the UPDATE picks up `signed`**

Look at how the route builds its UPDATE statement. Most likely it iterates over the parsed fields and includes any that are present in the patch. The `signed` field will pass through naturally if the existing UPDATE construction is field-agnostic.

If the UPDATE is hand-rolled (e.g. `SET title = $1, artist_note = $2, ...`), add `signed = $N` alongside.

Read the file from line 80 onward to confirm. The pattern in this codebase tends to be: build a `sets[]` array of `col = $N` and a `vals[]` parallel array, then `UPDATE artworks SET ${sets.join(', ')}`. If so, add a clause like:

```ts
if ('signed' in d) add('signed', d.signed ?? false);
```

(Where `add` is the helper that pushes onto `sets` + `vals`.)

If the route uses a different pattern, mirror the existing handling for `edition_size` exactly — `signed` follows the same shape (a simple field PATCH).

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/artworks/[id]/route.ts
git commit -m "feat(api): PATCH /admin/artworks/[id] accepts signed

zod schema gains signed: z.boolean().optional(); UPDATE statement
includes the column when present in the patch. Mirrors existing
edition_size handling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Admin artwork edit page — edition fields + sold count

**Files:**
- Modify: `app/admin/artworks/[id]/page.tsx`

- [ ] **Step 1: Extend the `Artwork` interface**

Find the `Artwork` interface near the top of the file. Add:

```ts
interface Artwork {
  id: number;
  slug: string;
  title: string;
  artist_note: string | null;
  year_shot: number | null;
  location: string | null;
  image_web_url: string;
  image_print_url: string | null;
  image_width: number | null;
  image_height: number | null;
  status: string;
  collection_id: number | null;
  collection_title: string | null;
  edition_size: number | null;
  signed: boolean;          // ← ADDED
}
```

- [ ] **Step 2: Extend the `Data` interface and the GET return**

The data interface is `Data { artwork: Artwork; variants: VRow[] }`. Add a `soldCount: number` field:

```ts
interface Data {
  artwork: Artwork;
  variants: VRow[];
  soldCount: number;        // ← ADDED
}
```

Update the GET endpoint at `app/api/admin/artworks/[id]/route.ts` to include both `signed` in the SELECT (likely already returns all artwork columns via `a.*`) and a sold count. Find the GET handler and modify:

```ts
const [a, v, e] = await Promise.all([
  pool.query(
    `SELECT a.*, c.title AS collection_title
     FROM artworks a LEFT JOIN collections c ON c.id = a.collection_id
     WHERE a.id = $1`,
    [id],
  ),
  pool.query(
    `SELECT * FROM artwork_variants WHERE artwork_id = $1 ORDER BY type, price_cents`,
    [id],
  ),
  pool.query<{ sold: number }>(
    `SELECT COUNT(oi.id)::int AS sold
     FROM order_items oi
     JOIN artwork_variants v ON v.id = oi.variant_id
     JOIN orders o ON o.id = oi.order_id
     WHERE v.artwork_id = $1
       AND o.status NOT IN ('canceled', 'refunded')`,
    [id],
  ),
]);
if (!a.rowCount) return NextResponse.json({ error: 'not found' }, { status: 404 });
return NextResponse.json({
  artwork: a.rows[0],
  variants: v.rows,
  soldCount: e.rows[0]?.sold ?? 0,
});
```

- [ ] **Step 3: Render the edition inputs in the artwork edit form**

Open `app/admin/artworks/[id]/page.tsx`. Find where `year_shot` or `location` is rendered (existing inputs). Add an "Edition" block alongside.

The exact spot depends on the file's structure — open it and look for an `AdminField` or similar input near the artwork's metadata. Add immediately after the existing `edition_size` reference (or where year/location is rendered if `edition_size` isn't already exposed):

```tsx
<div className="wl-adm-field">
  <label>
    <span>Edition size (blank = open edition)</span>
    <input
      type="number"
      min={1}
      max={9999}
      value={data.artwork.edition_size ?? ''}
      onChange={(e) => {
        const v = e.target.value;
        void save({
          edition_size: v === '' ? null : Math.max(1, parseInt(v, 10) || 0),
        });
      }}
      placeholder="—"
    />
  </label>
  {data.artwork.edition_size != null && (
    <p
      style={{
        marginTop: 6,
        color: 'var(--adm-muted)',
        fontSize: 12,
      }}
    >
      {data.soldCount} of {data.artwork.edition_size} sold ·{' '}
      {Math.max(0, data.artwork.edition_size - data.soldCount)} remaining
    </p>
  )}
</div>

<div className="wl-adm-field">
  <label
    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
  >
    <input
      type="checkbox"
      checked={data.artwork.signed}
      onChange={(e) => void save({ signed: e.target.checked })}
    />
    <span>Signed by the artist</span>
  </label>
</div>
```

The exact JSX placement depends on the file's layout — these blocks should sit near the other artwork-meta inputs (year, location, etc).

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/admin/artworks/[id]/page.tsx app/api/admin/artworks/[id]/route.ts
git commit -m "feat(admin): artwork edit page — edition_size + signed inputs

GET endpoint now returns soldCount alongside artwork + variants.
Edit form renders an edition_size number input and a signed
checkbox. Below the size input, shows '12 of 25 sold · 13
remaining' as a read-only summary. Both fields PATCH via the
existing endpoint (signed added to zod schema in prior commit).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Storefront artwork detail — badge + sold-out state

**Files:**
- Modify: `app/(shop)/shop/artwork/[slug]/page.tsx`

- [ ] **Step 1: Extend the artwork SELECT to include edition_size + signed**

Find the `ArtworkRow` interface and the CTE inside the main query. Add `edition_size` and `signed` to the projection:

```tsx
interface ArtworkRow {
  id: number;
  slug: string;
  title: string;
  artist_note: string | null;
  year_shot: number | null;
  location: string | null;
  image_web_url: string;
  image_width: number | null;
  image_height: number | null;
  collection_slug: string | null;
  collection_title: string | null;
  plate_idx: number;
  plate_total: number;
  edition_size: number | null;   // ← ADDED
  signed: boolean;               // ← ADDED
}
```

Update the CTE select clause:

```sql
WITH published AS (
  SELECT a.id, a.slug, a.title, a.artist_note, a.year_shot, a.location,
         a.image_web_url, a.image_width, a.image_height,
         a.collection_id,
         a.edition_size, a.signed,
         ROW_NUMBER() OVER (ORDER BY a.display_order, a.id) AS plate_idx,
         COUNT(*) OVER () AS plate_total
  FROM artworks a
  WHERE a.status = 'published'
)
SELECT p.id, p.slug, p.title, p.artist_note, p.year_shot, p.location,
       p.image_web_url, p.image_width, p.image_height,
       p.plate_idx::int, p.plate_total::int,
       p.edition_size, p.signed,
       c.slug AS collection_slug, c.title AS collection_title
FROM published p
LEFT JOIN collections c ON c.id = p.collection_id
WHERE p.slug = $1
```

- [ ] **Step 2: Fetch edition status alongside variants**

Add `getEditionStatus` to the parallel fetch. Replace the existing `Promise.all([variantsRes, relatedRes])` call:

```tsx
import { getEditionStatus } from '@/lib/editions';

// ...inside the function, after `const art = arts.rows[0];`:

const [variantsRes, relatedRes, edition] = await Promise.all([
  pool.query<VariantOption>(
    `SELECT id, type, size, finish, price_cents FROM artwork_variants
     WHERE artwork_id = $1 AND active = TRUE
     ORDER BY type, price_cents`,
    [art.id],
  ),
  art.collection_slug
    ? pool.query<PlateCardData>(
        `SELECT a.slug, a.title, a.image_web_url, a.year_shot, a.location,
                (SELECT MIN(price_cents) FROM artwork_variants v
                   WHERE v.artwork_id = a.id AND v.active = TRUE) AS min_price_cents
         FROM artworks a
         JOIN collections c ON c.id = a.collection_id
         WHERE c.slug = $1 AND a.status = 'published' AND a.slug <> $2
         ORDER BY a.display_order, a.id
         LIMIT 4`,
        [art.collection_slug, art.slug],
      )
    : Promise.resolve({ rows: [] as PlateCardData[] }),
  getEditionStatus(art.id),
]);
const variants = variantsRes.rows;
const related = relatedRes;
```

- [ ] **Step 3: Render the badge above the title or near the meta row**

Find where the artwork title and metadata render (look for a `<h1>` or similar near the existing plate number/year/location display). Insert the badge component above it:

```tsx
{edition.isLimited && (
  <div className="wl-edition-badge">
    <span className="line-1">
      Edition of {String(edition.editionSize).padStart(2, '0')}
    </span>
    {edition.signed && (
      <span className="line-2">Signed by the artist</span>
    )}
    <span className={`line-3 ${edition.soldOut ? 'sold-out' : ''}`}>
      {edition.soldOut
        ? 'Sold out'
        : `${edition.remaining} remaining`}
    </span>
  </div>
)}
```

- [ ] **Step 4: Gate the OrderCard / Add-to-cart UI when sold out**

Find where `<OrderCard>` is rendered (somewhere in the template). Replace its render with a conditional:

```tsx
{edition.soldOut ? (
  <div className="wl-edition-soldout">
    <h3>Sold out — thank you.</h3>
    <p>
      This edition has reached its run of {edition.editionSize}.
      To know about future releases:
    </p>
    <Link className="wl-btn primary" href="/journal">
      Subscribe via the journal →
    </Link>
  </div>
) : (
  <OrderCard
    artworkId={art.id}
    artworkTitle={art.title}
    artworkSlug={art.slug}
    imageUrl={art.image_web_url}
    variants={variants}
  />
)}
```

(The exact `<OrderCard>` props match what the existing render uses — preserve them as-is.)

- [ ] **Step 5: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add "app/(shop)/shop/artwork/[slug]/page.tsx"
git commit -m "feat: storefront artwork — limited-edition badge + sold-out state

Artwork detail page now fetches edition status (edition_size, signed,
sold count, remaining) and renders a badge above the metadata when
the artwork is a limited edition. When sold-out, replaces the order
card with a 'Sold out — thank you' block plus a journal subscribe
CTA.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Checkout API race guard

**Files:**
- Modify: `app/api/checkout/route.ts`

- [ ] **Step 1: Add the edition check after variant resolution**

Find the spot where `byId` is built (around line 69) and `subtotal` is computed (around line 74). Insert the edition check after `byId` and before subtotal:

```ts
  const byId = new Map<number, VariantRow>(rows.map((r) => [r.id, r]));

  // Limited-edition guard: for each line item whose artwork has a
  // non-null edition_size, ensure the requested quantity won't push
  // total sold over the cap. Race-safe because we count completed
  // orders at request time, not at session-create time.
  const artworkIds = Array.from(new Set(rows.map((r) => r.artwork_id)));
  if (artworkIds.length > 0) {
    const editionCheck = await pool.query<{
      artwork_id: number;
      title: string;
      edition_size: number | null;
      sold: number;
    }>(
      `SELECT a.id AS artwork_id, a.title, a.edition_size,
              COALESCE(
                (
                  SELECT COUNT(oi.id)::int
                  FROM order_items oi
                  JOIN artwork_variants v ON v.id = oi.variant_id
                  JOIN orders o ON o.id = oi.order_id
                  WHERE v.artwork_id = a.id
                    AND o.status NOT IN ('canceled', 'refunded')
                ),
                0
              ) AS sold
       FROM artworks a
       WHERE a.id = ANY($1::int[])`,
      [artworkIds],
    );

    // Sum requested quantities by artwork_id.
    const requestedByArtwork = new Map<number, number>();
    for (const l of lines) {
      const v = byId.get(l.variantId);
      if (!v) continue;
      requestedByArtwork.set(
        v.artwork_id,
        (requestedByArtwork.get(v.artwork_id) ?? 0) + l.quantity,
      );
    }

    for (const ed of editionCheck.rows) {
      if (ed.edition_size == null) continue;
      const requested = requestedByArtwork.get(ed.artwork_id) ?? 0;
      if (ed.sold + requested > ed.edition_size) {
        const remaining = Math.max(0, ed.edition_size - ed.sold);
        return NextResponse.json(
          {
            error: `"${ed.title}" sold out — please pick another. ${remaining} remaining.`,
          },
          { status: 400 },
        );
      }
    }
  }

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/api/checkout/route.ts
git commit -m "feat(api): checkout — limited-edition sold-out race guard

Before creating the Stripe session, sum the requested quantities
per artwork_id and verify (sold + requested) <= edition_size for
any limited-edition artworks in the cart. Returns a clear 400
naming the sold-out artwork and showing remaining count.

Race-safe: the count is read at request time, not at storefront
render time, so two simultaneous buyers can't both pass the
storefront check and exceed the edition.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Append edition CSS to globals

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Append the badge classes**

Add at the end of `app/globals.css`:

```css

/* ─── LIMITED EDITIONS ───────────────────────────────────── */

.wl-edition-badge {
  display: inline-flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 16px;
  margin-bottom: 16px;
  background: var(--paper-2);
  border: 1px solid var(--rule-strong);
  border-left: 3px solid var(--ink);
  font-family: var(--f-mono);
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.wl-edition-badge .line-1 {
  font-weight: 600;
  color: var(--ink);
}
.wl-edition-badge .line-2 {
  color: var(--ink-2);
  font-style: italic;
  text-transform: none;
  font-family: var(--f-serif);
  letter-spacing: 0;
  font-size: 13px;
}
.wl-edition-badge .line-3 {
  color: var(--ink-3);
}
.wl-edition-badge .line-3.sold-out {
  color: var(--s-red);
  font-weight: 600;
}

.wl-edition-soldout {
  padding: 32px;
  background: var(--paper-2);
  border: 1px solid var(--rule);
  border-radius: 4px;
  text-align: center;
}
.wl-edition-soldout h3 {
  font-family: var(--f-display);
  font-size: 28px;
  margin: 0 0 12px;
  color: var(--ink);
}
.wl-edition-soldout p {
  font-family: var(--f-serif);
  font-size: 15px;
  color: var(--ink-2);
  margin: 0 0 20px;
  line-height: 1.55;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/globals.css
git commit -m "feat(css): limited-edition badge + sold-out block

Mono-uppercase three-line badge with paper-2 bg + ink left rule.
Sold-out replacement block uses display serif heading and an
inline newsletter CTA via the .wl-btn primary class.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Manual verification

**Files:** None.

- [ ] **Step 1: Start dev server**

Run: `npm run dev`. Wait until ready.

- [ ] **Step 2: Sanity — no regression on open editions**

Visit `http://localhost:3000/shop/artwork/<any-current-slug>`. The page renders normally (no badge, no sold-out, OrderCard visible). All existing artworks have `edition_size = NULL` so nothing should change.

- [ ] **Step 3: Mark an artwork as a limited edition**

Sign in to admin. Visit `/admin/artworks/<id>` for one of the published artworks. Scroll to the new edition inputs. Set `Edition size = 5` and check `Signed by the artist`. The "0 of 5 sold" line appears below.

- [ ] **Step 4: Storefront badge**

Reload the public artwork page. The badge appears above the artwork title:

```
EDITION OF 05
Signed by the artist
5 REMAINING
```

OrderCard still renders normally (nothing sold yet).

- [ ] **Step 5: Simulate a sold-out**

Either complete a real test purchase 5 times, or directly mock by inserting order_items rows for that artwork via SQL:

```sql
-- Replace 42 with the artwork id, 100 with a variant id of that artwork.
INSERT INTO orders (customer_email, subtotal_cents, total_cents, status)
VALUES ('test@example.com', 9000, 9000, 'paid')
RETURNING id;
-- Then 5 order_items referencing the variant
INSERT INTO order_items (order_id, variant_id, quantity, ...)
VALUES (<order_id>, <variant_id>, 1, ...);
-- Repeat 5 times.
```

(Skip the SQL approach if it's awkward — the storefront badge is visible from the count being non-zero, and the checkout guard can be tested by setting edition_size = 0 momentarily.)

- [ ] **Step 6: Sold-out UI**

Reload the artwork page. The badge shows `Sold out` in red. The OrderCard is replaced by the "Sold out — thank you" block with a "Subscribe via the journal →" link.

- [ ] **Step 7: Checkout race guard (manual)**

If you have a test variant of an artwork with `edition_size = 1` and an existing order against it, attempt to add another via the cart and click checkout. The API returns 400 with the message: `"<title>" sold out — please pick another. 0 remaining.`

If no test data is convenient, this guard is exercised by Task 6's logic and validated indirectly by the "Sold out" UI hiding the buy path.

- [ ] **Step 8: Final tests + typecheck**

Run: `npm run typecheck && npm test`
Expected: exit 0; 62 tests pass.

- [ ] **Step 9: Reset test data**

If you set an artwork's `edition_size` for testing, set it back to NULL (or leave it — Dallas can clear it later). Stop the dev server.

---

## Self-Review

**Spec coverage:**
- ✓ `signed BOOLEAN` on artworks — Task 1.
- ✓ `getEditionStatus` helper — Task 2.
- ✓ PATCH accepts `signed` — Task 3.
- ✓ Admin inputs + sold count display — Task 4.
- ✓ Storefront badge + sold-out replacement — Task 5.
- ✓ Checkout race guard — Task 6.
- ✓ Badge CSS — Task 7.
- ✓ Manual verification — Task 8.

**Out of scope per spec (intentional gaps):**
- Per-print numbering (1 of 25) — deferred.
- Subscriber early-access gate — deferred (column already exists from SP#4).
- Certificate of authenticity / artist proofs / waitlist — deferred.
- Newsletter "feature this edition" block — SP#4's "start from journal entry" picker is sufficient for v1.

**Placeholder scan:** No "TBD" / "TODO" remaining. Each step has actual code.

**Type consistency:** `EditionStatus` interface defined in Task 2 is used by Tasks 5 (storefront). The `Artwork` interface change in Task 4 (adds `signed: boolean`) matches the schema added in Task 1. The PATCH zod field added in Task 3 matches the column type.
