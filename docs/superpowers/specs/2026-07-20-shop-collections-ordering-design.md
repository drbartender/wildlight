# Shop Collections Ordering and Plate Numbers (Design Spec)

Date: 2026-07-20
Revised: 2026-07-21, after the design-stage review fleet (9 blockers, 16 warnings)
Status: approved, not yet planned

## Context

The Wall & Shop admin page (`/admin/wall`, `components/admin/WallArranger.tsx`)
has three panes: the Wall, the Shop, and the Library. The Wall shelf is fully
arrangeable (drag to reorder, click a position badge to move a photo to a typed
slot, auto-save on `dragEnd`). The Shop shelf is not. It renders
`photos.filter(isInShop)` in whatever order the loader returned, with no filter
and no reorder.

Four facts about the current system drive this design:

1. **`artworks.display_order` is a single global column.** It orders the public
   `/shop` grid, every collection page, the portfolio, and the related rail on
   artwork detail pages. There is no per-collection ordering, so a collection
   cannot read differently from the global sequence.

2. **`collections` already has everything it needs.** `collections.display_order`
   exists, and `/admin/collections` already arranges it with drag, an explicit
   Save order, and Reset. Collection assignment (`artworks.collection_id`,
   nullable) is already editable from the artwork Edit page and from the row
   menu on the artworks list.

3. **Collections are nearly invisible on the storefront.** The main nav is
   Gallery, Shop, Events, Portraits, Journal, Studio. There is no Collections
   link and no Portfolio link. Every inbound link to `/shop/collections` is
   downstream of already finding a photo (cart empty state, checkout, order
   page, artwork breadcrumb) or is in the footer. `/portfolio` has exactly one
   inbound link, from the bottom of `/about`.

4. **A plate-number system already exists.** `lib/plate-number.ts` derives
   `WL–NNNN` from a char-code hash of the slug, across the range `WL–0100` to
   `WL–9099`, and it renders on eight files: `components/site/PlateCard.tsx`
   (every grid tile), `components/site/Lightbox.tsx`, the artwork detail page,
   `components/shop/OrderCard.tsx`, the cart, checkout, and the contact form
   (message body and email subject). It is derived, not stored, so it changes
   if a slug is ever renamed, and it exists for pieces in the shop only in the
   sense that nothing gives a wall-only piece a number anywhere it is seen.

Additionally, `/shop` is capped at `LIMIT 12` with no way to change it, and its
header reads "Index of plates" beside a count of *every* published work rather
than the twelve actually shown.

## Goals

1. Filter the admin Shop shelf by All, by collection, or by Unfiled.
2. Drag-reorder within the active filter, using the Wall's interaction model.
3. Keep the All order independent of every per-collection order.
4. Make the `/shop` cap an editable setting with a visible cut line in the admin.
5. Give collections one genuine entry point from `/shop`.
6. Convert `WL–NNNN` from a derived hash into a stored, permanent accession
   number carried by every artwork, including wall-only pieces.

## Non-goals

- Collection assignment stays where it is (artwork Edit page, artworks-list row
  menu). No dropdown on shop thumbnails.
- No collection filter chips on the public `/shop`. The All-versus-collection
  choice stays navigational (`/shop` versus `/shop/collections/[slug]`).
- The `/portfolio` versus `/shop/collections` duplication is not resolved here.
  See Out of scope.

## 1. Data model

### Unchanged

- `collections.display_order` remains the collection order, arranged at
  `/admin/collections`. No work.
- `artworks.collection_id` remains the assignment.

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

**Published rows only.** Every public consumer of both orders filters to
`status='published'`, so only published rows have a position that means
anything. If the backfill ranked *all* rows, existing drafts would be handed
positions interleaved among the published ones, and publishing a draft later
would drop it into the middle of the sequence (potentially above the cut line,
displacing something) instead of appending it. Leaving non-published rows at `0`
is what makes append-on-entry work, because `0` is the sentinel meaning "never
placed".

