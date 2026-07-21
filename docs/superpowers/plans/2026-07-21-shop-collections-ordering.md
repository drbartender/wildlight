# Shop Collections Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin Shop shelf filterable by collection and drag-arrangeable, with an independent All order and per-collection orders that drive the public storefront, plus an editable `/shop` cap.

**Architecture:** `artworks.display_order` is repurposed as the All order and a new `artworks.collection_order` holds position within a collection. Both are densified once by a marker-guarded migration. Positions are assigned server-side and never trusted from a stored value on a row entering the shop. Pure logic lives in `lib/shop-arrange.ts` and `lib/shop-limit.ts` so vitest can reach it; the Shop shelf is extracted from `WallArranger` into its own component so its state cannot entangle with the Wall's.

**Tech Stack:** Next.js 16 App Router, Postgres (Neon) via raw `pg`, Zod, vitest.

**Spec:** `docs/superpowers/specs/2026-07-20-shop-collections-ordering-design.md`

**Revision:** rewritten 2026-07-21 after the plan review fleet found 8 blockers in the first draft.

## Global Constraints

- **No ORM, no query builder.** Raw SQL via `lib/db.ts`, parameterized (`$1`, `$2`) always. Never concatenate a value into SQL.
- **Multi-statement writes use `withTransaction`** from `lib/db.ts`.
- **`lib/schema.sql` re-runs on every build** (`npm run build` is `tsx lib/migrate.ts && next build`). Every statement must be idempotent.
- **Never add a statement-level `BEGIN`/`COMMIT` or a non-transactional statement** (`CREATE INDEX CONCURRENTLY`, `VACUUM`) to `lib/schema.sql`. `lib/migrate.ts` sends the whole file through one `pool.query`, and that implicit transaction is what makes the backfill marker atomic. (The `BEGIN` inside a `DO $$ … $$` PL/pgSQL body is block syntax, not transaction control, and is fine.)
- **NOTHING a `'use client'` component imports may reach `lib/db.ts`.** `lib/db.ts:33` calls `createPool()` at module scope, so a value import drags `pg` into the client bundle. This fails only at `next build`, after typecheck and tests have both passed. Client-reachable constants live in `lib/shop-limit.ts`, which imports nothing.
- **`statement_timeout` is 15s** (`lib/db.ts`), and on PostgreSQL 16 and earlier it covers the whole multi-statement migration message.
- **Gates: `npm run typecheck`, `npm test`, and `npm run build`.** NOT `npm run lint`. `next lint` was removed in Next 16 and there is no flat ESLint config, so it fails for unrelated reasons.
- **No local database and no component-test harness.** SQL is verified by the throwaway-branch migration run in Task 4 and the manual deploy pass. React changes are verified in `/dev-preview/wall`, a DB-free, auth-free harness that renders the real component against mock data. It is gated off when `NODE_ENV === 'production'`, so it is a local-only checkpoint.
- **The reorder payload cap (1000) and the admin loader's `LIMIT 1000` stay in lockstep.** Note the loader's limit applies across ALL statuses while the reorder guard counts published rows. If total artworks approach 1000, both must be raised together or reordering 409s permanently.
- **DB columns are snake_case; JS variables are camelCase.** Admin request bodies in this repo use camelCase keys (`collectionId`, matching the existing `/api/admin/artworks` bulk route), so do not "fix" the new endpoints to snake_case.
- **Copy rule: no em dashes** in any user-facing string.

## Task order and deploy grouping

Two orderings are load-bearing and are not free to rearrange:

1. **Task 3 (script guards) comes before Task 4 (the migration).** The migration is what makes `scripts/publish-selections.ts` destructive; its guard must exist before the hazard, not ten tasks after it.
2. **Tasks 4 through 7 must ship in the SAME deploy.** `0` sorts first under `ORDER BY display_order, id`, so with the migration live and the position rules not, every newly published artwork jumps to the top of `/shop`.
3. **Tasks 14 and 16 must ship in the same deploy.** Task 14 gives the admin a working limit field; Task 16 is what makes `/shop` read it. Ship 14 alone and the field saves, the readout says "showing 30 of N buyable", the cut line moves, and `/shop` still returns exactly 12. A control that lies is worse than no control.
4. **Task 17 widens Task 16's `Promise.all` in place**, so once 17 lands, 16 cannot be reverted alone without a conflict. Revert both or neither.

Tasks 1 through 10 are a safe stopping point: schema, rules, and endpoints, with no UI and no public read changed.

## Review cadence

- After **Task 3**: a script-safety review. Both scripts can destroy a curated order.
- After **Task 4**: a SQL/migration review before any push. This is the one irreversible task.
- After **Task 10**: an auth and injection review of the two new endpoints.
- After **Task 11**: a review of the extraction. It moves a 1339-line component's most stateful section, and the prop seam is wide (16 fields). This is where a behavior regression hides.
- After **Task 14**: a client-bundle and UI-state review. Task 14 Step 9's `npm run build` is the only gate in the plan that catches a server module reaching the client.
- After **Task 17**: a public-facing query and copy review.

---

## File Structure

**Created:**
- `lib/shop-limit.ts`: limit constants and validators. Pure, imports nothing, safe for client components.
- `lib/site-settings.ts`: `getShopIndexLimit()`. Server-only, imports `pool`.
- `lib/shop-arrange.ts`: scope, order derivation, cut line, below-cut set.
- `components/admin/ShopShelf.tsx`: the Shop shelf, extracted from `WallArranger`.
- `components/admin/ShopLimitField.tsx`: the `/shop` cap control.
- `components/admin/TileActions.tsx`: `EditLink` and `RemoveButton`, shared by both shelves.
- `app/api/admin/shop/order/route.ts`, `app/api/admin/settings/route.ts`
- `tests/lib/shop-limit.test.ts`, `tests/lib/shop-arrange.test.ts`, `tests/lib/site-settings.test.ts`, `tests/lib/publish-artworks-order.test.ts`

**Modified:** `lib/schema.sql`, `lib/wall-arrange.ts`, `lib/publish-artworks.ts`, `app/api/admin/artworks/[id]/route.ts`, `app/api/admin/artworks/route.ts`, `app/admin/wall/page.tsx`, `components/admin/WallArranger.tsx`, `app/dev-preview/wall/page.tsx`, `app/admin/admin.css`, `tests/lib/wall-arrange-library.test.ts`, the four public pages, `components/site/Footer.tsx`, `scripts/import-manifest.ts`, `scripts/publish-selections.ts`, `README.md`.

---

### Task 1: Limit constants and validators (`lib/shop-limit.ts`)

**Files:**
- Create: `lib/shop-limit.ts`
- Test: `tests/lib/shop-limit.test.ts`

**Interfaces:**
- Consumes: nothing. This module imports nothing, deliberately.
- Produces: `SHOP_INDEX_LIMIT_MAX = 500`, `SHOP_INDEX_LIMIT_DEFAULT = 12`, `isValidShopIndexLimit(n: unknown): boolean`, `parseShopIndexLimit(raw: unknown): number`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/shop-limit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseShopIndexLimit,
  isValidShopIndexLimit,
  SHOP_INDEX_LIMIT_DEFAULT,
  SHOP_INDEX_LIMIT_MAX,
} from '@/lib/shop-limit';

describe('parseShopIndexLimit', () => {
  it('accepts a normal stored value', () => {
    expect(parseShopIndexLimit('12')).toBe(12);
  });

  it('accepts 0, which means no limit', () => {
    expect(parseShopIndexLimit('0')).toBe(0);
  });

  it('accepts the maximum', () => {
    expect(parseShopIndexLimit(String(SHOP_INDEX_LIMIT_MAX))).toBe(SHOP_INDEX_LIMIT_MAX);
  });

  // Number('') === 0, and 0 means "no limit" here, so without an explicit guard
  // a blank row would silently publish the entire catalogue to /shop.
  it('does NOT read an empty string as 0', () => {
    expect(parseShopIndexLimit('')).toBe(SHOP_INDEX_LIMIT_DEFAULT);
    expect(parseShopIndexLimit('   ')).toBe(SHOP_INDEX_LIMIT_DEFAULT);
  });

  it('falls back on junk, negatives, decimals and out-of-range values', () => {
    for (const bad of ['abc', '-1', '1.5', String(SHOP_INDEX_LIMIT_MAX + 1), null, undefined, {}]) {
      expect(parseShopIndexLimit(bad)).toBe(SHOP_INDEX_LIMIT_DEFAULT);
    }
  });
});

