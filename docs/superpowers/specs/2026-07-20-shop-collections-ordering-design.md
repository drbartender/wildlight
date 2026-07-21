# Shop Collections Ordering and Plate Numbers (Design Spec)

Date: 2026-07-20
Status: approved, not yet planned

## Context

The Wall & Shop admin page (`/admin/wall`, `components/admin/WallArranger.tsx`)
has three panes: the Wall, the Shop, and the Library. The Wall shelf is fully
arrangeable (drag to reorder, click a position badge to move a photo to a typed
slot, auto-save on `dragEnd`). The Shop shelf is not. It renders
`photos.filter(isInShop)` in whatever order the loader returned, with no filter
and no reorder.

Three facts about the current data model drive this design:

1. **`artworks.display_order` is a single global column.** It orders the public
   `/shop` grid, every collection page, the portfolio, and the related rail on
   artwork detail pages. There is no per-collection ordering, so a collection
   cannot read differently from the global sequence.

2. **`collections` already has everything it needs.** `collections.display_order`
   exists, and `/admin/collections` already arranges it with drag, an explicit
   Save order, and Reset. Collection assignment (`artworks.collection_id`,
   nullable) is already editable from the artwork Edit page.

3. **Collections are nearly invisible on the storefront.** The main nav is
   Gallery, Shop, Events, Portraits, Journal, Studio. There is no Collections
   link and no Portfolio link. Every inbound link to `/shop/collections` is
   downstream of already finding a photo (cart empty state, checkout, order
   page, artwork breadcrumb) or is in the footer. `/portfolio` has exactly one
   inbound link, from the bottom of `/about`.

Additionally, `/shop` is capped at `LIMIT 12` with no way to change it, and its
header reads "Index of plates" beside a count of *every* published work rather
than the twelve actually shown.

## Goals

1. Filter the admin Shop shelf by All, by collection, or by Unfiled.
2. Drag-reorder within the active filter, using the Wall's interaction model.
3. Keep the All order independent of every per-collection order.
4. Make the `/shop` cap an editable setting with a visible cut line in the admin.
5. Give collections one genuine entry point from `/shop`.
6. Give every artwork a permanent plate number, including wall-only pieces.

## Non-goals

- Collection assignment stays on the artwork Edit page. No dropdown on shop
  thumbnails.
- No collection filter chips on the public `/shop`. The All-versus-collection
  choice stays navigational (`/shop` versus `/shop/collections/[slug]`).
- The `/portfolio` versus `/shop/collections` duplication is not resolved here.
  See Out of scope.

## 1. Data model

### Unchanged

- `collections.display_order` remains the collection order, arranged at
  `/admin/collections`. No work.
- `artworks.collection_id` remains the assignment, edited only from the artwork
  Edit page.

### Repurposed

- `artworks.display_order` becomes **the All order**, explicitly. It already
  drives `/shop`; it has simply never been something anyone deliberately
  arranged.

### New

```sql
-- Position within the row's own collection. Meaningful ONLY relative to
-- collection_id. One column suffices because an artwork belongs to exactly one
-- collection; a join table would model a many-to-many that does not exist.
ALTER TABLE artworks
  ADD COLUMN IF NOT EXISTS collection_order INT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_artworks_collection_order
  ON artworks(collection_id, collection_order);

-- Generic key/value settings. There is no settings store in the repo today
-- (the Settings page is account, env masks, and integration health only).
-- Generic so the next small setting does not need another migration.
CREATE TABLE IF NOT EXISTS site_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO site_settings (key, value) VALUES ('shop_index_limit', '12')
  ON CONFLICT (key) DO NOTHING;
```

Seeding `shop_index_limit` to `12` preserves current behavior exactly, so the
deploy changes nothing until Dan changes it.

### Backfill

Both orders are densified from what is on screen today, so nothing reshuffles on
deploy.

