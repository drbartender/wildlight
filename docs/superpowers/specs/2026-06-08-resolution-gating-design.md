# Resolution-aware print sizing — design spec

**Date:** 2026-06-08
**Status:** Approved by user, awaiting implementation plan.
**Builds on:**
[`2026-04-26-print-master-required-design.md`](2026-04-26-print-master-required-design.md)
(the print-master-as-source-of-truth flow this extends) and the existing
advisory classifier `lib/print-resolution.ts`.

## Problem

Every published artwork currently offers the full size ladder — 8×10
through 24×36 paper/canvas/framed and 24×30 metal — regardless of how
much resolution its print master actually has. One flat template
(`applyTemplate`) turns on every size.

The catalog audit (2026-06-06/08) showed this is not theoretical:

- Of ~100 artworks, most masters are 12–16 MP — crisp to 16×20, soft at
  24×36 (≈119–136 DPI).
- Several published, **buyable-right-now** pieces are far worse:
  *Gulls at Dusk* is **0.8 MP (1050×720)** and *Sail Against the Sun* is
  **2.5 MP (1925×1280)** — yet both are sold up to 24×36 and 24×30 metal.
  A customer can order a poster-size print of a web thumbnail.
- One master (*Egret, Lifting Off*, id 198) references an R2 key that
  does not exist — a dangling print file.

We already **measure** (dims captured at upload) and **classify**
(`classifyPrintResolution`) — but the signal is advisory. Nothing stops
a soft size from being offered or sold.

## What this is (and isn't)

A system that lets each file's resolution decide which print sizes it is
offered at, automatically, with a deliberate per-size override.

Decisions locked during brainstorming:

1. **Enforce, don't just advise.** A size the file can't support is not
   buyable — not greyed out, not warned about: absent from the shop.
2. **Per-artwork, per-size override.** Dan can knowingly re-enable a
   blocked size. Override is the exception, not the workflow.
