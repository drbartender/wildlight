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
    wall_rank: over.wall_rank ?? null,
    collection_id: over.collection_id ?? null,
    collection_title: over.collection_title ?? null,
    collection_order: over.collection_order ?? 0,
    display_order: over.display_order ?? 0,
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

  it('sorts null wall_rank (never-arranged) to the end, after ranked ones', () => {
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
    photo({ id: 2, on_wall: true, status: 'draft', hd: true }), // wall only
    photo({ id: 3, on_wall: false, status: 'published', hd: true }), // shop only
    photo({ id: 4, on_wall: false, status: 'draft', hd: false }), // unplaced + no print
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
