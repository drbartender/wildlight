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

**Push 1 = Tasks 1, 2 and 7.** All three are invisible on the storefront. Task 1's column is additive and unread; Task 2 only adds unused exports; Task 7 is admin-only. Together they buy a **rendered** checkpoint before any public number moves: Dan can open the artwork Edit page and see the assigned plate numbers while the storefront still shows the old hash. That is worth having, because it is the last look before the one-way step.

**Push 2 = Tasks 3 through 6, then 8.** The display swap. Every number changes at once, which is the intended behaviour: a half-swapped state would show one number on the grid tile and a different one in the cart for the same piece.

**Do not push between Tasks 3 and 8.** Each commit in that range leaves the tree compiling but mid-swap, with two different numbers live for the same piece. Every task in the range restates this, because under subagent-driven execution each task is read in a fresh session that never sees this section.

Task 2 **adds** `formatPlate` while keeping `plateNumber`, which is what lets the six call sites migrate one at a time with every intermediate commit green. Task 8 removes `plateNumber` and is therefore the commit that makes push 2 coherent.

## Review cadence

- After **Task 1**: SQL review before pushing. The sequence, the permutation, and the idempotency guards are the whole risk.
- After **Task 4**: the public renumbering. Tasks 3 and 4 together *are* the visible change, and a `plate_no` missing from a SELECT list renders `WL–NaN` or 500s with nothing in the gates to catch it. This is the gate that matters most and the plan originally lacked it.
- After **Task 6**: the client-side surfaces (cart persistence, the attacker-controllable contact param).
- Before the push, not after: the copy and consistency pass, as Task 9 Steps 2 and 3 on the scratch branch.

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
- `app/admin/admin.css`: `.wl-adm-field-static`, for that field's value.

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
unique-violation 500 on every upload.

The horizon counts *draws*, not live rows, so deletes and failed inserts burn it
faster. The specific burner is
`app/api/admin/artworks/bulk-upload/finalize/route.ts`, whose
`ON CONFLICT (slug) DO NOTHING` retry loop takes up to ten attempts per create
and burns a sequence value on each. `scripts/import-manifest.ts` would burn one
per existing row on a re-import, since the tuple is evaluated before the
conflict is detected, but that script is fenced off and cannot run.

Also confirm the ordering backfill is not mid-flight: the spec's conditional
pre-ship snapshot applies only if this ships in the same window as that
migration. It shipped 2026-07-21 and its `DO $$` block is already in
`lib/schema.sql` with its marker set, so the condition is satisfied and no extra
snapshot is needed. Re-check if that is no longer true.

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

**Run the SQL review gate first** (see Review cadence). The sequence, the
permutation and the idempotency guards are the entire risk of this task, and
this is the last point before they reach the real database. Restated here
because a fresh session executing Task 1 never sees the header.

Push Tasks 1, 2 and 7 together (see Push grouping): all three are invisible on
the storefront, and together they let Dan see assigned numbers on the artwork
Edit page before any public number moves.

