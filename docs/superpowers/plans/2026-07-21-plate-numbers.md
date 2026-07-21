# Plate Numbers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `WL–NNNN` from a hash of the artwork slug into a stored, permanent accession number on every artwork, without changing how it looks.

**Architecture:** A Postgres sequence feeds a scattered-but-collision-free permutation into a new `artworks.plate_no` column, assigned once by a column default and never rewritten. `lib/plate-number.ts` stops deriving and becomes a pure formatter. Every display surface reads the stored value.

**Tech Stack:** Next.js 16 App Router, Postgres (Neon, PG17) via raw `pg`, vitest.

**Spec:** `docs/superpowers/specs/2026-07-21-plate-numbers-design.md`

## Global Constraints

- **No ORM.** Raw SQL via `lib/db.ts`, parameterized always.
- **`lib/schema.sql` re-runs on every build** (`npm run build` is `tsx lib/migrate.ts && next build`). Every statement must be idempotent.
- **Nothing a `'use client'` component imports may reach `lib/db.ts`**. `lib/db.ts:33` calls `createPool()` at module scope, and this fails only at `next build`. `lib/plate-number.ts` must stay import-free.
- **Format is fixed:** `WL–NNNN`, range `WL–0100` to `WL–9099`, en-dash separator (`–`, U+2013), zero-padded to 4.
- **Gates: `npm run typecheck`, `npm test`, `npm run build`.** NOT `npm run lint` (dead under Next 16 here).
- **Copy rule: no em dashes** in user-facing strings.

## The one thing that makes this different from the ordering build

**This is one-way.** Once `plate_no` is displayed, every piece has a new public number. Reverting the code restores `plateNumber(slug)` and flips every number a *second* time. A rollback is a decision to renumber again, not a neutral undo.

## Push grouping

**Push 1 = Task 1 only.** The migration is additive and nothing reads the column, so it is invisible: zero rendered change. Ship it alone, confirm it landed, then continue. This deliberately isolates the irreversible schema step from the irreversible *visible* step.

**Push 2 = Tasks 2 through 9.** The display swap. Every number changes at once, which is the intended behaviour: a half-swapped state would show one number on the grid tile and a different one in the cart for the same piece.

Within push 2, Task 2 **adds** `formatPlate` while keeping `plateNumber`, so every intermediate commit typechecks and the call sites can migrate one at a time. Task 8 removes `plateNumber` once nothing imports it.

## Review cadence

- After **Task 1**: SQL review before pushing. The sequence, the permutation, and the idempotency guards are the whole risk.
- After **Task 6**: a review of the client-side surfaces (cart persistence, the attacker-controllable contact param).
- After **Task 9**: a copy and consistency pass over the rendered result.

---

## File Structure

**Modified:**
- `lib/schema.sql`: sequence, column, default, backfill, unique index, NOT NULL.
- `lib/plate-number.ts`: `plateNumber(slug)` becomes `formatPlate(n)`.
- `components/site/PlateCard.tsx`: `PlateCardData` gains `plate_no`; renders it.
- `components/site/VintageWall.tsx`: `WallItem` gains `plate_no`; hover caption shows it.
- `components/site/Lightbox.tsx`: reads `item.plate_no`.
- `components/shop/CartProvider.tsx`: `CartLine` gains optional `plateNo`.
- `components/shop/OrderCard.tsx`: `plateNo` becomes a number; sets it on the cart line; carries `&plate=` on contact links.
- `app/(shop)/page.tsx`, `app/(shop)/shop/page.tsx`, `app/(shop)/portfolio/[slug]/page.tsx`, `app/(shop)/shop/collections/[slug]/page.tsx`, `app/(shop)/shop/artwork/[slug]/page.tsx`: queries select `plate_no`.
- `app/(shop)/shop/cart/page.tsx`, `app/(shop)/shop/checkout/page.tsx`: render the stored number.
- `app/(shop)/contact/page.tsx`: reads a validated `&plate=` param.
- `app/admin/artworks/[id]/page.tsx`: read-only Plate field.

**Created:**
- `tests/lib/plate-number.test.ts`

---

### Task 1: The migration

**Files:**
- Modify: `lib/schema.sql` (append at the end)

**Interfaces:**
- Produces: `artworks.plate_no INT NOT NULL UNIQUE`, populated for every existing row.