describe('isValidShopIndexLimit', () => {
  it('accepts integers in 0..MAX', () => {
    expect(isValidShopIndexLimit(0)).toBe(true);
    expect(isValidShopIndexLimit(12)).toBe(true);
    expect(isValidShopIndexLimit(SHOP_INDEX_LIMIT_MAX)).toBe(true);
  });

  it('rejects everything else', () => {
    for (const bad of [-1, 1.5, SHOP_INDEX_LIMIT_MAX + 1, '12', null, undefined, NaN]) {
      expect(isValidShopIndexLimit(bad)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/shop-limit.test.ts`
Expected: FAIL, `Failed to resolve import "@/lib/shop-limit"`

- [ ] **Step 3: Write the implementation**

Create `lib/shop-limit.ts`:

```ts
// Limit constants and validators for the /shop cap.
//
// THIS MODULE IMPORTS NOTHING, ON PURPOSE. It is imported by a 'use client'
// component (ShopLimitField), and lib/db.ts calls createPool() at module scope,
// so anything reaching lib/db.ts from a client component drags `pg` into the
// client bundle. That failure appears only at `next build`, after typecheck and
// tests have both passed. The DB-backed reader lives in lib/site-settings.ts.

/** Upper bound. A typo must not ask the storefront index for 50,000 rows. */
export const SHOP_INDEX_LIMIT_MAX = 500;
/** The previous hardcoded /shop cap. Seeded into site_settings, and the fallback. */
export const SHOP_INDEX_LIMIT_DEFAULT = 12;

/**
 * Is this an acceptable admin input? The SAME predicate runs on the client
 * (inline validation) and the server (Zod refinement), from this one function,
 * so the two cannot drift.
 */
export function isValidShopIndexLimit(n: unknown): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= SHOP_INDEX_LIMIT_MAX;
}

/**
 * Coerce a stored value into a usable limit. 0 means "no limit". Anything
 * unusable returns the default rather than throwing: this value gates the
 * storefront index, so a bad row must never blank or 500 the page.
 */
export function parseShopIndexLimit(raw: unknown): number {
  if (typeof raw === 'string' && raw.trim() === '') return SHOP_INDEX_LIMIT_DEFAULT;
  if (typeof raw !== 'string' && typeof raw !== 'number') return SHOP_INDEX_LIMIT_DEFAULT;
  const n = Number(raw);
  return isValidShopIndexLimit(n) ? n : SHOP_INDEX_LIMIT_DEFAULT;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/shop-limit.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Confirm the module has no imports**

Run: `grep -c '^import' lib/shop-limit.ts`
Expected: `0`

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add lib/shop-limit.ts tests/lib/shop-limit.test.ts
git commit -m "feat(shop): client-safe limit constants and validators"
```

---

### Task 2: Scopes, order derivation, cut line (`lib/shop-arrange.ts`)

**Files:**
- Create: `lib/shop-arrange.ts`
- Modify: `lib/wall-arrange.ts`, `tests/lib/wall-arrange-library.test.ts`, `app/dev-preview/wall/page.tsx`
- Test: `tests/lib/shop-arrange.test.ts`

**Interfaces:**
- Consumes: `isInShop`, `LibraryPhoto` from `@/lib/wall-arrange`
- Produces: `ShopScope`, `scopeKey`, `parseScopeKey`, `isArrangeable`, `deriveShopIds`, `shopScopeCounts`, `cutLineAfter`, `belowCutIds`

- [ ] **Step 1: Add the four fields to `LibraryPhoto`**

In `lib/wall-arrange.ts`, inside `export interface LibraryPhoto`, after `wall_rank`:

```ts
  /** Collection assignment, or null when unfiled. */
  collection_id: number | null;
  /** Collection title, for the read-only tile label. Null when unfiled. */
  collection_title: string | null;
  /** Position within its collection. 0 = never placed. */
  collection_order: number;
  /** Position in the All order (the /shop sequence). 0 = never placed. */
  display_order: number;
```

Note for the implementer: `pool.query<LibraryPhoto>` is an unchecked generic, so
these four fields are a promise the loader does not keep until Task 12. Nothing
reads them before then, so it is safe, but do not assume they are populated in
Tasks 3 through 11.

- [ ] **Step 2: Write the failing test**

Create `tests/lib/shop-arrange.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/lib/shop-arrange.test.ts`
Expected: FAIL, `Failed to resolve import "@/lib/shop-arrange"`

- [ ] **Step 4: Write the implementation**

Create `lib/shop-arrange.ts`:

```ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/lib/shop-arrange.test.ts`
Expected: PASS, 16 tests

- [ ] **Step 6: Fix the two other `LibraryPhoto` construction sites**

Typecheck now fails in two places. In `tests/lib/wall-arrange-library.test.ts`, inside `photo()`, after `wall_rank`:

```ts
    collection_id: over.collection_id ?? null,
    collection_title: over.collection_title ?? null,
    collection_order: over.collection_order ?? 0,
    display_order: over.display_order ?? 0,
```

In `app/dev-preview/wall/page.tsx`, inside the `out.push({…})` in `mockPhotos`, after `wall_rank`:

```ts
      // Two chapters so the filter tray has something to show, plus a
      // deliberate handful left unfiled so that chip is exercised too.
      //
      // The ids here MUST match the `collections` array passed in Task 11
      // Step 5. `i % 3` yields 1 and 2 for the filed cases, so the chips and the
      // tiles agree; `(i % 3) + 1` would yield 2 and 3 and leave one chapter
      // permanently empty and one set of photos with no chip at all.
      collection_id: published ? (i % 3 === 0 ? null : i % 3) : null,
      collection_title:
        published && i % 3 !== 0 ? (i % 3 === 1 ? 'The Front Range' : 'Night Work') : null,
      collection_order: i,
      display_order: i,
```

- [ ] **Step 7: Run the full suite and typecheck, then commit**

Run: `npm test && npm run typecheck`
Expected: all tests PASS, typecheck clean

```bash
git add lib/shop-arrange.ts lib/wall-arrange.ts tests/lib/shop-arrange.test.ts \
        tests/lib/wall-arrange-library.test.ts app/dev-preview/wall/page.tsx
git commit -m "feat(shop): scope, order derivation and cut-line logic"
```

---

### Task 3: Script guards (BEFORE the migration that makes them necessary)

**Files:**
- Modify: `scripts/import-manifest.ts`, `scripts/publish-selections.ts`, `README.md`

This task comes first among the server changes deliberately. Task 4's backfill is
what makes `publish-selections.ts` destructive, so its guard has to exist before
the hazard, not ten tasks after it.

- [ ] **Step 1: Stop `import-manifest` writing display order on BOTH tables**

The `collections` upsert currently ends:

```
         tagline = COALESCE(collections.tagline, EXCLUDED.tagline),
         display_order = EXCLUDED.display_order
       RETURNING id`,
```

`display_order = EXCLUDED.display_order` is the LAST item, so deleting that line
alone leaves a dangling comma on the `tagline` line. Delete the line **and** the
trailing comma above it:

```
         tagline = COALESCE(collections.tagline, EXCLUDED.tagline)
       RETURNING id`,
```

This ordering is load-bearing now: it drives the admin filter tray and the new
browse band, so a re-import must not reset it.

For the `artworks` upsert, remove `display_order` from the INSERT column list,
drop the matching `$n` from `VALUES`, remove the `display_order =
EXCLUDED.display_order,` line from `DO UPDATE SET` (that one DOES carry a
trailing comma, so removing the line alone is correct there), and drop `idx` from
the parameter array. Add above it:

```ts
        // display_order is the curated All order now, arranged from /admin/wall.
        // Writing a manifest index here would silently overwrite it on every
        // re-import. New rows keep the column default of 0, the "never placed"
        // sentinel the publish rules append from.
```

- [ ] **Step 2: Handle the re-file case**

`ON CONFLICT (slug) DO UPDATE SET collection_id = EXCLUDED.collection_id` re-files
rows that may already be published. Those never transition into `published`, so
the publish chokepoint never assigns them a chapter position.

The prior `collection_id` must be read **before** the upsert overwrites it, or
there is nothing left to compare against. Inside the same `withTransaction`,
before the upsert:

```ts
        const prior = await client.query<{ id: number; collection_id: number | null; status: string }>(
          `SELECT id, collection_id, status FROM artworks WHERE slug = $1`,
          [slug],
        );
        const priorRow = prior.rows[0] ?? null;
```

and after the upsert:

```ts
        // A re-filed row that is ALREADY published never transitions, so nothing
        // assigns it a chapter position and it would sort to the FRONT of its
        // new chapter on /shop/collections/[slug], /portfolio/[slug] and the
        // related rail. Only fires on a REAL change of collection, so a no-op
        // re-import does not shuffle anything.
        if (priorRow && priorRow.status === 'published' && priorRow.collection_id !== colId) {
          await client.query(
            `UPDATE artworks a
                SET collection_order = COALESCE(
                      (SELECT MAX(b.collection_order) FROM artworks b
                        WHERE b.collection_id = a.collection_id
                          AND b.status = 'published' AND b.id <> a.id), 0) + 1
              WHERE a.id = $1 AND a.collection_id IS NOT NULL`,
            [priorRow.id],
          );
        }
```

- [ ] **Step 3: Fence off `publish-selections`**

At the top of `main()` in `scripts/publish-selections.ts`, before reading the
selections file:

```ts
  // This script resolves artworks by (collection_id, display_order), expecting
  // display_order to be the manifest's per-collection index. The shop-ordering
  // backfill turned display_order into a global curated sequence, so that lookup
  // now matches the WRONG rows, and the converge step below demotes every
  // published row it did not match. A post-backfill run could mass-unpublish
  // the shop.
  //
  // Blocks the dry run too, not just --apply: a dry run that prints a confident
  // and entirely wrong diff is worse than one that refuses.
  //
  // A missing site_settings table (a fresh or pre-migrate database) means the
  // backfill has not run, so proceed rather than surfacing a raw Postgres error.
  let backfilled = false;
  try {
    const marker = await pool.query(
      `SELECT 1 FROM site_settings WHERE key = 'shop_order_backfilled'`,
    );
    backfilled = (marker.rowCount ?? 0) > 0;
  } catch {
    backfilled = false;
  }
  if (backfilled) {
    console.error(
      'publish:selections is disabled. display_order is now the curated /shop order, ' +
        'not the manifest index this script looks rows up by. See ' +
        'docs/superpowers/specs/2026-07-20-shop-collections-ordering-design.md',
    );
    process.exit(1);
  }
```

- [ ] **Step 4: Update the README**

On the `npm run publish:selections` row, append:
`(disabled after the shop-ordering backfill; display_order is the curated /shop order now)`

- [ ] **Step 5: Verify the SQL strings still parse**

Both edits removed lines from multi-line SQL template literals, which typecheck
cannot validate.

Run: `grep -n -A10 'INSERT INTO collections' scripts/import-manifest.ts && grep -n -A12 'INSERT INTO artworks' scripts/import-manifest.ts`

Expected: the `collections` `DO UPDATE SET` ends with `tagline = COALESCE(...)`
and no trailing comma; the `artworks` INSERT column list and `VALUES` have equal
counts, and the parameter array length matches the highest `$n`.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck && npm test
git add scripts/import-manifest.ts scripts/publish-selections.ts README.md
git commit -m "fix(scripts): stop clobbering curated order, fence off publish-selections"
```

---

### Task 4: Migration (`collection_order`, `site_settings`, the one-time backfill)

**Files:**
- Modify: `lib/schema.sql` (append at the end)

This is the one irreversible task in the plan. It gets a real run, not a re-read.

**Deploy grouping: Tasks 4 through 7 must ship together.**

- [ ] **Step 0: Snapshot production BEFORE this can reach any build**

`npm run build` runs `tsx lib/migrate.ts` first, so the densify fires on the
first build after this lands, including a Vercel preview build if Preview shares
the production `DATABASE_URL`. **Confirm whether it does** before continuing.

Against production:

```sql
CREATE TABLE artworks_order_backup_20260721 AS
  SELECT id, display_order, collection_id, collection_order FROM artworks;

-- Shape of the data going in. Expect many nonzero values: import-manifest wrote
-- per-collection indices into display_order.
SELECT COUNT(*) FILTER (WHERE display_order <> 0) AS arranged, COUNT(*) AS total
  FROM artworks;

-- Both counts matter. The reorder guard counts published rows, but the admin
-- loader's LIMIT 1000 applies across ALL statuses, so the total is what can
-- truncate the All scope and 409 every reorder.
SELECT COUNT(*) FILTER (WHERE status = 'published') AS published, COUNT(*) AS total
  FROM artworks;
```

Two non-SQL checks in the same step:

- **Confirm the Neon major version.** On PostgreSQL 16 and earlier the 15s
  `statement_timeout` covers the entire multi-statement migration message, so a
  slow deploy aborts the whole thing. That fails safe (the marker rolls back)
  but it fails the build, and knowing which behavior you are on beforehand is
  the difference between a diagnosis and a mystery.
- **Confirm no `scraped/selections.json` run is pending.** Task 3's fence is
  marker-gated, and the marker does not exist until this task runs, so there is
  a real window between the two commits where the old script would still run and
  would still be wrong.

- [ ] **Step 1: Append the DDL**

Order inside this block matters: `site_settings` must exist before the `DO` block
reads it.

```sql
-- Shop ordering ------------------------------------------------------------
-- Generic key/value settings. There was no settings store before this; the
-- admin Settings page is account, env masks, and integration health only.
CREATE TABLE IF NOT EXISTS site_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- 12 preserves the previous hardcoded /shop LIMIT exactly, so the deploy
-- changes nothing visible until an admin changes it.
INSERT INTO site_settings (key, value) VALUES ('shop_index_limit', '12')
  ON CONFLICT (key) DO NOTHING;

-- collection_order: position within the row's OWN collection. Meaningful only
-- relative to collection_id. One column suffices because an artwork belongs to
-- exactly one collection; a join table would model a many-to-many that does not
-- exist. 0 = never placed (the sentinel the publish rules depend on).
ALTER TABLE artworks
  ADD COLUMN IF NOT EXISTS collection_order INT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_artworks_collection_order
  ON artworks(collection_id, collection_order);

-- One-time densify of BOTH orders, from the sort key visitors already see, so
-- nothing reshuffles on deploy.
--
-- PUBLISHED ROWS ONLY. Every public consumer of both orders filters to
-- status='published', so only published rows have a position that means
-- anything. Ranking all rows would hand existing drafts positions interleaved
-- among the published ones, and publishing such a draft later would drop it into
-- the MIDDLE of the sequence (possibly above the cut line, displacing
-- something) instead of appending. Leaving non-published rows at 0 is what makes
-- append-on-entry work.
--
-- MARKER-GUARDED. lib/schema.sql re-runs on every build, and a densify that
-- re-ran every deploy would fight the append rules: a piece published at MAX+1
-- would be silently re-ranked on the next deploy.
--
-- lib/migrate.ts sends this whole file through ONE pool.query with no explicit
-- BEGIN/COMMIT, so Postgres runs it as a single implicit transaction: the DO
-- block cannot half-run, and a failure later in the file rolls the marker back
-- too, so the backfill retries on the next build instead of being skipped.
-- Do not split the migration, and never add a statement-level BEGIN/COMMIT or a
-- non-transactional statement (CREATE INDEX CONCURRENTLY, VACUUM) to this file.
--
-- THE MARKER IS DATA, NOT SCHEMA. If collection_order or display_order is ever
-- dropped and re-added, this row survives and the backfill silently skips,
-- leaving every collection page sorted by id. Delete the
-- 'shop_order_backfilled' row in the same breath as any such drop.
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
    -- (preview + prod, or a redeploy) both see no marker and both densify, and a
    -- bare INSERT raises 23505 on the second, aborting the whole implicit
    -- transaction and failing that deploy.
    INSERT INTO site_settings (key, value) VALUES ('shop_order_backfilled', '1')
      ON CONFLICT (key) DO NOTHING;
  END IF;
END $$;
```

- [ ] **Step 2: Verify no statement-level transaction control was introduced**

Two checks, because a single pattern cannot do this. The `BEGIN` inside the
`DO $$` body sits at column 0 (PL/pgSQL block syntax, not transaction control),
and the word `CONCURRENTLY` appears in the comment above the block, so a naive
`grep -E '^(BEGIN|...)|CONCURRENTLY'` matches the very DDL Step 1 just added.

First, no genuine transaction control or non-transactional statement:

Run: `grep -nE '^\s*(COMMIT|VACUUM)\b|^\s*CREATE +INDEX +CONCURRENTLY' lib/schema.sql`
Expected: no output

Second, the only `BEGIN` in the file is the `DO` block's:

Run: `grep -c '^BEGIN$' lib/schema.sql`
Expected: `1`

Run: `grep -B1 '^BEGIN$' lib/schema.sql`
Expected: the preceding line is `DO $$`

- [ ] **Step 3: Run the migration for real, twice, against a throwaway branch**

Re-reading SQL cannot detect a wrong `PARTITION BY`, a wrong join, or a marker
check that never fires. Create a scratch Neon branch from production, point
`DATABASE_URL` at it, and:

```bash
npm run migrate   # first run: performs the backfill
npm run migrate   # second run: must be a no-op
```

Then assert against the scratch branch:

```sql
-- 1. Dense 1..N over published rows, no gaps, no duplicates.
SELECT COUNT(*) AS published, MIN(display_order) AS lo, MAX(display_order) AS hi,
       COUNT(DISTINCT display_order) AS distinct_positions
  FROM artworks WHERE status = 'published';
-- Expect: lo = 1, hi = published, distinct_positions = published

-- 2. Non-published rows left at 0.
SELECT COUNT(*) FROM artworks WHERE status <> 'published' AND collection_order <> 0;
-- Expect: 0

-- 3. Dense 1..N within each collection, over published rows.
SELECT collection_id, COUNT(*) AS n, MAX(collection_order) AS hi
  FROM artworks WHERE status = 'published' AND collection_id IS NOT NULL
 GROUP BY collection_id;
-- Expect: n = hi for every row

-- 4. Order preserved. Compare against the Step 0 snapshot: the RELATIVE order
--    must be identical, only the values densify.
SELECT a.id, b.display_order AS before, a.display_order AS after
  FROM artworks a JOIN artworks_order_backup_20260721 b ON b.id = a.id
 WHERE a.status = 'published'
 ORDER BY b.display_order, a.id;
-- Expect: the `after` column strictly increasing down the result

-- 5. The second run changed nothing.
SELECT value FROM site_settings WHERE key = 'shop_order_backfilled';
-- Expect: exactly one row, value '1'
```

**Then the assertion that actually tests the marker.** Running twice proves
nothing on its own: the densify is idempotent on already-dense data, so an
inverted or always-true `IF NOT EXISTS` passes assertions 1 through 5
identically. Perturb the data between runs and confirm the second run leaves it
alone:

```sql
UPDATE artworks SET display_order = 9999
 WHERE id = (SELECT id FROM artworks WHERE status='published'
              ORDER BY display_order LIMIT 1);
```

```bash
npm run migrate   # third run
```

```sql
SELECT display_order FROM artworks WHERE display_order = 9999;
-- Expect: still 9999. If it was re-ranked, the marker guard is not firing and
-- every future deploy will silently re-rank the curated order.
```

Cut the scratch branch **after** Step 0, not before, or assertion 4's join to
`artworks_order_backup_20260721` finds no table.

- [ ] **Step 4: Delete the scratch branch and commit**

```bash
git add lib/schema.sql
git commit -m "feat(shop): collection_order, site_settings, one-time order backfill"
```

---

### Task 5: Rule 2 (entering `published` always assigns a fresh position)

**Files:**
- Modify: `lib/publish-artworks.ts`
- Test: `tests/lib/publish-artworks-order.test.ts`

**Interfaces:**
- Consumes: the existing `transitioning` id list already computed in this file.
- Produces: no signature change.

`publishArtworks` takes an injectable `PoolClient`, so unlike the route changes
this one IS reachable by vitest with a recording fake. Use that.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/publish-artworks-order.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { PoolClient } from 'pg';
import { publishArtworks } from '@/lib/publish-artworks';

/** Records every SQL string and param set, and replays canned SELECT results. */
function fakeClient(rows: { id: number; status: string }[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT id, status')) return { rows, rowCount: rows.length };
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;
  return { client, calls };
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('publishArtworks position assignment', () => {
  it('assigns positions with ROW_NUMBER, never MAX + 1', async () => {
    // MAX + 1 would hand an entire batch the identical position. This helper
    // takes an ids[], so the batch case is the normal case, not an edge case.
    const { client, calls } = fakeClient([
      { id: 1, status: 'draft' },
      { id: 2, status: 'draft' },
    ]);
    await publishArtworks(client, [1, 2]);
    const orderSql = calls.filter((c) => c.sql.includes('display_order'));
    expect(orderSql.length).toBeGreaterThan(0);
    expect(norm(orderSql[0].sql)).toContain('ROW_NUMBER() OVER (ORDER BY id)');
  });

  it('excludes the transitioning rows from the MAX it appends after', async () => {
    // The status UPDATE runs FIRST, so those rows are already status='published'
    // by the time the MAX is read. Without the exclusion the MAX reads their own
    // stale manifest indices back in and the batch lands mid-grid.
    const { client, calls } = fakeClient([{ id: 1, status: 'draft' }]);
    await publishArtworks(client, [1]);
    const maxSql = calls.find((c) => c.sql.includes('MAX(display_order)'));
    expect(maxSql).toBeDefined();
    expect(norm(maxSql!.sql)).toContain('id <> ALL($1::int[])');
    expect(norm(maxSql!.sql)).toContain("status = 'published'");
  });

  it('passes only the transitioning ids, not every eligible id', async () => {
    // Already-published rows must not be repositioned: re-publishing one would
    // otherwise kick it to the end of /shop.
    const { client, calls } = fakeClient([
      { id: 1, status: 'draft' },
      { id: 2, status: 'published' },
    ]);
    await publishArtworks(client, [1, 2]);
    const orderSql = calls.find((c) => c.sql.includes('display_order'));
    expect(orderSql!.params[0]).toEqual([1]);
  });

  it('does no position work when nothing is transitioning', async () => {
    const { client, calls } = fakeClient([{ id: 1, status: 'published' }]);
    await publishArtworks(client, [1]);
    expect(calls.some((c) => c.sql.includes('display_order'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/publish-artworks-order.test.ts`
Expected: FAIL on the first assertion, no query containing `display_order`

- [ ] **Step 3: Add the position assignment**

In `lib/publish-artworks.ts`, after the existing `if (eligible.length) { … }`
block and before the `return`:

```ts
  // Position assignment. A row entering the shop NEVER keeps its stored
  // position: production guarantees duplicate display_order values (
  // scripts/import-manifest.ts historically wrote per-collection manifest
  // indices into it), so any "is this position already taken" test would be
  // wrong on the first bulk publish. Assign unconditionally instead, and let
  // the demote paths zero the columns on the way out (Rule 1, Tasks 6 and 7).
  if (transitioning.length) {
    // MAX + ROW_NUMBER, never MAX + 1: this helper takes an ids[], so MAX + 1
    // would hand an entire batch of twenty drafts the identical position.
    //
    // The MAX excludes the transitioning rows themselves. The UPDATE above has
    // already flipped them to status='published', so an unqualified
    // MAX(display_order) WHERE status='published' would read their own stale
    // values back in.
    await client.query(
      `WITH m AS (
         SELECT COALESCE(MAX(display_order), 0) AS mx
           FROM artworks
          WHERE status = 'published' AND id <> ALL($1::int[])
       ),
       t AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
           FROM artworks WHERE id = ANY($1::int[])
       )
       UPDATE artworks a
          SET display_order = m.mx + t.rn
         FROM t, m
        WHERE a.id = t.id`,
      [transitioning],
    );

    // Same shape for collection_order, partitioned by collection. Rows with no
    // collection are skipped and stay at 0, which is correct: an unfiled piece
    // has no chapter to hold a position in.
    await client.query(
      `WITH t AS (
         SELECT id, collection_id,
                ROW_NUMBER() OVER (PARTITION BY collection_id ORDER BY id) AS rn
           FROM artworks
          WHERE id = ANY($1::int[]) AND collection_id IS NOT NULL
       ),
       m AS (
         SELECT collection_id, COALESCE(MAX(collection_order), 0) AS mx
           FROM artworks
          WHERE status = 'published'
            AND collection_id IS NOT NULL
            AND id <> ALL($1::int[])
          GROUP BY collection_id
       )
       UPDATE artworks a
          SET collection_order = COALESCE(m.mx, 0) + t.rn
         FROM t LEFT JOIN m ON m.collection_id = t.collection_id
        WHERE a.id = t.id`,
      [transitioning],
    );
  }
```

- [ ] **Step 4: Extend the file's docstring**

Add a fourth bullet after the `published_at` one:

```
 * - Rows TRANSITIONING into 'published' are assigned a fresh display_order (and
 *   collection_order, when filed) at the end of their scope. Stored positions
 *   are never trusted here; import-manifest historically wrote manifest indices
 *   into display_order, so duplicates are normal. The demote paths zero both
 *   columns, so a returning piece appends.
```

- [ ] **Step 5: Run the test, typecheck, commit**

Run: `npx vitest run tests/lib/publish-artworks-order.test.ts && npm run typecheck`
Expected: PASS, 4 tests; typecheck clean

```bash
git add lib/publish-artworks.ts tests/lib/publish-artworks-order.test.ts
git commit -m "feat(shop): assign shop positions at the publish chokepoint"
```

---

### Task 6: Rules 1 and 3 in the per-artwork PATCH

**Files:**
- Modify: `app/api/admin/artworks/[id]/route.ts`

**Note on Rule 1's placement.** The spec says Rules 1 and 2 live inside
`lib/publish-artworks.ts`. Rule 2 does (Task 5). Rule 1 cannot: that helper has
no demote path, it only publishes. Rule 1 therefore lives at the two demote
sites, this route and the bulk `retire` action. The third potential demoter,
`scripts/publish-selections.ts`'s converge step, is fenced off entirely in Task 3,
so it cannot bypass this. Recorded here so the divergence from the spec is
deliberate and visible rather than an oversight.

- [ ] **Step 1: Remove `display_order` from the Zod schema**

Delete `display_order: z.number().int().optional(),` from the `Patch` object.
Ordering has a dedicated endpoint now, and no admin UI sends this field, so a
direct write path that bypasses densification is a trap.

- [ ] **Step 2: Add Rules 1 and 3 beside the existing `wall_order` reset**

Immediately after the existing
`if (d.on_wall !== undefined) { updateCols.push('wall_order = 0'); }` block:

```ts
      // Rule 1: leaving 'published' zeroes both shop orders, exactly as toggling
      // on_wall clears wall_order directly above. Without this a retired piece
      // keeps a live-looking position, and re-publishing drops it back into the
      // middle of the grid instead of appending.
      const demoting = d.status === 'retired' || d.status === 'draft';
      if (demoting) {
        updateCols.push('display_order = 0', 'collection_order = 0');
      }

      // Rule 3: a REAL collection change appends to the end of the new chapter.
      // In an UPDATE the right-hand side sees the OLD column values, so
      // `collection_id IS DISTINCT FROM $n` compares the prior collection to the
      // incoming one in the same statement that overwrites it.
      //
      // The DISTINCT check is not optional: ArtworkRowMenu lets an admin click
      // the chapter a piece is already in, and without it that no-op would
      // re-append the piece to the end of its own chapter.
      //
      // Guarded on !demoting: Postgres rejects two assignments to the same
      // column in one UPDATE with 42601, and a PATCH of
      // {status:'retired', collection_id:N} would otherwise push both
      // `collection_order = 0` and this CASE. Demotion wins, which is right: a
      // row leaving the shop has no position in any chapter.
      if (d.collection_id !== undefined && !demoting) {
        const p = vals.length + 1;
        vals.push(d.collection_id);
        updateCols.push(
          `collection_order = CASE
             WHEN collection_id IS NOT DISTINCT FROM $${p}::int THEN collection_order
             WHEN $${p}::int IS NULL THEN 0
             ELSE COALESCE((SELECT MAX(b.collection_order) FROM artworks b
                             WHERE b.collection_id = $${p}::int
                               AND b.status = 'published'), 0) + 1
           END`,
        );
      }
```

This must sit **after** the generic `for (const [k, v] of Object.entries(d))`
loop that pushes `collection_id = $k`, so both parameters exist, and before
`vals.push(id)`. It already does: the `on_wall` block it follows is after that
loop and before the id push.

- [ ] **Step 3: Verify the parameter arithmetic by reading it back**

Typecheck cannot catch an off-by-one in a `$n` placeholder; the SQL compiles and
writes the wrong value. Read the assembled statement back and confirm every `$n`
in `updateCols` corresponds to the right entry in `vals`, and that `id` is the
last parameter, matching `WHERE id = $${vals.length}`.

This task's real checkpoint is manual steps 6, 7 and 8 in the final verification.
It is not verifiable at commit time.

- [ ] **Step 4: Typecheck and commit**

```bash
npm run typecheck && npm test
git add "app/api/admin/artworks/[id]/route.ts"
git commit -m "feat(shop): zero orders on demote, append on collection change"
```

---

### Task 7: Rules 1 and 3 in the bulk artworks route

**Files:**
- Modify: `app/api/admin/artworks/route.ts`

- [ ] **Step 1: Rule 1 on bulk retire**

Replace the `action === 'retire'` query:

```ts
  } else if (action === 'retire') {
    // Rule 1: zero both shop orders on the way out, so a piece that comes back
    // later appends rather than resurfacing on a stale position.
    await pool.query(
      `UPDATE artworks
          SET status='retired', display_order = 0, collection_order = 0,
              updated_at=NOW()
        WHERE id = ANY($1)`,
      [ids],
    );
```

- [ ] **Step 2: Rule 3 on bulk move**

Replace the `pool.query` inside `action === 'move'`:

```ts
      await pool.query(
        `WITH t AS (
           SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
             FROM artworks
            WHERE id = ANY($1::int[])
              AND collection_id IS DISTINCT FROM $2::int
         ),
         m AS (
           SELECT COALESCE(MAX(collection_order), 0) AS mx
             FROM artworks
            WHERE collection_id = $2::int AND status = 'published'
         )
         UPDATE artworks a
            SET collection_id = $2::int,
                collection_order = m.mx + t.rn,
                updated_at = NOW()
           FROM t, m
          WHERE a.id = t.id`,
        [ids, collectionId],
      );
```

Two fixes over the bare `UPDATE … SET collection_id` this replaces.
`ROW_NUMBER()` because this endpoint is inherently a batch, so `MAX + 1` would
give every moved row the identical position and sort them as a clump at the front
of the target chapter. And `IS DISTINCT FROM` in the `t` CTE, so rows already in
the target are not touched. An empty `t` CTE cross-joins to zero rows, which is
the intended no-op.

- [ ] **Step 3: Typecheck and commit**

```bash
npm run typecheck && npm test
git add app/api/admin/artworks/route.ts
git commit -m "feat(shop): batch-safe order handling on bulk retire and move"
```

---

### Task 8: The settings reader (`lib/site-settings.ts`)

**Files:**
- Create: `lib/site-settings.ts`
- Test: `tests/lib/site-settings.test.ts`

**Server-only.** This module imports `pool`, so no `'use client'` component may
import it. Client-side needs go to `lib/shop-limit.ts`.

- [ ] **Step 1: Write the failing test**

The spec calls the never-throws property load-bearing, so it gets tested rather
than asserted. Create `tests/lib/site-settings.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SHOP_INDEX_LIMIT_DEFAULT } from '@/lib/shop-limit';

const query = vi.fn();
vi.mock('@/lib/db', () => ({ pool: { query: (...a: unknown[]) => query(...a) } }));

const { getShopIndexLimit } = await import('@/lib/site-settings');

// BRACED, not a concise arrow. `mockReset()` returns the MockInstance, and
// Vitest treats a value returned from a hook as a per-test teardown callback,
// so `beforeEach(() => query.mockReset())` calls the mock after every test. On
// the rejecting test that teardown returns a rejected promise and Vitest fails
// the test even though getShopIndexLimit() resolved correctly. Verified: the
// arrow form gives 4 pass / 1 fail, the braced form 5 pass.
beforeEach(() => {
  query.mockReset();
});

describe('getShopIndexLimit', () => {
  it('returns the stored value', async () => {
    query.mockResolvedValue({ rows: [{ value: '25' }] });
    expect(await getShopIndexLimit()).toBe(25);
  });

  it('returns 0 for an explicit no-limit', async () => {
    query.mockResolvedValue({ rows: [{ value: '0' }] });
    expect(await getShopIndexLimit()).toBe(0);
  });

  it('falls back when the row is absent', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await getShopIndexLimit()).toBe(SHOP_INDEX_LIMIT_DEFAULT);
  });

  it('falls back when the value is unparseable or out of range', async () => {
    for (const v of ['abc', '', '-3', '99999']) {
      query.mockResolvedValue({ rows: [{ value: v }] });
      expect(await getShopIndexLimit()).toBe(SHOP_INDEX_LIMIT_DEFAULT);
    }
  });

  // The realistic case: a fresh, preview, or restored Neon branch with no
  // site_settings table (42P01). app/(shop)/shop/page.tsx has no try/catch of
  // its own, so a throw here takes the storefront index down.
  it('NEVER throws, even when the query rejects', async () => {
    query.mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
    await expect(getShopIndexLimit()).resolves.toBe(SHOP_INDEX_LIMIT_DEFAULT);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/site-settings.test.ts`
Expected: FAIL, `Failed to resolve import "@/lib/site-settings"`

- [ ] **Step 3: Write the implementation**

Create `lib/site-settings.ts`:

```ts
import { pool } from '@/lib/db';
import { parseShopIndexLimit, SHOP_INDEX_LIMIT_DEFAULT } from '@/lib/shop-limit';

/**
 * Read the limit for the public /shop grid. NEVER throws.
 *
 * SERVER ONLY: this imports `pool`, which creates a connection pool at module
 * scope. A 'use client' component importing this would pull `pg` into the client
 * bundle and fail at `next build`. Client code imports lib/shop-limit.ts.
 *
 * app/(shop)/shop/page.tsx has no try/catch of its own, and a missing
 * site_settings table (42P01, on a fresh, preview, or restored Neon branch) or a
 * cold-start blip would otherwise take the storefront index down.
 */
export async function getShopIndexLimit(): Promise<number> {
  try {
    const { rows } = await pool.query<{ value: string }>(
      `SELECT value FROM site_settings WHERE key = 'shop_index_limit'`,
    );
    if (!rows.length) return SHOP_INDEX_LIMIT_DEFAULT;
    return parseShopIndexLimit(rows[0].value);
  } catch {
    return SHOP_INDEX_LIMIT_DEFAULT;
  }
}
```

- [ ] **Step 4: Run the test, typecheck, commit**

Run: `npx vitest run tests/lib/site-settings.test.ts && npm run typecheck`
Expected: PASS, 5 tests

```bash
git add lib/site-settings.ts tests/lib/site-settings.test.ts
git commit -m "feat(shop): never-throwing shop_index_limit reader"
```

---

### Task 9: The reorder endpoint

**Files:**
- Create: `app/api/admin/shop/order/route.ts`

- [ ] **Step 1: Write the route**

```ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { requireSameOrigin } from '@/lib/origin-check';
import { logger } from '@/lib/logger';

// Persist one SHOP scope's sequence. Scope 'all' writes display_order (the /shop
// order); scope 'collection' writes collection_order for that collection only.
// The two never write each other.
//
// The cap must stay >= the admin loader's LIMIT (app/admin/wall/page.tsx), or a
// large catalogue would POST more ids than Zod accepts and reordering would 400
// with no way to recover. Same invariant /api/admin/wall documents. Note the
// loader's LIMIT applies across ALL statuses while Guard B below counts
// published rows, so both must be raised together as the catalogue grows.
const Ids = z
  .array(z.number().int().positive())
  .min(1)
  .max(1000)
  .refine((a) => new Set(a).size === a.length, 'duplicate ids');

const Body = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('all'), ids: Ids }),
  z.object({
    scope: z.literal('collection'),
    collectionId: z.number().int().positive(),
    ids: Ids,
  }),
]);

/** Thrown inside the transaction to force a ROLLBACK, then mapped to 409. */
class StaleScopeError extends Error {}

export async function POST(req: Request) {
  await requireSameOrigin();
  await requireAdmin();

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const body = parsed.data;
  const ids = body.ids;

  let stale = false;
  let matched = -1;
  try {
    await withTransaction(async (client) => {
      // Two literal statements rather than one built from `scope`. Deriving a
      // SET column name from request data is an identifier-interpolation trap in
      // a repo with no ORM.
      //
      // status='published' on BOTH scopes: without it a stale tab stamps a
      // nonzero position onto a draft and destroys the 0 sentinel that
      // append-on-publish depends on.
      //
      // Deliberately NOT setting updated_at, even though /api/admin/wall does.
      // The admin Library sorts ORDER BY a.updated_at DESC, so every drag would
      // reshuffle the Library under the user, and app/sitemap.ts uses updated_at
      // as lastModified, so every reorder would re-stamp every published artwork
      // in the sitemap.
      const res =
        body.scope === 'all'
          ? await client.query(
              `UPDATE artworks a
                  SET display_order = v.ord
                 FROM (SELECT id, ord
                         FROM unnest($1::int[]) WITH ORDINALITY AS t(id, ord)) v
                WHERE a.id = v.id
                  AND a.status = 'published'`,
              [ids],
            )
          : await client.query(
              `UPDATE artworks a
                  SET collection_order = v.ord
                 FROM (SELECT id, ord
                         FROM unnest($1::int[]) WITH ORDINALITY AS t(id, ord)) v
                WHERE a.id = v.id
                  AND a.status = 'published'
                  AND a.collection_id = $2`,
              [ids, body.collectionId],
            );
      matched = res.rowCount ?? 0;

      // Guard A: every posted id matched. The WHERE clauses skip non-matching
      // rows SILENTLY, so survivors would take sparse ordinals (1, 3, 5...) from
      // the full array's WITH ORDINALITY while skipped rows keep colliding
      // values, and the admin would still see "order saved".
      if (matched !== ids.length) throw new StaleScopeError();

      // Guard B: the payload covers the WHOLE scope. Guard A cannot catch a
      // SHORT payload: a strict subset where every row matches passes it and
      // gets renumbered 1..k, colliding with the rows outside the subset.
      //
      // `image_web_url <> ''` mirrors the admin loader exactly
      // (app/admin/wall/page.tsx). Without it, a published row with an empty web
      // URL is counted here but never reaches the shelf, so no payload the admin
      // can possibly send satisfies this guard: every reorder 409s forever, and
      // the client's 409 path reloads after 1200ms, turning a drag into a reload
      // loop. Any change to the loader's WHERE clause must change this too.
      const total =
        body.scope === 'all'
          ? await client.query<{ n: string }>(
              `SELECT COUNT(*)::text AS n FROM artworks
                WHERE status = 'published' AND image_web_url <> ''`,
            )
          : await client.query<{ n: string }>(
              `SELECT COUNT(*)::text AS n FROM artworks
                WHERE status = 'published' AND image_web_url <> ''
                  AND collection_id = $1`,
              [body.collectionId],
            );
      if (Number(total.rows[0].n) !== ids.length) throw new StaleScopeError();
    });
  } catch (err) {
    if (err instanceof StaleScopeError) {
      // The transaction rolled back, so NOTHING was written. This is the whole
      // reason the guards run inside withTransaction: a single statement in
      // autocommit has already committed by the time any assertion runs, so a
      // post-hoc check would only report corruption it had just made durable.
      logger.warn('shop reorder rejected: scope changed', {
        scope: body.scope,
        idCount: ids.length,
        rowCount: matched,
      });
      stale = true;
    } else {
      logger.error('shop reorder failed', err, {
        scope: body.scope,
        idCount: ids.length,
        rowCount: matched,
      });
      return NextResponse.json({ error: 'save failed' }, { status: 500 });
    }
  }
  if (stale) return NextResponse.json({ error: 'stale' }, { status: 409 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npm run typecheck && npm test
git add app/api/admin/shop/order/route.ts
git commit -m "feat(shop): scoped reorder endpoint with rollback on stale scope"
```

---

### Task 10: The settings endpoint

**Files:**
- Create: `app/api/admin/settings/route.ts`

- [ ] **Step 1: Write the route**

```ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { requireSameOrigin } from '@/lib/origin-check';
import { logger } from '@/lib/logger';
import { isValidShopIndexLimit } from '@/lib/shop-limit';

// The key is an ENUM, not a free-form string, so a generic key/value table can
// never be written by a generic writer.
const Body = z.object({
  key: z.enum(['shop_index_limit']),
  value: z.number().int().refine(isValidShopIndexLimit, 'out of range'),
});

export async function PATCH(req: Request) {
  await requireSameOrigin();
  await requireAdmin();

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const { key, value } = parsed.data;

  try {
    // Upsert, not a plain UPDATE, which is a silent no-op when the seed row is
    // missing (a database restored from before this feature shipped).
    await pool.query(
      `INSERT INTO site_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, String(value)],
    );
  } catch (err) {
    logger.error('site settings write failed', err, { key });
    return NextResponse.json({ error: 'save failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npm run typecheck && npm test
git add app/api/admin/settings/route.ts
git commit -m "feat(shop): settings endpoint for the /shop cap"
```

---

### Task 11: Extract the Shop shelf (no behavior change)

**Files:**
- Create: `components/admin/ShopShelf.tsx`, `components/admin/TileActions.tsx`
- Modify: `components/admin/WallArranger.tsx`, `app/admin/wall/page.tsx`, `app/dev-preview/wall/page.tsx`

A pure extraction. The Shop shelf renders exactly as it does today; only its
location changes. Doing it before the feature work is what keeps the Wall's state
and the Shop's from entangling: the first draft of this plan reused the Wall's
`[data-pos-id]` selector, in-flight flag, saved-flash, and snapshot ref, and every
one of those was a bug.

**Interfaces produced:**

```ts
export interface ShopShelfProps {
  photos: LibraryPhoto[];
  collections: { id: number; title: string }[];
  initialLimit: number;
  /** Parent-level mutations in flight (Library, Wall). The shelf disables while true. */
  parentInFlight: boolean;
  /** The shelf reports its own in-flight so the parent can gate the other panes. */
  onBusyChange: (busy: boolean) => void;
  minimized: boolean;
  onMinimize: () => void;
  /**
   * Library drag state, for the drop-to-sell affordance.
   *
   * The current markup computes `shopHot`/`shopBad` as
   * `dropTarget === 'shop' && !!drag && !!dragHd`. `drag` is deliberately NOT a
   * prop: `overShelf` only sets `dropTarget` when `drag?.from === 'lib'`, so
   * `dropTarget === 'shop'` already implies a live library drag. Drop the
   * `!!drag` conjunct when moving the markup, or it will not typecheck.
   */
  dropTarget: 'wall' | 'shop' | null;
  dragHd: boolean | undefined;
  onShelfDragOver: (e: React.DragEvent) => void;
  onShelfDragLeave: (e: React.DragEvent) => void;
  onShelfDrop: (e: React.DragEvent) => void;
  /** Two-step remove confirm, still parent-owned (Escape clears it globally). */
  confirmingId: number | null;
  onArmRemove: (id: number) => void;
  onRemoveFromShop: (id: number) => void;
  /**
   * Write saved positions back into the parent's `photos`. Without this the
   * shelf re-derives from stale display_order after ANY later setPhoto and
   * visibly snaps back to the pre-drag order.
   */
  onPositionsSaved: (
    updates: { id: number; display_order?: number; collection_order?: number }[],
  ) => void;
  announce: (msg: string) => void;
  fail: (msg: string) => void;
  onTimeout: () => void;
}
```

- [ ] **Step 1: Move the shared tile pieces AND the fetch helpers out**

Create `components/admin/TileActions.tsx` with `'use client'` (both components
use `onClick`), exporting `EditLink` and `RemoveButton` verbatim from
`WallArranger`, and import them in `WallArranger` from there. `ShopShelf` will
import them too; do NOT import them from `WallArranger` (circular import).

Also move `mutationTimeout()`, `isTimeout()`, and the `MutResult` type into a
shared module (`lib/admin-fetch.ts` or the same `TileActions.tsx`). `ShopShelf`
needs all three, and the alternative is inlining
`AbortSignal.timeout?.(30_000)`, which drops the `AbortController` fallback the
existing comment calls out explicitly: "the timeout guarantee is never silently
dropped". Without the fallback, `onTimeout` is dead on any engine lacking
`AbortSignal.timeout`, and a hung request wedges the shelf forever.

Tasks 13 and 14 assume `mutationTimeout()` is importable. Update their `fetch`
calls to use it rather than the inline form shown there.

- [ ] **Step 2: Move the Shop `<section>` into `ShopShelf.tsx`**

Create `components/admin/ShopShelf.tsx` with `'use client'`, the props above, and
the Shop `<section>` markup moved verbatim. In this step the shelf keeps
`photos.filter(isInShop)` exactly as today. No scope, no reorder, no cut line yet.

- [ ] **Step 3: Add the writeback handler in `WallArranger`**

```tsx
  // Fold saved positions back into `photos` so the shelf's derivation stays
  // truthful. Without this, any later setPhoto (removeFromShop, placeInShop,
  // bulkApply) recomputes the shelf from stale positions and snaps it back to
  // the pre-drag order.
  function applyPositions(
    updates: { id: number; display_order?: number; collection_order?: number }[],
  ) {
    const patch = new Map(updates.map((u) => [u.id, u]));
    setPhotos((ps) =>
      ps.map((p) => {
        const u = patch.get(p.id);
        if (!u) return p;
        return {
          ...p,
          display_order: u.display_order ?? p.display_order,
          collection_order: u.collection_order ?? p.collection_order,
        };
      }),
    );
  }
```

- [ ] **Step 4: Render `<ShopShelf …>` in place of the removed section**

Wire every prop. `parentInFlight` is the existing `inFlight`; extend the parent's
gate to include the shelf's reported busy state via `onBusyChange`.

- [ ] **Step 5: Update BOTH call sites of `WallArranger`**

`app/admin/wall/page.tsx` gains `collections` and `shopIndexLimit`. Task 12 adds
the queries; for now pass `[]` and `SHOP_INDEX_LIMIT_DEFAULT` so this task stands
alone.

`app/dev-preview/wall/page.tsx:73` currently renders
`<WallArranger photos={mockPhotos(n)} />` and **must** be updated here or this
task's own typecheck gate fails:

```tsx
        <WallArranger
          photos={mockPhotos(n)}
          collections={[
            { id: 1, title: 'The Front Range' },
            { id: 2, title: 'Night Work' },
          ]}
          // Deliberately LOW. At ?n=100 the mock yields ~8 buyable pieces, so a
          // limit of 12 would exceed the buyable count and cutLineAfter would
          // return null: the cut line could never be seen in the harness, which
          // is the one place Task 14 can be checked at all.
          shopIndexLimit={4}
        />
```

Note the prop names differ by design: the parent takes `shopIndexLimit` (what
the loader read) and passes it to `ShopShelf` as `initialLimit` (a seed for
local state the field then owns).

- [ ] **Step 6: Verify no behavior changed**

Run: `npm run dev`, open `http://localhost:3000/dev-preview/wall?n=100`

Expected: the Shop shelf looks and behaves exactly as before the extraction.
Minimize and restore it, drag a Library tile onto it, arm and cancel a remove.
Nothing about the Wall or Library changed.

- [ ] **Step 7: Typecheck, test, commit**

```bash
npm run typecheck && npm test
git add components/admin/ShopShelf.tsx components/admin/TileActions.tsx \
        components/admin/WallArranger.tsx app/admin/wall/page.tsx \
        app/dev-preview/wall/page.tsx
git commit -m "refactor(admin): extract ShopShelf from WallArranger"
```

---

### Task 12: Loader and the filter tray

**Files:**
- Modify: `app/admin/wall/page.tsx`, `components/admin/ShopShelf.tsx`, `components/admin/WallArranger.tsx`, `app/admin/admin.css`

- [ ] **Step 1: Extend the loader query**

`app/admin/wall/page.tsx:29` ends `))::int END AS wall_rank` with **no trailing
comma**, because it is the last select item. Add the comma when inserting:

```sql
                   ))::int END AS wall_rank,
              a.collection_id,
              c.title AS collection_title,
              a.collection_order,
              a.display_order
         FROM artworks a
         LEFT JOIN collections c ON c.id = a.collection_id
        WHERE a.image_web_url <> ''
```

- [ ] **Step 2: Add the two other queries**

```tsx
  let photos: LibraryPhoto[] = [];
  let collections: { id: number; title: string }[] = [];
  let shopIndexLimit = SHOP_INDEX_LIMIT_DEFAULT;
  try {
    const [res, colRes, limit] = await Promise.all([
      pool.query<LibraryPhoto>(/* the query above */),
      // Its own query, not derived from `photos`: the filter tray must show a
      // chapter even when nothing in it is currently in the shop.
      pool.query<{ id: number; title: string }>(
        'SELECT id, title FROM collections ORDER BY display_order, id',
      ),
      getShopIndexLimit(),
    ]);
    photos = res.rows;
    collections = colRes.rows;
    shopIndexLimit = limit;
  } catch (err) {
    console.error('[admin/wall] load failed:', err);
  }
```

Imports: `import { getShopIndexLimit } from '@/lib/site-settings';` and
`import { SHOP_INDEX_LIMIT_DEFAULT } from '@/lib/shop-limit';`

- [ ] **Step 3: Add scope state to `ShopShelf`**

```tsx
  const [shopScope, setShopScope] = useState<ShopScope>({ kind: 'all' });

  // Read post-mount, exactly as WallArranger reads wl-wall-min, so SSR renders
  // All and there is no hydration mismatch. Reading during render would flash
  // the All view and its cut line before switching.
  useEffect(() => {
    try {
      const s = window.localStorage.getItem('wl-shop-scope');
      if (!s) return;
      const parsed = parseScopeKey(s);
      // A persisted scope naming a since-deleted collection falls back to All,
      // rather than rendering an empty shelf with no matching chip.
      if (parsed.kind !== 'collection' || collections.some((c) => c.id === parsed.id)) {
        setShopScope(parsed);
      }
    } catch {
      /* ignore */
    }
  }, [collections]);

  function selectShopScope(next: ShopScope) {
    setShopScope(next);
    try {
      window.localStorage.setItem('wl-shop-scope', scopeKey(next));
    } catch {
      /* ignore */
    }
  }
```

- [ ] **Step 4: Derive the shelf list from the scope**

Replace `photos.filter(isInShop)` with:

```tsx
  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const counts = useMemo(() => shopScopeCounts(photos), [photos]);
  const shopIds = useMemo(() => deriveShopIds(photos, shopScope), [photos, shopScope]);
  const shop = useMemo(
    () => shopIds.map((id) => byId.get(id)).filter((p): p is LibraryPhoto => !!p),
    [shopIds, byId],
  );
```

- [ ] **Step 5: Render the tray**

In the shelf head, after the existing `<span className="wl-adm-ws-note">` block
(exactly one in this file now that the shelf is extracted):

```tsx
            <div className="wl-adm-seg wrap" role="group" aria-label="Filter the shop by collection">
              <button
                type="button"
                aria-pressed={shopScope.kind === 'all'}
                className={shopScope.kind === 'all' ? 'on' : ''}
                onClick={() => selectShopScope({ kind: 'all' })}
              >
                All <span className="sub">{counts.all}</span>
              </button>
              {collections.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={shopScope.kind === 'collection' && shopScope.id === c.id}
                  className={shopScope.kind === 'collection' && shopScope.id === c.id ? 'on' : ''}
                  onClick={() => selectShopScope({ kind: 'collection', id: c.id })}
                >
                  {c.title} <span className="sub">{counts.byCollection.get(c.id) ?? 0}</span>
                </button>
              ))}
              <button
                type="button"
                aria-pressed={shopScope.kind === 'unfiled'}
                className={shopScope.kind === 'unfiled' ? 'on' : ''}
                onClick={() => selectShopScope({ kind: 'unfiled' })}
              >
                Unfiled <span className="sub">{counts.unfiled}</span>
              </button>
            </div>
```

- [ ] **Step 6: Scope-aware empty states**

```tsx
            {shop.length === 0 ? (
              <div className="wl-adm-ws-empty">
                {shopScope.kind === 'all'
                  ? 'Drag photos with a print file here to put them up for sale.'
                  : shopScope.kind === 'unfiled'
                    ? 'Every photo in the shop belongs to a chapter.'
                    : 'Nothing in this chapter is in the shop yet.'}
              </div>
            ) : (
```

- [ ] **Step 7: Make the seg control wrap**

`.wl-adm-seg` is `inline-flex` with `overflow: hidden` and `white-space: nowrap`
buttons, so an overflowing row is CLIPPED, not wrapped. Add a modifier rather
than changing the base, which is shared with the artworks-list status tabs and
the Library filters:

```css
/* Wrapping variant for the Shop shelf's collection tray. The base :last-child
   border rule only clears the divider on the final button, which leaves a stray
   divider at the end of every wrapped row, so use a per-button shadow instead. */
.wl-adm-seg.wrap { flex-wrap: wrap; overflow: visible; }
.wl-adm-seg.wrap button { border-right: 0; box-shadow: inset -1px 0 0 var(--adm-rule); }
.wl-adm-seg.wrap button:last-child { box-shadow: none; }
```

The shelf head must also wrap. `.wl-adm-ws-head` is shared with the Wall and
Library heads, so verify all three after this change:

```css
.wl-adm-ws-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
```

- [ ] **Step 8: Reserve room for a taller Shop head**

In `WallArranger`'s `clampBand`:

```tsx
      // The Shop head can wrap once the collection tray and the limit field are
      // in it. Measure it rather than assuming one row, or a maxed band leaves
      // the Shop grid with no tile area at all.
      const shopHead = wall.querySelector<HTMLElement>('.wl-adm-ws-shelf.shop .wl-adm-ws-head');
      const shopHeadExtra = Math.max(0, (shopHead?.getBoundingClientRect().height ?? 0) - 32);
      max = wall.clientHeight - pad - errH - HANDLE - LIB_FLOOR - shopHeadExtra - gap * (errH ? 3 : 2);
```

`clampBand` currently re-runs only on window resize and on pane
minimize/restore. The Shop head's height ALSO changes on a scope switch: the
limit field mounts and unmounts with the All view, and chip labels differ in
width. That is `ShopShelf`-internal state the parent cannot observe, so the band
stays mis-clamped until the next resize. Observe the head instead of guessing:

```tsx
  // A ResizeObserver on the Shop head, so a scope switch re-clamps immediately.
  useEffect(() => {
    const head = document.querySelector('.wl-adm-ws-shelf.shop .wl-adm-ws-head');
    if (!head || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => reclamp());
    ro.observe(head);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 9: Verify in the harness**

Run: `npm run dev`, open `http://localhost:3000/dev-preview/wall?n=100`

Expected: the tray renders All, two chapters, and Unfiled, each with a count.
Clicking a chapter filters the shelf and the counts match what is shown. The tray
wraps rather than clipping when the window is narrowed. The Wall and Library heads
are unchanged. Reload and the chosen chapter is still selected.

- [ ] **Step 10: Typecheck, test, commit**

```bash
npm run typecheck && npm test
git add app/admin/wall/page.tsx components/admin/ShopShelf.tsx \
        components/admin/WallArranger.tsx app/admin/admin.css
git commit -m "feat(shop): collection filter tray on the shop shelf"
```

---

### Task 13: Scoped reorder

**Files:**
- Modify: `components/admin/ShopShelf.tsx`, `app/admin/admin.css`

- [ ] **Step 1: Add order state**

```tsx
  const [savingShop, setSavingShop] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [shopOrder, setShopOrder] = useState<number[]>([]);
  const shopOrderRef = useRef<number[]>([]);
  const savedShopIds = useRef<number[]>([]);
  const [editPos, setEditPos] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const inFlight = parentInFlight || savingShop;

  useEffect(() => onBusyChange(savingShop), [savingShop, onBusyChange]);

  // Re-seed whenever the derived list changes: a scope switch, or a mutation
  // that changes membership. Task 11's onPositionsSaved writeback is what makes
  // this safe; without it this effect re-derives from stale positions after any
  // later setPhoto and snaps the shelf back to the pre-drag order.
  useEffect(() => {
    shopOrderRef.current = shopIds;
    setShopOrder(shopIds);
    savedShopIds.current = shopIds;
  }, [shopIds]);
```

**Replace** the `shop` useMemo from Task 12 Step 4 with one that renders from
local order:

```tsx
  const shop = useMemo(
    () => shopOrder.map((id) => byId.get(id)).filter((p): p is LibraryPhoto => !!p),
    [shopOrder, byId],
  );
```

- [ ] **Step 2: Add the save path**

```tsx
  function setShopIds(next: number[] | ((cur: number[]) => number[])) {
    const v = typeof next === 'function' ? next(shopOrderRef.current) : next;
    shopOrderRef.current = v;
    setShopOrder(v);
  }

  async function commitShopOrder() {
    if (inFlight || !isArrangeable(shopScope)) return;
    const attempt = shopOrderRef.current.slice();
    // Reuse the tested helper from lib/wall-arrange.ts rather than
    // reimplementing the dirty check inline. The spec requires the order-dirty
    // check to be unit-tested, and logic that lives inside this component is
    // unreachable by vitest. Same for `reorder()` in the dragEnter handler.
    if (!orderChanged(attempt, savedShopIds.current)) return;
    // Tag the request with the scope it was built against. If the admin switches
    // filters mid-flight, a rollback into the NEW scope would be nonsense.
    const sentScope = shopScope;
    setSavingShop(true);
    let res: { ok: boolean; status: number; timedOut?: boolean };
    try {
      const r = await fetch('/api/admin/shop/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          sentScope.kind === 'collection'
            ? { scope: 'collection', collectionId: sentScope.id, ids: attempt }
            : { scope: 'all', ids: attempt },
        ),
        signal: AbortSignal.timeout?.(30_000),
      });
      res = { ok: r.ok, status: r.status };
    } catch (err) {
      const t =
        err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError');
      res = { ok: false, status: 0, timedOut: t };
    }
    setSavingShop(false);

    if (res.timedOut) return onTimeout();
    if (scopeKey(sentScope) !== scopeKey(shopScope)) {
      if (!res.ok) fail("Couldn't save the previous filter's order. Reload to see the saved order.");
      return;
    }
    if (res.status === 409) {
      // The server rolled back, so nothing was written. The pending arrangement
      // is genuinely lost, and that is correct: it was built against a
      // membership that no longer exists.
      setShopIds(savedShopIds.current.slice());
      fail('The shop changed in another window. Reloading to show the saved state.');
      window.setTimeout(() => window.location.reload(), 1200);
      return;
    }
    if (!res.ok) {
      setShopIds(savedShopIds.current.slice());
      fail("Couldn't save the new shop order. Please try again.");
      return;
    }
    savedShopIds.current = attempt;
    // Fold the new positions back into the parent's photos, or the next
    // membership change re-derives from stale values and snaps the shelf back.
    onPositionsSaved(
      attempt.map((id, i) =>
        sentScope.kind === 'collection'
          ? { id, collection_order: i + 1 }
          : { id, display_order: i + 1 },
      ),
    );
    setSavedFlash(true);
    announce(sentScope.kind === 'collection' ? 'Chapter order saved' : 'Shop order saved');
    window.setTimeout(() => setSavedFlash(false), 2200);
  }
```

- [ ] **Step 3: Add move-to-position**

```tsx
  function focusPos(id: number) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(`[data-shop-pos-id="${id}"]`)
          ?.focus({ preventScroll: true });
      }),
    );
  }

  async function moveToPosition(id: number, pos1: number) {
    if (inFlight) return;
    const cur = shopOrderRef.current;
    const from = cur.indexOf(id);
    setEditPos(null);
    if (from === -1 || !Number.isInteger(pos1) || pos1 < 1) return focusPos(id);
    const to = Math.max(0, Math.min(cur.length - 1, pos1 - 1));
    if (to === from) return focusPos(id);
    const next = cur.slice();
    next.splice(from, 1);
    next.splice(to, 0, id);
    setShopIds(next);
    // Announce the move itself, not just the save. The badge exists to give the
    // keyboard path a way to reorder, and without this that path is silent.
    announce(`Moved to position ${to + 1} of ${next.length}`);
    await commitShopOrder();
    focusPos(id);
  }
```

- [ ] **Step 4: Make the tiles draggable, with a position badge**

Mirror the Wall's tile, using `data-shop-pos-id`, NOT `data-pos-id`. The Wall
already uses the latter, and a photo that is both on the wall and in the shop
would match two elements, sending focus to the wrong tile.

Extract the tile markup into a local `renderTile(p: LibraryPhoto, i: number)` so
Task 14 can render it across two grids. Its signature and the three things it
must render beyond the Wall's version:

```tsx
  function renderTile(p: LibraryPhoto, i: number) {
    const arrangeable = isArrangeable(shopScope);
    return (
      <figure
        key={p.id}
        // `below-cut` is what dims everything the storefront will not show.
        // The class has styling but no meaning unless it is applied HERE.
        className={`wl-adm-ws-tile ${arrangeable ? 'grab' : ''} ${
          drag === p.id ? 'dragging' : ''
        } ${belowCut.has(p.id) ? 'below-cut' : ''}`}
        …
      >
        {/* position badge, as above */}

        {/* The badges container is ALWAYS rendered now. The pre-extraction
            markup gated the whole container on `!p.buyable`, so a buyable piece
            had nowhere to hang the chapter label or the unreachable flag. */}
        <div className="wl-adm-ws-badges">
          {!p.buyable && (
            <span className="wl-adm-ws-badge blocked">hidden · no sizes available</span>
          )}
          {/* Read-only chapter label, All view only. Not a control: assignment
              stays on the Edit page. It is here so the chapter mix is visible
              while arranging the front page, without flipping filters. */}
          {shopScope.kind === 'all' && (
            <span className="wl-adm-ws-badge chapter">{p.collection_title ?? 'unfiled'}</span>
          )}
          {/* Task 14 Step 5 adds the `unreachable` flag here. */}
        </div>

        {/* img + figcaption, as in the current markup */}
      </figure>
    );
  }
```

`belowCut` arrives in Task 14 Step 1. Until then use `false` for that conjunct
and swap it in Task 14, or land Tasks 13 and 14 together.

Commit on `onDragEnd`, never `onDrop`: Chromium does not deliver a `drop` event
when the drag source node was moved mid-drag, which a live reorder always does.

Note for a later editor: the tile's `onDrop` calls `preventDefault()` but not
`stopPropagation()`, so an intra-shelf drop also reaches the section's
`onShelfDrop`. That handler ignores anything not dragged from the Library, so it
is inert today. Do not relax that guard.

- [ ] **Step 5: Fix the badge collision**

`.wl-adm-ws-pos` and `.wl-adm-ws-badges` are both `position:absolute; top:5px;
left:5px`. The Wall tile has the position badge and no status badges; today's
Shop tile has status badges and no position badge. The new Shop tile has both:

```css
/* The Shop tile carries a position badge (top left, like the Wall) AND status
   badges, which the Wall tile never did. Move the badges right rather than
   layering them on the number. */
.wl-adm-ws-shelf.shop .wl-adm-ws-badges { left: auto; right: 5px; }
```

- [ ] **Step 6: Show the shelf's own saved flash**

```tsx
            {/* The public pages are `revalidate = 60` and there is no
                revalidatePath call anywhere in this repo, so a saved change can
                take up to a minute to appear. Say so: without it the delay reads
                as "the save did not work" and invites a second save. */}
            {savedFlash && (
              <span className="wl-adm-ws-saved">order saved ✓ live within a minute</span>
            )}
```

- [ ] **Step 7: Verify in the harness**

Run: `npm run dev`, open `http://localhost:3000/dev-preview/wall?n=100`

Expected: shop tiles show a position number and drag to reorder. Clicking a
number opens the input; typing a position and pressing Enter moves the tile. The
status badges sit at the right and do not overlap the number. Unfiled removes
both the drag affordance and the numbers. The Wall's own drag and numbers are
unaffected. (Saves fail against the harness, which has no API; the failure path
and rollback are what you are checking.)

- [ ] **Step 8: Typecheck, test, commit**

```bash
npm run typecheck && npm test
git add components/admin/ShopShelf.tsx app/admin/admin.css
git commit -m "feat(shop): drag and type-a-position reorder on the shop shelf"
```

---

### Task 14: Cut line and the limit control

**Files:**
- Create: `components/admin/ShopLimitField.tsx`
- Modify: `components/admin/ShopShelf.tsx`, `app/admin/admin.css`

- [ ] **Step 1: Compute the cut**

```tsx
  const [shopLimit, setShopLimit] = useState(initialLimit);
  // All view only: the cut governs /shop, and a chapter view has no cut.
  const cutAfter = useMemo(
    () => (shopScope.kind === 'all' ? cutLineAfter(shop, shopLimit) : null),
    [shopScope, shop, shopLimit],
  );
  // Readable from ANY scope, always computed from the full All order. Used by
  // the Unfiled view to flag a piece reachable from nowhere but the sitemap.
  const belowCut = useMemo(() => belowCutIds(photos, shopLimit), [photos, shopLimit]);
  const buyableCount = useMemo(() => shop.filter((p) => p.buyable).length, [shop]);
```

- [ ] **Step 2: Write `ShopLimitField`**

Create `components/admin/ShopLimitField.tsx`, importing ONLY from
`@/lib/shop-limit`, never `@/lib/site-settings`. See Global Constraints: a value
import reaching `lib/db.ts` from a client component puts `pg` in the client
bundle and fails at `next build`.

```tsx
'use client';

import { useEffect, useState } from 'react';
import { isValidShopIndexLimit, SHOP_INDEX_LIMIT_MAX } from '@/lib/shop-limit';

export function ShopLimitField({
  value,
  buyableCount,
  disabled,
  onSaved,
  onError,
}: {
  value: number;
  buyableCount: number;
  disabled?: boolean;
  onSaved: (n: number) => void;
  onError: (msg: string) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => setDraft(String(value)), [value]);

  async function save() {
    const n = Number(draft.trim());
    if (draft.trim() === '' || !isValidShopIndexLimit(n)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (n === value) return;
    setSaving(true);
    try {
      const r = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'shop_index_limit', value: n }),
        signal: AbortSignal.timeout?.(30_000),
      });
      if (!r.ok) throw new Error(String(r.status));
      onSaved(n);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch {
      // Revert rather than leaving a number on screen that does not match what
      // /shop will actually do.
      setDraft(String(value));
      onError("Couldn't save the shop limit. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="wl-adm-ws-limit">
      {/* Spec copy: the control has to say WHAT it caps. "Show first" alone
          leaves an admin guessing whether it caps the shelf or the storefront. */}
      <label htmlFor="wl-shop-limit">Show the first</label>
      <input
        id="wl-shop-limit"
        type="number"
        min={0}
        max={SHOP_INDEX_LIMIT_MAX}
        value={draft}
        disabled={disabled || saving}
        aria-invalid={invalid || undefined}
        aria-describedby="wl-shop-limit-hint"
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void save();
          }
        }}
      />
      <span className="on-shop">on /shop</span>
      <span id="wl-shop-limit-hint" className="hint" role="status">
        {invalid
          ? `Whole number, 0 to ${SHOP_INDEX_LIMIT_MAX}`
          : saving
            ? 'saving…'
            : saved
              ? 'saved ✓ live within a minute'
              : value === 0
                ? `no limit, showing all ${buyableCount} buyable`
                : value >= buyableCount
                  ? `showing all ${buyableCount} buyable`
                  : `showing ${value} of ${buyableCount} buyable`}
      </span>
    </span>
  );
}
```

The readout always says "all {buyableCount}", never "all {value}": with a limit
of 50 and 12 buyable pieces, "showing all 50 buyable" is wrong.

- [ ] **Step 3: Render it, All view only**

```tsx
            {shopScope.kind === 'all' && (
              <ShopLimitField
                value={shopLimit}
                buyableCount={buyableCount}
                disabled={inFlight}
                onSaved={setShopLimit}
                onError={fail}
              />
            )}
```

- [ ] **Step 4: Draw the cut as a break between two grids**

Do NOT put the divider inside the grid. `.wl-adm-ws-shelf .wl-adm-ws-grid` sets
`grid-auto-rows: 104px`, so a full-width separator would occupy a tile-height
row. Render two grids with the divider between:

```tsx
              <>
                <div className="wl-adm-ws-grid">
                  {shop
                    .slice(0, cutAfter == null ? shop.length : cutAfter + 1)
                    .map((p, i) => renderTile(p, i))}
                </div>
                {cutAfter != null && (
                  <>
                    <div
                      className="wl-adm-ws-cut"
                      role="separator"
                      aria-label="Cut line: photos below this do not appear on the shop page"
                    >
                      <span>below this does not appear on /shop</span>
                    </div>
                    <div className="wl-adm-ws-grid">
                      {shop.slice(cutAfter + 1).map((p, i) => renderTile(p, cutAfter + 1 + i))}
                    </div>
                  </>
                )}
              </>
```

The index offset on the second grid is what keeps position numbers continuous
across the divider.

**The two grids need sizing rules.** Inside the height-capped band,
`.wl-adm-wall.ws-fixed .wl-adm-ws-shelf` is `display:flex; flex-direction:column`
with `> .wl-adm-ws-grid { overflow-y:auto; min-height:0 }`. Turning one scrolling
grid into two sibling scrolling grids gives the shelf two independent scrollbars
with nothing arbitrating between them. Wrap both grids and the divider in a
single scrolling container instead, so the shelf still has exactly one scroll
region:

```tsx
              <div className="wl-adm-ws-scroll">
                {/* both grids and the divider */}
              </div>
```

```css
.wl-adm-wall.ws-fixed .wl-adm-ws-shelf.shop > .wl-adm-ws-scroll {
  overflow-y: auto;
  min-height: 0;
  flex: 1;
}
/* The inner grids no longer scroll; the wrapper does. */
.wl-adm-wall.ws-fixed .wl-adm-ws-shelf.shop > .wl-adm-ws-scroll > .wl-adm-ws-grid {
  overflow-y: visible;
}
```

- [ ] **Step 5: Flag the orphans in the Unfiled view**

```tsx
                      {shopScope.kind === 'unfiled' && belowCut.has(p.id) && (
                        <span className="wl-adm-ws-badge blocked">unreachable</span>
                      )}
```

This uses `belowCut`, not `cutAfter`. `cutAfter` is null by construction outside
the All view, and the visible index in a filtered view is not the All position,
so a version keyed on `cutAfter` could never render.

- [ ] **Step 6: Add the CSS**

```css
/* Below the cut is published and still buyable, it just does not appear on
   /shop. Deliberately not styled as an error. */
.wl-adm-ws-tile.below-cut { opacity: 0.45; }
.wl-adm-ws-tile.below-cut:hover { opacity: 0.8; }
.wl-adm-ws-badge.chapter {
  background: var(--adm-card); color: var(--adm-muted); border: 1px solid var(--adm-rule);
}
.wl-adm-ws-cut {
  display: flex; align-items: center; gap: 10px; margin: 8px 0;
  font-family: var(--f-mono), monospace; font-size: 10px;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--adm-muted);
}
.wl-adm-ws-cut::before, .wl-adm-ws-cut::after {
  content: ''; flex: 1; height: 1px; background: var(--adm-rule);
}
.wl-adm-ws-limit { display: inline-flex; align-items: center; gap: 6px; }
.wl-adm-ws-limit label,
.wl-adm-ws-limit .on-shop { font-size: 12px; color: var(--adm-muted); }
.wl-adm-ws-limit input {
  width: 68px; font-size: 12px; padding: 4px 8px;
  border: 1px solid var(--adm-rule); border-radius: 6px;
  background: var(--adm-paper); color: var(--adm-ink);
}
.wl-adm-ws-limit input[aria-invalid='true'] { border-color: var(--adm-red); }
.wl-adm-ws-limit .hint {
  font-family: var(--f-mono), monospace; font-size: 10.5px;
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--adm-muted);
}
```

- [ ] **Step 7: Verify in the harness**

Run: `npm run dev`, open `http://localhost:3000/dev-preview/wall?n=100`

Expected, with the harness's `shopIndexLimit={4}`: in All, a labelled divider
sits after the 4th **buyable** tile and every tile below it is dimmed. Position
numbers run continuously across the divider. Each tile shows its chapter name,
or "unfiled". Switch to a chapter and both the divider and the limit field
vanish. Switch to Unfiled and any piece below the All cut carries an
"unreachable" badge.

**What the harness cannot show:** changing the limit. `ShopLimitField.save()`
POSTs to `/api/admin/settings`, which 401s in the auth-free preview, so the
field reverts and `onSaved` never fires. The `0` and above-the-count branches of
the readout are covered by the manual pass on the live deploy (final
verification step 3), not here. Do not write a harness expectation that requires
the save to succeed.

- [ ] **Step 8: Typecheck, test, commit**

```bash
npm run typecheck && npm test
git add components/admin/ShopLimitField.tsx components/admin/ShopShelf.tsx app/admin/admin.css
git commit -m "feat(shop): editable /shop cap with a buyable-counted cut line"
```

- [ ] **Step 9: Confirm no server module reached the client bundle**

Run: `npm run build`

Expected: build succeeds. If it fails resolving `pg`, `dns`, `net`, or `fs`, a
client component imported `lib/site-settings.ts` or another db-backed module.
This is the ONLY gate that catches it.

---

### Task 15: Public collection ordering

**Files:**
- Modify: `app/(shop)/shop/collections/[slug]/page.tsx`, `app/(shop)/portfolio/[slug]/page.tsx`, `app/(shop)/shop/artwork/[slug]/page.tsx`

Split from the cap change (Task 16) so the two are independently revertible.

- [ ] **Step 1: Three query swaps**

Change `ORDER BY a.display_order, a.id` to `ORDER BY a.collection_order, a.id`
in:

- `app/(shop)/shop/collections/[slug]/page.tsx`, the chapter grid (one match)
- `app/(shop)/portfolio/[slug]/page.tsx`, the chapter grid (one match)
- `app/(shop)/shop/artwork/[slug]/page.tsx`, **the `LIMIT 4` related-rail query
  only**

**Do NOT replace-all in the artwork page.** `ORDER BY a.display_order, a.id`
appears TWICE there: once inside
`ROW_NUMBER() OVER (ORDER BY a.display_order, a.id) AS plate_idx` in the gating
query, and once in the related rail. Anchor on the rail's `LIMIT 4`. A
replace-all silently changes plate numbering to a per-collection sequence over
the whole catalogue, which is nonsense and which nothing in the gates would
catch.

Leave `plate_idx` alone. It still reads `display_order` and will drift when the
shop is rearranged; the plate-numbers spec deletes it. A known, accepted
transient.

Verify before editing:

Run: `grep -n 'ORDER BY a.display_order, a.id' "app/(shop)/shop/artwork/[slug]/page.tsx"`
Expected: two line numbers. Change only the one inside the `LIMIT 4` query.

- [ ] **Step 2: Typecheck and commit**

```bash
npm run typecheck && npm test
git add "app/(shop)/shop/collections/[slug]/page.tsx" "app/(shop)/portfolio/[slug]/page.tsx" \
        "app/(shop)/shop/artwork/[slug]/page.tsx"
git commit -m "feat(shop): chapter pages read collection_order"
```

---

### Task 16: The `/shop` cap, header, and footer

**Files:**
- Modify: `app/(shop)/shop/page.tsx`, `components/site/Footer.tsx`

- [ ] **Step 1: Apply the limit**

```tsx
  const [countsRes, limit] = await Promise.all([
    pool.query<CountsRow>(
      `SELECT COUNT(*)::int AS n, MAX(published_at)::text AS latest
       FROM artworks WHERE status='published'`,
    ),
    getShopIndexLimit(),
  ]);

  // Serial by necessity: the limit must be known before the plates query runs.
  // Folding it in as a `LIMIT (SELECT ...)` subquery would avoid the hop but put
  // the settings read inside the grid query, so one throw takes the grid down
  // with it. getShopIndexLimit never throws; this shape is what preserves that.
  //
  // NULLIF is load-bearing: in Postgres LIMIT 0 returns ZERO ROWS, and 0 means
  // "no limit" here. LIMIT NULL is the unlimited form.
  const platesRes = await pool.query<PlateRow>(
    `SELECT a.slug, a.title, a.image_web_url, a.year_shot, a.location,
            c.title AS collection_title,
            (SELECT MIN(price_cents) FROM artwork_variants v
               WHERE v.artwork_id = a.id AND v.buyable) AS min_price_cents
     FROM artworks a
     LEFT JOIN collections c ON c.id = a.collection_id
     WHERE a.status = 'published'
       AND EXISTS (SELECT 1 FROM artwork_variants v
                     WHERE v.artwork_id = a.id AND v.buyable)
     ORDER BY a.display_order, a.id
     LIMIT NULLIF($1::int, 0)`,
    [limit],
  );
```

Add `import { getShopIndexLimit } from '@/lib/site-settings';`

- [ ] **Step 2: Fix the header**

```tsx
        <header className="wl-sheet-h">
          <h2>Selected works</h2>
          <div className="wl-rule"></div>
          <span className="count">{String(plates.length).padStart(2, '0')} shown</span>
        </header>
```

The count now describes the grid rather than the archive. The masthead's "Plates
on file" stat keeps counting everything, which is where a total belongs.

- [ ] **Step 3: Fix the stale footer label**

In `components/site/Footer.tsx`, change the `/shop` link text from "Index of
plates" to "Selected works".

- [ ] **Step 4: Typecheck and commit**

```bash
npm run typecheck && npm test
git add "app/(shop)/shop/page.tsx" components/site/Footer.tsx
git commit -m "feat(shop): editable cap and Selected works heading"
```

---

### Task 17: Browse by collection band

**Files:**
- Modify: `app/(shop)/shop/page.tsx`

- [ ] **Step 1: Add the query to the existing `Promise.all`**

Widen Task 16's destructuring to three, so the band costs no extra round trip on
the storefront's busiest page:

Spell the counts query out in full. A comment followed by a comma
(`/* unchanged */,`) is an **array hole**, so `countsRes` would be `undefined`
and `countsRes.rows[0]` throws at request time on the storefront index.

```tsx
  const [countsRes, limit, chaptersRes] = await Promise.all([
    pool.query<CountsRow>(
      `SELECT COUNT(*)::int AS n, MAX(published_at)::text AS latest
       FROM artworks WHERE status='published'`,
    ),
    getShopIndexLimit(),
    pool.query<{ slug: string; title: string; n: number }>(
      // Counts BUYABLE published works, not just published. /shop/collections
      // counts status='published' and LEFT JOINs, so reusing it verbatim would
      // advertise "5 plates" on the storefront's busiest index and land on a
      // visibly empty page. The inner join already drops zero-count chapters.
      `SELECT c.slug, c.title, COUNT(a.id)::int AS n
         FROM collections c
         JOIN artworks a ON a.collection_id = c.id
          AND a.status = 'published'
          AND EXISTS (SELECT 1 FROM artwork_variants v
                        WHERE v.artwork_id = a.id AND v.buyable)
        GROUP BY c.id
        ORDER BY c.display_order, c.id`,
    ),
  ]);
  const chapters = chaptersRes.rows;
```

- [ ] **Step 2: Render the band below the grid**

```tsx
      {chapters.length > 0 && (
        <section className="wl-sheet wl-browse-band">
          <header className="wl-sheet-h">
            <h2>Browse by collection</h2>
            <div className="wl-rule"></div>
            <span className="count">{String(chapters.length).padStart(2, '0')} chapters</span>
          </header>
          <div className="wl-cindex-list">
            {chapters.map((c) => (
              <Link key={c.slug} href={`/shop/collections/${c.slug}`} className="wl-cindex-row">
                <span className="title">{c.title.replace(/^The /, '')}</span>
                <span className="count">
                  {c.n} {c.n === 1 ? 'plate' : 'plates'}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
```

Deliberately no `CH · NN` marker. That numbering comes from the array index on
`/shop/collections`, and omitting zero-count chapters here would make it disagree
with "Chapter 03 of 06" on the chapter and portfolio pages, which `ROW_NUMBER()`
over *all* collections.

Add `import Link from 'next/link';` if not already present.

- [ ] **Step 3: Give the band its own grid**

`.wl-cindex-row` is `grid-template-columns: 60px 1.5fr 2fr 1fr 120px`
(`app/globals.css`), sized for the five cells `/shop/collections` renders (`no`,
`title`, `tagline`, `count`, `thumb`). The band renders two, so the 44px display
title would land in the 60px `no` track and the count in the `1.5fr` title
track. Add a band-scoped override:

```css
/* The browse band reuses the chapter-row treatment but renders only title and
   count, so it needs its own track sizing rather than the five-cell one. */
.wl-browse-band .wl-cindex-row {
  grid-template-columns: 1fr auto;
}
```

- [ ] **Step 4: Look at it**

Run: `npm run dev`, open `http://localhost:3000/shop`

Expected: the band sits below Selected works, titles are left-aligned in the
display face at full size, counts sit right, rows align with each other, and the
page does not scroll horizontally at a narrow width. Tasks 15 through 17 change
public pages and this is the only step in the plan that looks at one.

- [ ] **Step 3: Typecheck and commit**

```bash
npm run typecheck && npm test
git add "app/(shop)/shop/page.tsx"
git commit -m "feat(shop): browse-by-collection band on the shop index"
```

---

## Final verification

- [ ] **Gates**

```bash
npm run typecheck && npm test && npm run build
```

`npm run build` is required, not optional: it is the only gate that catches a
server module leaking into the client bundle. Do NOT run `npm run lint`.

- [ ] **Manual pass on the live deploy**

1. Reorder in All; confirm `/shop` matches after revalidation (up to 60s).
2. Reorder within a chapter; confirm the chapter page, the portfolio page, and the related rail match, and that `/shop` did **not** change.
3. Change the limit; confirm the cut line and the live grid agree. **Set it to `0`** and confirm the full catalogue renders rather than a blank page.
4. **Retire a piece, then re-publish it.** Confirm it appends rather than landing mid-grid (Rules 1 and 2).
5. **Bulk-publish several drafts at once.** Confirm distinct consecutive positions, not a clump (Rule 2's `ROW_NUMBER()`).
6. **Bulk-move several photos to another chapter.** Confirm they land at the end, not the front (Rule 3's batch case).
7. Re-select a photo's *current* chapter from the row menu. Confirm it does **not** move (Rule 3's `IS DISTINCT FROM`).
8. PATCH a piece to `retired` **and** a new collection in one request, if reachable from the UI. Confirm a 200, not a 500 (the 42601 guard).
9. Open the shelf in two tabs, reorder in one, then reorder in the other. Confirm the second gets the "shop changed in another window" message and reloads, rather than silently saving a partial order.
10. Reorder, then remove a *different* photo from the shop. Confirm the arrangement does **not** snap back (the `onPositionsSaved` writeback).
11. Confirm the browse band lists only chapters with buyable work, and each link lands on a non-empty page.

## Risks and rollback

- **Task 4 is the only irreversible step.** Order-preserving by construction and guarded to run once, and Step 0 takes the snapshot before it can reach any build. Recovery is a restore from `artworks_order_backup_20260721`.
- **`display_order`'s meaning change is not code-revertible.** The manifest-index mapping `publish-selections.ts` relied on is destroyed; that script is fenced off (Task 3) rather than repaired.
- **Reverting the query changes restores prior public behavior** without a down migration. The new columns are additive.
- **If either order column is ever dropped and re-added, delete the `shop_order_backfilled` row too**, or the backfill silently skips and every chapter page sorts by `id`.
- **Tasks 4 through 7 must ship together.** Splitting them puts every newly published artwork at the top of `/shop`.
