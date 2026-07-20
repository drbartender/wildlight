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

// ── Library model (Wall & Shop redesign) ─────────────────────────────────
// Every photo lives in `photos`; The Wall is the on_wall subset ordered by
// wall_rank; The Shop is the published subset. These pure helpers are wired to
// component state + fetch. (The grid/tray helpers above are the pre-redesign
// tool and are removed once the redesign lands.)

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