**One-time, guarded by a marker.** Migrations re-run on every build
(`npm run build` is `tsx lib/migrate.ts && next build`), and a densify that
re-ran on every deploy would fight the append rule: a piece published at
position `MAX+1` would be silently re-ranked on the next deploy.

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

    -- All order, densified from the existing sort key.
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY display_order, id) AS ord
      FROM artworks WHERE status = 'published'
    )
    UPDATE artworks a SET display_order = r.ord FROM ranked r WHERE a.id = r.id;

    INSERT INTO site_settings (key, value) VALUES ('shop_order_backfilled', '1');
  END IF;
END $$;
```

`lib/migrate.ts` sends the whole of `lib/schema.sql` through a single
`pool.query(sql)` with no explicit `BEGIN`/`COMMIT`, so Postgres runs it as one
implicit transaction. The `DO` block therefore cannot half-run, and a failure in
any later statement rolls the marker row back too, so the backfill retries on
the next build rather than being silently skipped. Do not "improve" this by
splitting the migration into multiple queries.

**The marker is data, not schema.** If `collection_order` or `display_order` is
ever dropped and re-added, the marker row survives and the backfill will skip.
Anyone doing that must delete the `shop_order_backfilled` row in the same
breath. This is restated in Risks and rollback.

**`display_order` is not currently an unarranged `0` column.**
`scripts/import-manifest.ts` writes it as the *within-collection* manifest index,
so production holds many rows sharing low values across collections and `/shop`'s
global sort interleaves collections by index. The densify is still
order-preserving (it ranks by the existing sort key), but see the two script
changes below, which are not optional.

### Append-to-end, enforced at the chokepoint

Both orders assign their next position on entry. **The publish-side logic lives
inside `lib/publish-artworks.ts`**, whose own docstring names it as the single
chokepoint for every publish path. Putting it in the route handlers would be
bypassed by `scripts/publish-selections.ts`, which imports the helper directly.

- **On publish**, for the rows actually *transitioning* into `published`
  (`publishArtworks` deliberately accepts already-published rows and filters
  them into `transitioning`; only that subset gets a new position, and the
  collision check excludes the row itself):
  - `display_order` becomes `MAX(display_order) + ROW_NUMBER()` over the
    transitioning batch, ordered by id. **Not `MAX + 1`**: `publishArtworks`
    takes an `ids[]`, so a plain `MAX + 1` would hand an entire batch of twenty
    drafts the identical position.
  - Same treatment for `collection_order`, partitioned by `collection_id`, for
    rows whose `collection_id` is not null.
  - The new position is assigned when the stored value is `0` **or** collides
    with a different already-published row. The collision clause exists for
    legacy drafts carrying a stale non-zero `display_order` from before the
    backfill.
- **On `collection_id` change** (any status, all three writers below), set
  `collection_order = MAX(collection_order) + 1` within the new collection, or
  to `0` when the new `collection_id` is NULL (the Edit page's blank option
  sends exactly that).

**All three `collection_id` writers must carry this**, not just the Edit page:

1. `PATCH /api/admin/artworks/[id]` (Edit page and the artworks-list row menu
   both hit this one).
2. `POST /api/admin/artworks` with `action: 'move'`, which today is a bare
   `UPDATE artworks SET collection_id=$2 WHERE id = ANY($1)`. Without this, a
   bulk-moved batch lands at `collection_order = 0` and sorts to the **front**
   of that chapter on the collection page, the portfolio, and the related rail.
3. `scripts/import-manifest.ts` (see below).

**A retired piece that is re-published appends; it does not return to its old
slot.** An earlier draft of this spec claimed both, which is not self-consistent:
every reorder densifies the published set to 1..N, so a returning row's stored
position is almost always occupied, the collision clause fires, and it appends.
Appending is now the stated, single behavior.

`MAX + ROW_NUMBER()` is not race-free under READ COMMITTED; two concurrent
publishes can read the same max. This is a single-admin site and the failure
mode is two pieces sharing a position (which sorts by `id` as a tiebreak and is
fixed by the next reorder), so it is accepted rather than serialized. It is
called out because §5 rejects `MAX + 1` for `plate_no` on exactly these grounds,
where the consequence is far worse.

### Two required script changes

- **`scripts/import-manifest.ts` must stop writing `display_order`.** It
  currently upserts `ON CONFLICT (slug) DO UPDATE SET … display_order =
  EXCLUDED.display_order`, so one re-import would silently overwrite Dan's
  entire arranged All order with manifest indices. Remove `display_order` from
  both the INSERT column list and the `DO UPDATE SET` clause, leaving the `0`
  default to stand so imported drafts append correctly on publish. It must also
  set `collection_order` per the assignment rule above, or leave it at `0`
  (which appends on publish) rather than writing a manifest index.

- **`scripts/publish-selections.ts` must refuse to run after the backfill.** It
  resolves artworks by `WHERE collection_id = $1 AND display_order = ANY($2)`,
  expecting the manifest's per-collection index. The densify makes that mapping
  permanently wrong, and the script's converge step demotes every published row
  it did not match, so a post-backfill `--apply` would mass-unpublish. Add a
  guard at the top: if `site_settings` has `shop_order_backfilled`, exit with a
  clear message that `display_order` is now the curated All order and this
  script's index-based lookup no longer applies. Failing closed is deliberately
  chosen over adding a `manifest_index` column to keep an import-era script
  alive; if it is ever needed again, that is a decision to make then, with the
  data in front of us. `README.md` line 44 documents
  `npm run publish:selections` and must be updated to say so.

## 2. Admin UI (the Shop shelf)

### Loader

`app/admin/wall/page.tsx` currently returns one `LibraryPhoto[]`. It gains:

- `collection_id`, `collection_title`, `collection_order`, `display_order`, and
  `plate_no` on each photo.
- A second query for the collections list (id, title, in `display_order`), which
  drives the filter tray even for collections with zero shop members.
- A third for `shop_index_limit` from `site_settings`.

All three keep the existing fail-soft behavior: a Neon cold-start blip renders
an empty screen, not a 500.

Adding fields to the `LibraryPhoto` interface in `lib/wall-arrange.ts` breaks
two other construction sites that must be updated in the same change or
typecheck fails: the dev harness mock in `app/dev-preview/wall/page.tsx` and the
test factory in `tests/lib/wall-arrange-library.test.ts`. Commit `d67d411`
already had to touch both for the same reason.

### Filter tray

The Shop shelf head gets a segmented control styled on `.wl-adm-seg`:

```
All (n) · <each collection, in collections.display_order> (n) · Unfiled (n)
```

**`.wl-adm-seg` cannot wrap as it stands.** It is `display: inline-flex` with
`overflow: hidden`, and its buttons carry `white-space: nowrap`, so an
overflowing chip row is *clipped*, not wrapped. Wrapping requires adding
`flex-wrap: wrap` and reworking the `:last-child` border rule, which only
removes the divider from the final button and leaves a stray divider at the end
of every wrapped row. `.wl-adm-ws-head` also needs `flex-wrap: wrap` (only the
Library head sets it today), or the tray plus the limit field will overflow the
shelf head.

The active filter persists to `localStorage` alongside the existing
`wl-wall-min` pane state, and is **read post-mount**, exactly as `wl-wall-min`
is, so SSR renders the default and there is no hydration mismatch. Reading it
during render would flash the All view and its cut line before switching.

If the persisted filter names a collection that no longer exists, fall back to
All rather than rendering an empty scope with no matching chip.

### Scope determines which order you are editing

- **All** writes `display_order`.
- **A collection** writes `collection_order` for that collection only.
- **Unfiled** writes nothing (see below).

The two never write each other. Moving a photo to slot 1 of a collection does
nothing to where it sits on `/shop`.

### Reorder interaction

Mirror the Wall's model:

- `dragEnter` live-reorders local state.
- `dragEnd` auto-saves the whole scope order.
- Each tile gains the position badge: click the number, type a position, Enter.

The position badge is not optional garnish. The Shop shelf sits in the same
height-capped band as the Wall, and `dragEnter` can never fire on a tile clipped
out of view, so without it a photo cannot move more than about a row, and there
is no keyboard path at all.

**The commit fires on `dragEnd`, never `drop`.** Chromium does not deliver a
`drop` event when the drag source node was moved mid-drag, which a live reorder
always does. `/admin/collections` sidesteps the same trap with an explicit Save
button. Do not "clean this up" to a drop-keyed commit.

**"Mirror the Wall" does not mean "share the Wall's state."** `WallArranger`
holds several globals that a second arrangeable shelf would collide with, and
each needs a scoped counterpart:

- `focusPos()` queries `[data-pos-id="<id>"]`. A photo that is both on the wall
  and in the shop would match two elements, so focus after a Shop reorder lands
  on the Wall tile. The Shop badges need their own attribute.
- `inFlight` (`busy || savingOrder`) and `savedFlash` are shared, so a Shop save
  would disable the Wall and flash "order saved ✓" in the Wall's head. The Shop
  needs its own saving flag and flash.
- `savedWallIds` has no Shop counterpart. The Shop needs `savedShopIds` (keyed
  per scope) for the dirty check and for optimistic rollback.

A reorder POST that is in flight when the admin switches filters must not roll
back into the new scope on failure. Tag the in-flight request with its scope and
discard the rollback if the scope has changed, surfacing the error instead.

All mutations run behind the existing in-flight gate, with the existing 30s
abort, timeout-reconcile-by-reload, and stale-row handling.

### The cut line

Drawn in the **All** view only, after the Nth tile. Everything below it is
subdued and labeled as not appearing on `/shop`.

It counts **buyable tiles only**, skipping the ones badged "hidden, no sizes
available", because the public query filters unbuyable rows out *before* it
applies the limit. Counting all tiles would let Dan arrange twelve and see nine.

Degenerate cases, all explicit:

- **N = 0** (unlimited): no line is drawn at all, and the head says so.
- **N greater than the buyable count**: no line is drawn, and the head reads
  "showing all N buyable".
- **Zero buyable tiles**: no line, and the existing empty/blocked messaging
  carries it.

Not shown in collection views or Unfiled. The cut governs `/shop` alone.

### The limit control

A number field in the All view head: "Show the first N on /shop." `0` means no
limit, labeled on the field. A real unlimited matters so `/shop` cannot start
silently truncating years from now as the catalog grows past whatever number was
typed today.

Client-side rules mirror the server exactly: integer, `0` to `500`, anything
else rejected inline with the reason. The field shows a pending state while
saving, reverts to the last saved value on failure with an error message, and
confirms on success using the same flash pattern as the order save.

Beside it, a readout: "showing N of M buyable". One mistyped digit otherwise
removes the whole catalog from `/shop` for at least the 60s revalidate window
with nothing on screen to notice it by.

### Tile changes

Each tile in the **All** view shows its collection name as a small read-only
label, "unfiled" when it has none. Not a control.

Plate numbers do **not** go on admin thumbnails. Commits `1f23519` and `d67d411`
deliberately stripped names and prices off those tiles to quiet them.

### Unfiled is a worklist, not an arrangement surface

Drag is disabled and position badges are hidden. There is no "unfiled order" to
save, and dragging within a partial view of the All order is genuinely
ambiguous: dropping A above B when six other photos sit between them in the full
order has no single correct answer. Tiles keep their Edit link, which is where
assignment happens.

A tile that is unfiled **and** below the cut line is reachable from nowhere on
the site except the sitemap. Those get a distinct badge in the Unfiled view, not
just the generic treatment.

### Empty states

- A collection filter with zero shop members (the tray deliberately shows
  zero-member collections): "Nothing in this chapter is in the shop yet."
- Zero shop members at all, under a collection filter: the same, not the
  All-scoped "Drag photos with a print file here", which reads as wrong when a
  chapter filter is active.
- Unfiled with nothing in it: "Every photo in the shop belongs to a chapter."

## 3. Public surfaces

### Collection order, three query changes

Switch `ORDER BY a.display_order, a.id` to `ORDER BY a.collection_order, a.id`:

- `app/(shop)/shop/collections/[slug]/page.tsx`, the chapter grid.
- `app/(shop)/portfolio/[slug]/page.tsx`, the same collection without the
  buyability filter.
- `app/(shop)/shop/artwork/[slug]/page.tsx`, the related rail (4 pieces from the
  same chapter).

One sequence per collection, honored everywhere that collection appears.

The two collection *index* pages (`/shop/collections`, `/portfolio`) already sort
by `collections.display_order` and need no change.

### All order

`app/(shop)/shop/page.tsx` applies the limit. **Parameterized, never
interpolated.** `site_settings.value` is `TEXT`, and splicing it into raw SQL in
a repo with no ORM is a second-order injection sink; a missing or unparseable
row would also 500 the storefront index.

Read the value, `Number.isInteger` clamp it to `0..500`, and **fall back to 12
when the row is absent or unparseable**. `/shop` has no try/catch today (unlike
`app/(shop)/page.tsx`), so a fresh database, a restored Neon branch, or a
not-yet-seeded environment must degrade to the current behavior rather than
rendering the entire catalog or throwing.

Keep the page's existing two-parallel-query shape. A separate settings query
that *feeds* the plates query is a serial extra round trip on every cache miss,
doubling exposure to the deliberate 15s `connectionTimeoutMillis` fail-fast.
Either fold the lookup into the plates query as a `LIMIT (SELECT …)` subquery,
or read it in parallel and apply the slice with a large hard ceiling in SQL.

### `/shop` header

- "Index of plates" becomes **"Selected works"**.
- The count beside it changes from every published work to the number actually
  in the grid.
- The masthead's "Plates on file 024" keeps counting the whole archive.

### Browse by collection band

A new band on `/shop`, **below** the Selected works grid, listing chapters in
`collections.display_order`, each linking to its collection page. Reuses the
chapter-row treatment built for `/shop/collections`.

Two corrections to that treatment when reused here: `/shop/collections` counts
`status='published'` while the destination grid filters to buyable, and it
`LEFT JOIN`s so empty collections still render. On the storefront's
highest-traffic index that would advertise "5 plates" and land on a visibly
empty page. **Count buyable-published, and omit zero-count chapters.**

If there are no collections at all, the band does not render.

### Revalidation

These pages are `revalidate = 60`. A limit or order change will not appear on
the live site for up to a minute, and there is no `revalidatePath` call anywhere
in the repo. The admin says so in the shelf head after a successful save rather
than leaving it to be discovered.

## 4. API contracts

### `POST /api/admin/shop/order` (new)

```
{ scope: 'all', ids: number[] }
{ scope: 'collection', collectionId: number, ids: number[] }
```

One atomic statement, the shape `/api/admin/wall` and the collections reorder
use, so a partial failure cannot leave a mix of old and new positions:

```sql
UPDATE artworks a
   SET display_order = v.ord            -- or collection_order
  FROM (SELECT id, ord FROM unnest($1::int[]) WITH ORDINALITY AS t(id, ord)) v
 WHERE a.id = v.id
   AND a.status = 'published'
   AND a.collection_id = $2;            -- collection scope ONLY
