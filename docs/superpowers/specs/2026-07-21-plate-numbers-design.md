# Plate Numbers as a Stored Accession Number (Design Spec)

Date: 2026-07-21
Split out of `2026-07-20-shop-collections-ordering-design.md` after two review
rounds. Ships as its own deploy, after ordering.
Status: approved in design, findings from review round 2 folded in, not yet
planned

## Context

`lib/plate-number.ts` derives a plate number from the artwork slug:

```ts
export function plateNumber(slug: string): string {
  let sum = 0;
  for (let i = 0; i < slug.length; i++) sum += slug.charCodeAt(i);
  const n = (sum % 9000) + 100;
  return `WL–${String(n).padStart(4, '0')}`;
}
```

A char-code hash across `WL–0100` to `WL–9099`. It is **derived, not stored**,
with three consequences:

1. **Renaming a slug changes the number.** The module's own comment concedes
   this and calls renames "rare and intentional".
2. **The number is a function of the name, not of the catalog.** Two pieces can
   never be told apart by number in any durable sense, and the number carries no
   information about when a piece entered the collection.
3. **Nothing about it is a record.** It cannot be looked up, referenced in a
   conversation, or trusted to stay put.

It is nonetheless a real, visible identity: it appears on grid tiles, in the
lightbox, on the artwork page, in the cart, at checkout, and in the subject line
of contact emails. Customers see it at the moment of purchase.

## Goal

Convert `WL–NNNN` from a derived hash into a **stored, permanent accession
number** carried by every artwork, wall-only pieces included, without changing
how it looks.

## Non-goals

- Changing the format or the range. It stays `WL–0100` to `WL–9099`.
- Displaying it anywhere it is not already displayed, except the wall's hover
  caption.
- Anything about ordering. See the ordering spec.

## Why scattered, not sequential

The existing hash spreads numbers across the full range deliberately, so a
catalog of a hundred pieces reads like one of thousands. A plain sequence would
print `WL–0100, WL–0101, WL–0102`, announcing both the size of the catalog and
the acquisition order of every piece.

```
plate_no = ((nextval('artworks_plate_no_seq') * 2731) % 9000) + 100
```

2731 is prime and shares no factor with 9000 (`9000 = 2³·3²·5³`), so the map is
a **permutation** of the range: draws 1 through 9000 produce exactly 9000
distinct values spanning `WL–0100` to `WL–9099`, with no retry loop and no
randomness. Verified computationally during review.

## The migration

Statement order matters and must be preserved. Add the column nullable, *then*
set the default, then backfill. Folding the default into `ADD COLUMN` evaluates
`nextval` once and hands every existing row the same number, which then fails
the unique index.

```sql
CREATE SEQUENCE IF NOT EXISTS artworks_plate_no_seq;
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS plate_no INT;
ALTER TABLE artworks
  ALTER COLUMN plate_no
  SET DEFAULT ((nextval('artworks_plate_no_seq') * 2731) % 9000) + 100;

-- Assign only where missing. The WHERE clause is the ENTIRE idempotency guard:
-- lib/schema.sql re-runs on every build, and an unguarded re-rank would
-- renumber public plate numbers on every deploy.
UPDATE artworks SET plate_no = DEFAULT WHERE plate_no IS NULL;

-- CREATE UNIQUE INDEX IF NOT EXISTS, not ADD CONSTRAINT ... UNIQUE, which has
-- no IF NOT EXISTS and errors on the second build, breaking every deploy.
CREATE UNIQUE INDEX IF NOT EXISTS idx_artworks_plate_no ON artworks(plate_no);
ALTER TABLE artworks ALTER COLUMN plate_no SET NOT NULL;
```

**Placement in `lib/schema.sql`:** the idempotent post-create migration section,
after `CREATE TABLE artworks`. Independent of the ordering spec's additions; the
two do not interact, but both append and neither should be interleaved with the
other.

### No `setval`, and adding one would be a bug

`UPDATE … SET col = DEFAULT` is valid Postgres and evaluates the column default
**per row**: the parser substitutes the default expression into the target list,
and `nextval` is VOLATILE so it cannot be constant-folded. The backfill
therefore draws from the sequence itself and leaves it correct by construction.

Any hand-written `setval` would have to track how many numbers have been
*drawn*, not the highest number *stored*, because the permutation makes those
unrelated. Every naive variant is actively harmful: `setval` to `MAX(plate_no)`
or to a row count **rewinds** the sequence when the highest-numbered artwork is
deleted, and the next upload then reissues a number a customer has already seen.

### Idempotency, verified

