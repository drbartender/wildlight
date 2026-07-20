# Wall & Shop Admin Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `/admin/wall` screen around a Library-as-base model with two shelves (The Wall, The Shop), replacing today's "grid + off-wall tray with per-tile switches," to end the admin confusion between wall membership, shop membership, and permanent delete.

**Architecture:** Front-end rewrite over axes that already exist. The Library shows every photo; The Wall (`on_wall`) and The Shop (`status='published'`) are shelves you place photos onto by dragging up or toggling. Removing from a shelf never deletes; delete lives only in the Library. No schema change, no endpoint change — the loader query broadens to all photos and the component calls the existing `PATCH`/`DELETE`/reorder routes. Pure ordering/filter logic lives in `lib/wall-arrange.ts` (unit-tested); the client component wires it to state + fetch (manually verified, per repo convention).

**Tech Stack:** Next.js 16 App Router (React server component loader + `'use client'` arranger), Postgres via `pg` raw SQL (`lib/db.ts`), Vitest (unit-only, `tests/lib/`), existing admin CSS tokens (`--adm-*`) in `app/admin/admin.css`.

## Global Constraints

- **Money is integer cents everywhere.** Format the shop price only via `formatUSD` from `lib/money.ts` — never `toFixed`, never `/100` inline. (`CLAUDE.md`)
- **Raw parameterized SQL via `pg`** (`lib/db.ts`); no ORM, no query-builder. The loader is a single `pool.query`, wrapped in try/catch to fail soft on a Neon cold start.
- **No new endpoint, no schema change.** Reuse `PATCH /api/admin/artworks/[id]` (`{on_wall}` / `{status}`), `DELETE /api/admin/artworks/[id]`, `POST /api/admin/wall`. Every one already enforces `requireAdmin` + `requireSameOrigin`; do not add or weaken a guard.
- **`_`-prefixed folders under `app/` are private (404).** Do not place any route file under one.
- **Copy rule (house style): no em dashes in user-facing copy.** Use commas, periods, colons, parentheticals.
- **Design source of truth:** `docs/superpowers/specs/2026-07-19-wall-shop-admin-redesign-design.md` and its "Review pass" section. The three confirm rules below and the load-bearing guards come from it.
- **Confirm rules (from spec, modality reconciled 2026-07-20):** Shop-placement (publish, goes live in `/shop`) takes a single native `confirm()` on both the toggle and drag paths. Wall placement never confirms (reversible, not commerce). Shelf Remove (Wall or Shop) uses a light inline two-state confirm ("Sure — remove?"). Library delete (permanent) uses inline two-state ("Delete forever?") + a final native `confirm()`.
- **No-op re-placement (load-bearing):** placing a photo already on the target shelf must skip the PATCH entirely — re-firing `{on_wall:true}` resets `wall_order=0` and would scramble the saved wall order.
- **Single serialization domain:** at most one mutation (place / remove / publish / retire / delete / reorder) is in flight at a time (`inFlight`), and controls/dragging are disabled while it round-trips.

---

### Task 1: Pure ordering + filter helpers (`lib/wall-arrange.ts`)

Add the pure helpers for the Library model and unit-test them, **additively**: the new exports (`LibraryPhoto`, `deriveWallIds`, `reorder`, `orderChanged`, `filterCounts`, `applyFilter`, `isInShop`) go in alongside the existing grid/tray helpers, which the current consumers still import. This keeps `typecheck`/`build` green after this commit and lets it be reverted independently; Task 2 removes the now-dead old exports when it rewrites the consumers. No React, no DB.

**Files:**
- Modify (append new exports; keep the existing ones): `lib/wall-arrange.ts`
- Create: `tests/lib/wall-arrange-library.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `interface LibraryPhoto { id:number; slug:string; title:string; image_web_url:string; status:'draft'|'published'|'retired'; on_wall:boolean; updated_at:string; hd:boolean; buyable:boolean; price_from_cents:number|null; wall_rank:number|null }`
  - `type FilterKey = 'all'|'wall'|'shop'|'unplaced'|'nohd'`
  - `isInShop(p:LibraryPhoto):boolean`
  - `deriveWallIds(photos:LibraryPhoto[]):number[]`
  - `reorder(ids:number[], dragId:number, overId:number):number[]`
  - `orderChanged(a:number[], b:number[]):boolean`
  - `filterCounts(photos:LibraryPhoto[]):Record<FilterKey,number>`
  - `applyFilter(photos:LibraryPhoto[], key:FilterKey):LibraryPhoto[]`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/wall-arrange-library.test.ts` with (the existing `tests/lib/wall-arrange.test.ts` stays untouched — Task 2 deletes it):

```ts
import { describe, it, expect } from 'vitest';
import {
  deriveWallIds,
  reorder,
  orderChanged,
  filterCounts,
  applyFilter,
  isInShop,
  type LibraryPhoto,
} from '@/lib/wall-arrange';

function photo(over: Partial<LibraryPhoto> & { id: number }): LibraryPhoto {
  return {
    id: over.id,
    slug: over.slug ?? `slug-${over.id}`,
    title: over.title ?? `Photo ${over.id}`,
    image_web_url: over.image_web_url ?? `https://img/${over.id}.jpg`,
    status: over.status ?? 'draft',
    on_wall: over.on_wall ?? false,
    updated_at: over.updated_at ?? '2026-07-19T00:00:00Z',
    hd: over.hd ?? false,
    buyable: over.buyable ?? false,
    price_from_cents: over.price_from_cents ?? null,
    wall_rank: over.wall_rank ?? null,
  };
}

describe('deriveWallIds', () => {
  it('returns on_wall ids ordered by wall_rank ascending', () => {
    const photos = [
      photo({ id: 1, on_wall: true, wall_rank: 3 }),
      photo({ id: 2, on_wall: false }),
      photo({ id: 3, on_wall: true, wall_rank: 1 }),
      photo({ id: 4, on_wall: true, wall_rank: 2 }),
    ];
    expect(deriveWallIds(photos)).toEqual([3, 4, 1]);
  });

  it('sorts null wall_rank (never-arranged) to the end, stably after ranked ones', () => {
    const photos = [
      photo({ id: 1, on_wall: true, wall_rank: null }),
      photo({ id: 2, on_wall: true, wall_rank: 5 }),
    ];
    expect(deriveWallIds(photos)).toEqual([2, 1]);
  });

  it('excludes off-wall photos entirely', () => {
    expect(deriveWallIds([photo({ id: 1, on_wall: false, wall_rank: 1 })])).toEqual([]);
  });
});

describe('reorder', () => {
  it('moves dragId to the position of overId', () => {
    expect(reorder([1, 2, 3, 4], 4, 2)).toEqual([1, 4, 2, 3]);
  });
  it('is a no-op when dragId === overId', () => {
    expect(reorder([1, 2, 3], 2, 2)).toEqual([1, 2, 3]);
  });
  it('is a no-op when an id is absent', () => {
    expect(reorder([1, 2, 3], 9, 2)).toEqual([1, 2, 3]);
  });
});