```

Zod-validated with the duplicate-id refinement the collections route carries.
`requireAdmin` **and** `requireSameOrigin`, copying the artwork routes: the
collections route uses `requireAdmin` alone and is the wrong model here.

**Three guards, each load-bearing:**

- `AND a.collection_id = $2` on the collection scope. Without it a stale client
  holding an old id list renumbers rows in a collection it is not looking at.
- `AND a.status = 'published'` on **both** scopes. Without it a stale tab
  stamps a nonzero position onto a draft, destroying the `0` sentinel that
  append-on-publish depends on, and that draft later publishes into the middle
  of `/shop` instead of appending.
- **Assert `rowCount === ids.length`, else 409.** The guards above skip
  non-matching rows silently, so surviving rows would receive sparse ordinals
  (1, 3, 5…) from the full array's `WITH ORDINALITY` while skipped rows keep
  colliding values, and the admin would still see "order saved ✓" for a save
  that partly or wholly did nothing. A 409 tells the client to reload, matching
  the stale-row handling the Wall already has.

**Payload cap: 1000, not lower.** The admin loader is `LIMIT 1000` and
`/api/admin/wall` documents that the two must stay in lockstep. A smaller cap
makes a large catalog unreorderable with a 400 and no recovery.

**Do not set `updated_at = NOW()`**, even though `/api/admin/wall` does. The
admin Library sorts `ORDER BY a.updated_at DESC`, so every drag would reshuffle
the Library out from under the user, and `app/sitemap.ts` uses `updated_at` as
`lastModified`, so every reorder would re-stamp every published artwork in the
sitemap.

Unlike `/api/admin/wall`, this endpoint does **not** clear positions on rows
outside the payload. That is deliberate: the scope is a filtered subset, not the
whole table, and the collision clause on publish handles the stale values that
result.

### `PATCH /api/admin/settings` (new)

Writes `shop_index_limit`. The key is a **Zod enum**, not a free-form string, so
a generic table never gets a generic writer. Value is an integer `0..500`.
Upsert (`ON CONFLICT (key) DO UPDATE`), not a plain UPDATE, which would be a
silent no-op if the seed row is missing. Same auth as above.

### Observability

Both new routes log failures through `lib/logger.ts`, which forwards to Sentry.
The existing wall route uses bare `console.error`, which does not. Log the
scope, the id count, and the resulting `rowCount` so a failed reorder is
debuggable two weeks later.

### One removal

Drop `display_order` from the artwork PATCH Zod schema. Ordering now has a
dedicated endpoint, and leaving a direct write path that bypasses densification
is a trap.

## 5. Plate numbers

`WL–NNNN` stops being derived from the slug and becomes a stored, permanent
accession number on every artwork, wall-only pieces included.

### The column

```sql
CREATE SEQUENCE IF NOT EXISTS artworks_plate_no_seq;
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS plate_no INT;
ALTER TABLE artworks
  ALTER COLUMN plate_no
  SET DEFAULT ((nextval('artworks_plate_no_seq') * 2731) % 9000) + 100;