3. **Legibility is first-class.** Every blocked size carries its reason
   in plain language with the numbers ("24×36 needs 3600px short edge at
   150 DPI; file has 720px — supports up to 8×10"). Attempting a blocked
   action returns a real error explaining why.
4. **Single universal floor: 150 DPI**, stored as a named constant
   (`MIN_DPI`, already in `lib/print-resolution.ts`). Per-material floors
   and a DB-editable floor are out of scope (see below).
5. **Customers see only supported sizes.** No "available up to 16×20"
   messaging, no disabled buttons. All diagnostics live in the admin.
6. **Upload decides the options.** On master upload the supported sizes
   are auto-selected (offered); under-res sizes come pre-switched-off
   with their reason. Dan does zero per-size picking unless he overrides.

## Architectural invariant (new)

**A size is buyable iff `active AND (resolution passes the floor OR Dan
overrode it)`.** This is expressed once, as a generated column, and every
surface (shop, collections, artwork page, checkout, Printful sync) reads
that one column. No call site re-implements the gate.

## Data model

Three additions to `artwork_variants` (currently: `id, artwork_id,
printful_sync_variant_id, type, size, finish, price_cents, cost_cents,
active, created_at`).

| Column | Type | Meaning |
|---|---|---|
| `min_resolution_ok` | `BOOLEAN` (nullable) | Does the master clear the floor at *this* size? Written only by the recompute function. `NULL` = not yet measured. |
| `resolution_override` | `BOOLEAN NOT NULL DEFAULT FALSE` | Dan force-offers this size despite low resolution. |
| `buyable` | `BOOLEAN GENERATED ALWAYS AS (...) STORED` | Derived gate read everywhere. |

Generated expression:

```sql
buyable BOOLEAN GENERATED ALWAYS AS (
  active AND (min_resolution_ok IS NOT FALSE OR resolution_override)
) STORED
```

`min_resolution_ok IS NOT FALSE` is true for both `TRUE` and `NULL`, so
an unmeasured variant stays buyable (**fail-open on unknown**) — turning
the system on can never silently delist a file we haven't looked at yet.
Only an explicit `FALSE` (measured and under-floor) blocks, and an
override always wins.

Index:

```sql
CREATE INDEX IF NOT EXISTS idx_variants_artwork_buyable
  ON artwork_variants(artwork_id) WHERE buyable;
```

The existing `idx_variants_artwork_active` stays (admin still reads
`active`).

`active`, `resolution_override`, and `price_cents`/`cost_cents` are
unchanged in meaning. Re-uploading a worse master flips some
`min_resolution_ok` to `FALSE`; a previously-set `resolution_override`
persists (override means "always offer," independent of the file).
**Persistence has one seam:** re-applying a template *replaces* the
variant rows, so the recompute-chokepoint at that branch must carry
`resolution_override` + `active` forward onto the matching
`(type, size, finish)` rows — otherwise overrides silently reset. See the
recompute-chokepoints table.

## The per-size rule

Required short-edge pixels for a size = `shortEdgeInches × MIN_DPI`.
Short-edge inches are parsed from the size label (`"24x36"` →
`min(24,36) = 24`), so no separate size→inches map is maintained.

- 8×10 → 8" → 1200px
- 12×16 → 12" → 1800px
- 16×20 → 16" → 2400px
- 18×24 → 18" → 2700px
- 24×30 → 24" → 3600px
- 24×36 → 24" → 3600px

`min_resolution_ok = min(print_width, print_height) >= shortEdgeInches × MIN_DPI`.

Short edge governs because the print is matched short-edge to short-edge;
this is the conservative measure on the un-cropped master. (Printful crops
to the product aspect at fulfillment; aspect-crop-aware DPI is out of
scope — short-edge gating is strictly safe.)

## Lib changes

### `lib/print-resolution.ts` (extend)

Add a pure per-size evaluator alongside the existing whole-file
classifier:

```ts
export interface SizeResolution {
  size: string;
  shortInches: number;
  requiredShortPx: number;   // shortInches × MIN_DPI
  actualShortPx: number;     // min(width, height)
  effectiveDpi: number;      // round(actualShortPx / shortInches)
  ok: boolean;               // actualShortPx >= requiredShortPx
  message: string;           // legible reason, with the numbers
}

export function evaluateSizeResolution(
  width: number,
  height: number,
  size: string,
  floorDpi = MIN_DPI,
): SizeResolution;

// Largest offered size whose short edge the file still clears, for the
// "supports up to N" summary. Pure; takes the catalog's size list.
export function maxSupportedSize(
  width: number,
  height: number,
  sizes: string[],
  floorDpi = MIN_DPI,
): string | null;
```

`MIN_DPI` (150) is the gate. `GOOD_DPI` (240) stays as the advisory
"great vs. usable" band shown in admin copy — it does not gate.

### `lib/variant-resolution.ts` (new) — the recompute chokepoint

```ts
// Single writer of min_resolution_ok. Mirrors lib/publish-artworks.ts:
// caller owns the transaction (pass a PoolClient mid-transaction).
export async function refreshVariantResolution(
  client: PoolClient,
  artworkId: number,
): Promise<void>;
```

Loads the artwork's `print_width`/`print_height` and its variants, then
for each variant `UPDATE … SET min_resolution_ok = <evaluator.ok>` (or
`NULL` when dims are `NULL`). `buyable` updates itself via the generated
column. No-op-safe to call repeatedly.

## Recompute chokepoints

`refreshVariantResolution(client, artworkId)` runs at every point where
its inputs (the master's dims, or the variant set) change. Override and
per-size `active` toggles do **not** trigger it — they write their own
column and `buyable` re-derives automatically.

| Trigger | Where | Note |
|---|---|---|
| Master uploaded (dims written) | `app/api/admin/artworks/bulk-upload/finalize/route.ts` (update + create modes) | The dims write at lines 242–251 is a bare `pool.query` today; wrap it + the recompute in `withTransaction`, and have `refreshVariantResolution` read the dims through that **same client** (else it reads stale dims). |
| Print master re-pointed | `app/api/admin/artworks/[id]/route.ts` PATCH when `image_print_url` changes | This route can set `image_print_url` (Zod field, line 65) **without** re-measuring — today it would leave `print_width`/`print_height` stale. The PATCH must re-measure dims from the new key (sharp) then recompute, **or** master changes are funnelled exclusively through `finalize`. Decide in the plan; do not leave a path that changes the master without re-measuring. |
| Template (re)applied | `app/api/admin/artworks/[id]/route.ts` (`applyTemplate` branch, lines 123–137) | This branch sets old rows `active = FALSE` and **inserts new rows** with `resolution_override = FALSE`/`active = TRUE` defaults — so it would silently wipe any override. The branch must **carry forward** `resolution_override` and per-size `active` onto matching `(type, size, finish)` rows before recompute. |
| Dims backfilled | `scripts/backfill-print-dims.ts` (after each row's dims write) | |
| Floor changed | one-off `scripts/recompute-variant-resolution.ts` (run after editing `MIN_DPI`) | |

`app/api/admin/artworks/upload/route.ts` is **not** a trigger — it inserts
only a draft `artworks` row, never variants, so a recompute there is a
no-op.

## Enforcement points (read sites switched `active` → `buyable`)

All four customer-reachable surfaces plus Printful sync:

- `app/(shop)/shop/page.tsx` — min-price subquery.
- `app/(shop)/shop/collections/[slug]/page.tsx` — min-price subquery.
- `app/(shop)/shop/artwork/[slug]/page.tsx` — the offered-variants query
  (`WHERE artwork_id = $1 AND active`) and the min-price subquery.
- `app/api/checkout/route.ts` — variant lookup (`WHERE v.id = ANY(...)
  AND v.active AND a.status='published'`). Add an explicit error when a
  requested variant is non-buyable: *"that size isn't available for this
  piece."*
- `lib/printful-sync.ts` — only buyable variants are synced to Printful
  (no point provisioning a size we won't sell; an overridden size *is*
  buyable, so it still syncs).

`app/api/admin/artworks/route.ts` (admin list): the `variant_count`,
`min_price_cents`, AND `max_price_cents` subqueries (lines 44–48) all
currently filter `v.active`. Switch **all three** to `buyable` together —
switching only the price range leaves a broken "8 variants, no price"
range on an all-blocked artwork (the *Gulls* case, which is exactly what
this feature surfaces). The list also gains a resolution badge from a new
aggregate subquery (see Admin surfaces). `app/admin/artworks/[id]/page.tsx:151`
computes an `activeVariants` count for display — relabel/derive it from
`buyable` so the detail header doesn't contradict the shop.
(`scripts/find-variants.mjs` also filters `active`, but it's an untracked
debug script — out of scope.)

Defense in depth: the shop never renders a blocked size, *and* checkout
re-validates against `buyable`, *and* only buyable variants ever reach
Printful. A stale link or hand-crafted cart cannot purchase a soft size.
Historical orders are untouched (`order_items` reference `variant_id` and
a checkout-time snapshot; `buyable` has no effect on them).

## Admin surfaces

### Artwork detail (`app/admin/artworks/[id]/page.tsx`)

A size panel rendered from each variant's `min_resolution_ok`,
`resolution_override`, `active`, and the evaluator output, with the
master's dimensions and the floor in the header:

```
Master: 1050×720 (0.8 MP)              Floor: 150 DPI
 ✗ 8×10      90 DPI   blocked — needs 1200px, file has 720px   [ Override ]
 ✗ 12×16     60 DPI   blocked — needs 1800px, file has 720px   [ Override ]
 ✗ 16×20     45 DPI   blocked — needs 2400px, file has 720px   [ Override ]
 ✗ 24×36     30 DPI   blocked — needs 3600px, file has 720px   [ Override ]
 ⚠ No size meets the 150-DPI floor — re-upload a larger master, or override.
```

(For a partially-supported file like *Cake Alley* — 2578×1627, short edge
1627px — 8×10 clears at 203 DPI and everything above 8×10 blocks, so the
panel shows one ✓ and the rest ✗ with a "supports up to 8×10" summary.)

- `[Override]` flips `resolution_override = TRUE` for that variant via a
  confirm dialog that shows the numbers (deliberate act).
- A supported size can be switched off (sets `active = FALSE`) when Dan
  simply doesn't want to sell it — orthogonal to resolution.
- `NULL` dims render as "not measured yet."

### Artwork list (`app/admin/artworks/page.tsx`)

Per-row badge derived from the variants' resolution state:
`24×36 ✓` (clears top size) · `⚠ max 16×20` · `⚠ blocked` (no size
clears the floor) · `— unmeasured`.

### Variant PATCH endpoint

A small admin route to set `resolution_override` and/or `active` on a
single variant (`requireAdmin()`, validates the variant belongs to the
artwork). Writes the column; `buyable` re-derives; no recompute needed.

## Rollout (ordered, reversible)

1. **Migrate columns** — `ADD COLUMN IF NOT EXISTS` for
   `min_resolution_ok`, `resolution_override`, and the generated
   `buyable` + index, in `lib/migrate.ts`. All `min_resolution_ok` start
   `NULL`, so `buyable ≡ active` — **zero behavior change** at this step.
   (The table is ~1k rows; the STORED-generated-column rewrite is
   trivial.)
2. **Switch read sites** `active` → `buyable`. Still no behavior change
   (everything `NULL`/fail-open).
3. **Measure stragglers** — run `npm run backfill:print-dims` to fill the
   27 unmeasured masters (incl. 8 published). R2 creds now wired locally.
4. **Dry-run** — `scripts/recompute-variant-resolution.ts --dry-run`
   prints every size that *would* go dark. Dan reviews.
5. **Apply** — `--apply` writes `min_resolution_ok` for all variants.
   Enforcement engages: under-res sizes drop from the shop, reasons show
   in admin.

Revert at any point = switch the filter back to `active`; all data
preserved.

**Expected impact at step 4** (short-edge gate at 150 DPI):
*Gulls at Dusk* (720px short edge) clears nothing — even 8×10 needs
1200px — so it goes dark until re-upload or override. *Sail Against the
Sun* (1280px) → 8×10 only. *Cake Alley* (1627px) → 8×10 only.
*Heart, Sunset* (2160px) → up to 12×16. The other four live pieces
(*Marina City*, *18th & Vine*, *Liberty Memorial*, *Don't Give Up*) clear
every size. *Egret, Lifting Off* surfaces as "master missing" (dangling
R2 key) — a draft, no customer impact.

(These per-piece caps are slightly stricter than the 2026-06-06 audit
table, which used a long-edge÷36 proxy; the gate uses the more correct
short-edge÷size-inches metric. The dry-run script reports the real
numbers before anything is applied.)

## Edge cases & error handling

- **Unmeasured variant (`NULL` dims).** Fail-open: stays buyable, admin
  shows "not measured." Resolved by the backfill at rollout; only
  transient thereafter (upload always measures).
- **Re-upload a better master.** Recompute flips qualifying sizes back to
  `TRUE`; they return to the shop automatically. Overrides persist.
- **Re-upload a worse master.** Sizes that no longer qualify go `FALSE`
  and drop — unless overridden (override is file-independent).
- **Override of an extreme file** (e.g. *Gulls* at 24×36, 48 DPI). Allowed
  by design; the confirm dialog shows the brutal numbers. No hard floor on
  override — Dan asked for the override to always be available.
- **Dangling master** (*Egret*). Dims stay `NULL`, never measured; admin
  badge shows unmeasured/missing. Re-upload is the fix; not automated.
- **Checkout against a now-blocked variant** (stale tab). `buyable`
  filter drops it; explicit "size isn't available" error rather than a
  silent count mismatch.

## Out of scope

- **DB-editable floor / per-material floors.** `MIN_DPI` stays a constant;
  splitting metal vs. canvas vs. paper is a later config layer. The
  evaluator already takes `floorDpi`, so it is a drop-in extension.
- **AI upscaling** of weak masters.
- **Customer-facing "why."** Decided against — shoppers see only
  supported sizes.
- **Aspect-crop-aware DPI.** Short-edge gating is strictly safe; modeling
  Printful's per-product crop is unnecessary precision.
- **Automatic re-shoot/re-upload tracking** for weak pieces. The admin
  badge surfaces them; acting is manual.

## Testing

- **Vitest unit** (extends `tests/lib/print-resolution.test.ts`):
  `evaluateSizeResolution` — required pixels, `ok` boundary at exactly
  the floor, the reason string, and `maxSupportedSize` across a size
  list; plus the `NULL`-dims path producing `min_resolution_ok = NULL`.
- **Manual end-to-end** (per CLAUDE.md — checkout/R2 aren't unit-covered):
  1. Upload a low-res master → under-res sizes auto-block in admin; shop
     shows only supported sizes.
  2. Override a blocked size → it appears in the shop and survives a
     checkout.
  3. Attempt to buy a blocked size via a stale variant id → rejected with
     the explicit error.
  4. Re-upload a hi-res master to the same artwork → blocked sizes return
     automatically; overrides persist.

## Risks

- **Generated-column migration rewrite.** Negligible at ~1k rows; the
  `IS NOT FALSE`/`OR` expression is immutable and references only
  same-row columns, which `STORED GENERATED` requires.
- **Fail-open window.** Between steps 1–2 and step 5, unmeasured variants
  remain buyable. Acceptable: the backfill at step 3 closes it, and the
  state matches today's (everything buyable) until we deliberately apply.
- **Read-site drift.** Mitigated by funneling every surface through the
  single `buyable` column; the customer-facing switch list above is
  exhaustive (verified by `grep v.active` / `AND active` —
  `shop/page.tsx:37`, `artwork/[slug]/page.tsx:98,106`,
  `collections/[slug]/page.tsx:40`, `checkout/route.ts:56`,
  `printful-sync.ts:41`; admin reads handled separately above).

## Spec-review resolutions (grounding / gaps / risk, 2026-06-08)

Findings from the DRB spec-review trio, folded in. The chokepoint table,
the data-model persistence note, and the admin-list enforcement note above
were corrected directly; the rest are resolved here.

**Lib hardening (`lib/print-resolution.ts`, `lib/variant-resolution.ts`):**
- `MIN_DPI` and `GOOD_DPI` are currently un-`export`ed `const`s
  (`print-resolution.ts:9-10`). Add `export` so the evaluator, the
  recompute, and `classifyPrintResolution` share one source for the floor.
- **Size-label parsing is strict.** Parse short edge with
  `/^(\d+)x(\d+)$/` → `min(w, h)`. A label that doesn't match (a future
  `"8.5x11"`, `"A3"`, or finish-suffixed label) is **not** silently graded
  `FALSE` (which would dark-list a size with a nonsense "0px" reason) —
  it logs a warning and the variant's `min_resolution_ok` is left `NULL`
  (fail-open) for a human to look at.
- `evaluateSizeResolution` guards `NULL`/missing dims explicitly: returns
  an "unmeasured" result (drives `min_resolution_ok = NULL`), it does not
  assume `width: number`.
- `refreshVariantResolution(client, artworkId)` reads the artwork's
  `print_width`/`print_height` through the **passed `client`**, so a dims
  write earlier in the same transaction is visible (no stale-dims read).

**Variant override/active endpoint:** `PATCH
/api/admin/artworks/[id]/variants/[variantId]`. `requireAdmin()` +
`requireSameOrigin()` + Zod, matching every other admin mutation. The
IDOR guard is part of the write: `UPDATE … WHERE id = $variantId AND
artwork_id = $artworkId` (scoped, not SELECT-then-UPDATE). Body toggles
`resolution_override` and/or `active`. The admin panel must offer both
**set and unset** ("Override" ⇄ "Remove override"); `buyable` re-derives
with no recompute.

**Printful sync timing (important workflow seam):** a variant that was
blocked has no `printful_sync_variant_id`. Overriding it makes it
`buyable`, but a checkout will still drop to `needs_review` (the existing
"sync variant missing" branch in the Stripe webhook) until
`npm run sync:printful <id>` stamps the id. The override flow in the admin
must say so — overriding a blocked size is a two-step act (override → sync)
before it can be sold.

**Zero-buyable published artwork (the *Gulls* case):** when every size
blocks, the shop artwork page falls through to the existing
`variants.length === 0` branch in `OrderCard` — whose copy today reads
"Not yet for sale / editions coming," which is misleading. Fix the copy
to a neutral "Prints currently unavailable for this piece." The shop grid
min-price subquery (now `buyable`) yields no price for it, so it reads as
not-for-sale there too. **Product decision (confirm):** an all-blocked
*published* artwork stays listed (image visible, no buy options) rather
than being auto-hidden — Dan resolves it from the dry-run (re-upload /
override / unpublish) at rollout, so this is a transient state, not a
steady one.

**Admin-list badge data source:** the list endpoint adds an aggregate —
`bool_and(min_resolution_ok IS NOT FALSE)` for the clean/blocked state and
a `max`-supported-size rollup — so the badge (`24×36 ✓` / `⚠ max 16×20` /
`⚠ blocked` / `— unmeasured`) has data without an N+1.

**Migration idempotency:** the new columns, the generated `buyable`
column, and the index go in `lib/schema.sql`'s idempotent block (no new
migration-file pattern) as `ADD COLUMN IF NOT EXISTS`. Postgres rejects
redefining a generated column, so the add is guarded by `IF NOT EXISTS`
and never re-expressed in place; a real expression change is a deliberate
drop-and-readd. `idx_variants_artwork_active` stays (admin still toggles
and reads `active` directly).

**Observability (`lib/logger.ts` + `admin_audit_log` if present):** the
recompute logs how many variants flipped `TRUE`/`FALSE`/unchanged per
artwork; the override/active PATCH writes an audit entry (who, which
variant, old→new); the dry-run writes a reviewable report (MD/CSV table,
same shape as the 2026-06-06 audit) so "why did this size disappear" is
answerable later.

**In-flight payment at the apply instant (accepted):** the checkout
snapshot (`checkout_intents`) is the contract; the Stripe webhook
fulfills from it and does **not** re-check `buyable`. A customer who paid
in the seconds before step 5 gets their print fulfilled at the honored
price. This is the correct outcome (we took their money) and needs no
re-validation in the webhook — stated so the engineer doesn't add one.

**Checkout error nuance:** today `checkout/route.ts:65-67` rejects the
whole cart with a generic "some items unavailable" when any variant fails
the `active`/`published` filter. To give the friendlier "that size isn't
available for this piece," the lookup drops the `buyable` filter from the
SELECT and branches in code (buyable vs unpublished vs missing) — noted as
non-trivial, not a one-liner.

**Backfill resumability:** `scripts/backfill-print-dims.ts` already
commits per row and selects only `WHERE print_width IS NULL`, so a partial
run resumes cleanly; the recompute script reads dims from the **DB
column, not R2**, so the apply step can't crash on an R2 timeout.
