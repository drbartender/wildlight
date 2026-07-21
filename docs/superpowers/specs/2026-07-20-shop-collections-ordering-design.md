# Shop Collections Ordering (Design Spec)

Date: 2026-07-20
Revised: 2026-07-21, after two design-stage review rounds
Scope: ordering only. Plate numbers were split out to
`2026-07-21-plate-numbers-design.md` and ship separately.
Status: approved, not yet planned

## Context

The Wall & Shop admin page (`/admin/wall`, `components/admin/WallArranger.tsx`)
has three panes: the Wall, the Shop, and the Library. The Wall shelf is fully
arrangeable (drag to reorder, click a position badge to type a slot, auto-save
on `dragEnd`). The Shop shelf is not. It renders `photos.filter(isInShop)` in
whatever order the loader returned, with no filter and no reorder.

1. **`artworks.display_order` is a single global column.** It orders the public
   `/shop` grid, every collection page, the portfolio, and the related rail on
   artwork detail pages. There is no per-collection ordering, so a collection
   cannot read differently from the global sequence.

2. **`collections` already has what it needs.** `collections.display_order`
   exists and `/admin/collections` arranges it with drag, Save order, and Reset.
   Assignment (`artworks.collection_id`, nullable) is editable from the artwork
   Edit page and from the row menu on the artworks list.

3. **Collections are nearly invisible on the storefront.** The main nav is
   Gallery, Shop, Events, Portraits, Journal, Studio, with no Collections or
   Portfolio link. Every inbound link to `/shop/collections` is downstream of
   already finding a photo (cart empty state, checkout, order page, artwork
   breadcrumb) or is in the footer. `/portfolio` has one inbound link, from the
   bottom of `/about`.

4. **`display_order` is not an unarranged `0` column today.**
   `scripts/import-manifest.ts` writes it as the *within-collection* manifest
   index, so production holds many rows sharing low values across collections
   and `/shop`'s global sort interleaves collections by index. Duplicate values
   are guaranteed, which is why the publish rule below never trusts a stored
   position.

Additionally, `/shop` is capped at `LIMIT 12` with no way to change it, and its
header reads "Index of plates" beside a count of *every* published work rather
than the twelve actually shown.

## Goals

1. Filter the admin Shop shelf by All, by collection, or by Unfiled.
2. Drag-reorder within the active filter, using the Wall's interaction model.
3. Keep the All order independent of every per-collection order.
4. Make the `/shop` cap an editable setting with a visible cut line in the admin.
5. Give collections one genuine entry point from `/shop`.

## Non-goals

- Assignment stays where it is (Edit page, artworks-list row menu). No dropdown
  on shop thumbnails.
- No collection filter chips on the public `/shop`. The All-versus-collection
  choice stays navigational.
- Plate numbers. Separate spec, separate deploy.
- The `/portfolio` versus `/shop/collections` duplication. See Out of scope.

## 1. Data model

### Unchanged

`collections.display_order` remains the collection order, arranged at
`/admin/collections`. **One code change guards it**: see the `import-manifest`
change below, which today overwrites it on re-import. This spec makes that
ordering load-bearing (it drives the new filter tray and the new browse band),
so it can no longer be silently clobbered.

### Repurposed

`artworks.display_order` becomes **the All order**, explicitly.

### New

```sql
-- Position within the row's own collection. Meaningful ONLY relative to
-- collection_id. One column suffices because an artwork belongs to exactly one
-- collection; a join table would model a many-to-many that does not exist.
ALTER TABLE artworks
  ADD COLUMN IF NOT EXISTS collection_order INT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_artworks_collection_order
  ON artworks(collection_id, collection_order);

CREATE TABLE IF NOT EXISTS site_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO site_settings (key, value) VALUES ('shop_index_limit', '12')
  ON CONFLICT (key) DO NOTHING;
```

Seeding to `12` preserves current behavior exactly.

