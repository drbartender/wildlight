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