No unit test can reach a SQL column default. This task is verified by running the migration against a throwaway Neon branch, twice, plus the assertions in Step 4.

- [ ] **Step 1: Append the DDL**

Statement order matters and must be preserved: add the column **nullable**, *then* set the default, then backfill. Folding the default into `ADD COLUMN` evaluates `nextval` once and hands every existing row the same number, which then fails the unique index.

```sql

-- Plate numbers -----------------------------------------------------------
-- A stored, permanent accession number, replacing the char-code hash of the
-- slug that lib/plate-number.ts used to derive. Every artwork gets one,
-- including wall-only pieces: the lightbox already renders a plate number for
-- draft rows, because the homepage wall query filters on on_wall with no
-- status filter.
--
-- SCATTERED, NOT SEQUENTIAL. The old hash spread numbers across the whole
-- WL-0100..WL-9099 range, so a catalogue of a hundred reads like one of
-- thousands. A plain sequence would print 0100, 0101, 0102 and announce both
-- the size of the catalogue and the acquisition order of every piece.
-- 2731 is prime and shares no factor with 9000 (2^3 * 3^2 * 5^3), so
-- (n * 2731) % 9000 is a PERMUTATION of the range: draws 1..9000 give exactly
-- 9000 distinct values, with no retry loop and no randomness.
CREATE SEQUENCE IF NOT EXISTS artworks_plate_no_seq;
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS plate_no INT;
ALTER TABLE artworks
  ALTER COLUMN plate_no
  SET DEFAULT ((nextval('artworks_plate_no_seq') * 2731) % 9000) + 100;

-- Assign only where missing. The WHERE clause is the ENTIRE idempotency
-- guard: this file re-runs on every build, and an unguarded assignment would
-- renumber public plate numbers on every deploy.
--
-- NO setval, and adding one would be a bug. `SET col = DEFAULT` evaluates the
-- column default PER ROW (nextval is VOLATILE, so it cannot be constant
-- folded), which means the backfill draws from the sequence itself and leaves
-- it correct by construction. Any hand-written setval would have to track how
-- many numbers have been DRAWN, not the highest number STORED, because the
-- permutation makes those unrelated; and a setval to MAX(plate_no) or to a row
-- count REWINDS the sequence when the highest-numbered artwork is deleted, so
-- the next upload reissues a number a customer has already seen.
UPDATE artworks SET plate_no = DEFAULT WHERE plate_no IS NULL;

-- CREATE UNIQUE INDEX IF NOT EXISTS, not ADD CONSTRAINT ... UNIQUE, which has
-- no IF NOT EXISTS and would error on the second build, breaking every deploy.
CREATE UNIQUE INDEX IF NOT EXISTS idx_artworks_plate_no ON artworks(plate_no);
-- No-op on an already-NOT-NULL column: Postgres checks attnotnull and skips
-- both the change and the verification scan.
ALTER TABLE artworks ALTER COLUMN plate_no SET NOT NULL;
```

Two things this deliberately does NOT require, both easy to get wrong:

- **No insert site changes.** `app/api/admin/artworks/upload/route.ts`,
  `app/api/admin/artworks/bulk-upload/finalize/route.ts` and
  `scripts/import-manifest.ts` all keep working untouched, because the column
  default does the work. That is the main reason this is a sequence rather than
  `MAX(plate_no) + 1` in application code, which would race itself on bulk
  upload and hand two photos the same number.
- **No claim about assignment order.** `UPDATE … WHERE plate_no IS NULL` has no
  defined row order (Postgres assigns in heap order, and `artworks` has been
  rewritten repeatedly), so do not document or infer "lower number = older
  piece". The permutation scrambles the output anyway.

- [ ] **Step 2: Verify no statement-level transaction control was introduced**

Run: `grep -nE '^\s*(COMMIT|VACUUM)\b|^\s*CREATE +INDEX +CONCURRENTLY' lib/schema.sql`
Expected: no output