```

**Statement order matters and must be preserved:** add the column nullable,
*then* set the default, then backfill. Folding the default into `ADD COLUMN`
evaluates `nextval` once and hands every existing row the same number, which
then fails the unique index.

### Why scattered, not sequential

The existing hash spreads plate numbers across `WL–0100` to `WL–9099`
deliberately, so a catalog of a hundred pieces reads like one of thousands. A
plain sequence would print `WL–0100, WL–0101, WL–0102`, announcing both the size
of the catalog and the acquisition order of every piece.

`((nextval * 2731) % 9000) + 100` preserves the scatter while being permanent
and stored. 2731 is prime and shares no factor with 9000, so the mapping is a
*permutation* of the range: collision-free for the first 9000 pieces, with no
retry loop and no randomness.

### Why a sequence, not MAX + 1

Bulk upload inserts many rows at once, and `MAX(plate_no) + 1` in application
code races itself, handing two photos the same number. A sequence is
concurrency-safe and never reuses a value.

It also means **none of the three insert sites need to change**
(`app/api/admin/artworks/upload/route.ts`,
`app/api/admin/artworks/bulk-upload/finalize/route.ts`,
`scripts/import-manifest.ts`). The column default does the work.

### Backfill, idempotent

The whole of `lib/schema.sql` re-runs on every build, so every step here is
guarded. An unguarded version would renumber public plate numbers on the next
deploy, or break every deploy outright.

```sql
-- Assign only where missing. NEVER re-rank existing values: the WHERE clause is
-- the entire idempotency guard, and an unguarded re-rank would renumber public
-- plate numbers on the next deploy.
UPDATE artworks SET plate_no = DEFAULT WHERE plate_no IS NULL;