**Published rows only.** This is the subtle part. Every public consumer of both
orders filters to `status='published'`, so only published rows have a position
that means anything. If the backfill ranked *all* rows, existing drafts would be
handed positions interleaved among the published ones, and publishing a draft
later would drop it into the middle of the sequence (potentially above the cut
line, displacing something) instead of appending it. Leaving non-published rows
at `0` is what makes append-on-entry work, because `0` is the sentinel meaning
"never placed".

**One-time, guarded by a marker.** Migrations re-run on every build
(`npm run build` is `tsx lib/migrate.ts && next build`), and a densify that
re-ran on every deploy would fight the append rule: a piece published at
position `MAX+1` would be silently re-ranked on the next deploy. The marker
makes it run exactly once.

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM site_settings WHERE key = 'shop_order_backfilled')
  THEN
    -- Per-collection order, seeded from the sequence visitors already see.
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (
               PARTITION BY collection_id ORDER BY display_order, id
             ) AS ord
      FROM artworks
      WHERE collection_id IS NOT NULL AND status = 'published'
    )
    UPDATE artworks a SET collection_order = r.ord FROM ranked r WHERE a.id = r.id;

    -- All order, densified. Rows still at the 0 default currently fall through
    -- to id order; this writes that order down instead of leaving it implicit.
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY display_order, id) AS ord
      FROM artworks WHERE status = 'published'
    )
    UPDATE artworks a SET display_order = r.ord FROM ranked r WHERE a.id = r.id;

    INSERT INTO site_settings (key, value) VALUES ('shop_order_backfilled', '1');
  END IF;