Run: `grep -c '^BEGIN$' lib/schema.sql`
Expected: `1` (the shop-ordering `DO $$` block's own, added previously)

- [ ] **Step 3: Confirm the draw horizon before running anything**

Against production:

```sql
SELECT COUNT(*) AS artworks FROM artworks;
```

Expected: far below 9000. It was 107 on 2026-07-21. Draw 9001 collides with
draw 1 and, with a unique index and no retry loop, becomes a permanent
unique-violation 500 on every upload. The horizon counts *draws*, not live
rows, so deletes and failed inserts burn it faster.

- [ ] **Step 4: Run it for real, twice, on a throwaway branch**

Create a Neon branch off `production` (project `sweet-dew-84186427`), point
`DATABASE_URL` at it, then:

```bash
npm run migrate   # first run: assigns every row
npm run migrate   # second run: must assign nothing
```

Assertions on the scratch branch:

```sql
-- 1. Every row numbered, all distinct, all in range.
SELECT COUNT(*)                                   AS rows,
       COUNT(plate_no)                            AS numbered,
       COUNT(DISTINCT plate_no)                   AS distinct_no,
       MIN(plate_no)                              AS lo,
       MAX(plate_no)                              AS hi
  FROM artworks;
-- Expect: rows = numbered = distinct_no, lo >= 100, hi <= 9099

-- 2. The sequence is ahead of the draws already taken.
SELECT last_value FROM artworks_plate_no_seq;
-- Expect: >= the row count

-- 3. A NEW row gets a number automatically, from the default.
INSERT INTO artworks (slug, title, image_web_url, status)
VALUES ('plate-test-row', 'Plate Test', 'https://example.invalid/x.jpg', 'draft')
RETURNING id, plate_no;
-- Expect: a plate_no in 100..9099, different from every existing one

DELETE FROM artworks WHERE slug = 'plate-test-row';
```

Then the assertion that actually tests idempotency, which two clean runs cannot:

```sql
-- Perturb one row, then migrate again, and confirm it is NOT reassigned.
UPDATE artworks SET plate_no = 9099
 WHERE id = (SELECT id FROM artworks ORDER BY id LIMIT 1);
```

```bash
npm run migrate   # third run
```

```sql
SELECT plate_no FROM artworks ORDER BY id LIMIT 1;
-- Expect: still 9099. If it changed, the WHERE plate_no IS NULL guard is not
-- doing its job and every deploy would renumber the public catalogue.
```

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add lib/schema.sql
git commit -m "feat(plate): stored accession number column, scattered by a coprime permutation"
```

- [ ] **Step 6: Push and confirm on production**

This push is safe to make alone: the column is additive and nothing reads it,
so there is zero rendered change.

```sql
SELECT COUNT(*) AS rows, COUNT(DISTINCT plate_no) AS distinct_no,
       MIN(plate_no) AS lo, MAX(plate_no) AS hi FROM artworks;
```

Expected: `rows = distinct_no`, `lo >= 100`, `hi <= 9099`.

---

### Task 2: `formatPlate`, added alongside the old hash

**Files:**
- Modify: `lib/plate-number.ts`
- Test: `tests/lib/plate-number.test.ts`

**Interfaces:**
- Produces: `formatPlate(n: number): string` and `parsePlateParam(raw: string | null): number | null`. `plateNumber(slug: string): string` stays exported for now so the six existing call sites keep typechecking; Task 8 removes it.

`parsePlateParam` lives here rather than inline in the contact page for one
reason: the spec requires the param validation to be unit-tested, and logic
inside a `'use client'` component is unreachable by vitest, which has no
component harness in this repo.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/plate-number.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatPlate, parsePlateParam } from '@/lib/plate-number';

describe('formatPlate', () => {
  it('pads to four digits with the en-dash separator', () => {
    expect(formatPlate(100)).toBe('WL–0100');
    expect(formatPlate(4312)).toBe('WL–4312');
    expect(formatPlate(9099)).toBe('WL–9099');
  });

  // U+2013, not a hyphen. The old derived version used an en-dash and the
  // format is a non-goal of the change, so it must survive byte-identical.
  it('uses an en-dash, not a hyphen', () => {
    expect(formatPlate(100).charCodeAt(2)).toBe(0x2013);
  });
});

describe('parsePlateParam', () => {
  // The contact page reads this from a URL, so it is attacker-controllable.
  // Every rejection must return null so the caller can omit the plate entirely
  // rather than rendering a partial or "WL–NaN".
  it('accepts an in-range integer', () => {
    expect(parsePlateParam('100')).toBe(100);
    expect(parsePlateParam('4312')).toBe(4312);
    expect(parsePlateParam('9099')).toBe(9099);
  });

  it('rejects out-of-range values', () => {
    expect(parsePlateParam('99')).toBeNull();
    expect(parsePlateParam('9100')).toBeNull();
    expect(parsePlateParam('-4312')).toBeNull();
  });

  it('rejects non-integers and junk', () => {
    for (const bad of ['abc', '43.5', '4e3', '', '  ', null]) {
      expect(parsePlateParam(bad)).toBeNull();
    }
  });

  // Number('') is 0 and Number('  ') is 0, which would otherwise sail through
  // an integer check and then fail the range check by luck rather than design.
  it('rejects blank explicitly, not by accident of the range check', () => {
    expect(parsePlateParam('')).toBeNull();
  });
});

describe('the stored permutation', () => {
  // Documents the property the SQL column default relies on. It does NOT test
  // the default itself: no test in this repo can reach a Postgres expression.
  // (n * 2731) % 9000 + 100 is a permutation because 2731 is prime and shares
  // no factor with 9000 = 2^3 * 3^2 * 5^3.
  const draw = (n: number) => ((n * 2731) % 9000) + 100;

  it('gives 9000 distinct values over draws 1..9000, all in range', () => {
    const seen = new Set<number>();
    for (let n = 1; n <= 9000; n++) {
      const v = draw(n);
      expect(v).toBeGreaterThanOrEqual(100);
      expect(v).toBeLessThanOrEqual(9099);
      seen.add(v);
    }
    expect(seen.size).toBe(9000);
  });

  it('collides on draw 9001, which is the documented horizon', () => {
    expect(draw(9001)).toBe(draw(1));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/plate-number.test.ts`
Expected: FAIL, `formatPlate` is not exported

- [ ] **Step 3: Add the formatter**

In `lib/plate-number.ts`, add above the existing function:

```ts
/**
 * Render a stored plate number. The number itself lives in
 * `artworks.plate_no`, assigned once at insert and never rewritten.
 *
 * This module must keep importing NOTHING: it is reached from 'use client'
 * components, and anything that pulls in lib/db.ts drags `pg` into the client
 * bundle, which fails only at `next build`.
 */
export function formatPlate(n: number): string {
  return `WL–${String(n).padStart(4, '0')}`;
}

/**
 * Read a plate number off a URL param. Returns null for anything unusable, so
 * the caller can omit the plate entirely rather than render a partial.
 *
 * The contact page takes this from a query string, so it is
 * attacker-controllable via a crafted link. Without validation, `?plate=abc`
 * would render "WL–NaN" in the ref pill, the seeded message and the email
 * subject, and a shared link could show a fabricated plate number as if it
 * were official.
 *
 * The blank guard is explicit rather than incidental: Number('') is 0, which
 * is an integer, and would otherwise be rejected only by luck of the range
 * check.
 */
export function parsePlateParam(raw: string | null): number | null {
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 100 || n > 9099) return null;
  return n;
}
```

Leave `plateNumber` in place and mark it:

```ts
/**
 * DEPRECATED. Derived from the slug, so it changes when a slug is renamed and
 * carries no record of when a piece entered the catalogue. Being replaced by
 * the stored `artworks.plate_no`; call sites migrate one at a time and this is
 * deleted once nothing imports it.
 */
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/plate-number.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm test
git add lib/plate-number.ts tests/lib/plate-number.test.ts
git commit -m "feat(plate): add formatPlate alongside the derived hash"
```

---

### Task 3: Carry `plate_no` through the query layer

**Files:**
- Modify: `components/site/PlateCard.tsx`, `components/site/VintageWall.tsx`
- Modify: `app/(shop)/shop/page.tsx`, `app/(shop)/portfolio/[slug]/page.tsx`, `app/(shop)/shop/collections/[slug]/page.tsx`, `app/(shop)/shop/artwork/[slug]/page.tsx`, `app/(shop)/page.tsx`

**Interfaces:**
- Produces: `PlateCardData.plate_no: number` and `WallItem.plate_no: number`, both **required**, populated by five queries.

**Read this before starting.** The spec claims that making `plate_no` required
means "typecheck enumerates every feeding query". **That is false.**
`pool.query<PlateRow>(...)` is an unchecked generic: TypeScript never looks
inside the SQL string, so a query missing the column typechecks cleanly and
renders `undefined`, which would print `WL–NaN`. Typecheck only catches places
that build the object as a literal. The enumeration here is therefore explicit,
and Step 3 greps for it.

- [ ] **Step 1: Add the field to both types**

In `components/site/PlateCard.tsx`, inside `export interface PlateCardData`:

```ts
  /** Stored accession number. Required: a missing one renders WL–NaN. */
  plate_no: number;
```

In `components/site/VintageWall.tsx`, inside `export interface WallItem`:

```ts
  /** Stored accession number. Required: a missing one renders WL–NaN. */
  plate_no: number;
```

- [ ] **Step 2: Add `a.plate_no` to all five queries**

There are exactly five. Two feed `PlateCardData` directly via `PlateCard`, two
via `ArtworkGrid` (whose `GridItem` is an alias for `PlateCardData`), and one
feeds `WallItem`.

1. `app/(shop)/shop/page.tsx`: the Selected works grid. Add `a.plate_no,` after `a.location,`.
2. `app/(shop)/portfolio/[slug]/page.tsx`: the chapter grid. Add `a.plate_no,` after `a.location,`.
3. `app/(shop)/shop/collections/[slug]/page.tsx`: the chapter grid. Add `a.plate_no,` after `a.location,`.
4. `app/(shop)/shop/artwork/[slug]/page.tsx`: **the related rail only** (the `LIMIT 4` query). Add `a.plate_no,` after `a.location,`.
5. `app/(shop)/page.tsx`: the homepage wall query. Add `a.plate_no,` after `a.location,`.

The artwork page's *gating* query also needs it, for the page's own heading:
add `a.plate_no,` to the `published` CTE's select list and `p.plate_no,` to the
outer select, plus `plate_no: number;` on its `ArtworkRow` interface.

- [ ] **Step 3: Verify every query actually selects it**

Typecheck cannot do this, so grep can:

Run:
```bash
for f in "app/(shop)/shop/page.tsx" "app/(shop)/portfolio/[slug]/page.tsx" \
         "app/(shop)/shop/collections/[slug]/page.tsx" \
         "app/(shop)/shop/artwork/[slug]/page.tsx" "app/(shop)/page.tsx"; do
  printf '%-52s %s\n' "$f" "$(grep -c 'plate_no' "$f")"
done
```

Expected: every file `>= 1`, and `app/(shop)/shop/artwork/[slug]/page.tsx` `>= 4`
(gating CTE, outer select, interface, related rail).

- [ ] **Step 4: Typecheck, test, commit**

```bash
npm run typecheck && npm test
git add components/site/PlateCard.tsx components/site/VintageWall.tsx \
        "app/(shop)/shop/page.tsx" "app/(shop)/portfolio/[slug]/page.tsx" \
        "app/(shop)/shop/collections/[slug]/page.tsx" \
        "app/(shop)/shop/artwork/[slug]/page.tsx" "app/(shop)/page.tsx"
git commit -m "feat(plate): carry plate_no through every query that renders a plate"
```

---

### Task 4: Swap the server-rendered surfaces

**Files:**
- Modify: `components/site/PlateCard.tsx`, `components/site/Lightbox.tsx`, `components/site/VintageWall.tsx`, `app/(shop)/shop/artwork/[slug]/page.tsx`

**Interfaces:**
- Consumes: `formatPlate` (Task 2), `plate_no` on `PlateCardData` / `WallItem` / the artwork row (Task 3).

- [ ] **Step 1: `PlateCard`**

Replace the import and the derivation:

```ts
import { formatPlate } from '@/lib/plate-number';
```

```ts
  const plate = formatPlate(item.plate_no);
```

- [ ] **Step 2: `Lightbox`**

```ts
import { formatPlate } from '@/lib/plate-number';
```

```tsx
          <span className="sub">{formatPlate(item.plate_no)} · from the archive</span>
```

- [ ] **Step 3: The wall hover caption**

`.wl-wall-cap` is `opacity: 0`, revealed on `:hover` and `:focus-visible`, and
is already mono, uppercase and letterspaced, so a number sits in it natively.
This is the only new display surface in the whole change.

In `components/site/VintageWall.tsx`, add the import and replace the caption:

```tsx
import { formatPlate } from '@/lib/plate-number';
```

```tsx
            <span className="wl-wall-cap">
              {formatPlate(it.plate_no)} · {it.title}
            </span>
```

- [ ] **Step 4: The artwork page, and remove `plate_idx`**

Replace `const plate = plateNumber(art.slug);` with:

```ts
  const plate = formatPlate(art.plate_no);
```

Then delete the numbering that the stored value replaces. Remove `plate_idx`
and `plate_total` from the `ArtworkRow` interface, remove
`ROW_NUMBER() OVER (ORDER BY a.display_order, a.id) AS plate_idx,` and
`COUNT(*) OVER () AS plate_total` from the gating CTE, remove
`p.plate_idx::int, p.plate_total::int,` from the outer select, and replace the
heading:

```tsx
        <span>{plate}</span>
```

A permanent number in a catalogue with gaps cannot honestly claim an "of NN"
denominator, and `plate_idx` was computed from `display_order`, which is now
something the admin deliberately arranges: it moved on every reorder.

`OrderCard`'s `plateNo` prop still receives the formatted string here, so it is
unchanged by this step. Task 5 changes it to a number.

- [ ] **Step 5: Typecheck, test, commit**

```bash
npm run typecheck && npm test
git add components/site/PlateCard.tsx components/site/Lightbox.tsx \
        components/site/VintageWall.tsx "app/(shop)/shop/artwork/[slug]/page.tsx"
git commit -m "feat(plate): render the stored number, drop plate_idx"
```

---

### Task 5: The cart line

**Files:**
- Modify: `components/shop/CartProvider.tsx`, `components/shop/OrderCard.tsx`, `app/(shop)/shop/cart/page.tsx`, `app/(shop)/shop/checkout/page.tsx`, `app/(shop)/shop/artwork/[slug]/page.tsx`

**Interfaces:**
- Produces: `CartLine.plateNo?: number` (optional, deliberately).
- `OrderCard`'s `plateNo` prop changes from `string` to `number`.

- [ ] **Step 1: Add the optional field**

In `components/shop/CartProvider.tsx`, inside `export interface CartLine`, after `artworkTitle`:

```ts
  /**
   * OPTIONAL on purpose. Carts already sitting in a browser under the
   * `wl_cart_v1` key predate this field, and bumping the storage key to force
   * the issue would discard live carts: real revenue friction for a cosmetic
   * label. The renderers below handle its absence.
   */
  plateNo?: number;
```

- [ ] **Step 2: `OrderCard` takes a number and puts it on the line**

Change the prop type from `plateNo: string;` to:

```ts
  /** Stored accession number. Formatted at each render site. */
  plateNo: number;
```

Both render sites become `{formatPlate(plateNo)}`, with
`import { formatPlate } from '@/lib/plate-number';` added.

In the `cart.add({...})` call, add `plateNo,` to the object.

- [ ] **Step 3: The artwork page passes a number**

`plate` is now a formatted string, so `OrderCard` needs the raw value:

```tsx
                plateNo={art.plate_no}
```

- [ ] **Step 4: Cart and checkout render conditionally**

Dropping an optional value into `{plateNumber(l.artworkSlug)} · {l.type}` would
print a leading `" · "` for pre-existing lines. The **separator** has to be
conditional, not just the value.

`app/(shop)/shop/cart/page.tsx`:

```tsx
                  <div className="wl-ci-sub">
                    {l.plateNo != null ? `${formatPlate(l.plateNo)} · ` : ''}
                    {l.type} · {l.size}
                    {l.finish ? ` · ${l.finish}` : ''}
                  </div>
```

`app/(shop)/shop/checkout/page.tsx`:

```tsx
                <div className="wl-ci-sub">
                  {l.plateNo != null ? `${formatPlate(l.plateNo)} · ` : ''}
                  {l.type} · {l.size}
                  {l.finish ? ` · ${l.finish}` : ''} · ×{l.quantity}
                </div>
```

Both swap their import to `formatPlate`.

- [ ] **Step 5: Typecheck, test, commit**

```bash
npm run typecheck && npm test
git add components/shop/CartProvider.tsx components/shop/OrderCard.tsx \
        "app/(shop)/shop/cart/page.tsx" "app/(shop)/shop/checkout/page.tsx" \
        "app/(shop)/shop/artwork/[slug]/page.tsx"
git commit -m "feat(plate): carry the stored number on the cart line"
```

---

### Task 6: The contact page

**Files:**
- Modify: `components/shop/OrderCard.tsx`, `app/(shop)/contact/page.tsx`

**Interfaces:**
- Consumes: `formatPlate`.

The contact page is a `'use client'` component with **three** render sites and
no database access. It derives the piece from `?piece=<slug>`, and also from a
legacy `?license=<slug>` param that is documented as still working.

- [ ] **Step 1: The three inbound links carry the number**

All three are built by `OrderCard`, which now has `plateNo` as a number:

```tsx
            href={`/contact?reason=commission&piece=${artworkSlug}&plate=${plateNo}`}
```
```tsx
          href={`/contact?reason=commission&piece=${artworkSlug}&plate=${plateNo}`}
```
```tsx
        href={`/contact?reason=license&piece=${artworkSlug}&plate=${plateNo}`}
```

- [ ] **Step 2: Read and validate the param**

Beside the existing `const piece = qp.get('piece') || legacyLicenseSlug || '';`:

```tsx
  // Attacker-controllable via a crafted link, so validate rather than trust.
  // Without this, ?plate=abc renders "WL–NaN" in the ref pill, the seeded
  // message and the email subject, and a shared link could display a
  // fabricated plate number as if it were official. React escapes the value so
  // this is not XSS; a convincing fake reference is its own problem.
  //
  // Absent is normal, not exceptional: old links and the legacy ?license= path
  // cannot carry it. Every render site below omits the plate entirely rather
  // than showing a partial.
  const plateNo = parsePlateParam(qp.get('plate'));
```

Add `import { formatPlate, parsePlateParam } from '@/lib/plate-number';` and
remove the `plateNumber` import. The validation itself is tested in
`tests/lib/plate-number.test.ts`; it lives in `lib/` precisely so it can be.

- [ ] **Step 3: The seeded message**

```tsx
    const plate = plateNo != null ? formatPlate(plateNo) : null;
    const verb =
      reason === 'commission'
        ? 'a commission related to'
        : reason === 'license'
          ? 'licensing'
          : reason === 'corporate-gift'
            ? 'a corporate gift version of'
            : 'this plate';
    setMessage(
      plate
        ? `I'm interested in ${verb} ${plate} (${piece}).\n\n`
        : `I'm interested in ${verb} ${piece}.\n\n`,
    );
