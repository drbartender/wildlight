# Limited Editions (SP#6)

**Date:** 2026-04-28
**Status:** Ready for plan
**Sub-project of:** `2026-04-27-wildlight-com-rebuild-overview.md` (#6)
**Depends on:** SP#1 shop migration (already shipped). All schema hooks are pre-existing.

## Goal

Enable limited-edition prints in the shop. When an artwork has a non-null `edition_size`, render edition badges on the storefront ("Edition of 25", "Signed by the artist"), prevent purchase once the edition has sold out, and let admin set both fields on the artwork edit page. The `subscriber_early_access_until` column added in SP#4 stays in the schema as the hook for the future subscriber-only gating; SP#6 v1 does not implement that gate.

## Non-goals (v1 — pragmatic cuts)

- **No per-print edition number assignment.** v1 displays "Edition of 25" — not "1 of 25". Per-order numbering would require a migration on `order_items` plus a transactional sequence; deferred.
- **No subscriber early-access gate.** The `artwork_variants.subscriber_early_access_until` column exists from SP#4 but the storefront and checkout don't yet check it. v2.
- **No artist proofs / AP markings.** Just edition + signed.
- **No certificate of authenticity PDF.** A printable cert with the edition number, artist signature, and a hash is a nice future-V2 add; v1 ships without.
- **No "edition sold out" email to a waitlist.** No waitlist either.
- **No newsletter "feature this edition" composer block.** SP#4's "start from journal entry" picker already lets Dan compose a newsletter that mentions a print drop; a structured edition block is deferred.

The cuts hold because v1's job is "make this artwork visibly a limited edition and stop selling it once it's sold out." The complexity (per-print numbering, gating) is feature-by-feature opt-in for the future.

## Source of truth

- `artworks.edition_size INT` — already exists from Phase 1 monetization spec. Null means open edition (current default).
- `artwork_variants.subscriber_early_access_until TIMESTAMPTZ` — added in SP#4. Reserved for v2.
- `order_items` table — used to count "how many prints of this artwork have shipped" via existing JOIN to orders + variants.
- `app/(shop)/shop/artwork/[slug]/page.tsx` — public artwork detail; the badge renders here.
- `app/admin/artworks/[id]/page.tsx` — admin edit page; the Artwork interface already has `edition_size: number | null`. Add an input.
- `app/api/admin/artworks/[id]/route.ts` PATCH — already accepts `edition_size` in its zod schema (per the existing code I read in SP#3 prep).

## Architecture

### Schema

One ALTER TABLE — adds `signed BOOLEAN` to artworks, default false:

```sql
ALTER TABLE artworks
  ADD COLUMN IF NOT EXISTS signed BOOLEAN NOT NULL DEFAULT FALSE;
```

No new tables, no new indexes.

### Sold-out logic

A variant of an edition-bounded artwork is "sold out" when the count of completed (non-canceled, non-refunded) order_items that reference any variant of that artwork meets or exceeds `edition_size`.

Count query (used by both the storefront artwork page and the checkout-time guard):

```sql
SELECT COUNT(oi.id)::int AS sold
FROM order_items oi
JOIN artwork_variants v ON v.id = oi.variant_id
JOIN orders o ON o.id = oi.order_id
WHERE v.artwork_id = $1
  AND o.status NOT IN ('canceled', 'refunded')
```

Place this count in a small helper at `lib/editions.ts`:

```ts
export interface EditionStatus {
  isLimited: boolean;       // artwork has non-null edition_size
  editionSize: number | null;
  signed: boolean;
  soldCount: number;        // 0 when not limited
  remaining: number | null; // null when not limited
  soldOut: boolean;         // true when isLimited && soldCount >= editionSize
}

export async function getEditionStatus(artworkId: number): Promise<EditionStatus>;
```

The helper is called by:
1. `app/(shop)/shop/artwork/[slug]/page.tsx` — render badge + decide whether to render the "Add to cart" button.
2. `app/api/checkout/route.ts` — guard against the race where two simultaneous buyers could push a variant past sold-out.

### Storefront badge

On the artwork detail page, when `isLimited === true`:

- Above the title (or as part of the existing eyebrow): a small block:
  - Line 1: `Edition of NN` (zero-padded if size ≤ 99, otherwise `Edition of N,NNN`).
  - Line 2 (optional, if `signed`): `Signed by the artist`.
  - Line 3 (status): `12 remaining` while not sold out, or `Sold out` when reached.

When sold out, the variant chooser + "Add to cart" button are replaced with a quiet `Sold out — thank you` block. The page still renders all the artwork info — readers can browse, just not buy. A "Notify me of new releases" link points to the existing newsletter signup.

### Checkout-time guard

`app/api/checkout/route.ts` already validates that all line items resolve to active variants. After that resolution, for each line item whose `artwork.edition_size` is non-null, fetch the current sold count and reject the checkout if `soldCount + lineQty > editionSize`. Returns the existing `400` shape with a clearer error: `"<Artwork title>" sold out — please pick another.`

This guard is the safety net. It runs server-side before Stripe session creation, so a stale storefront page that says "1 remaining" can't push the edition over by 2.

### Admin edit page

`app/admin/artworks/[id]/page.tsx` — add two new inputs in the artwork-meta column near the existing year/location/note fields:

- **Edition size** (number input, nullable; empty = open edition; positive integer = limited).
- **Signed by artist** (checkbox).

Both fields PATCH via the existing endpoint. The endpoint's zod schema already accepts `edition_size`; add `signed: z.boolean().optional()`.

### Sold-count badge in admin

In the admin artwork list (`/admin/artworks`), edition-bounded rows get a small badge in the existing status column or alongside it: `12/25 sold` or `Sold out`. Skip if the existing list doesn't have a column to put it in cleanly — defer to a future polish pass.

For v1, the artwork edit page itself shows the count (read-only, just below the edition_size input):

> *12 of 25 sold. 13 remaining.*

## URL surface

No new routes. Modifies:

- `app/(shop)/shop/artwork/[slug]/page.tsx` — render badge + sold-out state.
- `app/admin/artworks/[id]/page.tsx` — edition_size + signed inputs + sold-count display.
- `app/api/admin/artworks/[id]/route.ts` PATCH — accept `signed` in zod.
- `app/api/checkout/route.ts` — sold-count guard.

## Done criteria

- [ ] `signed BOOLEAN NOT NULL DEFAULT FALSE` added to `artworks`.
- [ ] `lib/editions.ts:getEditionStatus(artworkId)` returns the documented shape.
- [ ] Storefront artwork page shows badge when `edition_size != null`.
- [ ] Storefront shows "Sold out" state with no buy button when count ≥ size.
- [ ] Checkout API rejects requests that would push past edition size.
- [ ] Admin artwork edit page has both inputs and shows sold count.
- [ ] PATCH endpoint accepts `signed` boolean.
- [ ] `npm run typecheck && npm test` pass.

## Open questions resolved

- **Per-print numbering**: deferred to v2.
- **Subscriber-only gating**: deferred to v2 (column exists, no logic).
- **Artist proofs**: not in v1.
- **Certificate of authenticity**: not in v1.
- **Waitlist for sold-out editions**: not in v1; existing newsletter is the funnel.
- **Edition_size on variants vs artworks**: artwork-level (existing schema). All sizes of a print share the edition cap.

## Open questions for the implementation plan

- Confirm the existing PATCH endpoint zod schema location and add `signed` cleanly.
- Decide whether the sold-out variant chooser shows a disabled Add-to-Cart with tooltip, or replaces the chooser entirely with the "Sold out" block. (Spec says: replace.)
- The badge typography/placement — either hardcoded inline styles or new CSS classes. The plan picks CSS classes for consistency with the rest of the storefront.
