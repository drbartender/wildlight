# Wall & Shop Curation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Dan add, delete, and independently toggle each photo's *wall* membership and *shop* membership from the `/admin/wall` tool, decoupling "shown on the wall" from "for sale."

**Architecture:** Add one `artworks.on_wall` boolean (the wall axis); the shop axis stays the existing `published + buyable variant`. The homepage wall reads `on_wall`; the admin tool grows a Wall switch, a Shop switch, a staged-batch Delete, an off-the-wall tray, and an Add-photos link. Pure array/snapshot transforms live in a unit-tested `lib/wall-arrange.ts`; everything else reuses existing endpoints (`PATCH`/`DELETE /api/admin/artworks/[id]`, `POST /api/admin/wall`).

**Tech Stack:** Next.js 16 App Router (RSC + client components), Postgres via raw `pg` (idempotent `lib/schema.sql` re-run on every build), Zod, Vitest (lib-only).

**Spec:** `docs/superpowers/specs/2026-06-11-wall-shop-curation-design.md`

**Branch:** `feat/wall-shop-curation` (already checked out). Commit per task.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `lib/schema.sql` | `on_wall` column + one-time backfill + index | Modify (~line 501) |
| `lib/wall-arrange.ts` | Pure tile/section/snapshot transforms + `WallTile` type | Create |
| `tests/lib/wall-arrange.test.ts` | Unit tests for the above | Create |
| `app/api/admin/artworks/[id]/route.ts` | `on_wall` in PATCH schema + `wall_order=0` reset | Modify |
| `app/(shop)/page.tsx` | Homepage wall reads `on_wall` | Modify (line 53) |
| `app/admin/wall/page.tsx` | Single partition query → grid + tray | Modify |
| `components/admin/WallArranger.tsx` | Grid + tray + switches + staged delete + add | Rewrite |
| `app/admin/admin.css` | Styles for switches, tray, staged/Undo, confirm, sr-only | Modify (~line 1632) |

**Dependency order:** schema → `wall-arrange` (imported by page + component) → PATCH route → homepage query → admin page → component → CSS → final verification.

**Testing reality (per `CLAUDE.md`):** Vitest is lib-only; routes, RSC queries, and UI are **not** unit-tested here. TDD applies fully to Task 2 (`lib/wall-arrange.ts`). Other tasks verify via `npm run typecheck` + the manual e2e checklist in Task 9. This is a deliberate, documented convention, not a gap.

---

## Task 1: Add the `on_wall` column

**Files:**
- Modify: `lib/schema.sql` (insert after the `wall_order` block, currently ending ~line 501 with `CREATE INDEX ... idx_artworks_wall_order`)

- [ ] **Step 1: Add the migration SQL**

Insert immediately after the existing `idx_artworks_wall_order` index line:

```sql
-- Wall membership — INDEPENDENT of shop status. The homepage wall is driven
-- purely by on_wall, decoupling "shown on the wall" from "for sale in the
-- shop" (status='published'). Added 2026-06-11.
ALTER TABLE artworks
  ADD COLUMN IF NOT EXISTS on_wall BOOLEAN;

-- One-time backfill preserves today's behavior: everything currently on the
-- wall (draft OR published) starts on_wall=true; retired pieces start false.
-- Idempotent — only seeds rows never set (NULL). Admin toggles write true/false
-- and are never reverted by a re-run, because no row is NULL after first apply.
UPDATE artworks
SET on_wall = (status <> 'retired')
WHERE on_wall IS NULL;

-- New rows land on the wall by default; enforce non-null now all rows are
-- seeded. SET NOT NULL takes ACCESS EXCLUSIVE + a scan, but artworks is ~100
-- rows so the lock is sub-ms. (For a large table, use ADD CONSTRAINT ... CHECK
-- (on_wall IS NOT NULL) NOT VALID then VALIDATE CONSTRAINT instead.)
ALTER TABLE artworks ALTER COLUMN on_wall SET DEFAULT true;
ALTER TABLE artworks ALTER COLUMN on_wall SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_artworks_on_wall ON artworks(on_wall) WHERE on_wall;
```

- [ ] **Step 2: Apply the migration (if a dev DB is reachable)**

Run: `npm run migrate`
Expected: `schema applied` with no error.

> Note: `.env.local` may have an empty `DATABASE_URL` (local dev gotcha). If `migrate` can't connect, that's fine — the SQL is idempotent and applies on the next `npm run build`/deploy. Do **not** lower connection timeouts to force it.

- [ ] **Step 3: Verify the column + backfill (only if migrate ran)**

Run:
```bash
psql "$DATABASE_URL" -c "SELECT on_wall, status, count(*) FROM artworks GROUP BY 1,2 ORDER BY 1,2;"
```
Expected: every `status='retired'` row has `on_wall=false`; every `draft`/`published` row has `on_wall=true`; no NULLs.

- [ ] **Step 4: Commit**

```bash
git add lib/schema.sql
git commit -m "feat(wall): add artworks.on_wall flag (wall membership, decoupled from shop)"
```

---