Every statement above is re-run safe under the build-time re-apply model:
`CREATE SEQUENCE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `ALTER COLUMN … SET
DEFAULT` (idempotent by definition), the `WHERE plate_no IS NULL` guard (zero
rows on run two), `CREATE UNIQUE INDEX IF NOT EXISTS`, and `ALTER COLUMN … SET
NOT NULL`, which is a genuine no-op on an already-NOT-NULL column (Postgres
checks `attnotnull` and skips both the change and the verification scan).

### Assignment order is undefined, and that is fine

`UPDATE … WHERE plate_no IS NULL` has **no defined row order**. Postgres assigns
in heap order, and `artworks` has been rewritten repeatedly, so heap order is
not `id` order. This is harmless because the permutation scrambles the output
anyway, but do not document or rely on "lower draw = older piece". An earlier
draft claimed assignment in creation order; that claim was false and is
deliberately absent here.

### The 9001st draw

Draw 9001 collides with draw 1. With a unique index, no retry loop, and no
randomness, that surfaces as a **permanent unique-violation 500 on every
upload**, with no in-code recovery. The horizon counts *draws*, not live rows,
so deletes, failed inserts, and re-imports burn it faster. In particular,
`app/api/admin/artworks/bulk-upload/finalize/route.ts` has an
`ON CONFLICT (slug) DO NOTHING` retry loop that burns a sequence value per
failed attempt.

At two dozen pieces this is remote. It is recorded because **the modulus cannot
be widened later without renumbering every plate**, which the whole design
forbids. If the catalog ever approaches four figures, the fix is a wider format
(`WL–NNNNN`), decided deliberately, not a quiet modulus change.

Relatedly: `nextval` is exempt from transaction rollback, so a failed and
retried migration permanently burns numbers. Consistent with "gaps are permanent
and correct", but worth knowing.

### Why a sequence rather than MAX + 1

Bulk upload inserts many rows at once, and `MAX(plate_no) + 1` in application
code races itself, handing two photos the same number. A sequence is
concurrency-safe.

It also means **none of the three insert sites need to change**
(`app/api/admin/artworks/upload/route.ts`,
`app/api/admin/artworks/bulk-upload/finalize/route.ts`,
`scripts/import-manifest.ts`). The column default does the work.

## Display: replacing `plateNumber()`

`lib/plate-number.ts` changes from `plateNumber(slug: string)` to a pure
formatter:

```ts
export function formatPlate(n: number): string {
  return `WL–${String(n).padStart(4, '0')}`;
}
```

### Call sites: six files, eight expressions

`plateNumber()` is **imported by six files**. `components/shop/OrderCard.tsx` is
*not* one of them: it receives `plateNo: string` as a prop, passed from the
artwork page. An earlier draft listed eight importers and named OrderCard among
them; both were wrong.

| File | Sites | Where the number comes from |
|---|---|---|
| `components/site/PlateCard.tsx` | 1 | `PlateCardData` (see below) |
| `components/site/Lightbox.tsx` | 1 | `WallItem` |
| `app/(shop)/shop/artwork/[slug]/page.tsx` | 1 | its gating query |
| `app/(shop)/shop/cart/page.tsx` | 1 | the cart line |
| `app/(shop)/shop/checkout/page.tsx` | 1 | the cart line |
| `app/(shop)/contact/page.tsx` | 3 | a URL param |

### `PlateCardData` is fed by four queries

Making `plate_no` **required** (not optional) on `PlateCardData` is deliberate:
`npm run typecheck` then enumerates every feeding query rather than silently
rendering `undefined`. All four need `plate_no` added:

- `app/(shop)/shop/page.tsx`
- `app/(shop)/portfolio/[slug]/page.tsx`
- `app/(shop)/shop/collections/[slug]/page.tsx`
- the related rail in `app/(shop)/shop/artwork/[slug]/page.tsx`

Same treatment for `WallItem`, fed by the homepage wall query in
`app/(shop)/page.tsx`, and for `OrderCard`'s `plateNo` prop, which becomes a
number formatted at the call site.

### The cart and checkout

Both render from a `localStorage` cart line (`wl_cart_v1`) that carries
`artworkId` and `artworkSlug` but no plate number. `OrderCard` already holds the
number at `cart.add()` time, so `CartLine` gains `plateNo`.

**Optional, and the JSX must actually handle its absence.** Carts already
sitting in a browser lack the field, and the current markup is:

```tsx
{plateNumber(l.artworkSlug)} · {l.type} · {l.size}
```

Dropping an optional value into that prints a leading `" · "`. The separator has
to be conditional, not just the value. Do **not** bump `wl_cart_v1` to force the
issue: that discards live carts, which is real revenue friction for a cosmetic
field.

### The contact page

A client component with **three** render sites, not two: the seeded message, the
email subject, and the visible "Re: WL–NNNN" ref pill. It derives the piece from
`?piece=<slug>`, and also from a legacy `?license=<slug>` param that is
documented as still working.

The three inbound links are all built by `OrderCard`, which has the number, so
they gain `&plate=<n>`. Three requirements:

- **Validate the param.** It is attacker-controllable via a crafted link.
  Require an integer in `100..9099`; otherwise omit the plate entirely. Without
  this, `?plate=abc` renders `WL–NaN` in the pill, the message, and the email
  subject, and a shared link can display a fabricated plate number as official.
  React escapes the value so this is not XSS, but a fabricated official-looking
  reference is its own problem.
- **Degrade cleanly when absent.** Old links and the legacy `?license=` path
  cannot carry `&plate=`, and an empty pill renders a bold nothing and a stray
  separator. Omit the whole pill.
- Do not fetch. A round trip to resolve a slug on a contact form is not worth
  it for a reference label.

### New display surface: the wall hover caption

`.wl-wall-cap` is `opacity: 0`, revealed on `:hover` and `:focus-visible`,
already mono, uppercase, and letterspaced. It gains the plate number beside the
title.

Note for accuracy: an earlier draft justified covering every artwork by claiming
"nothing gives a wall-only piece a number anywhere it is seen." That is false.
`Lightbox.tsx` already renders one, and its data comes from the homepage wall
query, which filters on `on_wall` with **no status filter**, so draft and
wall-only pieces already display a plate number today. The conclusion still
holds (every artwork needs one), but the reason is that the lightbox already
demands it, not that the wall lacks it.

### The artwork page's `plate_idx`

`app/(shop)/shop/artwork/[slug]/page.tsx` currently computes
`ROW_NUMBER() OVER (ORDER BY a.display_order, a.id)` and renders "Plate 07 of
24" *alongside* the `WL–NNNN`. That window function goes away entirely, along
with the "of 24" denominator: a permanent number in a catalog with gaps cannot
honestly claim one.

**Known interaction with the ordering spec.** Ordering ships first and makes
`display_order` something Dan deliberately arranges, so between the two deploys
`plate_idx` will shift whenever he reorders the shop. It is already unstable
today (any new publish shifts it), so this is a widening of existing behavior
rather than a new class of problem, and this spec removes it. Accepted rather
than patched with a stopgap that would change the visible numbers twice.

### Admin

The artwork Edit page shows `plate_no` as a read-only field. Plate numbers do
**not** go on admin thumbnails: commits `1f23519` and `d67d411` deliberately
stripped names and prices off those tiles to quiet them.

## Consequences, stated plainly

- **Every existing piece gets a new number, once.** A piece showing `WL–4312`
  today becomes something else. Nothing durable stores the old value, verified:
  `order_items.artwork_snapshot` carries title, slug, and image only;
  `lib/email.ts` renders a "Plates" section label with no number; and the order
  page shows title only. The blast radius is bookmarks, screenshots, and the
  subject lines of contact emails already sent.
- **Gaps are permanent and correct.** Delete a plate and that number never
  returns. That is what makes it trustworthy.
- **Renames stop moving the number.** The old hash changed when a slug was
  renamed; the stored value does not. A strict improvement.
- **This is not part of the revertible surface.** Reverting the code would
  restore `plateNumber(slug)` and flip every public number a *second* time. The
  column is one-way from the moment it ships. Treat a rollback of this deploy as
  a decision to renumber again, not as a neutral undo.

## Verification approach

### Unit tests (vitest, `tests/lib/`)

- `formatPlate` padding across the range boundaries (`100`, `9099`).
- Contact-param validation: non-numeric, out of range, absent, all omitting the
  plate rather than rendering a partial.
- A TypeScript re-implementation of the permutation, asserting 9000 distinct
  values over draws 1..9000 and the collision at 9001. This documents the
  property; it does **not** test the SQL column default, which no test in this
  repo can reach.

### Manual, on the live deploy

1. Confirm the same number appears on the grid tile, the artwork page, the wall
   hover, the lightbox, the cart, and checkout for one piece.
2. Confirm a wall-only (unpublished) piece shows a number on hover and in the
   lightbox.
3. Add a piece to the cart, deploy, and confirm the pre-existing cart line
   renders without a stray separator.
4. Follow a `/contact?reason=commission&piece=…` link with and without `&plate=`
   and confirm both render sensibly.
5. Upload a new artwork and confirm it receives a number in range and unique.

### Gates

`npm run typecheck` and `npm test`. Making `plate_no` required on
`PlateCardData` and `WallItem` means typecheck is the enumeration mechanism for
the query changes; a green typecheck is meaningful evidence here, not a
formality.

## Pre-ship checks

- Confirm `SELECT COUNT(*) FROM artworks` is far below 9000 (the draw horizon).
- Snapshot is unnecessary for correctness (the column is additive and nothing
  reads it before the display swap), but take one anyway if this ships in the
  same window as the ordering backfill.

## Out of scope, follow-ups

- **A wider format** (`WL–NNNNN`) if the catalog ever approaches four figures.
  Deliberate decision, not a quiet modulus change.
- **Surfacing the plate number in emails or on the order page.** It is not there
  today, and adding it is a separate copy decision.