**Placement in `lib/schema.sql`:** the file is append-structured (base DDL near
the top, then idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` blocks).
Append at the end, in this order: `site_settings` CREATE and seed, then the
`collection_order` column and index, then the `DO $$` backfill block. The
backfill reads `site_settings`, so it must come after that table exists.

### Backfill

**Published rows only.** Every public consumer of both orders filters to
`status='published'`, so only published rows have a position that means
anything. Non-published rows stay at `0`, the sentinel for "never placed".

**One-time, guarded by a marker**, because migrations re-run on every build
(`npm run build` is `tsx lib/migrate.ts && next build`).

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM site_settings WHERE key = 'shop_order_backfilled')
  THEN
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (
               PARTITION BY collection_id ORDER BY display_order, id
             ) AS ord
      FROM artworks
      WHERE collection_id IS NOT NULL AND status = 'published'
    )
    UPDATE artworks a SET collection_order = r.ord FROM ranked r WHERE a.id = r.id;

    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY display_order, id) AS ord
      FROM artworks WHERE status = 'published'
    )
    UPDATE artworks a SET display_order = r.ord FROM ranked r WHERE a.id = r.id;

    -- ON CONFLICT DO NOTHING is required, not decorative: two concurrent builds
    -- (preview + prod, or a redeploy) both see no marker, both densify, and a
    -- bare INSERT raises 23505 on the second, aborting the whole implicit
    -- transaction and failing that deploy.
    INSERT INTO site_settings (key, value) VALUES ('shop_order_backfilled', '1')
      ON CONFLICT (key) DO NOTHING;
  END IF;
END $$;
```

`lib/migrate.ts` sends the whole of `lib/schema.sql` through a single
`pool.query(sql)` with no explicit `BEGIN`/`COMMIT`, so Postgres runs it as one
implicit transaction. The `DO` block therefore cannot half-run, and a failure
later in the file rolls the marker back too, so the backfill retries on the next
build rather than being silently skipped.

**Two corollaries, both load-bearing:**

- Do not split the migration into multiple `pool.query` calls.
- Never add `BEGIN`/`COMMIT` or a non-transactional statement
  (`CREATE INDEX CONCURRENTLY`, `VACUUM`) to `schema.sql`. Either destroys the
  implicit transaction the marker's atomicity rests on. There are none today.

**`statement_timeout` is 15s** (`lib/db.ts`) and applies to the entire
multi-statement message on PostgreSQL 16 and earlier, meaning all of
`schema.sql` plus both densify passes share one budget. Fine at current row
counts. Confirm the Neon major version before shipping; on 16 or earlier a slow
deploy aborts the whole migration, which fails safe (the marker rolls back) but
fails the build.

**The marker is data, not schema.** If either order column is ever dropped and
re-added, the marker row survives and the backfill silently skips. Anyone doing
that must delete `shop_order_backfilled` in the same breath.

### Position assignment

Three rules, all enforced server-side. The design deliberately **never trusts a
stored position on a row entering the shop**, which is what lets it drop the
collision-detection logic an earlier draft of this spec carried.

**Rule 1: leaving `published` zeroes both orders.**
On any transition out of `published` (to `retired` or `draft`), set
`display_order = 0` and `collection_order = 0`. This mirrors the existing
`wall_order = 0` reset on an `on_wall` change, twenty lines away in the same
PATCH handler. It restores the sentinel, so a piece that comes back later is
genuinely unplaced.

Without this the whole scheme breaks: a retired piece keeps a live-looking
position, and re-publishing drops it into the middle of the grid.

**Rule 2: entering `published` always assigns a fresh position.**
For the rows actually *transitioning* into `published` (`publishArtworks`
accepts already-published rows and filters them into a `transitioning` subset;
only that subset is touched):

```sql
WITH m AS (
  SELECT COALESCE(MAX(display_order), 0) AS mx
  FROM artworks WHERE status = 'published'      -- scope to published, or
),                                              -- retired rows' stale highs leak in
t AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM artworks WHERE id = ANY($1)
)
UPDATE artworks a SET display_order = m.mx + t.rn
  FROM t, m WHERE a.id = t.id;
```

`MAX + ROW_NUMBER()`, never `MAX + 1`: `publishArtworks` takes an `ids[]`, so a
plain `MAX + 1` hands an entire batch of twenty drafts the identical position.
The `MAX` is read in a CTE, so it snapshots before the update.

Same shape for `collection_order`, partitioned by `collection_id`, for rows
whose `collection_id` is not null.

Because the position is always reassigned, there is no need to inspect the
stored value and no collision predicate. That matters: production guarantees
duplicate `display_order` values (manifest indices), so any predicate of the
form "is this value already taken" would have been wrong on the first bulk
publish.

**Rule 3: a real `collection_id` change appends to the new collection.**
`collection_order = MAX(collection_order within the new collection) +
ROW_NUMBER()`, or `0` when the new `collection_id` is NULL.

- **Batch-safe.** `action: 'move'` takes `ids[]` and does one
  `UPDATE … WHERE id = ANY($1)`, so this needs `ROW_NUMBER()` for exactly the
  same reason Rule 2 does.
- **Only on a real change.** Use `IS DISTINCT FROM` against the current value.
  The PATCH builds its UPDATE generically from the Zod body and never reads the
  prior value, and `ArtworkRowMenu` lets an admin click the chapter a piece is
  already in, which would otherwise re-append it to the end of its own chapter.

**All three `collection_id` writers carry Rule 3:**

1. `PATCH /api/admin/artworks/[id]` (Edit page and the row menu both hit this).
2. `POST /api/admin/artworks` with `action: 'move'`, today a bare
   `UPDATE artworks SET collection_id=$2 WHERE id = ANY($1)`.
3. `scripts/import-manifest.ts`, whose upsert re-files **already-published**
   rows via `ON CONFLICT (slug) DO UPDATE SET collection_id = EXCLUDED…`. Those
   never transition into `published`, so Rule 2 never fires for them and a
   `collection_order` of `0` would sort them to the front of the new chapter.

Rules 1 and 2 live inside `lib/publish-artworks.ts`, whose own docstring names
it the single chokepoint for every publish path. Putting them in route handlers
would be bypassed by `scripts/publish-selections.ts`, which imports the helper
directly.

`MAX + ROW_NUMBER()` is not race-free under READ COMMITTED; two concurrent
publishes can read the same max. Single-admin site, and the failure mode is two
pieces sharing a position (which sorts by `id` as a tiebreak and is fixed by the
next reorder), so it is accepted rather than serialized.

### Two required script changes

**`scripts/import-manifest.ts` stops writing display order, on both tables.**
It currently upserts `display_order = EXCLUDED.display_order` for `artworks`
*and* for `collections`. Either one silently overwrites a deliberate
arrangement on the next re-import. Remove `display_order` from both `DO UPDATE
SET` clauses and from the `artworks` INSERT column list, leaving the `0` default
to stand. Apply Rule 3 for the re-file case.

**`scripts/publish-selections.ts` refuses to run after the backfill.**
It resolves artworks by `WHERE collection_id = $1 AND display_order = ANY($2)`,
expecting the manifest's per-collection index. The densify makes that mapping
permanently wrong, and the script's converge step demotes every published row it
did not match, so a post-backfill `--apply` would mass-unpublish.

Guard specifics, because a vague "add a guard" reproduces the bug:
- Check for the `shop_order_backfilled` marker at the top of `main()`.
- Wrap the read so a missing `site_settings` table (42P01, a pre-migrate or
  fresh database) is treated as "not backfilled" and the script proceeds, rather
  than surfacing a raw Postgres stack.
- Block the **dry-run path too**, not just `--apply`. A dry run that prints a
  confident and entirely wrong diff is worse than one that refuses.
- Exit `1` with a one-line explanation that `display_order` is now the curated
  All order.

Failing closed is deliberately chosen over adding a `manifest_index` column to
keep an import-era script alive. `README.md` line 44 documents
`npm run publish:selections` and must say so.

## 2. Admin UI (the Shop shelf)

### Loader

`app/admin/wall/page.tsx` gains, per photo: `collection_id`,
`collection_title`, `collection_order`, `display_order`. Plus a second query for
the collections list (id, title, in `display_order`) so the tray shows chapters
with zero shop members, and a third for `shop_index_limit`. All keep the
existing fail-soft try/catch.

Adding fields to `LibraryPhoto` in `lib/wall-arrange.ts` breaks two other
construction sites that must be updated in the same change or typecheck fails:
`app/dev-preview/wall/page.tsx` and `tests/lib/wall-arrange-library.test.ts`.
Commit `d67d411` already had to touch both for the same reason.

### Deriving the two scope orders

The loader sorts `ORDER BY a.updated_at DESC LIMIT 1000`, which is not either
shelf order. The Wall solves this by computing `wall_rank` in SQL so the admin
order equals the public order exactly; the Shop does not need that, because
after the densify both orders are dense integers with no hash fallback. Derive
client-side in `lib/wall-arrange.ts`, alongside `deriveWallIds`:

- **All**: shop members sorted by `display_order`, then `id`.
- **Collection**: shop members with that `collection_id`, sorted by
  `collection_order`, then `id`.

The `, id` tiebreak is required and must match the public queries exactly, or
the admin order and the live order disagree whenever two rows share a position.

### Filter tray

A segmented control styled on `.wl-adm-seg`:

```
All (n) · <each collection, in collections.display_order> (n) · Unfiled (n)
```

**`.wl-adm-seg` cannot wrap as it stands.** It is `display: inline-flex` with
`overflow: hidden` and its buttons carry `white-space: nowrap`, so an
overflowing row is *clipped*. Wrapping needs `flex-wrap: wrap` plus a rework of
the `:last-child` border rule, which only clears the divider on the final
button and leaves a stray one at the end of every wrapped row. `.wl-adm-ws-head`
also needs `flex-wrap: wrap`; only the Library head sets it today.

`.wl-adm-seg` is shared with the artworks-list status tabs and the Library
filters. Both must be checked after the change.

**Counts come from client `photos` state, not the server query**, or they go
stale the instant `placeInShop`, `removeFromShop`, or `bulkApply('shopOn')`
runs.

The active filter persists to `localStorage` beside `wl-wall-min` and is **read
post-mount**, exactly as `wl-wall-min` is, so SSR renders the default and there
is no hydration mismatch. A persisted filter naming a deleted collection falls
back to All.

**Head height.** `.wl-adm-ws-head` is `flex: 0 0 auto` inside the user-resizable
shelf band, whose floor is 120px. A wrapping tray plus the limit field plus the
readout eats tile area, so `clampBand` must account for a multi-row Shop head.

### Scope determines which order you edit

All writes `display_order`. A collection writes `collection_order` for that
collection only. Unfiled writes nothing. The two never write each other.

### Reorder interaction

Mirror the Wall's model: `dragEnter` live-reorders local state, `dragEnd`
auto-saves the scope order, and each tile gets a position badge (click the
number, type a position, Enter).

The badge is not garnish. The Shop shelf sits in the same height-capped band as
the Wall, and `dragEnter` cannot fire on a tile clipped out of view, so without
it a photo cannot move more than about a row and there is no keyboard path.

**Commit on `dragEnd`, never `drop`.** Chromium does not deliver a `drop` event
when the drag source node was moved mid-drag, which a live reorder always does.
`/admin/collections` sidesteps the same trap with an explicit Save button.

**"Mirror the Wall" does not mean "share the Wall's state."** Each of these
needs a scoped counterpart:

- `focusPos()` queries `[data-pos-id]`. A photo both on the wall and in the shop
  matches two elements, so focus after a Shop reorder lands on the Wall tile.
- `inFlight` (`busy || savingOrder`) and `savedFlash` are shared, so a Shop save
  disables the Wall and flashes "order saved ✓" in the Wall's head.
- `savedWallIds` needs a `savedShopIds` equivalent, keyed per scope, for the
  dirty check and rollback.
- `announce()` / `liveRef` emit Wall-specific strings ("Wall order saved",
  "Moved to position N of M"). The Shop needs its own, naming the scope.

A reorder POST in flight when the admin switches filters must not roll back into
the new scope on failure: tag the request with its scope and discard the
rollback if the scope changed, surfacing the error instead.

### The cut line

**All view only**, after the Nth tile, with everything below subdued and labeled
as not appearing on `/shop`. It counts **buyable tiles only**, because the
public query filters unbuyable rows out *before* applying the limit.

- **N = 0** (unlimited): no line, head says "showing all M buyable".
- **N greater than the buyable count M**: no line, head says
  "showing all M buyable". (Not "all N": with limit 50 and 12 buyable, "showing
  all 50" is wrong.)
- **Zero buyable tiles**: no line; existing blocked messaging carries it.

### The limit control

A number field in the All head: "Show the first N on /shop", `0` meaning no
limit, labeled on the field.

Client rules mirror the server exactly: integer, `0` to `500`, rejected inline
with the reason otherwise. Pending state while saving, revert to last saved
value on failure with a message, confirm on success. Both sides share one
validator from `lib/`, rather than two copies that drift.

Beside it, "showing N of M buyable". One mistyped digit otherwise removes the
catalog from `/shop` for the revalidate window with nothing on screen to notice
it by.

### Tile changes

Each tile in the All view shows its collection name as a small read-only label,
"unfiled" when it has none. Plate numbers do not go on admin thumbnails: commits
`1f23519` and `d67d411` deliberately stripped names and prices to quiet them.

### Unfiled is a worklist

Drag disabled, position badges hidden. There is no "unfiled order" to save, and
dragging within a partial view of the All order is ambiguous: dropping A above B
when six photos sit between them in the full order has no single right answer.
Tiles keep their Edit link.

A tile that is unfiled **and** below the cut line is reachable from nowhere on
the site except the sitemap. Those get a distinct badge.

### Empty states

- Collection filter, zero shop members: "Nothing in this chapter is in the shop
  yet."
- Unfiled, empty: "Every photo in the shop belongs to a chapter."
- The existing All-scoped "Drag photos with a print file here" must not show
  under a chapter filter, where it reads as wrong.

## 3. Public surfaces

### Collection order, three query changes

`ORDER BY a.display_order, a.id` becomes `ORDER BY a.collection_order, a.id` in:

- `app/(shop)/shop/collections/[slug]/page.tsx`, the chapter grid
- `app/(shop)/portfolio/[slug]/page.tsx`, the same collection unfiltered by
  buyability
- `app/(shop)/shop/artwork/[slug]/page.tsx`, the related rail

The two collection *index* pages already sort by `collections.display_order`.

### All order and the limit

`app/(shop)/shop/page.tsx` applies the limit. Three requirements, each fixing a
way the obvious implementation breaks:

**Parameterized, never interpolated.** `site_settings.value` is `TEXT`, and
splicing it into raw SQL in a repo with no ORM is a second-order injection sink.

**`LIMIT NULLIF($1, 0)`.** In Postgres `LIMIT 0` returns *zero rows*; only
`LIMIT NULL` means unlimited. Without `NULLIF`, typing `0` blanks the storefront
for the revalidate window.

**A read helper that cannot throw.** `lib/site-settings.ts` exposes
`getShopIndexLimit()`: read the row, `Number.isInteger` clamp to `0..500`, and
return `12` on anything else, including a **thrown** query. A missing
`site_settings` table (42P01) on a fresh, preview, or restored Neon branch is
the realistic case, and `/shop` has no try/catch of its own.

**Accept the extra round trip.** The limit must be known before the plates
query, so run the counts query and the settings read in the existing
`Promise.all`, then the plates query. An earlier draft insisted on avoiding the
serial hop by folding the lookup into a `LIMIT (SELECT …)` subquery; that is
valid SQL but it puts the settings read inside the grid query, so one throw
takes the grid down with it. Correctness beats the round trip. This also
resolves the contradiction in that draft, which promised a real unlimited and
then proposed a hard SQL ceiling: there is no ceiling beyond the field's own
`500` max.

### `/shop` header

"Index of plates" becomes **"Selected works"**, and the count beside it
describes the grid rather than the archive. The masthead's "Plates on file 024"
keeps counting the whole archive.

`components/site/Footer.tsx` links `/shop` with the label "Index of plates" and
must be updated in the same change, or the rename leaves a stale pointer.

### Browse by collection band

A band on `/shop`, **below** the Selected works grid, listing chapters in
`collections.display_order`, each linking to its collection page. Reuses the
chapter-row treatment from `/shop/collections`, with two corrections: that page
counts `status='published'` while the destination grid filters to buyable, and
it `LEFT JOIN`s so empty chapters render. Here, **count buyable-published and
omit zero-count chapters**.

Omitting chapters breaks the `CH · NN` numbering, which comes from the array
index and would then disagree with "Chapter 03 of 06" on the chapter and
portfolio pages (those `ROW_NUMBER()` over *all* collections). Either number
from the collection's true position or drop the `CH · NN` marker in the band.

The band's query joins the existing `Promise.all` rather than running serially.
If there are no collections, the band does not render.

### Revalidation

These pages are `revalidate = 60`, and there is no `revalidatePath` call
anywhere in the repo. The admin says so in the shelf head after a successful
save rather than leaving it to be discovered.

### Known interaction with the plate-numbers spec

`app/(shop)/shop/artwork/[slug]/page.tsx` computes
`ROW_NUMBER() OVER (ORDER BY a.display_order, a.id)` and renders "Plate 07 of
24". This spec makes `display_order` something Dan deliberately arranges, so
**between this deploy and the plate-numbers deploy, that index will shift
whenever he reorders the shop.**

Accepted rather than patched. It is already unstable (any new publish shifts
it), so this widens existing behavior rather than introducing a new class of
problem, and the plate-numbers spec deletes the window function entirely. A
stopgap here would change the visible numbers twice instead of once.

## 4. API contracts

### `POST /api/admin/shop/order`

```
{ scope: 'all', ids: number[] }
{ scope: 'collection', collectionId: number, ids: number[] }
```

**Inside `withTransaction`, with a rollback on mismatch.** This is not optional
polish. The write is a single statement, but a single statement in autocommit
has already committed by the time any assertion runs, so a post-hoc check would
report corruption it had just made durable.

```sql
UPDATE artworks a
   SET display_order = v.ord            -- or collection_order
  FROM (SELECT id, ord FROM unnest($1::int[]) WITH ORDINALITY AS t(id, ord)) v
 WHERE a.id = v.id
   AND a.status = 'published'
   AND a.collection_id = $2;            -- collection scope ONLY
```

Use **two literal SQL strings**, one per scope. Building the `SET` column name
from the request's `scope` value is an identifier-interpolation trap.

**Guards, all inside the transaction, all rolling back on failure:**

- `AND a.collection_id = $2` on the collection scope, or a stale client
  renumbers rows in a collection it is not looking at.
- `AND a.status = 'published'` on **both** scopes, or a stale tab stamps a
  nonzero position onto a draft and destroys the `0` sentinel Rule 2 depends on.
- `rowCount = ids.length`, else rollback and 409. The guards above skip
  non-matching rows silently, so survivors would take sparse ordinals (1, 3,
  5…) from the full array's `WITH ORDINALITY`.
- `ids.length = (SELECT COUNT(*) …)` for the scope, else rollback and 409. None
  of the above catches a **short** payload: a strict subset where every row
  matches passes `rowCount = ids.length` and gets renumbered `1..k`, colliding
  with the rows outside it. Latent at current row counts, live the moment
  published artworks exceed the loader's `LIMIT 1000`.

**On 409 the client rolls back to `savedShopIds`, shows "the shop changed in
another window", and reloads after a short delay.** The Wall has no 409 path;
its two behaviors are 404 → `dropStale` with no reload, and timeout →
`reconcileAfterTimeout` with a 1200ms reload. This follows the latter. The
admin's pending arrangement is lost, which is correct: it was built against a
membership that no longer exists.

**Payload cap 1000**, matching the loader's `LIMIT 1000`;
`/api/admin/wall` documents that the two stay in lockstep. Zod-validated with
the duplicate-id refinement the collections route carries. `requireAdmin` **and**
`requireSameOrigin`, copying the artwork routes; the collections route uses
`requireAdmin` alone and is the wrong model.

**Do not set `updated_at = NOW()`**, even though `/api/admin/wall` does. The
admin Library sorts `ORDER BY a.updated_at DESC`, so every drag would reshuffle
the Library under the user, and `app/sitemap.ts` uses `updated_at` as
`lastModified`, so every reorder would re-stamp every published artwork.

Unlike `/api/admin/wall`, this endpoint does not clear positions on rows outside
the payload. Deliberate: the scope is a filtered subset, and Rules 1 and 2 mean
no row entering the shop ever trusts a stale value.

### `PATCH /api/admin/settings`

Writes `shop_index_limit`. The key is a **Zod enum**, not a free-form string, so
a generic table never gets a generic writer. Value is an integer `0..500`,
validated by the same shared validator the client uses. Upsert
(`ON CONFLICT (key) DO UPDATE`), not a plain UPDATE, which is a silent no-op if
the seed row is missing. Same auth as above.

### Observability

Both routes log failures through `lib/logger.ts`, which forwards to Sentry; the
existing wall route's bare `console.error` does not. Log the scope, the id
count, and the resulting `rowCount`.

### One removal

Drop `display_order` from the artwork PATCH Zod schema. Ordering has a dedicated
endpoint now, and no admin UI sends it, so leaving a direct write path that
bypasses densification is a trap.

## Edge cases and invariants

- **Collection deleted.** `ON DELETE SET NULL`, so its photos become Unfiled.
  Their stale `collection_order` is never read without a `collection_id`, and
  Rule 3 overwrites it if they are filed again.
- **Gaps.** Positions are relative. Every reorder save rewrites the scope 1..N.
- **A photo above the cut loses buyability.** The grid backfills with the next
  buyable piece and the cut line recomputes; both count buyable only.
- **Concurrent admins.** Last-write-wins, plus the new 409 on a stale or short
  id list.

## Verification approach

### Unit tests (vitest, `tests/lib/`)

All of this must live in a `lib/` module, not inside the React component, or
vitest cannot reach it: there is no component-test harness.

- scope resolution, and the two order derivations including the `, id` tiebreak
- reorder and the order-dirty check
- filter counts including Unfiled
- the cut-line index over buyable-only tiles, with unbuyable tiles interleaved
  above and below, plus all three degenerate cases
- the shared `0..500` limit validator (used by both client and server)
- `getShopIndexLimit()` fallback: absent row, unparseable value, out-of-range
  value, and a thrown query all returning `12`

### Manual, on the live deploy

No integration harness exists, and the app cannot boot against a real database
on the current dev box.

1. Reorder in All; confirm `/shop` matches after revalidation.
2. Reorder within a collection; confirm the chapter page, portfolio page, and
   related rail match, and that `/shop` did **not** change.
3. Change the limit; confirm the cut line and the live grid agree. **Try `0`**
   and confirm the full catalog renders rather than a blank page.
4. **Retire a piece, then re-publish it**, and confirm it appends rather than
   landing mid-grid (Rules 1 and 2).
5. **Bulk-publish several drafts at once**; confirm distinct consecutive
   positions (Rule 2's `ROW_NUMBER()`).
6. **Bulk-move several photos to another chapter**; confirm they land at the end,
   not the front (Rule 3's batch case).
7. Re-select a photo's current chapter from the row menu; confirm it does *not*
   move (Rule 3's `IS DISTINCT FROM`).

### Gates

`npm run typecheck` and `npm test`. Not `npm run lint`, dead under Next 16 here.

## Pre-ship checks

- **Snapshot before the deploy that runs the backfill.** The densify is not
  revertible by reverting code, so take
  `CREATE TABLE artworks_order_backup_20260721 AS
   SELECT id, display_order, collection_id FROM artworks;`
  or a named Neon branch. Without it there is no recovery if the comparison
  below fails.
- Count production rows where `display_order <> 0`. Expect many, because
  `import-manifest` writes per-collection indices.
- Confirm the artwork count is under the 1000 payload cap and loader limit.
- Confirm no `scraped/selections.json` run is pending.
- Confirm the Neon major version, for the `statement_timeout` note above.

## Risks and rollback

- **The backfill is the risky step.** Order-preserving by construction and
  guarded to run once. Verify by comparing `/shop` and one collection page
  before and after, against the snapshot.
- **`display_order`'s meaning change is not code-revertible.** The
  manifest-index mapping `publish-selections.ts` relied on is destroyed. That
  script is fenced off rather than repaired.
- **Rollback.** The new columns are additive and the public query changes are
  the behavior change, so reverting the queries restores prior behavior without
  a down migration. `site_settings` can stay in place unused, **except**: if
  either order column is dropped and re-added, delete the
  `shop_order_backfilled` row too, or the backfill silently skips and every
  collection page sorts by `id`.

## Out of scope, follow-ups

- **Plate numbers.** `2026-07-21-plate-numbers-design.md`.
- **`/portfolio` versus `/shop/collections` duplication.** Two parallel browse
  trees over the same collections, one effectively orphaned. A structural
  decision about the site.
- **Collections in the main nav.** The browse band gives them one real entry
  point; a seventh nav item is a separate call.
- **Filter chips on the public `/shop`.** Rejected in favor of the existing
  navigational path.
- **`scripts/publish-selections.ts`.** Fenced off, not repaired. If needed
  again, decide then between preserving a `manifest_index` column and changing
  its input format to slugs.
- **`scripts/draft-export.mjs`** reads `display_order` (one-off, not in
  `package.json`, cosmetic output). Left alone; noted so it is not a surprise.
