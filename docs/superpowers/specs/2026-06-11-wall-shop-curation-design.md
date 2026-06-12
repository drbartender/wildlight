# Wall & shop curation — design

**Date:** 2026-06-11
**Status:** Approved (design); pending spec review
**Surfaces:** `/admin/wall` (admin), homepage vintage wall (public)

## Problem

Dan curates the homepage "vintage wall" from `/admin/wall`, but the tool can
only *reorder*. Three things are missing:

1. **Adding** images is possible (`/admin/artworks/bulk-upload`) but not
   reachable from where he curates.
2. **Deleting** unwanted images — there are many duplicate artwork rows (bulk
   upload mints a new row per file with no content de-dupe) — is only doable
   from the dense text-table Artworks list, requiring a title→list round-trip
   that's miserable when duplicates share near-identical titles.
3. **Wall membership and shop membership are tangled.** `status='published'`
   forces a piece *both* onto the wall *and* into the shop. There is no way to
   keep a sellable piece on the wall but out of the shop, or in the shop but
   off the wall.

## The model: two independent axes

A picture has two independent on/off states. Today `status` conflates them; the
two diagonal cells below are currently impossible:

| | **On the wall** | **Off the wall** |
|---|---|---|
| **In the shop** | published + on wall *(today's only "published")* | **in shop, off wall** ← new |
| **Not in the shop** | **on wall, not for sale** ← new | retired / hidden |

- **Wall axis** ← a new `artworks.on_wall` boolean. The homepage wall is driven
  purely by `on_wall = true`.
- **Shop axis** ← unchanged: `status='published' AND` a buyable variant. Toggled
  via the existing publish/retire mechanism, so order history is preserved and
  it is fully reversible.

A third, permanent action — **Delete** — stays for true junk/duplicates.

## Data model & migration

Add one column to `artworks`, mirroring the idempotent additive-column +
one-time backfill pattern already used for `published_at` (`lib/schema.sql`).

```sql
-- Wall membership — INDEPENDENT of shop status. The homepage wall is driven
-- purely by on_wall; this decouples "shown on the wall" from "for sale".
ALTER TABLE artworks
  ADD COLUMN IF NOT EXISTS on_wall BOOLEAN;

-- One-time backfill preserves today's behavior: everything currently on the
-- wall (draft OR published) starts on_wall=true; retired pieces start false.
-- Idempotent — only seeds rows never set; admin toggles write true/false and
-- are never reverted by a re-run (no row is NULL after the first apply).
UPDATE artworks
SET on_wall = (status <> 'retired')
WHERE on_wall IS NULL;

-- New rows land on the wall by default; enforce non-null now all rows are seeded.
ALTER TABLE artworks ALTER COLUMN on_wall SET DEFAULT true;
ALTER TABLE artworks ALTER COLUMN on_wall SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_artworks_on_wall ON artworks(on_wall) WHERE on_wall;
```

Order: add nullable → backfill `WHERE on_wall IS NULL` → set default → set
not-null. Every step is a no-op on re-run, so it is safe under the
"`schema.sql` runs on every build" model.

`ALTER COLUMN … SET NOT NULL` takes an `ACCESS EXCLUSIVE` lock and a full table
scan, but `artworks` is ~100 rows, so the lock is held sub-millisecond — a
non-issue here. *If* this table ever grows large, switch to the non-blocking
pattern (`ADD CONSTRAINT … CHECK (on_wall IS NOT NULL) NOT VALID` then
`VALIDATE CONSTRAINT`); it would be unjustified complexity at the current size.

## Query changes (public)

`app/(shop)/page.tsx` — homepage wall. Change the filter only:

```diff
- WHERE a.status IN ('draft', 'published')
+ WHERE a.on_wall AND a.image_web_url <> ''
```

The `available` computed column (`status='published' AND` buyable variant) is
**unchanged** — a piece that is `on_wall` but not published renders as a
look-only vintage example (no dot, no "See print options" link), which is
exactly the "on wall, not for sale" cell. The `image_web_url <> ''` guard is a
cheap defense against a mid-upload reserved row (empty URL) flashing onto the
highest-traffic page; ordering/LIMIT are unchanged.

## API changes

**No new endpoints.** Every action reuses existing routes:

- **Wall toggle** → `PATCH /api/admin/artworks/[id]` with `{ on_wall: boolean }`.
  Add `on_wall: z.boolean().optional()` to the `Patch` Zod schema; the route's
  generic column builder (`for (const [k, v] of Object.entries(d))`) then
  persists it. **Plus:** when the payload includes `on_wall`, the route resets
  `wall_order = 0` in the same `UPDATE`. Without this, a piece toggled off the
  wall keeps its old `wall_order`, and toggling it back on would resurface it
  *mid-wall* on the public homepage (which sorts by `wall_order`) even though
  the admin UI shows it appended at the end — a UI/DB divergence. Zeroing makes
  an off-then-on piece read as un-arranged (sorts to the end via `md5(slug)`)
  until the admin explicitly saves a new order. This is a small server-side
  special case in the route, not a free-form `wall_order` field on the schema.
- **Shop toggle** → `PATCH /api/admin/artworks/[id]` with
  `{ status: 'published' | 'retired' }` (already supported). Publishing routes
  through the existing `publishArtworks` gate (returns 409 "print master
  required" when a piece has no master) — so the Shop switch is only offered on
  shop-capable pieces (see below). Retiring is a plain status update.
- **Delete** → existing `DELETE /api/admin/artworks/[id]` (hard-deletes;
  returns 409 "retire instead" when a piece has non-canceled orders).
- **Reorder** → existing `POST /api/admin/wall` (writes `wall_order`),
  untouched.

## The wall tool (`/admin/wall`)

`app/admin/wall/page.tsx` loads the curation set in **one** query and partitions
it in memory, then passes both lists to `WallArranger`:

```sql
SELECT a.id, a.slug, a.title, a.image_web_url, a.status, a.on_wall, a.wall_order,
       (a.image_print_url IS NOT NULL AND a.image_print_url <> '') AS "canSell",
       (a.status = 'published'
          AND EXISTS (SELECT 1 FROM artwork_variants v
                        WHERE v.artwork_id = a.id AND v.buyable)) AS available
  FROM artworks a
 WHERE (a.on_wall OR a.status <> 'retired')
   AND a.image_web_url <> ''
 LIMIT 600
```

- **One query, not two.** Two parallel `pool.query` calls run on separate
  connections with no shared snapshot; a concurrent `on_wall` toggle between
  them could make a piece appear in *both* lists (React key collision) or
  *neither*. A single query is atomic and simpler.
- **Partition in JS:** `grid = rows.filter(r => r.on_wall)` sorted by
  `(wall_order=0), wall_order, md5(slug)`; `tray = rows.filter(r => !r.on_wall)`
  sorted by `updated_at DESC`. (Sort keys can be done in SQL or JS; the md5
  shuffle is cheap to replicate client-side or add as a select column.)
- **`WHERE on_wall OR status <> 'retired'`** keeps fully-dead pieces
  (retired *and* off-wall) out of the tray, so retiring a piece from the shop
  doesn't clutter the curation surface; it still surfaces a retired-but-`on_wall`
  piece on the grid (the "on wall, not for sale" cell). `image_web_url <> ''`
  drops mid-upload reserved rows, mirroring the homepage guard.

`canSell = image_print_url IS NOT NULL AND <> ''` decides whether the Shop
switch appears. Note this is intentionally *stricter* than the real
`publishArtworks` gate (which checks only `IS NOT NULL`): a transient reserved
row has `image_print_url = ''`, and we don't want to offer a Shop switch on it.
For every real piece the two conditions agree.

### Layout

```
┌ Arrange the wall ───────────────────  [Add photos]  [Reset] [Save order] ┐
│  On the wall — drag to reorder                                            │
│  ┌─────┐ ┌─────┐ ┌─────┐ ...    each tile: drag · ⟦Wall on⟧ ⟦Shop on/—⟧ · ✕ │
│  │ img │ │ img │ │ img │                                                  │
│  └─────┘ └─────┘ └─────┘                                                  │
│                                                                           │
│  Off the wall                                                             │
│  ┌─────┐ ┌─────┐                each card: [Put on wall] · ⟦Shop on/off⟧   │
│  │ img │ │ img │                                                          │
│  └─────┘ └─────┘                                                          │
│                                                                           │
│  [Remove 3 photos]   ← appears only when ≥1 tile is staged for delete     │
└───────────────────────────────────────────────────────────────────────── ┘
```

### Per-tile controls

- **Wall switch** (every tile). On the grid it reads ON; toggling OFF persists
  `on_wall=false` and the tile moves to the Off-the-wall tray. In the tray a
  **"Put on wall"** button persists `on_wall=true` and moves it into the grid
  (appended to the end). Optimistic + reversible.
- **Shop switch** (only when `canSell`). ON = published, OFF = retired; persists
  via the status PATCH. Hidden entirely on pieces with no print master (a
  low-res vintage scan can never be a product). The green "for sale" dot still
  reflects genuine buyability (published AND buyable variant), which is a
  superset condition of the switch — note in UI copy that the switch publishes
  the piece, and a piece with no priced variants will publish but not show a
  dot until variants exist.
- **Delete ✕** (**grid only**, and only on pieces **not** currently in the
  shop, i.e. `!available`). Staged, not instant: clicking dims the tile and
  shows **Undo**. A **"Remove N photos"** button commits the whole staged batch
  behind one inline themed confirm. For-sale pieces have no ✕ — they're guarded
  to the catalog, since deleting one would yank a sellable print out of the
  shop. The tray has **no** delete in v1 (it holds intentionally-hidden pieces);
  duplicates are caught and deleted on the grid, where they naturally start
  (`on_wall=true`). Deleting an off-wall piece is a catalog action.

### Three interaction models, kept separate

1. **Reorder** — drag, then explicit **Save order** (today's behavior).
2. **Toggles** (Wall, Shop) — **immediate & optimistic**: one PATCH each,
   reversible, low-risk. No staging.
3. **Delete** — **staged + confirmed batch**: destructive and permanent, so it
   never rides on the reorder save and always takes an explicit confirm.

This separation is deliberate: a mis-drag can never delete, and a delete never
silently reorders.

## State model & snapshot maintenance

`WallArranger` already tracks order-dirtiness against a saved snapshot
(`savedTiles`/`savedKey`). Extend:

- `grid: WallTile[]`, `tray: WallTile[]` — the two sections.
- `pendingRemoval: Set<number>` — tiles staged for delete (grid only).
- `removeState: 'idle' | 'confirming' | 'removing' | 'error'` plus a list of
  per-id failures.

Rules that keep the order-dirty signal honest:

- A tile **leaving the grid** (delete committed, or Wall→off) is dropped from
  **both** the live grid and the saved snapshot, so it does not read as a
  reorder.
- A tile **entering the grid** (Wall→on from the tray) is appended to **both**
  live and saved, so merely re-adding doesn't mark the order dirty; only a
  subsequent drag does. The Wall toggle's server-side `wall_order = 0` reset
  (see API section) guarantees its DB `wall_order` is actually 0, so the
  homepage sorts it to the end via `md5(slug)` — matching its on-screen
  position. (Without that reset a re-added piece would jump mid-wall on the
  public page; that's the BLOCKER the reset closes.)

To keep these transforms unit-testable, factor the pure
set/section/snapshot operations into `lib/wall-arrange.ts`
(e.g. `removeTiles`, `moveToTray`, `moveToGrid`, `isOrderDirty`) and have the
component call them.

## Error handling & edge cases

- **Optimistic toggle fails** → revert the tile to its prior section and show a
  transient error; no data lost.
- **Delete batch, partial failure** — runs per-id (`Promise.allSettled`).
  Successes leave the grid; failures stay put with an inline reason
  (e.g. a piece that unexpectedly has order history → 409 "manage in Catalog").
- **Publish gate** — toggling Shop ON on a piece whose master is missing/just
  cleared returns 409; surface inline ("needs a print master") and leave the
  switch OFF. (The `canSell` gate makes this rare.)
- **Empty states** — no off-wall pieces ⇒ the tray section is hidden entirely;
  no staged tiles ⇒ no "Remove N" button.

## Accessibility

- Switches are real `<button role="switch" aria-checked>` (or labeled
  checkboxes), each with `aria-label` naming the piece and axis
  ("Show {title} on the wall").
- Delete ✕ is a labeled button ("Remove {title}"); Undo and the batch
  confirm are keyboard-operable and focus-managed.
- **Focus on section move.** Toggling Wall (or "Put on wall") unmounts the tile
  from one section and remounts it in the other, which drops keyboard focus to
  `<body>`. The component must move focus deliberately — focus the control's
  equivalent in the destination (or a visually-hidden `aria-live` status that
  announces "Moved to the tray / Put on the wall") — so a keyboard/SR user
  isn't dumped to the top of the page after every toggle.
- DnD keyboard a11y remains the pre-existing follow-up (unchanged here).

## Testing & verification

- **Unit (Vitest, `tests/lib/`)** — cover `lib/wall-arrange.ts`: removal drops
  from both snapshots, tray↔grid moves, dirty recompute, append-doesn't-dirty.
- **Manual e2e** (per repo convention — UI/DB paths aren't unit-tested):
  1. Toggle a draft Wall→off → leaves homepage wall; reverse → returns.
  2. Toggle a published piece Wall→off → stays in `/shop`, gone from wall
     ("in shop, off wall").
  3. Retire a published piece (Shop→off) while on_wall=true → gone from `/shop`,
     still on wall with no dot ("on wall, not for sale").
  4. Stage 3 duplicates → Undo one → commit → 2 rows deleted, homepage updates.
  5. Confirm a for-sale tile has no ✕; confirm a low-res draft has no Shop
     switch.
  6. Migration: backfill leaves the current wall visually identical on first
     deploy.

## Out of scope (follow-ups, not built)

- Content-level de-dupe at upload time to stop *new* duplicates appearing.
- Reaping orphaned R2 files after a hard delete (existing
  `bulk-upload/cleanup-orphans` path covers this).
- Tray filtering/search if off-wall volume ever grows large.
- Touch-drag reordering and DnD keyboard a11y (pre-existing).

## File touch list

- `lib/schema.sql` — `on_wall` column, backfill, index.
- `app/(shop)/page.tsx` — homepage wall `WHERE` clause.
- `app/admin/wall/page.tsx` — single partition query (grid + tray) selecting
  `status`, `on_wall`, `wall_order`, `canSell`, `available`.
- `app/api/admin/artworks/[id]/route.ts` — `on_wall` in the `Patch` schema +
  reset `wall_order = 0` when `on_wall` is in the payload.
- `components/admin/WallArranger.tsx` — grid + tray + switches + staged delete +
  Add-photos link.
- `lib/wall-arrange.ts` — new, pure transforms (+ `tests/lib/wall-arrange.test.ts`).
- `app/admin/admin.css` (the `.wl-adm-wall*` block, ~line 1504) — switches,
  tray, staged/Undo, confirm bar, sr-only live region.

## Review pass (2026-06-11, Gemini, read-only)

Hardened after an independent spec review:

- **Adopted** — server-side `wall_order = 0` reset on `on_wall` toggle (fixes a
  re-add resurfacing mid-wall); single partition query for the admin page
  (fixes a two-query toggle race, keeps dead pieces out of the tray); explicit
  `status`/`on_wall`/`canSell` columns; focus management on grid↔tray moves.
- **Considered, not adopted** — rewriting `SET NOT NULL` as a `NOT VALID` CHECK
  to avoid an `ACCESS EXCLUSIVE` lock: justified only on large tables;
  `artworks` is ~100 rows, so it'd be needless complexity. Recorded the pattern
  for if the table ever grows.
- **Confirmed clean** — no new endpoints; `requireAdmin` + `requireSameOrigin`
  already guard every mutating path (toggle/publish/retire/delete/reorder); no
  key-name injection risk in the generic PATCH builder (columns come from a
  fixed Zod schema, not user keys).
```