-- CREATE UNIQUE INDEX IF NOT EXISTS, not ADD CONSTRAINT ... UNIQUE, which has
-- no IF NOT EXISTS and errors on the second build, breaking every deploy.
CREATE UNIQUE INDEX IF NOT EXISTS idx_artworks_plate_no ON artworks(plate_no);
ALTER TABLE artworks ALTER COLUMN plate_no SET NOT NULL;
```

**No `setval` is needed, and adding one would be a bug.** `SET plate_no =
DEFAULT` evaluates the column default per row, which means it draws from
`artworks_plate_no_seq` itself, so the sequence is already correct the moment
the backfill finishes. A hand-written `setval` would have to track how many
numbers have been *drawn* rather than the highest number *stored* (the
permutation makes those unrelated), and any version that reads `MAX(plate_no)`
or a row count would rewind the sequence when the highest-numbered artwork is
deleted, reissuing a number a customer has already seen. Do not add one.

Assignment order is creation order (`id`), because a plate number records when a
piece entered the catalog, not where it sits in an arrangement. Deliberately
**not** seeded from `display_order`.

### Display: replace `plateNumber()` everywhere

`lib/plate-number.ts` changes from `plateNumber(slug: string)` to a pure
formatter, `formatPlate(n: number): string`, returning `WL–${pad4(n)}`. Every
one of the eight call sites switches to the stored value.

Five read it straight from a row that is already loaded: `PlateCard`,
`Lightbox`, the artwork detail page, `OrderCard`, and the wall. Each needs
`plate_no` added to its query and to its props/row interface (`PlateCardData`,
`WallItem`).

Three have no database row at hand and each gets an explicit answer:

- **Cart and checkout** render from a `localStorage` cart line (`wl_cart_v1`)
  that carries only `artworkSlug`. `OrderCard` already receives the plate number
  as a prop at add-to-cart time, so `CartLine` gains `plateNo`. Make it
  **optional**: carts already sitting in a browser lack it, and those lines
  should degrade to title-only rather than being discarded by a storage-key
  bump. Do not bump `wl_cart_v1`.
- **The contact page** is a client component that derives the plate from a
  `?piece=<slug>` param and uses it in both the seeded message and the email
  subject. The three links into it are all built by `OrderCard`, which has the
  number, so they carry `&plate=<n>`. When the param is absent (an old link,
  a hand-typed URL), omit the plate from the message and subject rather than
  fetching.

### New display surfaces

- The wall's hover caption (`.wl-wall-cap`, already `opacity: 0` revealed on
  `:hover`/`:focus-visible`, already mono and letterspaced) gains the plate
  number beside the title. This is the only place a wall-only piece's number
  appears, and it is why `plate_no` covers every artwork rather than published
  ones.
- The artwork detail page drops its
  `ROW_NUMBER() OVER (ORDER BY a.display_order, a.id)` plate_idx entirely, along
  with the "Plate 07 of 24" denominator. A permanent number in a catalog with
  gaps cannot honestly claim one.
- The artwork Edit page shows `plate_no` as a read-only field.

### Consequences, stated plainly

- **Every existing piece gets a new number, once.** A piece showing `WL–4312`
  today becomes something else. Nothing durable stores the old value: emails
  render a "Plates" section label but never a number, and the order page shows
  none. The blast radius is bookmarks, screenshots, and the subject lines of
  contact emails already sent.
- **Gaps are permanent and correct.** Delete a plate and that number never
  returns. That is what makes it trustworthy.
- **Renames stop moving the number.** The old hash changed if a slug was
  renamed; the stored value does not. That is a strict improvement.

## Edge cases and invariants

- **Collection deleted.** `collection_id` is `ON DELETE SET NULL`, so its photos
  become Unfiled and surface in that chip. Their stale `collection_order` is
  never read without a `collection_id`, and the assignment rule overwrites it if
  they are filed again.
- **Gaps in an order.** Positions are relative, never absolute. Every reorder
  save rewrites the scope dense as 1..N.
- **A photo above the cut loses buyability.** The `/shop` grid backfills with the
  next buyable piece and the admin cut line recomputes, because both count
  buyable tiles only.
- **An unfiled photo below the cut** is reachable from nowhere but the sitemap.
  Flagged in the Unfiled view rather than fixed silently.
- **Concurrent admins.** Last-write-wins with reload-on-timeout, plus the new
  409 on a stale id list. No new locking.

## Verification approach

### Unit tests (vitest, `tests/lib/`)

Pure logic moves into a `lib/` module the way `lib/wall-arrange.ts` does:

- scope resolution (which order a given filter edits)
- reorder and the order-dirty check
- filter counts, including the Unfiled bucket
- **the cut-line index computed over buyable-only tiles**, with unbuyable tiles
  interleaved above and below the line, plus the three degenerate cases
- `formatPlate` padding, and the scatter permutation being collision-free over a
  representative range

Everything named above must live in the `lib/` module, not inside the React
component, or vitest cannot reach it: this repo has no component-test harness.

### Not unit-testable

The SQL writes and the drag interaction. There is no integration harness, and
the app cannot be booted against a real database on the current dev box. Manual
pass on the live deploy after shipping:

1. Reorder in All, confirm `/shop` matches after revalidation.
2. Reorder within a collection, confirm the collection page, the portfolio page,
   and the related rail all match, and that `/shop` did **not** change.
3. Change the limit, confirm the cut line and the live grid agree. Try `0`.
4. **Re-publish a retired piece** and confirm it appends rather than landing
   mid-grid.
5. **Bulk-publish several drafts at once** and confirm they receive distinct
   consecutive positions.
6. **Bulk-move several photos to another collection** and confirm they land at
   the end of that chapter, not the front.
7. Confirm the same plate number appears on the grid tile, the artwork page, the
   wall hover, the lightbox, the cart, and checkout, and that it does not move
   after a reorder.

### Gates

`npm run typecheck` and `npm test`. **Not** `npm run lint`, which is dead under
Next 16 in this repo.

## Pre-ship checks

- **Count production `artworks` rows where `display_order <> 0`.** Expect many,
  because `import-manifest` writes per-collection indices. The densify is still
  order-preserving; this is to see the shape of the data before it changes.
- Confirm the artwork count is under the 1000 reorder payload cap and the
  loader's `LIMIT 1000`.
- Confirm no `scraped/selections.json` run is pending before the backfill lands.

## Risks and rollback

- **The backfills are the risky step.** All are order-preserving by construction
  and guarded to run once. Verify on the deploy by comparing `/shop` and one
  collection page before and after.
- **`plate_no` is one-way.** Once numbers are assigned and shown they cannot be
  renumbered without lying to anyone who saw one.
- **`display_order`'s meaning change is not revertible by reverting code.** The
  manifest-index mapping that `publish-selections.ts` relied on is destroyed by
  the densify. That script is fenced off rather than repaired.
- **Rollback.** The new columns are additive and the public query changes are
  the behavior change, so reverting the queries restores prior behavior without
  a down migration. `site_settings` and `plate_no` can stay in place unused,
  **except**: if `collection_order` or `display_order` is ever dropped and
  re-added, delete the `shop_order_backfilled` row too, or the backfill silently
  skips and every collection page sorts by `id`.

## Out of scope, follow-ups

- **`/portfolio` versus `/shop/collections` duplication.** Two parallel browse
  trees over the same collections, one of them effectively orphaned. A
  structural decision about the site, not about ordering.
- **Collections in the main nav.** The browse band gives collections one real
  entry point. A seventh nav item is a separate design call.
- **Filter chips on the public `/shop`.** Explicitly rejected in favor of the
  existing navigational path.
- **`scripts/publish-selections.ts`.** Fenced off, not repaired. If it is needed
  again, decide then whether to preserve a `manifest_index` column or to change
  its input format to slugs.
