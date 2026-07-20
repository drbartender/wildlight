# Wall & Shop admin redesign — design

**Date:** 2026-07-19
**Status:** Design. Not yet built.
**Surfaces:** `/admin/wall` (admin; route unchanged, nav relabeled "Wall & shop").
Homepage vintage wall and `/shop` are read-only consumers, unchanged.
**Design source:** `Wall and shop admin confusion.zip` on the winshare
(claude.ai/design export): `Wall Admin - Current.dc.html` (today's tool) and
`Wall & Shop - Redesign.dc.html` (the target).

## Problem

The current `/admin/wall` tool ("Arrange wall") confuses Dan. It presents one
grid of on-wall photos plus an "Off the wall" tray, with a Wall switch and a
Shop switch riding on every tile, and a delete ✕ on some. Three things blur
together:

1. **"On the wall" is the frame for everything.** The wall is treated as the
   home for a photo, so a photo that is for sale but not on the wall lives in a
   secondary "tray," and a photo that is neither on the wall nor in the shop has
   nowhere obvious to be. There is no single place that answers "where does this
   photo actually live."
2. **The shop is invisible as a place.** Shop membership is only a per-tile
   switch. Nothing on the screen shows "here is exactly what customers can buy,"
   which is the thing Dan most wants to see and control.
3. **Delete sits next to hide.** A destructive, permanent ✕ sits inches from the
   reversible Wall switch, so "take it off the wall" and "destroy it forever"
   look like neighbors.

The underlying data model is already right (wall membership and shop membership
are independent axes; see `2026-06-11-wall-shop-curation-design.md`). This is a
presentation problem, so this is a front-end redesign, not a data change.

## The model: one Library, two shelves

Reframe the screen around where a photo lives:

- **The Library** (the base) holds **every** photo, always. A photo never leaves
  the Library. This is the answer to "where does this photo live": here.
- **The Wall** (a shelf) is the homepage gallery. A photo is placed on it, or
  not. Backed by `artworks.on_wall`.
- **The Shop** (a shelf) is what customers can buy. A photo is placed in it, or
  not. Backed by `status = 'published'` (plus a buyable variant to actually
  transact, surfaced as a badge, see below).

A photo can be on the Wall, in the Shop, both, or neither (Library-only). You
place a photo by dragging it up from the Library onto a shelf, or by flipping
its Wall / Shop toggle in the Library. Taking a photo off a shelf never deletes
it: it simply becomes Library-only again. **Delete lives only in the Library**,
double-confirmed, and means "destroy this photo everywhere, forever."

This maps one-to-one onto axes that already exist:

| Concept in the UI | Backing state | Already exists |
|---|---|---|
| In the Library | any `artworks` row with `image_web_url <> ''` | yes |
| On the Wall | `on_wall = true` | yes (`on_wall` column) |
| In the Shop | `status = 'published'` | yes (publish/retire) |
| `hd` (sellable) | `image_print_url` present | yes |
| Buyable (real green-light) | published AND a buyable variant | yes (`available`) |
| Wall order | `wall_order` | yes |

Because editing (titles, pricing, print-file upload, AI draft, bulk upload)
stays on the existing **Artworks** screen, the Library grid is a **placement +
delete** surface only. Each Library tile carries a small **"Edit ↗"** link that
deep-links to `/admin/artworks/[id]`; there is no in-place editor here, so the
two screens cannot drift.

## Data & the loader query

No schema change. No endpoint change. The only server-side change is the
read-only loader in `app/admin/wall/page.tsx`, which must broaden from today's
curated subset to **every** photo (the Library shows everything, including
retired and never-placed pieces), and must carry the two fields the shelves
need: `hd` and a shop price.

```sql
SELECT a.id, a.slug, a.title, a.image_web_url, a.status, a.on_wall,
       a.wall_order, a.updated_at::text AS updated_at, md5(a.slug) AS slug_hash,
       (a.image_print_url IS NOT NULL AND a.image_print_url <> '') AS hd,
       EXISTS (SELECT 1 FROM artwork_variants v
                 WHERE v.artwork_id = a.id AND v.buyable) AS buyable,
       (SELECT MIN(v.price_cents) FROM artwork_variants v
          WHERE v.artwork_id = a.id AND v.buyable) AS price_from_cents
  FROM artworks a
 WHERE a.image_web_url <> ''
 ORDER BY a.updated_at DESC
 LIMIT 1000
```

- `WHERE image_web_url <> ''` still drops mid-upload reserved rows (empty web
  URL) so a half-uploaded piece never flashes into the Library, matching the
  homepage and current-tool guards.
- Dropping the old `(on_wall OR status <> 'retired')` filter is the point: the
  Library must show retired and unplaced pieces so Dan can re-place or delete
  them. In the old model those were "dead"; in the Library model they are simply
  Library-only.
- `hd` here mirrors the old `canSell` (stricter than the publish gate's
  `IS NOT NULL`, so a transient reserved row with `image_print_url = ''` reads
  as non-`hd` and gets no Shop affordance).
- `buyable` mirrors the old `available` (published AND a buyable variant). Used
  only for the "hidden — sizes blocked" badge on Shop tiles.
- `price_from_cents` is the lowest buyable-variant price, formatted through
  `lib/money.ts` (never inline). Null when nothing is buyable, rendered as "—".
- `updated_at DESC` puts freshly uploaded photos at the top of the Library,
  where placement usually happens. The Wall shelf re-sorts its own subset
  client-side (see state model), so the Library sort does not affect it.
- `slug_hash` (= `md5(slug)`) is returned so the client can reproduce the
  homepage's stable shuffle for never-arranged (`wall_order = 0`) Wall pieces
  without hashing in JS. This keeps the admin Wall order identical to the public
  homepage order.
- `LIMIT 1000` is far above today's ~100 rows. Pagination / lazy-loading the
  Library is a follow-up if the catalog ever approaches that cap; called out in
  Out of scope. The `try/catch` fail-soft (render an empty screen on a Neon
  cold-start blip, not a 500) is preserved.

## Screen layout

```
┌ Wall & shop ─────────────────────────────────  [Add photos] ┐  (existing topbar)
│                                                              │
│  ⓘ  Every photo lives in the Library. Drag one up onto the   │  hint banner
│     Wall or the Shop, or use its toggles. Removing from a    │  (dismissible,
│     shelf never deletes it. Only hd photos can go in the     │  localStorage)
│     Shop.                                          [Dismiss] │
│                                                              │
│  ┌ The Wall  homepage gallery · N ───── order saved ✓ ─┐ ┌ The Shop  for sale · M ┐
│  │ [⌄]  drag to reorder — saves automatically          │ │ [⌄] exactly what        │
│  │  ┌───┐┌───┐┌───┐┌───┐   each tile: pos · title ·     │ │     customers can buy   │
│  │  │ 1 ││ 2 ││ 3 ││ 4 │   [Remove]                     │ │  ┌───┐┌───┐  price ·    │
│  │  └───┘└───┘└───┘└───┘                                │ │  │   ││   │  [Remove]   │
│  └─────────────────────────────────────────────────────┘ │  └───┘└───┘             │
│                                                           └────────────────────────┘
│  ┌ Library  every photo · T ─────  [All][On wall][In shop][Unplaced][No print file] ┐
│  │  Photos never leave the Library — drag onto a shelf, or use Wall / Shop toggles.  │
│  │  ✕ deletes the photo everywhere, forever.                                         │
│  │  ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐   each tile: hd|web-only badge · ✕(delete) ·       │
│  │  │hd │ │web│ │hd │ │hd │ │hd │   title · [Wall] [Shop] toggles · Edit ↗           │
│  │  └───┘ └───┘ └───┘ └───┘ └───┘                                                    │
│  └───────────────────────────────────────────────────────────────────────────────── ┘
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **Two shelves side by side** on wide viewports (`grid-template-columns: 3fr 2fr`,
  Wall wider), **stacked** on narrow viewports and whenever either shelf is
  minimized. Each shelf has a chevron to minimize (collapse to just its header +
  count), so Dan can focus on one job at a time. No user-facing density / layout
  knobs (the mockup's `tileMin` / `layout` props are design-tool controls); tile
  min-width is a fixed ~150px via `repeat(auto-fill, minmax(150px, 1fr))`.
- **Hint banner** explains the model in one sentence. Dismissal persists in
  `localStorage` (`wl-wall-hints-dismissed`) so it stays gone across sessions.
- **Library filters** are a segmented control (existing `.wl-adm-seg`): All /
  On wall / In shop / Unplaced / No print file, each with a live count. Counts
  and filtering are derived client-side from the single photos array.
- **Empty states**: an empty Wall or Shop shelf shows a dashed drop-zone prompt
  ("Drag photos here from the Library…"). Styling uses existing `--adm-*` tokens;
  the mockup is nearly all inline styles over those tokens, so little or no new
  CSS is needed (verified: `--adm-card`, `--adm-rule`, `--adm-amber*`,
  `--adm-green*`, `.wl-adm-topbar`, `.wl-adm-btn`, `.wl-adm-seg` all exist).

## Interactions

### Placing a photo (Library → shelf)

Two equivalent paths, both immediate and optimistic:

- **Drag** a Library tile up onto the Wall or Shop shelf and drop. The Library
  tile is the drag source and is **not** moved during the drag (placement flips
  a flag; the photo stays in the Library), so the shelf's `onDrop` fires
  reliably. While dragging over a shelf, the shelf border turns green if the
  drop is allowed, red if not (a non-`hd` photo over the Shop).
- **Toggle** the Wall or Shop pill on the Library tile.

Placing on the Wall → `PATCH /api/admin/artworks/[id]` with `{ on_wall: true }`
(the route also resets `wall_order = 0`, so a re-added photo sorts to the end of
the public wall, not mid-wall on a stale order). Placing in the Shop →
`PATCH … { status: 'published' }`, which routes through the existing
`publishArtworks` gate.

### Wall reordering (auto-save)

Drag to reorder within the Wall shelf. Reordering is **live** on `dragEnter`
(the tiles rearrange as you drag) and **commits on `dragEnd`**: if the order
changed, fire `POST /api/admin/wall` with the new id sequence and flash
"order saved ✓". There is no Save / Reset button and no persistent dirty state
(a deliberate departure from today's explicit Save; approved 2026-07-19).

Reordering is low-stakes and trivially reversible (drag it back). The commit is
keyed off `dragEnd`, which always fires, never off a `drop` event (see DnD
invariant below).

### Removing from a shelf (never deletes)

Each Wall and Shop tile has an inline **Remove** button that requires one
in-tile confirm (the label flips to "Sure — remove?"). Removing from the Wall →
`PATCH … { on_wall: false }`. Removing from the Shop → `PATCH … { status:
'retired' }`. Either way the photo stays in the Library (its toggle simply reads
off), so nothing is lost. Optimistic, reverts on failure.

### Deleting (Library only, double-confirmed)

The ✕ lives only on Library tiles. It is a two-step confirm: click once (label
flips to "Delete forever?"), click again to get a final native `confirm()`
naming the photo, then `DELETE /api/admin/artworks/[id]`. On success the photo
leaves the Library, the Wall, and the Shop at once.

The existing DELETE endpoint returns **409** when the piece has non-canceled
orders ("Cannot delete: artwork has sold orders. Retire it instead…") or on any
FK reference. This must be surfaced inline on the tile, not swallowed: a sold
piece cannot be deleted, only retired. (The mockup deletes freely; the real
implementation must keep and show this guard.)

### Shop HD gating

Only `hd` photos (those with a print file) can enter the Shop:

- A non-`hd` Library tile's Shop toggle is `disabled` with a tooltip ("Needs a
  print file (HD master) before it can be sold"). Its badge reads `web only`.
- Dragging a non-`hd` photo over the Shop shelf shows a red (rejected) border
  and, on drop, an inline shelf error rather than a placement.
- Even for an `hd` photo, `publishArtworks` can still 409 ("cannot publish:
  print master required") if the master was cleared between load and click; that
  409 is surfaced inline and the toggle stays off. The `hd` gate makes this rare.
- A published photo with a master but no buyable variant is genuinely in the
  Shop (`status='published'`) but not transactable. Its Shop tile shows an amber
  **"hidden — sizes blocked"** badge and no price. This reuses `buyable`
  (resolution-gated variants, see `2026-06-08-resolution-gating-design.md`); the
  redesign only surfaces the state, it does not change gating.

## Persistence & optimism

Every mutation reuses the existing endpoints and the current WallArranger
patterns (`patchArtwork`, `saveOrder`, the DELETE call), unchanged on the
server:

- All four mutating paths (`on_wall` toggle, publish/retire, reorder, delete)
  already enforce `requireAdmin` + `requireSameOrigin`. No new endpoints, no
  auth surface added.
- Toggles and removes are **optimistic and serialized**: one in-flight mutation
  at a time (today's `inFlight` guard), controls disabled while it round-trips,
  and a failed mutation reverts the tile to its prior state with a transient
  inline error. Because the Library, Wall, and Shop all derive from one photos
  array plus one `wallIds` list, a single state update reflects everywhere (the
  Library toggle and the shelf tile can never disagree).
- The reorder POST fires at most once per completed drag. `POST /api/admin/wall`
  requires a non-empty id list; removing the last Wall photo is a `PATCH`
  (`on_wall=false`), not a reorder, so an empty-array POST never happens.

## DnD architecture and the Chromium no-drop invariant

Two distinct drag mechanisms coexist, and the split matters (we were bitten
before by committing reorders off a `drop` event that never fired when the
source node moved; see `reference-chromium-drag-no-drop`).

- **Library → shelf (placement):** the drag source (a Library tile) is **not**
  removed or moved during the drag, so the target shelf's `onDrop` fires
  normally. Commit on drop is correct here.
- **Wall reorder:** the dragged tile **is** re-inserted among its siblings as
  you drag (live reorder on `dragEnter`), so a `drop` on the moved node would
  never fire. Commit is therefore keyed off **`dragEnd`** (always fires) with an
  order-snapshot diff, never off `drop`. No `drop`-keyed commit anywhere in the
  reorder path.

Stating the invariant plainly: **placement commits on `drop`; reorder commits on
`dragEnd`.** Do not cross them.

Touch: HTML5 DnD does not fire on touch, so on touch devices placement happens
via the Wall / Shop **toggles** (fully functional) and only reordering is
unavailable. Touch reordering (and DnD keyboard a11y) remain the pre-existing
follow-up, not regressed by this change and partly mitigated by toggles being
the primary placement path.

## State model & pure helpers

Single source of truth in the component:

- `photos: LibraryPhoto[]` — every loaded row (the Library).
- `wallIds: number[]` — ordered ids of the Wall shelf.
- `filter`, `drag` (`{ id, from: 'lib' | 'wall' }`), `dropTarget`, `confirm`
  (`{ kind: 'wall' | 'shop' | 'del', id }`), `wallSaved`, per-shelf `min`,
  `inFlight`, transient errors.

Derived each render: Wall = `wallIds.map(byId)`; Shop = `photos.filter(inShop)`
in loader order (`updated_at DESC`; the Shop is not reorderable in v1); filter
counts; the filtered Library list.

Factor the pure, testable operations into `lib/wall-arrange.ts` (rewriting its
current grid/tray helpers for the Library model), so the component only wires
them to state + fetch:

- `deriveWallIds(photos)` — initial `wallIds` from `on_wall` rows sorted by
  `(wall_order = 0)`, `wall_order`, then `slug_hash` (the loader's `md5(slug)`),
  matching the homepage sort so the admin order equals the public order.
- `reorder(wallIds, dragId, overId)` — pure splice used by the live `dragEnter`.
- `place(photos, id, shelf, on)` / `remove` — flip `on_wall` / `inShop` on the
  photo and maintain `wallIds`.
- `filterCounts(photos)` and `applyFilter(photos, key)`.
- `orderChanged(before, after)` — the `dragEnd` diff.

Keep the type names aligned with the new model (`LibraryPhoto` replacing the
old `WallTile`; `inShop` derived from `status === 'published'`).

## Accessibility

- Wall / Shop pills are real `<button role="switch" aria-checked>` with an
  `aria-label` naming the photo and axis ("Put {title} up for sale").
- Delete ✕ and the inline Remove are labeled buttons; the two-step confirms are
  keyboard-operable and focus-managed.
- Because the Library tile is the stable home and never unmounts on
  place/remove (only the shelf copy appears or disappears), there is far less
  focus disruption than today's grid↔tray unmount. Still, moving a photo onto or
  off a shelf should announce via a visually-hidden `aria-live` region
  ("Placed on the Wall" / "Removed from the Shop").
- Shelf drop zones carry an accessible label; the drag-only reorder keeps the
  pre-existing keyboard-DnD follow-up.

## Error handling & edge cases

- **Optimistic mutation fails** → revert the photo's flag / order and show a
  transient inline error; nothing lost.
- **Delete 409 (sold / referenced)** → inline "has sold orders, retire instead";
  the photo stays.
- **Publish 409 (master missing)** → inline "needs a print file"; Shop toggle
  stays off.
- **Reject non-hd drop on Shop** → red border while dragging, inline error on
  drop, no state change.
- **Neon cold-start on load** → fail-soft empty screen (existing try/catch).
- **Empty shelves** → dashed drop-zone prompt; **empty Library** → a short "no
  photos yet — Add photos" prompt.

## Testing & verification

- **Unit (Vitest, `tests/lib/wall-arrange.test.ts`)** — rewrite for the new
  helpers: `deriveWallIds` ordering matches the homepage sort; `reorder` splices
  correctly; `place`/`remove` keep `wallIds` and `inShop` consistent;
  `filterCounts` and `applyFilter`; `orderChanged` true only on a real move.
- **Manual e2e** (DnD / publish / delete are not unit-tested, per repo
  convention):
  1. Drag a `web only` photo from the Library onto the Wall → appears on the
     Wall, homepage wall updates; Shop toggle on it is disabled.
  2. Drag an `hd` photo onto the Shop → published, shows in `/shop`; a published
     piece with no buyable variant shows "hidden — sizes blocked" and no price.
  3. Drag a non-hd photo onto the Shop → red border, rejected, inline error.
  4. Reorder the Wall, release → "order saved ✓", reload → order persists and
     matches the public homepage order.
  5. Remove from Wall and from Shop → photo remains in the Library with toggles
     off; homepage / shop update.
  6. Delete a never-sold photo (two-step + native confirm) → gone from Library,
     Wall, Shop. Attempt to delete a sold photo → inline 409, still present.
  7. Filters (All / On wall / In shop / Unplaced / No print file) show correct
     counts and subsets; minimize each shelf; dismiss the hint and reload
     (stays dismissed).
  8. "Edit ↗" opens `/admin/artworks/[id]`.
- `npm run typecheck` and `npm test` green; `CI=true` production build.

## Out of scope (follow-ups, not built)

- Library pagination / lazy load (only needed if the catalog approaches the
  1000-row cap; ~100 today).
- Reordering the Shop shelf (v1 Shop is a read-only "what's for sale" view;
  order is `display_order`/title).
- Touch-drag reordering and DnD keyboard a11y (pre-existing; placement via
  toggles already works on touch).
- In-place metadata/pricing editing (stays on Artworks by design; this screen
  links out).
- Content-level de-dupe at upload time and R2 orphan reaping (pre-existing
  follow-ups from the curation spec).

## File touch list

- `app/admin/wall/page.tsx` — broaden the loader to all photos; add `hd`,
  `buyable`, `price_from_cents`; sort `updated_at DESC`; keep the fail-soft.
- `components/admin/WallArranger.tsx` — rewrite to the Library + two-shelves UI
  (drag placement, auto-save reorder, inline remove, Library-only delete,
  filters, collapsible shelves, hint banner, Edit ↗ link). Reuse the existing
  `patchArtwork` / `saveOrder` / DELETE fetch helpers and the `inFlight`
  serialization.
- `lib/wall-arrange.ts` — replace grid/tray helpers with the Library-model pure
  helpers and types above (+ rewritten `tests/lib/wall-arrange.test.ts`).
- `app/admin/admin.css` — only if a shelf/badge style can't be expressed with
  existing `--adm-*` tokens; expected to be minimal.
- Admin sidebar (`app/admin/layout.tsx` or the sidebar component) — relabel the
  nav item "Arrange wall" → "Wall & shop". Route stays `/admin/wall`. Update the
  page `metadata.title` to "Wall & shop · Wildlight admin".

## Explicitly unchanged (do not touch)

- Every mutating endpoint: `PATCH`/`DELETE /api/admin/artworks/[id]`,
  `POST /api/admin/wall`. No signature or behavior change; this redesign only
  changes which of them the UI calls and when.
- The `artworks` schema, `on_wall` / `wall_order` semantics, the publish gate,
  resolution gating, and the homepage / `/shop` queries.
