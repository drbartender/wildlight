// Pure helpers for the Shop shelf. No React, no DB. Mirrors lib/wall-arrange.ts's
// role for the Wall: keeping order/filter logic here is what makes it testable,
// since this repo has no component-test harness.

import { isInShop, type LibraryPhoto } from '@/lib/wall-arrange';

/**
 * Which slice of the Shop is on screen, and therefore WHICH ORDER a drag edits.
 * 'all' writes display_order; a collection writes collection_order for that
 * collection only; 'unfiled' writes nothing.
 */
export type ShopScope =
  | { kind: 'all' }
  | { kind: 'unfiled' }
  | { kind: 'collection'; id: number };

/** Stable string form, for localStorage and React keys. */
export function scopeKey(s: ShopScope): string {
  return s.kind === 'collection' ? `c:${s.id}` : s.kind;
}

/** Inverse of scopeKey. Anything unrecognised falls back to All. */
export function parseScopeKey(raw: string | null): ShopScope {
  if (raw === 'unfiled') return { kind: 'unfiled' };
  const m = /^c:(\d+)$/.exec(raw ?? '');
  if (m) return { kind: 'collection', id: Number(m[1]) };
  return { kind: 'all' };
}

/**
 * Unfiled is a worklist, not an arrangement surface. There is no "unfiled
 * order" to save, and dragging inside a partial view of the All order is
 * ambiguous: dropping A above B when six photos sit between them in the full
 * order has no single correct answer.
 */
export function isArrangeable(s: ShopScope): boolean {
  return s.kind !== 'unfiled';
}

/**
 * The shop members in this scope, in the order that scope edits.
 *
 * The `|| a.id - b.id` tiebreak must match the public queries' `, a.id`
 * exactly, or the admin order and the live order disagree whenever two rows
 * share a position (which they can, briefly, after a concurrent publish).
 */
export function deriveShopIds(photos: LibraryPhoto[], scope: ShopScope): number[] {
  const inShop = photos.filter(isInShop);
  if (scope.kind === 'collection') {
    return inShop
      .filter((p) => p.collection_id === scope.id)
      .slice()
      .sort((a, b) => a.collection_order - b.collection_order || a.id - b.id)
      .map((p) => p.id);
  }
  const base =
    scope.kind === 'unfiled' ? inShop.filter((p) => p.collection_id == null) : inShop;
  return base
    .slice()
    .sort((a, b) => a.display_order - b.display_order || a.id - b.id)
    .map((p) => p.id);
}

/**
 * Chip counts. Derived from client `photos` state, NOT from a server query, or
 * they go stale the instant placeInShop / removeFromShop / bulkApply runs.
 */
export function shopScopeCounts(photos: LibraryPhoto[]): {
  all: number;
  unfiled: number;
  byCollection: Map<number, number>;
} {
  const inShop = photos.filter(isInShop);
  const byCollection = new Map<number, number>();
  for (const p of inShop) {
    if (p.collection_id == null) continue;
    byCollection.set(p.collection_id, (byCollection.get(p.collection_id) ?? 0) + 1);
  }
  return {
    all: inShop.length,
    unfiled: inShop.filter((p) => p.collection_id == null).length,
    byCollection,
  };
}

/**
 * Index in `ordered` AFTER which the cut line is drawn, or null for no line.
 *
 * Counts BUYABLE tiles only: the public query filters unbuyable rows out before
 * applying its LIMIT, so counting every tile would put the line in the wrong
 * place and the admin would arrange twelve and see nine.
 *
 * Null cases, all deliberate: limit 0 (unlimited), fewer buyable tiles than the
 * limit, and a cut landing on the last tile (nothing below it to mark).
 */
export function cutLineAfter(ordered: LibraryPhoto[], limit: number): number | null {
  if (limit <= 0) return null;
  let buyable = 0;
  for (let i = 0; i < ordered.length; i++) {
    if (!ordered[i].buyable) continue;
    buyable++;
    if (buyable === limit) return i === ordered.length - 1 ? null : i;
  }
  return null;
}

/**
 * Ids that fall BELOW the cut in the All order, readable from any scope.
 *
 * Always computed from the full All order, never from the visible subset: the
 * cut is a property of /shop, and a filtered view is not the /shop sequence.
 * Used by the Unfiled view to flag a piece that is both unfiled and below the
 * cut, which is reachable from nowhere on the site except the sitemap.
 */
export function belowCutIds(photos: LibraryPhoto[], limit: number): Set<number> {
  const allIds = deriveShopIds(photos, { kind: 'all' });
  const byId = new Map(photos.map((p) => [p.id, p]));
  const ordered = allIds.map((id) => byId.get(id)).filter((p): p is LibraryPhoto => !!p);
  const cut = cutLineAfter(ordered, limit);
  if (cut == null) return new Set();
  return new Set(ordered.slice(cut + 1).map((p) => p.id));
}