describe('orderChanged', () => {
  it('is false for equal sequences and true for a real move', () => {
    expect(orderChanged([1, 2, 3], [1, 2, 3])).toBe(false);
    expect(orderChanged([1, 3, 2], [1, 2, 3])).toBe(true);
  });
});

describe('filterCounts / applyFilter', () => {
  const photos = [
    photo({ id: 1, on_wall: true, status: 'published', hd: true }), // wall + shop
    photo({ id: 2, on_wall: true, status: 'draft', hd: true }),      // wall only
    photo({ id: 3, on_wall: false, status: 'published', hd: true }), // shop only
    photo({ id: 4, on_wall: false, status: 'draft', hd: false }),    // unplaced + no print
  ];
  it('counts each bucket', () => {
    expect(filterCounts(photos)).toEqual({ all: 4, wall: 2, shop: 2, unplaced: 1, nohd: 1 });
  });
  it('filters to the right subset', () => {
    expect(applyFilter(photos, 'wall').map((p) => p.id)).toEqual([1, 2]);
    expect(applyFilter(photos, 'shop').map((p) => p.id)).toEqual([1, 3]);
    expect(applyFilter(photos, 'unplaced').map((p) => p.id)).toEqual([4]);
    expect(applyFilter(photos, 'nohd').map((p) => p.id)).toEqual([4]);
    expect(applyFilter(photos, 'all').map((p) => p.id)).toEqual([1, 2, 3, 4]);
  });
  it('isInShop is exactly status === published', () => {
    expect(isInShop(photos[0])).toBe(true);
    expect(isInShop(photos[1])).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/projects/wildlight && npx vitest run tests/lib/wall-arrange-library.test.ts`
Expected: FAIL — the new exports (`deriveWallIds`, `reorder`, `orderChanged`, `filterCounts`, `applyFilter`, `isInShop`, `LibraryPhoto`) don't exist yet.

- [ ] **Step 3: Write the implementation**

**Append** the following to `lib/wall-arrange.ts`, below the existing exports (do NOT remove `WallTile`/`partition`/`toTray`/`toGrid`/`applyShop`/`orderKey`/`removeFromGrid` — the current `WallArranger.tsx`/`page.tsx` still import them until Task 2):

```ts
// Pure helpers for the Wall & Shop admin tool — no React, no DB. The Library
// model: every photo lives in `photos`; The Wall is the on_wall subset ordered
// by wall_rank; The Shop is the published subset. Keeping order/filter logic
// here makes it unit-testable (the component wires these to state + fetch).

export interface LibraryPhoto {
  id: number;
  slug: string;
  title: string;
  image_web_url: string;
  status: 'draft' | 'published' | 'retired';
  on_wall: boolean;
  /** ISO-ish text (cast `::text` in SQL). Loader sorts the Library newest-first. */
  updated_at: string;
  /** Has a print master → can be sold. Gates the Shop affordance. */
  hd: boolean;
  /** A buyable variant exists. Read ONLY together with isInShop (see spec). */
  buyable: boolean;
  /** Lowest buyable-variant price in cents, or null. Formatted via lib/money. */
  price_from_cents: number | null;
  /** Homepage wall position (1-based), computed in SQL; null when off-wall. */
  wall_rank: number | null;
}

export type FilterKey = 'all' | 'wall' | 'shop' | 'unplaced' | 'nohd';

/** Shop membership is exactly status==='published' (independent of buyability). */
export const isInShop = (p: LibraryPhoto): boolean => p.status === 'published';

/**
 * Initial Wall shelf order: the on_wall subset sorted by wall_rank. wall_rank is
 * computed server-side from the SAME expression the homepage orders by
 * ((wall_order=0), wall_order, md5(slug)), so the admin order equals the public
 * order without re-hashing client-side. Null ranks (shouldn't occur for on_wall
 * rows) sort last.
 */
export function deriveWallIds(photos: LibraryPhoto[]): number[] {
  const big = Number.MAX_SAFE_INTEGER;
  return photos
    .filter((p) => p.on_wall)
    .slice()
    .sort((a, b) => (a.wall_rank ?? big) - (b.wall_rank ?? big))
    .map((p) => p.id);
}

/** Move dragId to overId's slot. No-op if either is absent or they're equal. */
export function reorder(ids: number[], dragId: number, overId: number): number[] {
  if (dragId === overId) return ids;
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1) return ids;
  const next = ids.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Order-dirty check: has the live wall order diverged from the saved one? */
export function orderChanged(a: number[], b: number[]): boolean {
  return a.join(',') !== b.join(',');
}

export function filterCounts(photos: LibraryPhoto[]): Record<FilterKey, number> {
  return {
    all: photos.length,
    wall: photos.filter((p) => p.on_wall).length,
    shop: photos.filter(isInShop).length,
    unplaced: photos.filter((p) => !p.on_wall && !isInShop(p)).length,
    nohd: photos.filter((p) => !p.hd).length,
  };
}

export function applyFilter(photos: LibraryPhoto[], key: FilterKey): LibraryPhoto[] {
  switch (key) {
    case 'wall':
      return photos.filter((p) => p.on_wall);
    case 'shop':
      return photos.filter(isInShop);
    case 'unplaced':
      return photos.filter((p) => !p.on_wall && !isInShop(p));
    case 'nohd':
      return photos.filter((p) => !p.hd);
    default:
      return photos;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/projects/wildlight && npx vitest run tests/lib/wall-arrange-library.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Full typecheck + test suite (must be GREEN — the change is additive)**

Run: `cd ~/projects/wildlight && npm run typecheck && npm test`
Expected: PASS. The new exports are additive, so the existing consumers still compile against the old exports, and both the old `tests/lib/wall-arrange.test.ts` and the new `wall-arrange-library.test.ts` pass. This commit leaves the tree green and independently revertable.

- [ ] **Step 6: Commit**

```bash
cd ~/projects/wildlight
git add lib/wall-arrange.ts tests/lib/wall-arrange-library.test.ts
git commit -m "feat(wall): add Library-model pure helpers + unit tests

deriveWallIds/reorder/orderChanged/filterCounts/applyFilter + LibraryPhoto,
added alongside the existing grid/tray helpers (additive; consumers rewritten
and old helpers removed in Task 2)."
```

---

### Task 2: The screen — loader, loading state, and the Library + two-shelves component

Broaden the loader to every photo, add the `wall_rank` and shop-price columns, add a loading skeleton, and rewrite `WallArranger` into the Library + Wall + Shop UI. This is one atomic deliverable: the loader and component share the `LibraryPhoto` props contract, so they change together and are verified together against the spec's end-to-end checklist. Includes reorder (the highest-risk piece — verify it carefully in Step 8).

**Files:**
- Create: `app/admin/wall/loading.tsx`
- Modify: `app/admin/wall/page.tsx` (loader query + metadata + render)
- Modify (full rewrite): `components/admin/WallArranger.tsx`
- Modify: `app/admin/admin.css` (append a `.wl-adm-ws-*` block)
- Modify: `lib/wall-arrange.ts` (remove the now-dead old grid/tray exports)
- Delete: `tests/lib/wall-arrange.test.ts` (tested the removed old helpers)

**Interfaces:**
- Consumes: `LibraryPhoto`, `deriveWallIds`, `reorder`, `orderChanged`, `filterCounts`, `applyFilter`, `isInShop` from Task 1; `formatUSD` from `lib/money.ts`; the routes `PATCH`/`DELETE /api/admin/artworks/[id]` and `POST /api/admin/wall`.
- Produces: `WallArranger({ photos: LibraryPhoto[] })` (the new prop is `photos`, replacing `initialGrid`/`initialTray`).

- [ ] **Step 1: Append the shelf/library CSS**

Append this block to the end of `app/admin/admin.css` (uses existing `--adm-*` tokens; the segmented control `.wl-adm-seg` and `.wl-adm-sr-only` already exist):

```css
/* ── Wall & Shop redesign (Library + two shelves) ───────────────────── */
.wl-adm-ws-shelves { display: grid; grid-template-columns: 3fr 2fr; gap: 22px; align-items: start; }
.wl-adm-ws-shelves.stacked { display: flex; flex-direction: column; }
@media (max-width: 1000px) { .wl-adm-ws-shelves { display: flex; flex-direction: column; } }

.wl-adm-ws-shelf { background: var(--adm-card); border: 1px solid var(--adm-rule); border-radius: var(--adm-radius-lg); padding: 16px; transition: border-color 120ms, box-shadow 120ms; }
.wl-adm-ws-shelf.hot-ok { border-color: var(--adm-green); box-shadow: 0 0 0 1px var(--adm-green); }
.wl-adm-ws-shelf.hot-bad { border-color: var(--adm-red); }
.wl-adm-ws-library { background: var(--adm-paper-alt); border: 1px solid var(--adm-rule); border-radius: var(--adm-radius-lg); padding: 16px; }

.wl-adm-ws-head { display: flex; align-items: center; gap: 10px; }
.wl-adm-ws-head.open { margin-bottom: 12px; }
.wl-adm-ws-head h3 { margin: 0; font-size: 1rem; }
.wl-adm-ws-meta { font-family: var(--f-mono), monospace; font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--adm-muted); }
.wl-adm-ws-note { font-size: 12px; color: var(--adm-muted); }
.wl-adm-ws-saved { font-family: var(--f-mono), monospace; font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--adm-green); background: var(--adm-green-soft); padding: 2px 8px; border-radius: 999px; }
.wl-adm-ws-min { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; flex-shrink: 0; border: 1px solid var(--adm-rule); border-radius: var(--adm-radius-sm, 4px); background: transparent; color: var(--adm-muted); cursor: pointer; }
.wl-adm-ws-min svg { transition: transform 160ms; }
.wl-adm-ws-min.collapsed svg { transform: rotate(-90deg); }

.wl-adm-ws-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.wl-adm-ws-empty { border: 1.5px dashed var(--adm-rule); border-radius: var(--adm-radius-md); padding: 34px; text-align: center; color: var(--adm-muted); font-size: 13px; }

.wl-adm-ws-tile { position: relative; aspect-ratio: 3 / 2; border-radius: var(--adm-radius-sm, 4px); overflow: hidden; background: var(--adm-paper-alt); border: 1px solid var(--adm-rule); user-select: none; }
.wl-adm-ws-tile.grab { cursor: grab; }
.wl-adm-ws-tile.dragging { opacity: 0.4; outline: 2px dashed var(--adm-ink); outline-offset: -2px; }
.wl-adm-ws-tile img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
.wl-adm-ws-pos { position: absolute; top: 5px; left: 5px; z-index: 2; font-family: var(--f-mono), monospace; font-size: 10px; font-weight: 600; padding: 2px 5px; border-radius: 3px; background: rgba(0,0,0,0.6); color: #fff; }
.wl-adm-ws-cap { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 6px; padding: 12px 6px 5px 7px; background: linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0)); color: #fff; font-size: 10.5px; }
.wl-adm-ws-cap .name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; flex: 1; }
.wl-adm-ws-cap .price { font-family: var(--f-mono), monospace; font-size: 10px; }
.wl-adm-ws-rm { font-family: var(--f-mono), monospace; font-size: 9.5px; letter-spacing: 0.05em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.5); background: rgba(0,0,0,0.35); color: #fff; cursor: pointer; flex-shrink: 0; }
.wl-adm-ws-rm.confirming { background: var(--adm-red); border-color: var(--adm-red); }

.wl-adm-ws-badges { position: absolute; top: 5px; left: 5px; z-index: 2; display: flex; gap: 4px; }
.wl-adm-ws-badge { font-family: var(--f-mono), monospace; font-size: 9.5px; letter-spacing: 0.05em; text-transform: uppercase; padding: 2px 6px; border-radius: 3px; background: rgba(252,250,244,0.85); }
.wl-adm-ws-badge.hd { color: var(--adm-blue); border: 1px solid var(--adm-blue); }
.wl-adm-ws-badge.web { color: var(--adm-muted); border: 1px solid var(--adm-rule); }
.wl-adm-ws-badge.blocked { background: var(--adm-amber-soft); color: var(--adm-amber); border: 1px solid var(--adm-amber); }

.wl-adm-ws-del { position: absolute; bottom: 5px; right: 5px; z-index: 2; font-family: var(--f-mono), monospace; font-size: 9.5px; letter-spacing: 0.05em; text-transform: uppercase; padding: 3px 7px; border-radius: 3px; cursor: pointer; border: 1px solid var(--adm-rule); background: rgba(252,250,244,0.85); color: var(--adm-red); }
.wl-adm-ws-del.confirming { border-color: var(--adm-red); background: var(--adm-red); color: #fff; }

.wl-adm-ws-libitem { display: flex; flex-direction: column; }
.wl-adm-ws-libitem.dragging { opacity: 0.4; }
.wl-adm-ws-libctl { display: flex; align-items: center; gap: 6px; padding: 6px 2px 0; }
.wl-adm-ws-libctl .name { flex: 1; font-size: 11px; color: var(--adm-ink-2); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.wl-adm-ws-pill { font-family: var(--f-mono), monospace; font-size: 9.5px; letter-spacing: 0.05em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; cursor: pointer; line-height: 1; background: transparent; color: var(--adm-muted); border: 1px solid var(--adm-rule); }
.wl-adm-ws-pill.on-wall { background: var(--adm-ink); color: var(--adm-paper); border-color: var(--adm-ink); }
.wl-adm-ws-pill.on-shop { background: var(--adm-green); color: #fff; border-color: var(--adm-green); }
.wl-adm-ws-pill:disabled { color: var(--adm-dim); border-style: dashed; cursor: not-allowed; }
.wl-adm-ws-edit { font-size: 11px; color: var(--adm-muted); text-decoration: none; white-space: nowrap; }
.wl-adm-ws-edit:hover { color: var(--adm-ink); }
.wl-adm-ws-hint { display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; background: var(--adm-card); border: 1px solid var(--adm-rule); border-radius: var(--adm-radius-md); font-size: 13px; color: var(--adm-ink-2); line-height: 1.55; }
.wl-adm-ws-hint .dismiss { margin-left: auto; border: none; background: none; color: var(--adm-muted); font-size: 12px; cursor: pointer; flex-shrink: 0; }
```

- [ ] **Step 2: Create the loading skeleton**

Create `app/admin/wall/loading.tsx` (the loader is `force-dynamic` and now scans the whole catalog; on a slow Neon query Next renders this instead of blocking on a blank screen):

```tsx
export default function Loading() {
  return (
    <div className="wl-adm-wall" aria-busy="true">
      <p className="wl-adm-wall-hint">Loading the wall and shop…</p>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite the loader query and render**

Replace the entire contents of `app/admin/wall/page.tsx` with:

```tsx
import { pool } from '@/lib/db';
import { WallArranger } from '@/components/admin/WallArranger';
import type { LibraryPhoto } from '@/lib/wall-arrange';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Wall & shop · Wildlight admin' };

// Auth is enforced by app/admin/layout.tsx (getAdminSession → /login).
export default async function AdminWallPage() {
  // The Library shows EVERY photo (incl. retired and never-placed), so the old
  // (on_wall OR status<>'retired') filter is dropped — only reserved mid-upload
  // rows (empty web url) are excluded. wall_rank reproduces the homepage sort
  // ((wall_order=0), wall_order, md5(slug)) in SQL for on_wall rows, so the
  // admin wall order equals the public order with no client-side hashing. hd
  // gates the Shop; buyable + price_from_cents drive the Shop tile badge/price.
  // Fail soft on a Neon cold-start blip: render an empty screen, not a 500.
  let photos: LibraryPhoto[] = [];
  try {
    const res = await pool.query<LibraryPhoto>(
      `SELECT a.id, a.slug, a.title, a.image_web_url, a.status, a.on_wall,
              a.updated_at::text AS updated_at,
              (a.image_print_url IS NOT NULL AND a.image_print_url <> '') AS hd,
              EXISTS (SELECT 1 FROM artwork_variants v
                        WHERE v.artwork_id = a.id AND v.buyable) AS buyable,
              (SELECT MIN(v.price_cents) FROM artwork_variants v
                 WHERE v.artwork_id = a.id AND v.buyable) AS price_from_cents,
              CASE WHEN a.on_wall THEN (row_number() OVER (
                     PARTITION BY a.on_wall
                     ORDER BY (a.wall_order = 0), a.wall_order, md5(a.slug)
                   ))::int END AS wall_rank
         FROM artworks a
        WHERE a.image_web_url <> ''
        ORDER BY a.updated_at DESC
        LIMIT 1000`,
    );
    photos = res.rows;
  } catch (err) {
    console.error('[admin/wall] load failed:', err);
  }
  return <WallArranger photos={photos} />;
}
```

- [ ] **Step 4: Rewrite the arranger component**

Replace the entire contents of `components/admin/WallArranger.tsx` with:

```tsx
'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatUSD } from '@/lib/money';
import {
  applyFilter,
  deriveWallIds,
  filterCounts,
  isInShop,
  orderChanged,
  reorder,
  type FilterKey,
  type LibraryPhoto,
} from '@/lib/wall-arrange';

const HINT_KEY = 'wl-wall-hints-dismissed';

// Every mutation runs behind `inFlight` (disables controls + dragging) so the
// interaction models can't interleave. A hung request would wedge the page, so
// abort at 30s (server worst case = 15s connect + 15s statement_timeout). A
// timed-out request MAY have committed, so callers reconcile by reload rather
// than rolling back (see reconcileAfterTimeout).
const mutationTimeout = () => AbortSignal.timeout?.(30_000);
function isTimeout(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === 'TimeoutError' || err.name === 'AbortError')
  );
}
type MutResult = { ok: boolean; status: number; error?: string };
async function patchArtwork(id: number, body: Record<string, unknown>): Promise<MutResult> {
  try {
    const r = await fetch(`/api/admin/artworks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: mutationTimeout(),
    });
    if (r.ok) return { ok: true, status: r.status };
    const data = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: false, status: r.status, error: data.error };
  } catch (err) {
    return { ok: false, status: 0, error: isTimeout(err) ? 'timeout' : 'network error' };
  }
}

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'wall', label: 'On wall' },
  { key: 'shop', label: 'In shop' },
  { key: 'unplaced', label: 'Unplaced' },
  { key: 'nohd', label: 'No print file' },
];

type ConfirmKind = 'wallRemove' | 'shopRemove' | 'del';
type Confirm = { kind: ConfirmKind; id: number } | null;
type Drag = { id: number; from: 'lib' | 'wall' } | null;

export function WallArranger({ photos: initial }: { photos: LibraryPhoto[] }) {
  const [photos, setPhotos] = useState<LibraryPhoto[]>(initial);
  const [wallIds, setWallIds] = useState<number[]>(() => deriveWallIds(initial));
  const savedWallIds = useRef<number[]>(deriveWallIds(initial));

  const [filter, setFilter] = useState<FilterKey>('all');
  const [drag, setDrag] = useState<Drag>(null);
  const [dropTarget, setDropTarget] = useState<'wall' | 'shop' | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [wallMin, setWallMin] = useState(false);
  const [shopMin, setShopMin] = useState(false);
  const [hintsDismissed, setHintsDismissed] = useState(true); // hidden until localStorage read (avoids hydration flash)
  const [actionErr, setActionErr] = useState<string | null>(null);

  const [savingOrder, setSavingOrder] = useState(false);
  const inFlight = busy || savingOrder;

  const liveRef = useRef<HTMLDivElement>(null);
  const announce = (msg: string) => {
    if (liveRef.current) liveRef.current.textContent = msg;
  };

  // Post-mount: read the dismissal from localStorage (never during render).
  useEffect(() => {
    try {
      setHintsDismissed(window.localStorage.getItem(HINT_KEY) === '1');
    } catch {
      setHintsDismissed(false);
    }
  }, []);
  function dismissHints() {
    setHintsDismissed(true);
    try {
      window.localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  const byId = useMemo(() => {
    const m = new Map<number, LibraryPhoto>();
    for (const p of photos) m.set(p.id, p);
    return m;
  }, [photos]);
  const counts = filterCounts(photos);
  const wall = wallIds.map((id) => byId.get(id)).filter((p): p is LibraryPhoto => !!p);
  const shop = photos.filter(isInShop); // loader order (updated_at DESC)
  const libList = applyFilter(photos, filter);

  function setPhoto(id: number, patch: Partial<LibraryPhoto>) {
    setPhotos((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  // A stale row (deleted/retired elsewhere) returns 404: drop it everywhere and
  // announce, rather than showing a retry that would 404 again.
  function dropStale(id: number, title: string) {
    setPhotos((ps) => ps.filter((p) => p.id !== id));
    setWallIds((ids) => ids.filter((x) => x !== id));
    savedWallIds.current = savedWallIds.current.filter((x) => x !== id);
    setActionErr(`"${title}" was changed elsewhere and has been removed from this view.`);
  }
  function reconcileAfterTimeout() {
    setActionErr('That took too long to confirm — reloading to show the saved state…');
    announce('Request timed out; reloading');
    window.setTimeout(() => window.location.reload(), 1200);
  }

  // ── Wall placement (no confirm; reversible) ──────────────────────────
  async function placeOnWall(id: number) {
    if (inFlight) return;
    const p = byId.get(id);
    if (!p || p.on_wall) return; // no-op re-placement (never re-fires wall_order reset)
    setBusy(true);
    setActionErr(null);
    setPhoto(id, { on_wall: true });
    setWallIds((ids) => [...ids, id]);
    savedWallIds.current = [...savedWallIds.current, id];
    announce(`Put "${p.title}" on the wall`);
    const res = await patchArtwork(id, { on_wall: true });
    if (res.error === 'timeout') return reconcileAfterTimeout();
    if (!res.ok) {
      if (res.status === 404) dropStale(id, p.title);
      else {
        setPhoto(id, { on_wall: false });
        setWallIds((ids) => ids.filter((x) => x !== id));
        savedWallIds.current = savedWallIds.current.filter((x) => x !== id);
        setActionErr(`Couldn't put "${p.title}" on the wall — please try again.`);
      }
    }
    setBusy(false);
  }
  async function removeFromWall(id: number) {
    if (inFlight) return;
    const p = byId.get(id);
    if (!p || !p.on_wall) return;
    setBusy(true);
    setActionErr(null);
    setConfirm(null);
    setPhoto(id, { on_wall: false });
    setWallIds((ids) => ids.filter((x) => x !== id));
    savedWallIds.current = savedWallIds.current.filter((x) => x !== id);
    announce(`Removed "${p.title}" from the wall`);
    const res = await patchArtwork(id, { on_wall: false });
    if (res.error === 'timeout') return reconcileAfterTimeout();
    if (!res.ok) {
      if (res.status === 404) dropStale(id, p.title);
      else {
        setPhoto(id, { on_wall: true });
        setWallIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
        savedWallIds.current = savedWallIds.current.includes(id)
          ? savedWallIds.current
          : [...savedWallIds.current, id];
        setActionErr(`Couldn't take "${p.title}" off the wall — please try again.`);
      }
    }
    setBusy(false);
  }

  // ── Shop placement (always confirmed; hd-gated) ──────────────────────
  async function placeInShop(id: number) {
    if (inFlight) return;
    const p = byId.get(id);
    if (!p || isInShop(p)) return; // no-op re-placement
    if (!p.hd) {
      setActionErr(`"${p.title}" needs a print file before it can be sold.`);
      return;
    }
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Put "${p.title}" up for sale in the shop?`)) return;
    setBusy(true);
    setActionErr(null);
    setPhoto(id, { status: 'published' });
    announce(`Put "${p.title}" up for sale`);
    const res = await patchArtwork(id, { status: 'published' });
    if (res.error === 'timeout') return reconcileAfterTimeout();
    if (!res.ok) {
      setPhoto(id, { status: p.status });
      if (res.status === 404) dropStale(id, p.title);
      else
        setActionErr(
          res.status === 409
            ? res.error ?? `"${p.title}" needs a print file before it can be sold.`
            : `Couldn't put "${p.title}" up for sale — please try again.`,
        );
    }
    setBusy(false);
  }
  async function removeFromShop(id: number) {
    if (inFlight) return;
    const p = byId.get(id);
    if (!p || !isInShop(p)) return;
    setBusy(true);
    setActionErr(null);
    setConfirm(null);
    setPhoto(id, { status: 'retired' });
    announce(`Stopped selling "${p.title}"`);
    const res = await patchArtwork(id, { status: 'retired' });
    if (res.error === 'timeout') return reconcileAfterTimeout();
    if (!res.ok) {
      if (res.status === 404) dropStale(id, p.title);
      else {
        setPhoto(id, { status: p.status });
        setActionErr(`Couldn't stop selling "${p.title}" — please try again.`);
      }
    }
    setBusy(false);
  }

  // ── Library delete (permanent; two-step + native confirm) ────────────
  async function deletePhoto(id: number) {
    if (inFlight) return;
    const p = byId.get(id);
    if (!p) return;
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      `Last check — permanently delete "${p.title}"?\n\n` +
        `It will be removed from the Library, the Wall, and the Shop. This cannot be undone.`,
    );
    if (!ok) {
      setConfirm(null);
      return;
    }
    setBusy(true);
    setActionErr(null);
    setConfirm(null);
    let res: MutResult;
    try {
      const r = await fetch(`/api/admin/artworks/${id}`, {
        method: 'DELETE',
        signal: mutationTimeout(),
      });
      res = {
        ok: r.ok,
        status: r.status,
        error: r.ok ? undefined : ((await r.json().catch(() => ({}))) as { error?: string }).error,
      };
    } catch (err) {
      res = { ok: false, status: 0, error: isTimeout(err) ? 'timeout' : 'network error' };
    }
    if (res.error === 'timeout') return reconcileAfterTimeout();
    if (res.ok) {
      setPhotos((ps) => ps.filter((x) => x.id !== id));
      setWallIds((ids) => ids.filter((x) => x !== id));
      savedWallIds.current = savedWallIds.current.filter((x) => x !== id);
      announce(`Deleted "${p.title}"`);
    } else {
      setActionErr(
        res.error
          ? `Couldn't delete "${p.title}" — ${res.error}`
          : `Couldn't delete "${p.title}" — please try again.`,
      );
    }
    setBusy(false);
  }

  // ── Wall reorder (live on dragEnter, auto-save on dragEnd) ────────────
  function moveOver(overId: number) {
    if (!drag || drag.from !== 'wall') return;
    setWallIds((ids) => reorder(ids, drag.id, overId));
  }
  async function commitOrder() {
    if (!orderChanged(wallIds, savedWallIds.current)) return;
    setSavingOrder(true); // state (not a ref) so inFlight re-renders and disables controls
    const attempt = wallIds.slice(); // rebuild payload from current order, never a drag-start snapshot
    try {
      const r = await fetch('/api/admin/wall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: attempt }),
        signal: mutationTimeout(),
      });
      if (!r.ok) throw new Error(String(r.status));
      savedWallIds.current = attempt;
      setSavedFlash(true);
      announce('Wall order saved');
      window.setTimeout(() => setSavedFlash(false), 2200);
    } catch (err) {
      if (isTimeout(err)) return reconcileAfterTimeout(); // leave savingOrder true → controls stay disabled until reload
      setWallIds(savedWallIds.current); // revert to last-saved order
      setActionErr("Couldn't save the new wall order — please try again.");
    }
    setSavingOrder(false);
  }

  // ── Drag wiring ──────────────────────────────────────────────────────
  const overShelf = (which: 'wall' | 'shop') => (e: React.DragEvent) => {
    e.preventDefault();
    if (drag?.from === 'lib' && dropTarget !== which) setDropTarget(which);
  };
  const leaveShelf = (e: React.DragEvent) => {
    if (!(e.currentTarget as Node).contains(e.relatedTarget as Node)) setDropTarget(null);
  };
  const dropOnWall = (e: React.DragEvent) => {
    e.preventDefault();
    const d = drag;
    setDropTarget(null);
    setDrag(null);
    if (d?.from === 'lib') void placeOnWall(d.id);
  };
  const dropOnShop = (e: React.DragEvent) => {
    e.preventDefault();
    const d = drag;
    setDropTarget(null);
    setDrag(null);
    if (d?.from === 'lib') void placeInShop(d.id);
  };

  const shopHot = dropTarget === 'shop' && !!drag && byId.get(drag.id)?.hd;
  const shopBad = dropTarget === 'shop' && !!drag && !byId.get(drag.id)?.hd;

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="wl-adm-wall">
      <header className="wl-adm-wall-head">
        <div>
          <h1>Wall &amp; shop</h1>
          <p>
            Every photo lives in the Library. Drag one up onto the Wall (the
            homepage gallery) or the Shop (for sale), or use its toggles. Taking
            a photo off a shelf never deletes it. Only photos with a print file
            can go in the Shop.
          </p>
        </div>
        <div className="actions">
          <a className="wl-adm-wall-add" href="/admin/artworks/bulk-upload">
            Add photos
          </a>
        </div>
      </header>

      {actionErr && <p className="wl-adm-wall-err">{actionErr}</p>}

      {!hintsDismissed && (
        <div className="wl-adm-ws-hint">
          <div>
            Every photo lives in the <strong>Library</strong>. Drag one up into
            the <strong>Wall</strong> or the <strong>Shop</strong>, or both.
            Removing it from a shelf just returns it to Library-only. Only photos
            with a print file can be sold.
          </div>
          <button type="button" className="dismiss" onClick={dismissHints}>
            Dismiss
          </button>
        </div>
      )}

      <div className={`wl-adm-ws-shelves ${wallMin || shopMin ? 'stacked' : ''}`}>
        {/* THE WALL */}
        <section
          className={`wl-adm-ws-shelf ${dropTarget === 'wall' ? 'hot-ok' : ''}`}
          aria-label="The Wall"
          onDragOver={overShelf('wall')}
          onDragLeave={leaveShelf}
          onDrop={dropOnWall}
        >
          <div className={`wl-adm-ws-head ${wallMin ? '' : 'open'}`}>
            <button
              type="button"
              className={`wl-adm-ws-min ${wallMin ? 'collapsed' : ''}`}
              aria-label={wallMin ? 'Expand the Wall' : 'Minimize the Wall'}
              onClick={() => setWallMin((v) => !v)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <h3>The Wall</h3>
            <span className="wl-adm-ws-meta">homepage gallery · {wall.length}</span>
            <span style={{ flex: 1 }} />
            {savedFlash && <span className="wl-adm-ws-saved">order saved ✓</span>}
            {!wallMin && <span className="wl-adm-ws-note">Drag to reorder — saves automatically</span>}
          </div>
          {!wallMin && (
            wall.length === 0 ? (
              <div className="wl-adm-ws-empty">Drag photos here from the Library to hang them on the homepage.</div>
            ) : (
              <div className="wl-adm-ws-grid">
                {wall.map((p, i) => (
                  <figure
                    key={p.id}
                    className={`wl-adm-ws-tile grab ${drag?.id === p.id && drag.from === 'wall' ? 'dragging' : ''}`}
                    title={p.title}
                    draggable={!inFlight}
                    onDragStart={(e) => {
                      if (inFlight) return;
                      e.dataTransfer.setData('text/plain', String(p.id));
                      e.dataTransfer.effectAllowed = 'move';
                      setDrag({ id: p.id, from: 'wall' });
                    }}
                    onDragEnter={() => moveOver(p.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDragEnd={() => {
                      setDrag(null);
                      setDropTarget(null);
                      void commitOrder();
                    }}
                    onDrop={(e) => e.preventDefault()}
                  >
                    <span className="wl-adm-ws-pos">{i + 1}</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.image_web_url} alt={p.title} draggable={false} />
                    <figcaption className="wl-adm-ws-cap">
                      <span className="name">{p.title}</span>
                      <RemoveButton
                        confirming={confirm?.kind === 'wallRemove' && confirm.id === p.id}
                        disabled={inFlight}
                        label={`Remove ${p.title} from the wall`}
                        onClick={() =>
                          confirm?.kind === 'wallRemove' && confirm.id === p.id
                            ? void removeFromWall(p.id)
                            : setConfirm({ kind: 'wallRemove', id: p.id })
                        }
                      />
                    </figcaption>
                  </figure>
                ))}
              </div>
            )
          )}
        </section>

        {/* THE SHOP */}
        <section
          className={`wl-adm-ws-shelf ${shopHot ? 'hot-ok' : ''} ${shopBad ? 'hot-bad' : ''}`}
          aria-label="The Shop"
          onDragOver={overShelf('shop')}
          onDragLeave={leaveShelf}
          onDrop={dropOnShop}
        >
          <div className={`wl-adm-ws-head ${shopMin ? '' : 'open'}`}>
            <button
              type="button"
              className={`wl-adm-ws-min ${shopMin ? 'collapsed' : ''}`}
              aria-label={shopMin ? 'Expand the Shop' : 'Minimize the Shop'}
              onClick={() => setShopMin((v) => !v)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <h3>The Shop</h3>
            <span className="wl-adm-ws-meta">for sale · {shop.length}</span>
            <span style={{ flex: 1 }} />
            {!shopMin && <span className="wl-adm-ws-note">Exactly what customers can buy</span>}
          </div>
          {!shopMin && (
            shop.length === 0 ? (
              <div className="wl-adm-ws-empty">Drag photos with a print file here to put them up for sale.</div>
            ) : (
              <div className="wl-adm-ws-grid">
                {shop.map((p) => (
                  <figure key={p.id} className="wl-adm-ws-tile" title={p.title}>
                    {isInShop(p) && !p.buyable && (
                      <div className="wl-adm-ws-badges">
                        <span className="wl-adm-ws-badge blocked">hidden — sizes blocked</span>
                      </div>
                    )}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.image_web_url} alt={p.title} draggable={false} />
                    <figcaption className="wl-adm-ws-cap">
                      <span className="name">{p.title}</span>
                      <span className="price">{p.price_from_cents != null ? formatUSD(p.price_from_cents) : '—'}</span>
                      <RemoveButton
                        confirming={confirm?.kind === 'shopRemove' && confirm.id === p.id}
                        disabled={inFlight}
                        label={`Remove ${p.title} from the shop`}
                        onClick={() =>
                          confirm?.kind === 'shopRemove' && confirm.id === p.id
                            ? void removeFromShop(p.id)
                            : setConfirm({ kind: 'shopRemove', id: p.id })
                        }
                      />
                    </figcaption>
                  </figure>
                ))}
              </div>
            )
          )}
        </section>
      </div>

      {/* LIBRARY */}
      <section className="wl-adm-ws-library" aria-label="Library">
        <div className="wl-adm-ws-head open" style={{ flexWrap: 'wrap' }}>
          <h3>Library</h3>
          <span className="wl-adm-ws-meta">every photo · {counts.all}</span>
          <span style={{ flex: 1 }} />
          <div className="wl-adm-seg">
            {FILTERS.map((f) => (
              <button key={f.key} className={filter === f.key ? 'on' : ''} onClick={() => setFilter(f.key)}>
                {f.label} <span className="sub">{counts[f.key]}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="wl-adm-ws-note" style={{ margin: '0 0 12px' }}>
          Photos never leave the Library — drag one onto a shelf above, or use its Wall / Shop toggles. ✕ deletes the photo everywhere, forever.
        </p>
        {libList.length === 0 ? (
          <div className="wl-adm-ws-empty">
            {counts.all === 0 ? 'No photos yet.' : 'No photos match this filter.'}
          </div>
        ) : (
          <div className="wl-adm-ws-grid">
            {libList.map((p) => {
              const onWall = p.on_wall;
              const inShop = isInShop(p);
              const delConfirming = confirm?.kind === 'del' && confirm.id === p.id;
              return (
                <div key={p.id} className={`wl-adm-ws-libitem ${drag?.id === p.id && drag.from === 'lib' ? 'dragging' : ''}`}>
                  <figure
                    className="wl-adm-ws-tile grab"
                    title={p.title}
                    draggable={!inFlight}
                    onDragStart={(e) => {
                      if (inFlight) return;
                      e.dataTransfer.setData('text/plain', String(p.id));
                      e.dataTransfer.effectAllowed = 'copy';
                      setDrag({ id: p.id, from: 'lib' });
                      setConfirm(null);
                    }}
                    onDragEnd={() => {
                      setDrag(null);
                      setDropTarget(null);
                    }}
                  >
                    <div className="wl-adm-ws-badges">
                      {p.hd ? (
                        <span className="wl-adm-ws-badge hd" title="Has a print file — can be sold">hd</span>
                      ) : (
                        <span className="wl-adm-ws-badge web" title="No print file yet — upload one to sell this photo">web only</span>
                      )}
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.image_web_url} alt={p.title} draggable={false} />
                    <button
                      type="button"
                      className={`wl-adm-ws-del ${delConfirming ? 'confirming' : ''}`}
                      aria-label={`Delete ${p.title} forever`}
                      disabled={inFlight}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (delConfirming) void deletePhoto(p.id);
                        else setConfirm({ kind: 'del', id: p.id });
                      }}
                    >
                      {delConfirming ? 'Delete forever?' : '✕'}
                    </button>
                  </figure>
                  <div className="wl-adm-ws-libctl">
                    <span className="name">{p.title}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={onWall}
                      className={`wl-adm-ws-pill ${onWall ? 'on-wall' : ''}`}
                      disabled={inFlight}
                      title={onWall ? 'On the wall — click to take it down' : 'Click to hang it on the homepage wall'}
                      onClick={() => (onWall ? void removeFromWall(p.id) : void placeOnWall(p.id))}
                    >
                      Wall
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={inShop}
                      className={`wl-adm-ws-pill ${inShop ? 'on-shop' : ''}`}
                      disabled={inFlight || !p.hd}
                      title={
                        !p.hd
                          ? 'Needs a print file before it can be sold'
                          : inShop
                            ? 'In the shop — click to stop selling it'
                            : 'Click to put it up for sale'
                      }
                      onClick={() => (inShop ? void removeFromShop(p.id) : void placeInShop(p.id))}
                    >
                      Shop
                    </button>
                    <Link className="wl-adm-ws-edit" href={`/admin/artworks/${p.id}`} title={`Edit ${p.title} details`}>
                      Edit ↗
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div ref={liveRef} aria-live="polite" className="wl-adm-sr-only" />
    </div>
  );
}

// Module scope (avoids react/no-unstable-nested-components). Props only.
function RemoveButton({
  confirming,
  disabled,
  label,
  onClick,
}: {
  confirming: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`wl-adm-ws-rm ${confirming ? 'confirming' : ''}`}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {confirming ? 'Sure — remove?' : 'Remove'}
    </button>
  );
}
```

- [ ] **Step 4b: Remove the now-dead old helpers**

The rewritten consumers no longer import the grid/tray helpers. In `lib/wall-arrange.ts`, delete the old code: the `WallTile` / `WallSections` / `Snapshotted` types and the `partition` / `orderKey` / `removeFromGrid` / `toTray` / `toGrid` / `applyShop` functions — keep only the Library-model exports added in Task 1. Then remove the old test file:

Run: `cd ~/projects/wildlight && git rm tests/lib/wall-arrange.test.ts`
Expected: staged for deletion; only `tests/lib/wall-arrange-library.test.ts` remains under `tests/lib/`.

- [ ] **Step 5: Typecheck**

Run: `cd ~/projects/wildlight && npm run typecheck`
Expected: PASS with no errors (the loader and component now agree on the `photos: LibraryPhoto[]` contract; all `lib/wall-arrange` imports resolve; nothing imports the removed old exports).

- [ ] **Step 6: (ESLint runs inside the build — no standalone lint)**

`next lint` was removed in Next 16, so there is no `npm run lint`. ESLint runs as
part of `next build` (Step 7), which is the real gate for
`react/no-unstable-nested-components`, `no-alert` (inline-disabled where used),
and `@next/next/no-img-element` (inline-disabled on each `<img>`). Nothing to run
here; proceed to the build.

- [ ] **Step 7: Production build**

Run: `cd ~/projects/wildlight && npm run build`
Expected: build succeeds (migrations run first, then `next build`). If it fails only on an unrelated pre-existing migration/env issue, note it and continue; otherwise fix before proceeding.

- [ ] **Step 8: Manual end-to-end verification (the acceptance gate)**

Start the dev server (`npm run dev`), log into `/admin`, open `/admin/wall`, and confirm each scenario from the spec. Reordering (8.4) is the highest-risk path — verify it against the public homepage.

  - [ ] 8.1 The screen shows Library (every photo, newest first), a Wall shelf, and a Shop shelf. The hint banner shows on first load; Dismiss hides it and it stays hidden after reload.
  - [ ] 8.2 Drag a `web only` photo from the Library onto the Wall → it appears on the Wall; its Library Wall pill goes on; the public homepage `/` shows it after refresh. Its Library Shop pill is disabled.
  - [ ] 8.3 Drag an `hd` photo onto the Shop → native confirm prompt → accept → it appears in the Shop shelf and on `/shop`. A piece with a KNOWN priced buyable variant shows that exact price (e.g. a $420 variant renders "$420.00", confirming cents→dollars via `formatUSD`). An `hd`, published piece with NO buyable variant shows the amber "hidden — sizes blocked" badge and price "—".
  - [ ] 8.4 **Reorder the Wall**: drag a tile to a new slot, release → "order saved ✓" flashes. Refresh `/admin/wall` AND the public `/` homepage → both show the new order and they match.
  - [ ] 8.5 Re-drag a photo that is ALREADY on the Wall back onto the Wall → nothing changes and the saved order is NOT scrambled (verify the homepage order is unchanged). Same for an already-published photo dropped on the Shop.
  - [ ] 8.6 Drag a `web only` (non-hd) photo onto the Shop → the shelf border turns red and no placement happens (inline "needs a print file" error).
  - [ ] 8.7 On a Wall tile and a Shop tile, click Remove → "Sure — remove?" → click again → the photo leaves the shelf but remains in the Library with its pill off; homepage/shop update.
  - [ ] 8.8 In the Library, click ✕ on a never-sold photo → "Delete forever?" → click again → native confirm → accept → the photo is gone from Library, Wall, Shop. Try ✕ on a sold photo → inline 409 message, the photo stays.
  - [ ] 8.9 Filters (All / On wall / In shop / Unplaced / No print file) show correct counts and subsets; a filter matching zero shows "No photos match this filter." Minimize each shelf (the layout stacks). "Edit ↗" opens `/admin/artworks/[id]`.
  - [ ] 8.10 While a mutation round-trips (place / remove / publish / delete / reorder-save), controls and tile dragging are disabled (the single `inFlight` guard): rapidly clicking two pills does not double-fire; a second action waits until the first resolves.

- [ ] **Step 8b: Focused review checkpoint (publish + delete are commerce paths)**

This change drives publish (goes live in `/shop`), retire, and permanent delete, so run a proportional **code + consistency** review over the diff before committing (not a full security review — no new endpoint, no weakened guard). Verify specifically: the no-op re-placement guard truly prevents the `wall_order=0` reset on a re-drag/re-toggle; the single `inFlight` guard disables controls/dragging during EVERY mutation incl. the reorder POST; the `{on_wall}` / `{status}` / `{ids}` payloads match the existing route contracts; and price renders via `formatUSD` (cents in, no float/inline math). Fix anything it surfaces before Step 9.

- [ ] **Step 9: Commit**

```bash
cd ~/projects/wildlight
git add app/admin/wall/page.tsx app/admin/wall/loading.tsx components/admin/WallArranger.tsx app/admin/admin.css lib/wall-arrange.ts
git commit -m "feat(wall): Library + two-shelves Wall & Shop admin screen

Rebuild /admin/wall around a Library base with Wall/Shop shelves: drag or
toggle to place, auto-save reorder, shelf remove (never deletes), Library-only
delete, hd-gated shop with confirm-on-publish, filters, collapsible shelves.
Loader broadened to every photo with wall_rank/hd/price. No schema or endpoint
change."
```

---

### Task 3: Sidebar relabel + final verification

Relabel the nav item and run the full gate one more time against the merged change set. Small, but its own reviewable unit (a copy change plus the whole-feature sign-off).

**Files:**
- Modify: `components/admin/AdminSidebar.tsx:41`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new.

- [ ] **Step 1: Relabel the nav item**

In `components/admin/AdminSidebar.tsx`, in the `CATALOG` array, change the `wall` entry's label (line 41):

```tsx
  {
    id: 'wall',
    label: 'Wall & shop',
    href: '/admin/wall',
    icon: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    match: ({ path }) => path.startsWith('/admin/wall'),
  },
```

(Only the `label` string changes, from `'Arrange wall'` to `'Wall & shop'`. The `href`, `icon`, and `match` are unchanged; the route stays `/admin/wall`.)

- [ ] **Step 2: Typecheck + unit tests + build**

Run: `cd ~/projects/wildlight && npm run typecheck && npm test && npm run build`
Expected: typecheck clean, all Vitest suites pass (including the rewritten `tests/lib/wall-arrange.test.ts`), build succeeds.

- [ ] **Step 3: Verify the label in the running app**

With `npm run dev`, confirm the sidebar Catalog group now reads "Wall & shop" and that clicking it still lands on `/admin/wall` with the item marked active.

- [ ] **Step 4: Commit**

```bash
cd ~/projects/wildlight
git add components/admin/AdminSidebar.tsx
git commit -m "feat(wall): relabel sidebar nav 'Arrange wall' → 'Wall & shop'"
```

---

## Deferred (recorded in the spec's Review pass; out of scope for this plan)

These flow/UX items are intentionally not built here. Revisit if they bite in use: default Library filter tuning vs a large retired-duplicate backlog (currently defaults to "All"); optimistic wall-append vs the homepage md5-shuffle before a reload; touch-drag reordering and DnD keyboard a11y (pre-existing follow-up — placement via toggles already works on touch); Library pagination if the catalog approaches the 1000-row cap; Shop-shelf reordering; R2 orphan reaping after a hard delete (pre-existing follow-up); reconciling the `POST /api/admin/wall` 600-id cap if the wall ever exceeds 600; remove-from-shelf focus management (the removed shelf tile unmounts, dropping focus to `<body>` — the action is announced via `aria-live`, but no destination focus target is set); and an explicit reorder-save Retry control (today the failure path reverts to the saved order, and re-dragging is the retry).

## Self-Review

- **Spec coverage:** Library + two shelves (Task 2 component); loader broadened to all photos with hd/buyable/price/wall_rank (Task 2 loader); drag + toggle placement, no-op re-placement guard, confirm-on-publish, hd gating, shelf remove, Library-only two-step+native delete with 409 guard, auto-save reorder under `inFlight` with savedWallIds revert/timeout-reconcile, filters + counts, collapsible shelves, hint banner (post-mount localStorage), Edit ↗ link, aria-live, empty/filtered-zero states, loading skeleton, stale-row 404 reconcile (Task 2); sidebar relabel + metadata title (Task 2/3); unit tests for the pure helpers (Task 1). No schema/endpoint change (constraint respected). All spec sections map to a task.
- **Placeholder scan:** no TBD/TODO; every code step shows complete code; every command has an expected result.
- **Type consistency:** `LibraryPhoto`, `FilterKey`, `deriveWallIds`, `reorder`, `orderChanged`, `filterCounts`, `applyFilter`, `isInShop` are defined in Task 1 and consumed with the same names/signatures in Task 2; the component prop is `photos: LibraryPhoto[]` in both the loader render and the component definition; `formatUSD(cents:number)` matches `lib/money.ts`.