## Task 2: Pure transforms in `lib/wall-arrange.ts` (TDD)

**Files:**
- Create: `lib/wall-arrange.ts`
- Test: `tests/lib/wall-arrange.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/wall-arrange.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  partition,
  orderKey,
  removeFromGrid,
  toTray,
  toGrid,
  applyShop,
  type WallTile,
} from '@/lib/wall-arrange';

function tile(id: number, over: Partial<WallTile> = {}): WallTile {
  return {
    id,
    slug: `s${id}`,
    title: `T${id}`,
    image_web_url: `https://img/${id}.jpg`,
    status: 'draft',
    on_wall: true,
    wall_order: 0,
    canSell: false,
    available: false,
    updated_at: `2026-06-1${id}T00:00:00Z`,
    ...over,
  };
}

describe('partition', () => {
  it('splits on on_wall and preserves grid input order', () => {
    const rows = [
      tile(1, { on_wall: true }),
      tile(2, { on_wall: false }),
      tile(3, { on_wall: true }),
    ];
    const { grid, tray } = partition(rows);
    expect(grid.map((t) => t.id)).toEqual([1, 3]);
    expect(tray.map((t) => t.id)).toEqual([2]);
  });

  it('sorts the tray newest-first by updated_at', () => {
    const rows = [
      tile(2, { on_wall: false, updated_at: '2026-06-01T00:00:00Z' }),
      tile(4, { on_wall: false, updated_at: '2026-06-09T00:00:00Z' }),
    ];
    expect(partition(rows).tray.map((t) => t.id)).toEqual([4, 2]);
  });
});

describe('orderKey', () => {
  it('joins ids in order', () => {
    expect(orderKey([tile(3), tile(1), tile(2)])).toBe('3,1,2');
  });
});

describe('removeFromGrid', () => {
  it('drops ids from both live and saved arrays', () => {
    const grid = [tile(1), tile(2), tile(3)];
    const saved = [tile(1), tile(2), tile(3)];
    const r = removeFromGrid(grid, saved, new Set([2]));
    expect(r.grid.map((t) => t.id)).toEqual([1, 3]);
    expect(r.savedGrid.map((t) => t.id)).toEqual([1, 3]);
  });
});

describe('toTray', () => {
  it('moves a tile grid->tray, off both grid and saved, keeping order undirty', () => {
    const s = { grid: [tile(1), tile(2)], tray: [], savedGrid: [tile(1), tile(2)] };
    const n = toTray(s, 1);
    expect(n.grid.map((t) => t.id)).toEqual([2]);
    expect(n.savedGrid.map((t) => t.id)).toEqual([2]);
    expect(n.tray.map((t) => t.id)).toEqual([1]);
    expect(n.tray[0].on_wall).toBe(false);
    expect(orderKey(n.grid)).toBe(orderKey(n.savedGrid)); // not dirty
  });
});

describe('toGrid', () => {
  it('moves a tile tray->grid, appended to both, with on_wall=true wall_order=0', () => {
    const s = {
      grid: [tile(1)],
      tray: [tile(5, { on_wall: false, wall_order: 9 })],
      savedGrid: [tile(1)],
    };
    const n = toGrid(s, 5);
    expect(n.grid.map((t) => t.id)).toEqual([1, 5]);
    expect(n.savedGrid.map((t) => t.id)).toEqual([1, 5]);
    expect(n.tray).toEqual([]);
    expect(n.grid[1].on_wall).toBe(true);
    expect(n.grid[1].wall_order).toBe(0);
    expect(orderKey(n.grid)).toBe(orderKey(n.savedGrid)); // not dirty
  });
});