END $$;
```

Non-published rows keep whatever `display_order` they already carry. That is
harmless (nothing reads it) but it does mean the sentinel is not universally
`0` for legacy drafts, which the append rule handles explicitly below.

### Append-to-end, enforced server-side

Both orders assign `MAX + 1` on entry, inside the existing artwork PATCH
transaction (`app/api/admin/artworks/[id]/route.ts`) and the bulk publish path
(`app/api/admin/artworks/route.ts`, via `lib/publish-artworks.ts`):

- **On publish**, if the row's `display_order` is `0` **or collides with an
  already-published row's position**, set it to `MAX(display_order) + 1` over
  published rows. The collision clause covers legacy drafts that carried a
  stale non-zero `display_order` from before the backfill; without it such a
  piece would publish into the middle of the sequence.
- **On publish**, if `collection_id` is not null and `collection_order` is `0`,
  set it to `MAX(collection_order) + 1` within that collection.
- **On `collection_id` change** (any status), set
  `collection_order = MAX(collection_order) + 1` within the new collection.

This must live server-side, not in the client. A photo published from the bulk
endpoint or from its Edit page would otherwise keep `display_order = 0`, which
sorts it to the **front** of `/shop`, above the cut line, displacing whatever Dan
put in slot one. That is the exact surprise append-to-end exists to prevent.

A piece that is retired and later re-published keeps its existing
`display_order` and returns to its old slot. Append-to-end is for pieces that
never had a place, not for ones coming back.

## 2. Admin UI (the Shop shelf)

### Loader

`app/admin/wall/page.tsx` currently returns one `LibraryPhoto[]`. It gains:

- `collection_id`, `collection_order`, and `display_order` on each photo, plus
  the collection's title for the read-only tile label.
- A second query for the collections list (id, title, in `display_order`), which
  drives the filter tray even for collections with zero shop members.
- A third for `shop_index_limit` from `site_settings`.

All three keep the existing fail-soft behavior: a Neon cold-start blip renders
an empty screen, not a 500.

### Filter tray

The Shop shelf head gets a segmented control, reusing the `.wl-adm-seg`
component the Library filters already use:

```
All (n) · <each collection, in collections.display_order> (n) · Unfiled (n)
```

It wraps rather than scrolls. If the chapter count outgrows a couple of rows,
this becomes a `<select>`, but chips are correct for the handful of collections
that exist.

The active filter persists to `localStorage` alongside the existing
`wl-wall-min` pane state. Every "Edit" is a round trip out of the page and back,
and losing your place on return was already fixed once here for pane state.

### Scope determines which order you are editing

- **All** writes `display_order`.
- **A collection** writes `collection_order` for that collection only.
- **Unfiled** writes nothing (see below).

The two never write each other. Moving a photo to slot 1 of a collection does
nothing to where it sits on `/shop`.

### Reorder interaction

Mirror the Wall exactly:

- `dragEnter` live-reorders local state.
- `dragEnd` auto-saves the whole scope order.
- Each tile gains the position badge: click the number, type a position, Enter.

The position badge is not optional garnish. The Shop shelf sits in the same
height-capped band as the Wall, and `dragEnter` can never fire on a tile clipped
out of view, so without it a photo cannot move more than about a row, and there
is no keyboard path at all. This is documented in the Wall's own code comments
and applies identically here.

**The commit fires on `dragEnd`, never `drop`.** Chromium does not deliver a
`drop` event when the drag source node was moved mid-drag, which a live reorder
always does. `/admin/collections` sidesteps the same trap with an explicit Save
button. Do not "clean this up" to a drop-keyed commit.

All mutations run behind the existing `inFlight` gate, with the existing 30s
abort, timeout-reconcile-by-reload, and stale-row 404 handling.

### The cut line

Drawn in the **All** view only, after the Nth tile. Everything below it is
subdued and labeled as not appearing on `/shop`.

It counts **buyable tiles only**, skipping the ones badged "hidden, no sizes
available", because the public query filters unbuyable rows out *before* it
applies the limit. Counting all tiles would let Dan arrange twelve and see nine.

Not shown in collection views or Unfiled. The cut governs `/shop` alone.

### The limit control

A number field in the All view head: "Show the first N on /shop." `0` means no
limit, labeled as such on the field. A real unlimited matters so `/shop` cannot
start silently truncating years from now as the catalog grows past whatever
number was typed today.

### Tile changes

Each tile in the **All** view shows its collection name as a small read-only
label, "unfiled" when it has none. Not a control. It lets Dan see the chapter
mix while arranging the front page without flipping filters.

Plate numbers do **not** go on admin thumbnails. Commits `1f23519` and `d67d411`
deliberately stripped names and prices off those tiles to quiet them; adding a
number back would undo that.

### Unfiled is a worklist, not an arrangement surface

Drag is disabled and position badges are hidden. There is no "unfiled order" to
save, and dragging within a partial view of the All order is genuinely
ambiguous: dropping A above B when six other photos sit between them in the full
order has no single correct answer. Tiles keep their Edit link, which is where
assignment happens, and the empty state says so.

## 3. Public surfaces

### Collection order, three query changes

Switch `ORDER BY a.display_order, a.id` to `ORDER BY a.collection_order, a.id`:

- `app/(shop)/shop/collections/[slug]/page.tsx`, the chapter grid.
- `app/(shop)/portfolio/[slug]/page.tsx`, the same collection without the
  buyability filter.
- `app/(shop)/shop/artwork/[slug]/page.tsx`, the related rail (4 pieces from the
  same chapter).

One sequence per collection, honored everywhere that collection appears. The
portfolio shows the whole sequence; the shop collection page shows the same
sequence with unbuyable pieces skipped.

The two collection *index* pages (`/shop/collections`, `/portfolio`) already sort
by `collections.display_order` and need no change.

### All order

`app/(shop)/shop/page.tsx` reads `shop_index_limit` from `site_settings` and
applies it: `ORDER BY a.display_order, a.id LIMIT <n>`, with no LIMIT clause at
all when the setting is `0`. This is a third query on a page that already runs
two in parallel.

### `/shop` header

- "Index of plates" becomes **"Selected works"**.
- The count beside it changes from every published work to the number actually
  in the grid.
- The masthead's "Plates on file 024" keeps counting the whole archive, which is
  where a total belongs.

### Browse by collection band

A new band on `/shop`, **below** the Selected works grid, listing chapters in
`collections.display_order`, each linking to its collection page. Reuses the
chapter-row treatment already built for `/shop/collections`.

Below rather than above because the curated selection is the thing Dan arranged
and it should lead. The band is the way deeper once a visitor wants more than
the selection.

This is the piece that makes both orders visible to a visitor at all. Without
it, collections remain reachable only from the footer or from downstream of an
artwork the visitor already found.

### Revalidation

These pages are `revalidate = 60`. A limit or order change will not appear on
the live site for up to a minute. That is existing behavior for every other
edit, so it stays, but it reads as "the save did not work" if you do not know.

## 4. API contracts

### `POST /api/admin/shop/order` (new)

```
{ scope: 'all', ids: number[] }
{ scope: 'collection', collectionId: number, ids: number[] }
```

One atomic statement, the same shape `/api/admin/wall` and the collections
reorder already use, so a partial failure cannot leave a mix of old and new
positions:

```sql
UPDATE artworks a
   SET display_order = v.ord            -- or collection_order
  FROM (SELECT id, ord FROM unnest($1::int[]) WITH ORDINALITY AS t(id, ord)) v
 WHERE a.id = v.id
   AND a.collection_id = $2;            -- collection scope ONLY