```

- [ ] **Step 4: The email subject**

```tsx
    const subject =
      piece && plateNo != null
        ? `${REASON_LABEL[reason]} — ${formatPlate(plateNo)}`
        : piece
          ? `${REASON_LABEL[reason]} — ${piece}`
          : REASON_LABEL[reason];
```

Falling back to the slug rather than dropping the reference keeps the subject
useful on a legacy link, where the piece is known but its number is not.

- [ ] **Step 5: The ref pill**

An empty pill renders a bold nothing and a stray separator, so omit the number
rather than the pill:

```tsx
          {piece && (
            <div className="ref-pill">
              <span>Re:</span>
              {plateNo != null && (
                <>
                  <b>{formatPlate(plateNo)}</b>
                  <span>·</span>
                </>
              )}
              <span>{piece}</span>
            </div>
          )}
```

- [ ] **Step 6: Typecheck, test, commit**

```bash
npm run typecheck && npm test
git add components/shop/OrderCard.tsx "app/(shop)/contact/page.tsx"
git commit -m "feat(plate): validated plate param on the contact form"
```

---

### Task 7: The admin read-only field

**Files:**
- Modify: `app/admin/artworks/[id]/page.tsx`

Plate numbers deliberately do **not** go on admin thumbnails: commits `1f23519`
and `d67d411` stripped names and prices off those tiles to quiet them. This is
the one admin surface, where you would go looking for it on purpose.

- [ ] **Step 1: Add the field**

In the `wl-adm-field-grid`, after the Title field:

```tsx
              <AdminField label="Plate">
                <span className="wl-adm-field-static">
                  {a.plate_no != null ? formatPlate(a.plate_no) : "not set"}
                </span>
              </AdminField>