This push is safe to make: the column is additive and nothing public reads it,
so there is zero rendered change on the storefront.

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

  // Each of these is an integer in range once Number() is through with it, so
  // they are rejected only by the digit-shape check. This is the test that
  // fails if someone "simplifies" the implementation back to Number.isInteger.
  it('rejects numeric forms that are not plain digits', () => {
    for (const bad of ['4e3', '0x1F4', '+500', ' 4312 ']) {
      expect(parsePlateParam(bad)).toBeNull();
    }
  });

  it('rejects non-integers and junk', () => {
    for (const bad of ['abc', '43.5', '', '  ', null]) {
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
  // Digit-shape FIRST, before Number(). `Number.isInteger(Number(x))` is not a
  // digit check: Number('4e3') is 4000, Number('0x1F4') is 500, Number('+500')
  // is 500 and Number(' 4312 ') is 4312, all integers, all in range. Every one
  // of those would render a plate number from a URL that does not look like
  // one. Verified by running this exact predicate both ways.
  if (raw == null || !/^\d{1,4}$/.test(raw)) return null;
  const n = Number(raw);
  if (n < 100 || n > 9099) return null;
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
Expected: PASS, 9 tests

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
5. `app/(shop)/page.tsx`: the homepage wall query. Add `a.plate_no,` after `a.location,`, **and add `plate_no: number;` to the local `interface WallRow`** (around line 15). That interface is separate from `WallItem`, and line ~59 assigns `items = res.rows`, so a required field on `WallItem` without the matching field on `WallRow` fails typecheck. This is the ONE query of the five where the compiler helps; the other four launder through `pool.query<T>` and are unchecked.

Note on anchors: `a.location,` is unique in files 1, 2, 3 and 5, but appears
**twice** in `app/(shop)/shop/artwork/[slug]/page.tsx` (the gating `published`
CTE around line 49, and the related rail around line 104). Both need it, with
different prefixes downstream (`a.` inside the CTE, `p.` in the outer select),
so edit them as two deliberate changes rather than one match.

The artwork page's *gating* query also needs it, for the page's own heading:
add `a.plate_no,` to the `published` CTE's select list and `p.plate_no,` to the
outer select, plus `plate_no: number;` on its `ArtworkRow` interface.

- [ ] **Step 3: Verify every query actually selects it**

Typecheck cannot do this, so grep can:

Grep for `a.plate_no` specifically, not bare `plate_no`: an interface line or a
prop name satisfies the loose pattern while the SELECT list stays empty, which
is exactly the failure being guarded against.

Run:
```bash
for f in "app/(shop)/shop/page.tsx" "app/(shop)/portfolio/[slug]/page.tsx" \
         "app/(shop)/shop/collections/[slug]/page.tsx" \
         "app/(shop)/shop/artwork/[slug]/page.tsx" "app/(shop)/page.tsx"; do
  printf '%-52s %s\n' "$f" "$(grep -c 'a\.plate_no' "$f")"
done
```

Expected: `1` for every file except `app/(shop)/shop/artwork/[slug]/page.tsx`,
which is `2` (gating CTE + related rail).

Then confirm the artwork page also threads it through the outer select and its
interface, neither of which matches `a.plate_no`:

Run: `grep -n 'p\.plate_no\|plate_no: number' "app/(shop)/shop/artwork/[slug]/page.tsx"`
Expected: two lines, the outer select and the `ArtworkRow` field.

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

Then delete the numbering that the stored value replaces, in four places.

**The CTE removal needs a comma fixed, or the page 500s.** The two window
functions are the LAST items in the gating CTE's select list, and the line above
them ends with a comma:

```sql
              a.collection_id, a.edition_size, a.signed,
              ROW_NUMBER() OVER (ORDER BY a.display_order, a.id) AS plate_idx,
              COUNT(*) OVER () AS plate_total
       FROM artworks a
```

Deleting just the two window-function lines leaves `a.signed,` immediately
before `FROM`, which is `syntax error at or near "FROM"` and a hard 500 on the
shop's highest-intent page. **Drop the trailing comma after `a.signed` too**, so
the result reads:

```sql
              a.collection_id, a.edition_size, a.signed
       FROM artworks a
```

Neither `npm run typecheck` nor `npm test` can see inside a SQL string, so the
Step 5 browser pass is the only thing that catches this. Do not skip it.

The other three removals are ordinary. Remove `plate_idx` and `plate_total`
from the `ArtworkRow` interface; remove `p.plate_idx::int, p.plate_total::int,`
from the outer select (safe: the line above it ends in a comma and a line
follows); and replace the heading:

```tsx
        <span>{plate}</span>
```

A permanent number in a catalogue with gaps cannot honestly claim an "of NN"
denominator, and `plate_idx` was computed from `display_order`, which is now
something the admin deliberately arranges: it moved on every reorder.

`OrderCard`'s `plateNo` prop still receives the formatted string here, so it is
unchanged by this step. Task 5 changes it to a number.

- [ ] **Step 5: LOOK AT IT. Typecheck cannot see this.**

This is the first task that changes rendered output, and `npm run typecheck` is
provably blind to the failure mode: four of the five queries go through
`pool.query<T>`, an unchecked generic, so a `plate_no` missing from a SELECT
list compiles green and then renders `WL–NaN` at runtime, or 500s outright if
the artwork page's outer select references a column its CTE never produced.

Reuse the throwaway Neon branch from Task 1 Step 4 rather than a real database.
**This path is verified working** (run on 2026-07-21: `/shop` returned 200 and
rendered real plate numbers against a scratch branch), but two things will make
it look broken if you do not know them:

- There is no `DATABASE_URL` in `.env.local` on this box, only a
  `VERCEL_OIDC_TOKEN`. Exporting it is mandatory, not optional. `lib/load-env.ts`
  is `config({ path: '.env.local' })` with no `override`, so an exported value
  wins.
- **Port 3000 is occupied by an unrelated Express service, so Next silently
  shifts to 3001.** Read the "Local:" line rather than assuming 3000. Probing
  3000 returns a 404 from the other service, which reads exactly like a broken
  route.

```bash
export DATABASE_URL='<the scratch branch connection string from Task 1>'
npm run dev
# then read the "- Local: http://localhost:PORT" line and use that port
```

If another `next dev` is already running for this repo it holds a lock and the
new one exits with "Another next dev server is already running"; stop that one
first.

Check each of these and confirm a well-formed `WL–NNNN`, never `WL–NaN`:

| URL | surface |
|---|---|
| `/shop` | grid tiles (Selected works) |
| `/shop/collections/<slug>` | chapter grid |
| `/portfolio/<slug>` | portfolio chapter grid, a **separate** query from the line above |
| `/shop/artwork/<slug>` | the heading, and the related rail at the bottom |
| `/` | hover a wall tile for the caption; click one to open the lightbox |

The artwork page heading must now read just `WL–NNNN`, with no "Plate 007 of
024" after it.

**On the lightbox:** the plate renders only in the `item.available === false`
branch (`components/site/Lightbox.tsx`, the "· from the archive" line). A
published, buyable piece shows "See print options →" instead and has no plate
there. That is existing behaviour and correct. **Do not add the plate to the
available branch** to make it appear: new public display surfaces are a Non-goal
of the spec, and the wall hover caption is the only one this change adds.

- [ ] **Step 6: Commit the swap**

The artwork page holds BOTH changes (the `formatPlate` swap and the `plate_idx`
removal), so it cannot be staged wholesale here or Step 7 has nothing left to
commit. Stage that one file by hunk; the other three are whole-file.

The hunks are far apart (the swap is around lines 7 and 127, the removal around
24-27, 52-59 and 146-149), so git presents them separately and `git add -p` is
straightforward: accept the import and `const plate =` hunks, skip the interface,
CTE, outer-select and heading hunks.

```bash
npm run typecheck && npm test
git add components/site/PlateCard.tsx components/site/Lightbox.tsx \
        components/site/VintageWall.tsx
git add -p "app/(shop)/shop/artwork/[slug]/page.tsx"   # swap hunks only
git commit -m "feat(plate): render the stored number on every server surface"
```

If splitting proves fiddly, the alternative is to do Step 4's two edits as two
passes in the first place: swap first, commit, then remove `plate_idx`, commit.

**Do not push.** The tree is mid-swap: these surfaces now show the stored
number while the cart, checkout and contact page still derive the old hash, so
the same piece has two different numbers. That is expected and only resolves at
Task 8.

- [ ] **Step 7: Commit the `plate_idx` removal separately**

The removal in Step 4 is a copy deletion (`WL–4312 · Plate 007 of 024` becomes
`WL–4312`) and is independently revertible, so it does not belong buried under a
commit message about rendering a stored number.

```bash
git add "app/(shop)/shop/artwork/[slug]/page.tsx"
git commit -m "refactor(plate): drop the plate_idx counter and its of-NN denominator"
```

If Step 4 was done as one edit, split it here with `git add -p`, or reorder:
land the three surface swaps first, then the removal.

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

Change only the body. **Keep the effect's first line `if (!piece || message) return;`
and its `}, []);` one-shot deps, including the `eslint-disable-next-line
react-hooks/exhaustive-deps` above it.** The guard is what stops the effect
overwriting text the user has already typed, and the empty deps are what make it
seed once on mount rather than on every render. Neither is shown in the snippet
below, and both must survive.

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
useful on a legacy link, where the piece is known but its number is not. That
fallback is a decision this plan makes; the spec only required the *pill* to
degrade cleanly, so flag it if you disagree.

The `—` in that template is an em dash, which the Global Constraints forbid in
user-facing copy. It is **pre-existing** copy being preserved through a
mechanical edit, not new text, so it stays. Changing it is a separate copy
decision.

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

- [ ] **Step 6: LOOK AT IT. The client surfaces have no test harness at all.**

vitest is node-only here with no jsdom and no component harness, so nothing
automated renders these. With the dev server still on the scratch branch:

| URL | expect |
|---|---|
| `/shop/artwork/<slug>`, then Add to cart, then `/shop/cart` | the plate, then ` · ` , then type/size. No stray leading separator. |
| `/shop/checkout` | same line, plus `· ×1` |
| `/contact?reason=commission&piece=<slug>&plate=4312` | pill shows `Re: WL–4312 · <slug>`; message seeded with the plate |
| `/contact?reason=commission&piece=<slug>` | pill shows `Re: <slug>` with no bold gap and no stray `·`; message names the slug |
| `/contact?reason=commission&piece=<slug>&plate=abc` | identical to the line above. Never `WL–NaN`. |
| `/contact?reason=commission&piece=<slug>&plate=4e3` | identical again. This is the case the digit-shape check exists for. |
| `/contact?license=<slug>` | legacy path still works, reason preselects License |

Then the case only a returning visitor sees: with an item already in the cart,
open devtools and delete `plateNo` from the `wl_cart_v1` entry in
localStorage, reload `/shop/cart`, and confirm the line renders `type · size`
with no leading separator. That is exactly the state every pre-existing cart is
in on the day this ships.

- [ ] **Step 7: Typecheck, test, commit**

```bash
npm run typecheck && npm test
git add components/shop/OrderCard.tsx "app/(shop)/contact/page.tsx"
git commit -m "feat(plate): validated plate param on the contact form"
```

**Do not push.** The contact page now matches the rest; only Task 8's deletion
remains before the swap is coherent.

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
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
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

Delete `plateNumber` **only**. `formatPlate` and `parsePlateParam` both stay:
the contact page imports the latter as of Task 6, and a literal reading of
"leave only the formatter" would break it.

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
export DATABASE_URL='<the scratch branch connection string from Task 1>'
npm run typecheck && npm test && npm run build
git add lib/plate-number.ts
git commit -m "refactor(plate): delete the slug-derived hash"
```

`npm run build` is required here, not optional: it is the only gate that catches
a server module reaching the client bundle.

**Export `DATABASE_URL` first.** `build` is `tsx lib/migrate.ts && next build`,
so it applies `lib/schema.sql` to whatever the connection string resolves to
before it bundles anything. Point it at the scratch branch, or use
`npm run build:skip-migrate` if you only want the bundle check. Do not run it
bare and hope.

---

### Task 9: Final verification

- [ ] **Step 1: Gates**

```bash
export DATABASE_URL='<the scratch branch connection string from Task 1>'
npm run typecheck && npm test && npm run build
```

`npm run build` is `tsx lib/migrate.ts && next build`, so it **applies the
migration to whatever `DATABASE_URL` resolves to** before bundling. Point it at
the scratch branch, or use `npm run build:skip-migrate` if you only want the
client-bundle check. Do NOT run it with a bare environment and let
`lib/load-env.ts` pick up `.env.local`.

Do NOT run `npm run lint`.

- [ ] **Step 2: PRE-PUSH. Confirm one piece shows one number everywhere**

This runs on the **scratch branch**, before the push, because the change is
one-way: after the push, "the number is wrong on the portfolio page" is not a
bug you fix, it is a second renumbering.

The whole point is that a piece has *one* number. Picking the wrong piece makes
two surfaces silently absent, which reads as a pass. It must be published,
buyable, **`on_wall`** (surfaces 6 and the lightbox), **inside the `/shop` cut**
(that page is `LIMIT NULLIF($1,0)` with `shop_index_limit` seeded to 12, so a
piece at position 13 never appears on surface 1), and **among the first four of
its collection** (the related rail is `ORDER BY a.collection_order LIMIT 4`, so
surface 5 is otherwise empty).

Confirm all of these render the same `WL–NNNN`:

1. its tile on `/shop`
2. its tile on `/shop/collections/<slug>`
3. its tile on `/portfolio/<slug>` — a **separate query** from 2, and the one most likely to be missed
4. the artwork page heading, now with no "of NN" after it
5. the related rail on a sibling artwork's page
6. the wall hover caption on `/`
7. the cart, after adding it
8. the checkout summary

Not on the list, deliberately: **the lightbox for this piece.** It renders the
plate only in the not-available branch, so a buyable piece correctly shows
"See print options →" instead. See Step 3.

- [ ] **Step 3: PRE-PUSH. The cases only a browser can show**

Still on the scratch branch:

1. **A wall-only (unpublished) piece**: number on hover, and in the lightbox. This is the branch the lightbox actually renders, and the reason the column covers every artwork rather than only published ones.
2. **A cart line with no `plateNo`** (delete the field from `wl_cart_v1` in devtools): renders `type · size` with no leading separator. Every pre-existing cart is in this state on launch day.
3. **`/contact?...&plate=4312`, `&plate=abc`, `&plate=4e3`, and no `&plate=`**: the first shows the number, the other three omit it cleanly. Never `WL–NaN`.
4. **The legacy `/contact?license=<slug>`**: still works, falls back to the slug in the subject.
5. **A new artwork gets a number**: already proven on the scratch branch by Task 1 Step 4 assertion 3. Do not repeat it against production by uploading a real row.

- [ ] **Step 4: POST-PUSH. Confirm the numbers actually changed**

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
- **Task 1 is abandonable, not revertible.** `lib/schema.sql` is applied
  additively at build time, so reverting the hunk does not drop the column, the
  sequence, or the assigned numbers: it just stops re-applying. If the swap is
  never shipped, the column sits unused and costs nothing. Do not reach for
  `git revert` expecting a clean database.
- **After Task 8, Tasks 3 through 6 are no longer individually revertible.**
  Reverting one alone restores calls to `plateNumber`, which no longer exists,
  and the tree stops compiling. A revert of the display swap must include Task 8
  or start from it.
- **Renames stop moving the number.** The old hash changed whenever a slug was
  renamed; the stored value does not. A strict improvement, and the reason a
  slug rename is no longer a customer-visible event.
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
