import { describe, it, expect } from 'vitest';
import type { LibraryPhoto } from '@/lib/wall-arrange';
import {
  parseScopeKey,
  scopeKey,
  isArrangeable,
  deriveShopIds,
  shopScopeCounts,
  cutLineAfter,
  belowCutIds,
} from '@/lib/shop-arrange';

function photo(over: Partial<LibraryPhoto> & { id: number }): LibraryPhoto {
  return {
    id: over.id,
    slug: over.slug ?? `slug-${over.id}`,
    title: over.title ?? `Photo ${over.id}`,
    image_web_url: over.image_web_url ?? `https://img/${over.id}.jpg`,
    status: over.status ?? 'published',
    on_wall: over.on_wall ?? false,
    updated_at: over.updated_at ?? '2026-07-21T00:00:00Z',
    hd: over.hd ?? true,
    buyable: over.buyable ?? true,
    wall_rank: over.wall_rank ?? null,
    collection_id: over.collection_id ?? null,
    collection_title: over.collection_title ?? null,
    collection_order: over.collection_order ?? 0,
    display_order: over.display_order ?? 0,
  };
}

describe('scope keys', () => {
  it('round-trips every scope', () => {
    for (const s of [
      { kind: 'all' } as const,
      { kind: 'unfiled' } as const,
      { kind: 'collection', id: 7 } as const,
    ]) {
      expect(parseScopeKey(scopeKey(s))).toEqual(s);
    }
  });

  it('falls back to All on null or an unrecognised key', () => {
    expect(parseScopeKey(null)).toEqual({ kind: 'all' });
    expect(parseScopeKey('c:notanumber')).toEqual({ kind: 'all' });
    expect(parseScopeKey('garbage')).toEqual({ kind: 'all' });
  });
});

describe('isArrangeable', () => {
  it('is false only for Unfiled, which has no order to save', () => {
    expect(isArrangeable({ kind: 'all' })).toBe(true);
    expect(isArrangeable({ kind: 'collection', id: 1 })).toBe(true);
    expect(isArrangeable({ kind: 'unfiled' })).toBe(false);
  });
});

describe('deriveShopIds', () => {
  const photos = [
    photo({ id: 1, display_order: 2, collection_id: 10, collection_order: 2 }),
    photo({ id: 2, display_order: 1, collection_id: 10, collection_order: 1 }),
    photo({ id: 3, display_order: 3, collection_id: null }),
    photo({ id: 4, status: 'draft' }),
    photo({ id: 5, status: 'retired' }),
  ];

  it('All is every shop member by display_order', () => {
    expect(deriveShopIds(photos, { kind: 'all' })).toEqual([2, 1, 3]);
  });

  it('a collection is its members by collection_order', () => {
    expect(deriveShopIds(photos, { kind: 'collection', id: 10 })).toEqual([2, 1]);
  });

  it('Unfiled is shop members with no collection', () => {
    expect(deriveShopIds(photos, { kind: 'unfiled' })).toEqual([3]);
  });

  it('excludes drafts and retired pieces from every scope', () => {
    const all = deriveShopIds(photos, { kind: 'all' });
    expect(all).not.toContain(4);
    expect(all).not.toContain(5);
  });

  // This tiebreak MUST match the public queries' `, a.id`, or the admin order
  // and the live order disagree whenever two rows share a position.
  it('breaks ties on id, matching the public ORDER BY', () => {
    const tied = [
      photo({ id: 9, display_order: 1 }),
      photo({ id: 3, display_order: 1 }),
      photo({ id: 6, display_order: 1 }),
    ];
    expect(deriveShopIds(tied, { kind: 'all' })).toEqual([3, 6, 9]);
  });
});

describe('shopScopeCounts', () => {
  it('counts shop members per scope', () => {
    const photos = [
      photo({ id: 1, collection_id: 10 }),
      photo({ id: 2, collection_id: 10 }),
      photo({ id: 3, collection_id: null }),
      photo({ id: 4, status: 'draft', collection_id: 10 }),
    ];
    const c = shopScopeCounts(photos);
    expect(c.all).toBe(3);
    expect(c.unfiled).toBe(1);
    expect(c.byCollection.get(10)).toBe(2);
  });
});

describe('cutLineAfter', () => {
  // The public /shop query filters unbuyable rows out BEFORE applying its
  // LIMIT, so the line has to count buyable tiles only. Counting every tile is
  // the off-by-N this function exists to prevent.
  it('counts buyable tiles only, with unbuyable ones above AND below the cut', () => {
    const ordered = [
      photo({ id: 1, buyable: true }),
      photo({ id: 2, buyable: false }),
      photo({ id: 3, buyable: true }),
      photo({ id: 4, buyable: false }),
      photo({ id: 5, buyable: true }),
    ];
    // limit 2 -> after the 2nd BUYABLE tile, which is index 2 (id 3)
    expect(cutLineAfter(ordered, 2)).toBe(2);
  });

  it('returns null for limit 0, which means no limit', () => {
    expect(cutLineAfter([photo({ id: 1 }), photo({ id: 2 })], 0)).toBeNull();
  });

  it('returns null when the limit exceeds the buyable count', () => {
    const ordered = [photo({ id: 1, buyable: true }), photo({ id: 2, buyable: false })];
    expect(cutLineAfter(ordered, 5)).toBeNull();
  });

  it('returns null when every tile is unbuyable', () => {
    const ordered = [photo({ id: 1, buyable: false }), photo({ id: 2, buyable: false })];
    expect(cutLineAfter(ordered, 1)).toBeNull();
  });

  it('returns null when the cut falls on the last tile, since nothing is below it', () => {
    const ordered = [photo({ id: 1, buyable: true }), photo({ id: 2, buyable: true })];
    expect(cutLineAfter(ordered, 2)).toBeNull();
  });
});

describe('belowCutIds', () => {
  // The cut is a property of the ALL order, but it has to be readable from any
  // scope: a piece that is both unfiled and below the cut is reachable from
  // nowhere on the site except the sitemap, and the Unfiled view is where that
  // gets flagged. Computing it from the visible subset would be wrong, because
  // that subset is not the All order.
  it('is computed from the All order, not from the visible subset', () => {
    const photos = [
      photo({ id: 1, display_order: 1, collection_id: 10 }),
      photo({ id: 2, display_order: 2, collection_id: null }),
      photo({ id: 3, display_order: 3, collection_id: null }),
    ];
    const below = belowCutIds(photos, 2);
    expect(below.has(3)).toBe(true);
    expect(below.has(1)).toBe(false);
    expect(below.has(2)).toBe(false);
  });

  it('is empty when there is no cut', () => {
    const photos = [photo({ id: 1, display_order: 1 })];
    expect(belowCutIds(photos, 0).size).toBe(0);
    expect(belowCutIds(photos, 99).size).toBe(0);
  });
});