```

Add `import { formatPlate } from '@/lib/plate-number';`, and `plate_no: number | null;`
to the page's artwork row type. It is typed nullable here purely because the
admin fetches `SELECT a.*` and the type is hand-maintained; the column is
`NOT NULL` in the database.

- [ ] **Step 2: Style the static value**

In `app/admin/admin.css`:

```css
/* Read-only value inside an AdminField, styled to match an input's text
   without looking editable. */
.wl-adm-field-static {
  font-family: var(--f-mono), monospace;
  font-size: 13px;
  color: var(--adm-ink-2);
}
```

- [ ] **Step 3: Typecheck, test, commit**

```bash
npm run typecheck && npm test
git add "app/admin/artworks/[id]/page.tsx" app/admin/admin.css
git commit -m "feat(plate): read-only plate number on the artwork edit page"
```

---

### Task 8: Delete the derived hash

**Files:**
- Modify: `lib/plate-number.ts`

- [ ] **Step 1: Confirm nothing imports it**

Run: `grep -rn 'plateNumber' app components lib --include=*.ts --include=*.tsx`
Expected: matches only inside `lib/plate-number.ts` itself

If anything else matches, that call site was missed and must be migrated before
continuing. A surviving `plateNumber` call renders a *different number* for the
same piece than every other surface.

- [ ] **Step 2: Remove the function**

Delete `plateNumber` entirely, leaving `formatPlate` and a header comment:

```ts
// Plate numbers. The number itself is `artworks.plate_no`, assigned once by a
// column default and never rewritten; this module only renders it.
//
// It used to be derived here as a char-code hash of the slug, which meant a
// rename changed a piece's number and the number recorded nothing about the
// catalogue. See docs/superpowers/specs/2026-07-21-plate-numbers-design.md.
//
// IMPORTS NOTHING, deliberately: reached from 'use client' components, and
// anything pulling in lib/db.ts drags `pg` into the client bundle, which fails
// only at `next build`.
```

- [ ] **Step 3: Typecheck, test, build, commit**

```bash
npm run typecheck && npm test && npm run build
git add lib/plate-number.ts
git commit -m "refactor(plate): delete the slug-derived hash"
```

`npm run build` is required here, not optional: it is the only gate that
catches a server module reaching the client bundle.

---

### Task 9: Final verification

- [ ] **Step 1: Gates**

```bash
npm run typecheck && npm test && npm run build
```

Do NOT run `npm run lint`.

- [ ] **Step 2: Confirm one piece shows one number everywhere**

The whole point of the change is that a piece has *one* number. Pick a
published, buyable artwork and check every surface renders the same `WL–NNNN`:

1. its tile on `/shop`
2. its tile on its chapter page
3. the artwork page heading
4. the related rail on a sibling artwork's page
5. the wall hover caption on `/`
6. the lightbox on `/`
7. the cart, after adding it
8. the checkout summary

- [ ] **Step 3: The cases only a browser can show**

1. **A wall-only (unpublished) piece** shows a number on hover and in the lightbox. This is why the column covers every artwork and not just published ones.
2. **A pre-existing cart line**, added before this shipped, renders with no stray leading separator.
3. **`/contact?reason=commission&piece=<slug>`** with `&plate=` present, with it absent, and with `&plate=abc`: the first shows the number, the other two omit it cleanly and never render `WL–NaN`.
4. **The legacy `/contact?license=<slug>`** path still works and falls back to the slug in the subject.
5. **Upload a new artwork** and confirm it receives a number in range, distinct from every existing one.

- [ ] **Step 4: Confirm the numbers actually changed**

```sql
SELECT COUNT(*) AS rows, COUNT(DISTINCT plate_no) AS distinct_no FROM artworks;
```

Expected: equal. Then spot-check one piece against a screenshot taken before
the deploy: its number **should** be different. That is the intended one-time
renumbering, not a bug.

## Risks and rollback

- **The visible change is one-way.** Reverting the display swap restores
  `plateNumber(slug)` and flips every public number a second time. Treat a
  rollback as a decision to renumber again, not a neutral undo.
- **Task 1 alone is safely revertible**, because nothing reads the column. If
  the migration lands and the swap is abandoned, the column sits unused and
  costs nothing.
- **`nextval` is exempt from transaction rollback**, so a failed and retried
  migration permanently burns numbers. Consistent with "gaps are permanent and
  correct", but worth knowing when the sequence looks ahead of the row count.
- **The modulus cannot be widened later** without renumbering every plate. If
  the catalogue ever approaches four figures, the fix is a wider format
  (`WL–NNNNN`), decided deliberately.

## Out of scope

- Surfacing the plate number in emails or on the order page. It is absent from
  both today (`lib/email.ts` renders a "Plates" section label with no number),
  and adding it is a separate copy decision.
- A wider format. See Risks.