describe('applyShop', () => {
  it('publishing sets status=published; retiring sets retired + clears available', () => {
    const tiles = [tile(1, { status: 'published', available: true, canSell: true })];
    expect(applyShop(tiles, 1, false)[0]).toMatchObject({ status: 'retired', available: false });
    expect(applyShop(tiles, 1, true)[0]).toMatchObject({ status: 'published' });
  });
  it('leaves other tiles untouched', () => {
    const tiles = [tile(1), tile(2)];
    expect(applyShop(tiles, 1, true)[1]).toBe(tiles[1]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- wall-arrange`
Expected: FAIL — `Cannot find module '@/lib/wall-arrange'`.

- [ ] **Step 3: Implement `lib/wall-arrange.ts`**

```ts
// Pure helpers for the admin wall curation tool — no React, no DB. Keeping the
// order/snapshot logic here makes it unit-testable (the component just wires
// these to state + fetch).

export interface WallTile {
  id: number;
  slug: string;
  title: string;
  image_web_url: string;
  status: 'draft' | 'published' | 'retired';
  on_wall: boolean;
  wall_order: number;
  /** Has a print master → can be published/sold. Gates the Shop switch. */
  canSell: boolean;
  /** published AND a buyable variant → genuinely for sale (the green dot). */
  available: boolean;
  /** ISO-ish text (cast `::text` in SQL) so it string-sorts chronologically. */
  updated_at: string;
}

export interface WallSections {
  grid: WallTile[];
  tray: WallTile[];
}

interface Snapshotted extends WallSections {
  /** The last-saved grid order, for dirty-checking. */
  savedGrid: WallTile[];
}

/**
 * Split the single curation query into the arrangeable grid (on_wall) and the
 * off-wall tray. Rows arrive already ordered for the grid
 * ((wall_order=0), wall_order, md5(slug)); filtering preserves that order. The
 * tray is sorted newest-first.
 */
export function partition(rows: WallTile[]): WallSections {
  const grid = rows.filter((r) => r.on_wall);
  const tray = rows
    .filter((r) => !r.on_wall)
    .slice()
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return { grid, tray };
}

/** Stable order signature for dirty-checking. */
export function orderKey(tiles: WallTile[]): string {
  return tiles.map((t) => t.id).join(',');
}

/** Remove ids from BOTH the live grid and the saved snapshot (delete / wall-off). */
export function removeFromGrid(
  grid: WallTile[],
  savedGrid: WallTile[],
  ids: ReadonlySet<number>,
): { grid: WallTile[]; savedGrid: WallTile[] } {
  return {
    grid: grid.filter((t) => !ids.has(t.id)),
    savedGrid: savedGrid.filter((t) => !ids.has(t.id)),
  };
}

/** Move a tile grid->tray: drop from grid + saved snapshot, prepend to tray. */
export function toTray(s: Snapshotted, id: number): Snapshotted {
  const tile = s.grid.find((t) => t.id === id);
  if (!tile) return s;
  return {
    grid: s.grid.filter((t) => t.id !== id),
    savedGrid: s.savedGrid.filter((t) => t.id !== id),
    tray: [{ ...tile, on_wall: false }, ...s.tray],
  };
}

/** Move a tile tray->grid: drop from tray, append to grid + saved snapshot. */
export function toGrid(s: Snapshotted, id: number): Snapshotted {
  const tile = s.tray.find((t) => t.id === id);
  if (!tile) return s;
  const moved: WallTile = { ...tile, on_wall: true, wall_order: 0 };
  return {
    grid: [...s.grid, moved],
    savedGrid: [...s.savedGrid, moved],
    tray: s.tray.filter((t) => t.id !== id),
  };
}

/**
 * Reflect a shop toggle on whichever section holds the tile. Retiring clears
 * `available` (definitely no longer for sale); publishing sets status but does
 * NOT fake `available` true — buyability depends on resolution-gated variants,
 * so the green dot reconciles on the next page load.
 */
export function applyShop(tiles: WallTile[], id: number, on: boolean): WallTile[] {
  return tiles.map((t) =>
    t.id === id
      ? {
          ...t,
          status: on ? 'published' : 'retired',
          available: on ? t.available : false,
        }
      : t,
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- wall-arrange`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add lib/wall-arrange.ts tests/lib/wall-arrange.test.ts
git commit -m "feat(wall): pure grid/tray/snapshot transforms + unit tests"
```

---

## Task 3: Accept `on_wall` in the artwork PATCH + reset `wall_order`

**Files:**
- Modify: `app/api/admin/artworks/[id]/route.ts` (the `Patch` Zod schema ~line 55, and the update-loop ~line 124)

- [ ] **Step 1: Add `on_wall` to the `Patch` schema**

In the `const Patch = z.object({ ... })` block, add this line (next to `display_order`):

```ts
  on_wall: z.boolean().optional(),
```

- [ ] **Step 2: Reset `wall_order` whenever `on_wall` is written**

Find the update-column builder loop:

```ts
      const updateCols: string[] = [];
      const vals: unknown[] = [];
      for (const [k, v] of Object.entries(d)) {
        if (k === 'applyTemplate' || v === undefined) continue;
        // Helper already wrote status + published_at + updated_at.
        if (k === 'status' && v === 'published') continue;
        updateCols.push(`${k} = $${vals.length + 1}`);
        vals.push(v);
      }
```

Insert immediately **after** that loop (before `if (updateCols.length) {`):

```ts
      // Toggling wall membership clears any saved arrangement position, so a
      // piece taken off the wall and later put back sorts to the END of the
      // public wall (which orders by wall_order) until explicitly re-arranged
      // — instead of resurfacing mid-wall on its stale wall_order. Constant 0,
      // no param. Column names come from the fixed Zod schema, never user keys.
      if (d.on_wall !== undefined) {
        updateCols.push('wall_order = 0');
      }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Manual sanity (no route unit-test harness exists)**

Confirm by reading the diff: `on_wall` is in `Patch`; the loop emits `on_wall = $N` with a boolean param; `wall_order = 0` is appended only when `on_wall` is present; `requireSameOrigin()` + `requireAdmin()` remain at the top of `PATCH` (unchanged).

- [ ] **Step 5: Commit**

```bash
git add "app/api/admin/artworks/[id]/route.ts"
git commit -m "feat(wall): PATCH accepts on_wall and resets wall_order on toggle"
```

---

## Task 4: Homepage wall reads `on_wall`

**Files:**
- Modify: `app/(shop)/page.tsx` (line 53)

- [ ] **Step 1: Swap the wall filter**

Change line 53 from:

```ts
       WHERE a.status IN ('draft', 'published')
```

to:

```ts
       WHERE a.on_wall AND a.image_web_url <> ''
```

Leave the `SELECT` list, the `available` expression, the `ORDER BY`, and `LIMIT 300` exactly as they are. (A piece with `on_wall=true` but not published now renders as a look-only vintage example — no dot, no print link — which is the intended "on wall, not for sale" state. `image_web_url <> ''` drops mid-upload reserved rows from the highest-traffic page.)

- [ ] **Step 2: Update the explanatory comment**

The block comment above the query (lines ~26–37) says the wall is `status IN ('draft','published')`. Replace the sentence describing the filter so it reads:

```ts
  // The wall is every piece flagged on_wall (Dan curates this in /admin/wall),
  // shown as look-only "vintage" examples intermixed with the few available
  // prints. on_wall is INDEPENDENT of shop status, so a piece can be on the
  // wall without being for sale, or for sale without being on the wall.
```

(Keep the rest of the comment about `wall_order`, the md5 shuffle, and the LIMIT.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(shop)/page.tsx"
git commit -m "feat(wall): homepage wall is driven by on_wall, not status"
```

---

## Task 5: Admin wall page — single partition query → grid + tray

**Files:**
- Modify: `app/admin/wall/page.tsx` (replace whole file)

- [ ] **Step 1: Rewrite the page**

Replace the entire contents of `app/admin/wall/page.tsx` with:

```tsx
import { pool } from '@/lib/db';
import { WallArranger } from '@/components/admin/WallArranger';
import { partition, type WallTile } from '@/lib/wall-arrange';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Arrange the wall · Wildlight admin' };

// Auth is enforced by app/admin/layout.tsx (getAdminSession → /login).
export default async function AdminWallPage() {
  // ONE query, partitioned in memory — not two parallel queries. Two queries
  // on separate connections have no shared snapshot, so a concurrent on_wall
  // toggle between them could make a piece appear in both lists (React key
  // collision) or neither. Fail soft on a Neon cold-start blip: render the
  // empty arranger rather than a 500.
  let rows: WallTile[] = [];
  try {
    const res = await pool.query<WallTile>(
      `SELECT a.id, a.slug, a.title, a.image_web_url, a.status, a.on_wall,
              a.wall_order, a.updated_at::text AS updated_at,
              (a.image_print_url IS NOT NULL AND a.image_print_url <> '') AS "canSell",
              (a.status = 'published'
                 AND EXISTS (SELECT 1 FROM artwork_variants v
                               WHERE v.artwork_id = a.id AND v.buyable)) AS available
         FROM artworks a
        WHERE (a.on_wall OR a.status <> 'retired')
          AND a.image_web_url <> ''
        ORDER BY (a.wall_order = 0), a.wall_order, md5(a.slug)
        LIMIT 600`,
    );
    rows = res.rows;
  } catch (err) {
    console.error('[admin/wall] load failed:', err);
  }
  const { grid, tray } = partition(rows);
  return <WallArranger initialGrid={grid} initialTray={tray} />;
}
```

Key points: `canSell` is stricter than the real publish gate (`IS NOT NULL` only) so a transient reserved row (`image_print_url=''`) gets no Shop switch; `WHERE on_wall OR status <> 'retired'` keeps fully-dead pieces out of the tray; `updated_at::text` so it string-sorts in `partition`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: error in `components/admin/WallArranger.tsx` because it still has the old `{ initial }` prop — that's expected; Task 6 fixes it. The **page** itself must have no type error in its own query/`partition` usage.

- [ ] **Step 3: Commit**

```bash
git add app/admin/wall/page.tsx
git commit -m "feat(wall): admin wall loads grid + tray from one partition query"
```

---

## Task 6: Rewrite `WallArranger` — switches, tray, staged delete, add

**Files:**
- Rewrite: `components/admin/WallArranger.tsx`

- [ ] **Step 1: Replace the whole component**

Replace the entire contents of `components/admin/WallArranger.tsx` with:

```tsx
'use client';

import { useRef, useState } from 'react';
import {
  orderKey,
  removeFromGrid,
  toTray,
  toGrid,
  applyShop,
  type WallTile,
} from '@/lib/wall-arrange';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type RemoveState = 'idle' | 'confirming' | 'removing' | 'error';
interface RemoveErr {
  id: number;
  title: string;
  reason: string;
}

async function patchArtwork(
  id: number,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const r = await fetch(`/api/admin/artworks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) return { ok: true, status: r.status };
    const data = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: false, status: r.status, error: data.error };
  } catch {
    return { ok: false, status: 0, error: 'network error' };
  }
}

/**
 * Wall & shop curation. Three independent interaction models on one screen:
 *   1. Reorder  — drag, then explicit Save order (writes wall_order).
 *   2. Toggles  — Wall / Shop switches, optimistic + reversible (one PATCH each).
 *   3. Delete   — staged batch behind one confirm (destructive, grid only).
 * Order-dirtiness is tracked against savedGrid; tiles leaving/entering the grid
 * update savedGrid too so a toggle never looks like a reorder.
 */
export function WallArranger({
  initialGrid,
  initialTray,
}: {
  initialGrid: WallTile[];
  initialTray: WallTile[];
}) {
  const [grid, setGrid] = useState<WallTile[]>(initialGrid);
  const [tray, setTray] = useState<WallTile[]>(initialTray);
  const savedGrid = useRef<WallTile[]>(initialGrid);

  const [dragId, setDragId] = useState<number | null>(null);
  const [orderState, setOrderState] = useState<SaveState>('idle');

  const [pending, setPending] = useState<Set<number>>(new Set());
  const [removeState, setRemoveState] = useState<RemoveState>('idle');
  const [removeErrs, setRemoveErrs] = useState<RemoveErr[]>([]);
  const [toggleErr, setToggleErr] = useState<string | null>(null);

  const liveRef = useRef<HTMLDivElement>(null);
  const announce = (msg: string) => {
    if (liveRef.current) liveRef.current.textContent = msg;
  };

  const dirty = orderKey(grid) !== orderKey(savedGrid.current);

  // ── Reorder ──────────────────────────────────────────────────────────
  function moveOver(overId: number) {
    if (dragId === null || dragId === overId) return;
    setGrid((prev) => {
      const from = prev.findIndex((t) => t.id === dragId);
      const to = prev.findIndex((t) => t.id === overId);
      if (from === -1 || to === -1 || from === to) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function saveOrder() {
    setOrderState('saving');
    try {
      const r = await fetch('/api/admin/wall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: grid.map((t) => t.id) }),
      });
      if (!r.ok) throw new Error(String(r.status));
      savedGrid.current = grid;
      setOrderState('saved');
    } catch {
      setOrderState('error');
    }
  }

  function resetOrder() {
    setGrid(savedGrid.current);
    setOrderState('idle');
  }

  // ── Wall toggle (optimistic) ─────────────────────────────────────────
  async function wallOff(id: number) {
    const prev = { grid, tray, saved: savedGrid.current };
    const next = toTray({ grid, tray, savedGrid: savedGrid.current }, id);
    setGrid(next.grid);
    setTray(next.tray);
    savedGrid.current = next.savedGrid;
    setToggleErr(null);
    announce('Moved to the off-the-wall tray');
    const res = await patchArtwork(id, { on_wall: false });
    if (!res.ok) {
      setGrid(prev.grid);
      setTray(prev.tray);
      savedGrid.current = prev.saved;
      setToggleErr("Couldn't take that off the wall — please try again.");
    }
  }

  async function wallOn(id: number) {
    const prev = { grid, tray, saved: savedGrid.current };
    const next = toGrid({ grid, tray, savedGrid: savedGrid.current }, id);
    setGrid(next.grid);
    setTray(next.tray);
    savedGrid.current = next.savedGrid;
    setToggleErr(null);
    announce('Put on the wall');
    const res = await patchArtwork(id, { on_wall: true });
    if (!res.ok) {
      setGrid(prev.grid);
      setTray(prev.tray);
      savedGrid.current = prev.saved;
      setToggleErr("Couldn't put that on the wall — please try again.");
    }
  }

  // ── Shop toggle (optimistic) ─────────────────────────────────────────
  async function toggleShop(id: number, on: boolean) {
    const prevGrid = grid;
    const prevTray = tray;
    setGrid((g) => applyShop(g, id, on));
    setTray((t) => applyShop(t, id, on));
    setToggleErr(null);
    const res = await patchArtwork(id, { status: on ? 'published' : 'retired' });
    if (!res.ok) {
      setGrid(prevGrid);
      setTray(prevTray);
      setToggleErr(
        res.status === 409
          ? res.error ?? 'Needs a print master before it can be sold.'
          : "Couldn't change the shop status — please try again.",
      );
    }
  }

  // ── Staged delete ────────────────────────────────────────────────────
  function stage(id: number) {
    setPending((p) => new Set(p).add(id));
    if (removeState !== 'idle') setRemoveState('idle');
  }
  function unstage(id: number) {
    setPending((p) => {
      const n = new Set(p);
      n.delete(id);
      return n;
    });
  }

  async function commitRemoval() {
    setRemoveState('removing');
    const ids = [...pending];
    const settled = await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/admin/artworks/${id}`, { method: 'DELETE' }).then(async (r) => ({
          ok: r.ok,
          status: r.status,
          error: r.ok ? undefined : ((await r.json().catch(() => ({}))) as { error?: string }).error,
        })),
      ),
    );
    const ok = new Set<number>();
    const errs: RemoveErr[] = [];
    settled.forEach((res, i) => {
      const id = ids[i];
      if (res.status === 'fulfilled' && res.value.ok) {
        ok.add(id);
      } else {
        const title = grid.find((t) => t.id === id)?.title ?? `#${id}`;
        const reason =
          res.status === 'fulfilled'
            ? res.value.error ?? `HTTP ${res.value.status}`
            : 'network error';
        errs.push({ id, title, reason });
      }
    });
    if (ok.size) {
      const r = removeFromGrid(grid, savedGrid.current, ok);
      setGrid(r.grid);
      savedGrid.current = r.savedGrid;
    }
    setPending(new Set(errs.map((e) => e.id)));
    setRemoveErrs(errs);
    setRemoveState(errs.length ? 'error' : 'idle');
  }

  // ── Render ───────────────────────────────────────────────────────────
  function Switch({
    on,
    label,
    onClick,
    kind,
  }: {
    on: boolean;
    label: string;
    onClick: () => void;
    kind: 'wall' | 'shop';
  }) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`wl-adm-wall-switch ${kind} ${on ? 'on' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        {kind === 'wall' ? 'Wall' : 'Shop'}
      </button>
    );
  }

  return (
    <div className="wl-adm-wall">
      <header className="wl-adm-wall-head">
        <div>
          <h1>Wall &amp; shop</h1>
          <p>
            Drag to reorder the wall. Toggle each photo on or off the wall and in
            or out of the shop — they&apos;re independent. Deleting is permanent and
            only for duplicates or junk.
          </p>
        </div>
        <div className="actions">
          <a className="wl-adm-wall-add" href="/admin/artworks/bulk-upload">
            Add photos
          </a>
          {dirty && (
            <button type="button" onClick={resetOrder}>
              Reset
            </button>
          )}
          <button
            type="button"
            className="primary"
            onClick={saveOrder}
            disabled={!dirty || orderState === 'saving'}
          >
            {orderState === 'saving'
              ? 'Saving…'
              : !dirty && orderState === 'saved'
                ? 'Saved ✓'
                : 'Save order'}
          </button>
        </div>
      </header>

      {orderState === 'error' && (
        <p className="wl-adm-wall-err">Couldn&apos;t save the order — please try again.</p>
      )}
      {toggleErr && <p className="wl-adm-wall-err">{toggleErr}</p>}

      <p className="wl-adm-wall-hint">
        {grid.length} on the wall · the green dot marks pieces for sale
      </p>

      <div className="wl-adm-wall-grid">
        {grid.map((t, i) => {
          const staged = pending.has(t.id);
          return (
            <div
              key={t.id}
              className={`wl-adm-wall-tile ${dragId === t.id ? 'dragging' : ''} ${staged ? 'staged' : ''}`}
              draggable={!staged}
              onDragStart={() => {
                if (staged) return;
                setDragId(t.id);
                if (orderState !== 'idle') setOrderState('idle');
              }}
              onDragEnter={() => moveOver(t.id)}
              onDragOver={(e) => e.preventDefault()}
              onDragEnd={() => setDragId(null)}
              onDrop={(e) => e.preventDefault()}
              title={t.title}
            >
              <span className="pos">{i + 1}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={t.image_web_url} alt={t.title} loading="lazy" draggable={false} />
              {t.available && <span className="dot" aria-hidden="true" />}
              <div className="wl-adm-wall-ctl">
                <Switch
                  kind="wall"
                  on
                  label={`Take ${t.title} off the wall`}
                  onClick={() => wallOff(t.id)}
                />
                {t.canSell && (
                  <Switch
                    kind="shop"
                    on={t.status === 'published'}
                    label={`${t.status === 'published' ? 'Remove' : 'Put'} ${t.title} ${t.status === 'published' ? 'from' : 'in'} the shop`}
                    onClick={() => toggleShop(t.id, t.status !== 'published')}
                  />
                )}
              </div>
              {!t.available &&
                (staged ? (
                  <button
                    type="button"
                    className="wl-adm-wall-undo"
                    onClick={(e) => {
                      e.stopPropagation();
                      unstage(t.id);
                    }}
                  >
                    Undo
                  </button>
                ) : (
                  <button
                    type="button"
                    className="wl-adm-wall-x"
                    aria-label={`Remove ${t.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      stage(t.id);
                    }}
                  >
                    ✕
                  </button>
                ))}
              <span className="cap">{t.title}</span>
            </div>
          );
        })}
      </div>

      {pending.size > 0 && (
        <div className="wl-adm-wall-removebar">
          {removeState === 'confirming' || removeState === 'removing' ? (
            <>
              <span>
                Permanently delete {pending.size} photo{pending.size > 1 ? 's' : ''}? This
                can&apos;t be undone.
              </span>
              <button
                type="button"
                className="danger"
                onClick={commitRemoval}
                disabled={removeState === 'removing'}
              >
                {removeState === 'removing' ? 'Removing…' : 'Delete'}
              </button>
              <button
                type="button"
                onClick={() => setRemoveState('idle')}
                disabled={removeState === 'removing'}
              >
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="danger" onClick={() => setRemoveState('confirming')}>
              Remove {pending.size} photo{pending.size > 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}

      {removeErrs.length > 0 && (
        <ul className="wl-adm-wall-removeerrs">
          {removeErrs.map((e) => (
            <li key={e.id}>
              Couldn&apos;t remove “{e.title}” — {e.reason}
            </li>
          ))}
        </ul>
      )}

      {tray.length > 0 && (
        <section className="wl-adm-wall-tray">
          <p className="wl-adm-wall-hint">Off the wall · {tray.length}</p>
          <div className="wl-adm-wall-grid">
            {tray.map((t) => (
              <div key={t.id} className="wl-adm-wall-tile off" title={t.title}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={t.image_web_url} alt={t.title} loading="lazy" draggable={false} />
                {t.available && <span className="dot" aria-hidden="true" />}
                <div className="wl-adm-wall-ctl">
                  <button
                    type="button"
                    className="wl-adm-wall-add small"
                    onClick={() => wallOn(t.id)}
                    aria-label={`Put ${t.title} on the wall`}
                  >
                    Put on wall
                  </button>
                  {t.canSell && (
                    <Switch
                      kind="shop"
                      on={t.status === 'published'}
                      label={`${t.status === 'published' ? 'Remove' : 'Put'} ${t.title} ${t.status === 'published' ? 'from' : 'in'} the shop`}
                      onClick={() => toggleShop(t.id, t.status !== 'published')}
                    />
                  )}
                </div>
                <span className="cap">{t.title}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div ref={liveRef} aria-live="polite" className="wl-adm-sr-only" />
    </div>
  );
}
```

> Note: the exported type `WallTile` now lives in `lib/wall-arrange.ts`; the old `export interface WallTile` that used to be in this file is gone. Any other importer of `@/components/admin/WallArranger`'s `WallTile` must switch to `@/lib/wall-arrange` (Step 2 checks this).

- [ ] **Step 2: Check for stale imports of the old `WallTile`**

Run: `git grep -n "WallArranger'" -- '*.ts' '*.tsx'` and `git grep -n "from '@/components/admin/WallArranger'"`
Expected: only `app/admin/wall/page.tsx` imports `WallArranger` (the component, not the type). If anything imported `WallTile` from the component, repoint it to `@/lib/wall-arrange`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors (the Task 5 page error is now resolved).

- [ ] **Step 4: Lint**

Run: `npm run lint` (if defined) — confirm no `@next/next/no-img-element` failures (the eslint-disable lines cover the admin thumbnails).

- [ ] **Step 5: Commit**

```bash
git add components/admin/WallArranger.tsx
git commit -m "feat(wall): curation tool — wall/shop switches, off-wall tray, staged delete, add"
```

---

## Task 7: Styles for switches, tray, staged/Undo, confirm bar, sr-only

**Files:**
- Modify: `app/admin/admin.css` (append after the `.wl-adm-wall-tile:hover .cap` rule, ~line 1632)

- [ ] **Step 1: Append the styles**

Add after the existing `.wl-adm-wall-tile:hover .cap { ... }` rule:

```css
/* ── Wall & shop curation controls ───────────────────────────────────── */
.wl-adm-wall-add {
  font-family: inherit;
  font-size: 13px;
  padding: 9px 16px;
  border-radius: var(--adm-radius-md);
  border: 1px solid var(--adm-rule);
  background: var(--adm-paper);
  color: var(--adm-ink);
  text-decoration: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}
.wl-adm-wall-add:hover {
  border-color: var(--adm-ink);
}

.wl-adm-wall-ctl {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.12s ease;
}
.wl-adm-wall-tile:hover .wl-adm-wall-ctl,
.wl-adm-wall-tile:focus-within .wl-adm-wall-ctl {
  opacity: 1;
}
.wl-adm-wall-tile.off .wl-adm-wall-ctl {
  position: static;
  opacity: 1;
  justify-content: center;
  padding: 6px;
}

.wl-adm-wall-switch {
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 3px 7px;
  border-radius: 999px;
  border: 1px solid var(--adm-rule);
  background: color-mix(in srgb, var(--adm-paper) 80%, transparent);
  color: var(--adm-muted);
  cursor: pointer;
  backdrop-filter: blur(2px);
}
.wl-adm-wall-switch.on {
  background: var(--adm-ink);
  border-color: var(--adm-ink);
  color: var(--adm-paper);
}
.wl-adm-wall-switch.shop.on {
  background: var(--adm-green, #2e7d4f);
  border-color: var(--adm-green, #2e7d4f);
}

.wl-adm-wall-x,
.wl-adm-wall-undo {
  position: absolute;
  bottom: 4px;
  right: 4px;
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  font-size: 11px;
  line-height: 1;
  padding: 4px 7px;
  border-radius: var(--adm-radius-sm);
  border: 1px solid var(--adm-rule);
  background: color-mix(in srgb, var(--adm-paper) 80%, transparent);
  color: var(--adm-red);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease;
}
.wl-adm-wall-tile:hover .wl-adm-wall-x,
.wl-adm-wall-tile:focus-within .wl-adm-wall-x,
.wl-adm-wall-undo {
  opacity: 1;
}
.wl-adm-wall-tile.staged {
  opacity: 0.45;
  outline: 2px dashed var(--adm-red);
  outline-offset: -2px;
}

.wl-adm-wall-removebar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 14px 0;
  padding: 10px 14px;
  border: 1px solid var(--adm-rule);
  border-radius: var(--adm-radius-md);
  background: color-mix(in srgb, var(--adm-red) 7%, var(--adm-paper));
  font-size: 13px;
}
.wl-adm-wall-removebar button {
  font-family: inherit;
  font-size: 13px;
  padding: 7px 14px;
  border-radius: var(--adm-radius-md);
  border: 1px solid var(--adm-rule);
  background: var(--adm-paper);
  cursor: pointer;
}
.wl-adm-wall-removebar button.danger {
  background: var(--adm-red);
  border-color: var(--adm-red);
  color: #fff;
}
.wl-adm-wall-removebar button:disabled {
  opacity: 0.5;
  cursor: default;
}
.wl-adm-wall-removeerrs {
  margin: 0 0 14px;
  padding-left: 18px;
  color: var(--adm-red);
  font-size: 13px;
}

.wl-adm-wall-tray {
  margin-top: 28px;
  padding-top: 18px;
  border-top: 1px solid var(--adm-rule);
}

.wl-adm-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

> `--adm-green` may not be a defined token; the `color-mix`/fallback `#2e7d4f` covers it. If a green token exists in `admin.css` (search `--adm-green` / the `.dot` rule's color), use that instead for consistency.

- [ ] **Step 2: Confirm the green token**

Run: `git grep -n "adm-green\|\.wl-adm-wall-tile .dot" -- app/admin/admin.css`
If the `.dot` uses a specific color variable, replace the `#2e7d4f` fallback with it.

- [ ] **Step 3: Commit**

```bash
git add app/admin/admin.css
git commit -m "style(wall): switches, off-wall tray, staged/undo, confirm bar"
```

---

## Task 8: Update the spec status

**Files:**
- Modify: `docs/superpowers/specs/2026-06-11-wall-shop-curation-design.md` (the `**Status:**` line)

- [ ] **Step 1: Mark implemented**

Change `**Status:** Approved (design); pending spec review` to `**Status:** Implemented (plan: docs/superpowers/plans/2026-06-11-wall-shop-curation.md)`.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-11-wall-shop-curation-design.md
git commit -m "docs(wall): mark curation spec implemented"
```

---

## Task 9: Full verification

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 2: Unit tests**

Run: `npm test`
Expected: all pass, including the new `wall-arrange` suite.

- [ ] **Step 3: Build (runs migration + Next build)**

Run: `npm run build`
Expected: `schema applied` (the `on_wall` migration), then a successful Next build. If `DATABASE_URL` is unset locally, the migrate step will fail to connect — run the build in an environment with the dev/staging DB, or rely on the deploy build.

- [ ] **Step 4: Manual e2e (dev server)**

Run `npm run dev`, sign into `/admin/wall`, and confirm each spec scenario:

1. **On wall, not for sale** — a published piece: toggle **Shop** off → gone from `/shop`, still on the homepage wall with **no** green dot.
2. **In shop, off wall** — a published piece: toggle **Wall** off → moves to the **Off the wall** tray; gone from the homepage wall; still listed in `/shop`.
3. **Re-add lands at the end** — from the tray, **Put on wall** → appears at the end of the grid; reload the homepage and confirm it's at the **end**, not mid-wall (validates the `wall_order=0` reset).
4. **Delete duplicates** — stage 3 duplicate drafts (✕), **Undo** one, **Remove 2 photos** → confirm → 2 rows gone; homepage wall updates; the third remains.
5. **Guards** — a for-sale tile (green dot) has **no** ✕; a low-res vintage draft (no print master) has **no** Shop switch.
6. **Reorder still works** — drag to reorder, **Save order**, reload homepage → order persists; toggling/deleting did not falsely mark the order dirty.
7. **Add** — **Add photos** opens `/admin/artworks/bulk-upload`; an uploaded image appears on the wall after returning.

- [ ] **Step 5: Commit any fixups, then stop for review**

```bash
git add -A
git commit -m "fix(wall): address manual-verification findings"   # only if needed
```

Report results (typecheck/tests/build output + which manual scenarios passed) and **do not** fast-forward to `main` or push — Dallas handles the merge/push. Flag any commit on this branch authored by a parallel session before integrating.

---

## Self-Review (completed by plan author)

- **Spec coverage:** on_wall migration → T1; pure transforms → T2; PATCH on_wall + wall_order reset → T3; homepage query → T4; single partition query w/ status/canSell/available → T5; grid+tray+switches+staged delete+add + a11y live region → T6; styles → T7; manual checklist → T9. The five Gemini-hardened items (wall_order reset, single query, explicit columns, focus/announce, lock note) are all present.
- **Type consistency:** `WallTile` is defined once (T2) and imported by T5/T6; `partition/orderKey/removeFromGrid/toTray/toGrid/applyShop` signatures match between the test (T2), the page (T5), and the component (T6). The component prop is `{ initialGrid, initialTray }` in both T5 (caller) and T6 (definition).
- **No placeholders:** every code step shows complete code; no TBD/TODO; verification commands have expected output.