```

Zod-validated with the duplicate-id refinement the collections route already
carries, plus a length cap. `requireAdmin` and `requireSameOrigin`, matching the
artwork routes.

**The scope guard is load-bearing.** When the scope is a collection, the UPDATE
must also filter `AND a.collection_id = $collectionId`. Without it, a stale
client holding an old id list can renumber rows in a collection it is not even
looking at. The wall endpoint does not need this because it has a single global
scope; this endpoint has many, so the constraint belongs in the SQL rather than
being assumed from the client's payload.

### `PATCH /api/admin/settings` (new)

Writes `shop_index_limit`. Integer, `0` to a sane ceiling (500) so a typo cannot
ask the page for fifty thousand rows. Same auth as above.

## 5. Plate numbers

### The column

```sql
CREATE SEQUENCE IF NOT EXISTS artworks_plate_no_seq;
ALTER TABLE artworks
  ADD COLUMN IF NOT EXISTS plate_no INT;
ALTER TABLE artworks
  ALTER COLUMN plate_no SET DEFAULT nextval('artworks_plate_no_seq');
```

Assigned once at creation, never rewritten, on **every** artwork regardless of
status or wall membership. A wall-only piece gets a number the same as a piece
for sale. A `UNIQUE` constraint is added after the backfill.

### Why a sequence, not MAX + 1

Bulk upload inserts many rows at once, and `MAX(plate_no) + 1` in application
code races itself under concurrent inserts, handing two photos the same number.
A sequence is concurrency-safe and never reuses a number, which is exactly the
semantics an accession number wants.

It also means **none of the three insert sites need to change**
(`app/api/admin/artworks/upload/route.ts`,
`app/api/admin/artworks/bulk-upload/finalize/route.ts`,
`scripts/import-manifest.ts`). The column default does the work.

### Backfill

Assign in `id` order, which is creation order, then `setval` the sequence past
the high-water mark, then add `UNIQUE` and `NOT NULL`. Both constraints go on
after the backfill, never before, or the migration fails on the first existing
row.

Creation order is the honest basis: a plate number records when a piece entered
the catalog, not where it currently sits in an arrangement. Deliberately **not**
seeded from `display_order`, which would bake today's arrangement into a number
meant to outlive arrangements.

### Display

Zero-padded to three digits, matching the site's existing habit
(`Plates on file 024`, `CH · 01`).

- `app/(shop)/shop/artwork/[slug]/page.tsx` drops the
  `ROW_NUMBER() OVER (ORDER BY a.display_order, a.id)` plate_idx entirely and
  prints the stored number. "of 24" goes away: a permanent number in a catalog
  with gaps cannot honestly claim a denominator.
- `components/site/VintageWall.tsx` adds the number beside the title in
  `.wl-wall-cap`, the hover/focus caption that is already mono, uppercase, and
  letterspaced. No new UI, no permanent stamp on the frame.
- `components/site/Lightbox.tsx` adds the number to the caption block.

Both wall surfaces need `plate_no` selected in the homepage wall query
(`app/(shop)/page.tsx`) and added to the `WallItem` interface.

The artwork Edit page (`app/admin/artworks/[id]/page.tsx`) shows it as a
read-only field.

### Gaps are permanent and correct

Delete plate 042 and there is never a 042 again. That is what makes the number
trustworthy, and it does mean plate numbers stop matching any count on the site.

## Edge cases and invariants

- **Collection deleted.** `collection_id` is `ON DELETE SET NULL`, so its photos
  become Unfiled and surface in that chip. Their stale `collection_order` is
  never read without a `collection_id`, so it is harmless, and the append rule
  overwrites it if they are filed again.
- **Gaps in an order.** Positions are relative, never absolute, so a gap left by
  a removal is invisible. Every reorder save rewrites the scope dense as 1..N.
- **A photo above the cut loses buyability.** The `/shop` grid backfills with the
  next buyable piece and the admin cut line recomputes, because both count
  buyable tiles only. No hole appears on the page.
- **An unfiled photo can sit in Selected works** while belonging to no chapter,
  making it unreachable from the browse band. Not a bug: that is precisely the
  condition the Unfiled chip exists to reveal.
- **Concurrent admins.** Last-write-wins with reload-on-timeout, matching the
  existing Wall and collections behavior. No new locking.

## Verification approach

### Unit tests (vitest, `tests/lib/`)

The pure logic moves into a `lib/` module the way `lib/wall-arrange.ts` already
does, and gets tests for:

- scope resolution (which order a given filter edits)
- reorder and the order-dirty check
- filter counts, including the Unfiled bucket
- **the cut-line index computed over buyable-only tiles**, with unbuyable tiles
  interleaved above and below the line. This is where the off-by-N actually
  lives.

### Not unit-testable

The SQL writes and the drag interaction. There is no integration harness in this
repo, and the app cannot be booted against a real database on the current dev
box. The ordering changes need a manual pass on the live deploy after shipping:

1. Reorder in All, confirm `/shop` matches after revalidation.
2. Reorder within a collection, confirm the collection page, the portfolio page,
   and the related rail all match, and that `/shop` did **not** change.
3. Change the limit, confirm the cut line and the live grid agree.
4. Confirm plate numbers appear on wall hover, in the lightbox, and on the
   artwork page, and that they do not move after a reorder.

### Gates

`npm run typecheck` and `npm test`. **Not** `npm run lint`, which is dead under
Next 16 in this repo (no `next lint`, no flat ESLint config).

## Pre-ship checks

- **Count `artworks` rows where `display_order <> 0` against production before
  deploying.** If any exist, the densify backfill is still order-preserving, but
  it is worth seeing the number before the fact rather than after.
- Confirm the artwork count is well under the reorder payload cap.

## Risks and rollback

- **The backfills are the risky step.** Both are order-preserving by
  construction (they rank by the existing sort key), so the visible outcome
  should be no change at all. Verify on the deploy by comparing `/shop` and one
  collection page before and after.
- **`plate_no` backfill is one-way.** Once numbers are assigned and shown, they
  cannot be renumbered without lying to anyone who saw the old number. Get the
  `id`-order decision right before running it.
- **Rollback.** The new columns are additive and the public queries are the only
  behavior change, so reverting the query changes restores prior behavior
  without a down migration. `site_settings` and `plate_no` can stay in place
  unused.

## Out of scope, follow-ups

- **`/portfolio` versus `/shop/collections` duplication.** Two parallel browse
  trees over the same collections, one of them effectively orphaned (a single
  inbound link, from `/about`). This is a structural decision about the site,
  not about ordering. Worth its own conversation.
- **Collections in the main nav.** The browse band gives collections one real
  entry point. Whether they also deserve a seventh nav item is a separate design
  call.
- **Filter chips on the public `/shop`.** Explicitly rejected here in favor of
  the existing navigational path. Revisit only if the browse band underperforms.
