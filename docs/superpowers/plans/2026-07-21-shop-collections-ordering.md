# Shop Collections Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin Shop shelf filterable by collection and drag-arrangeable, with an independent All order and per-collection orders that drive the public storefront, plus an editable `/shop` cap.

**Architecture:** `artworks.display_order` is repurposed as the All order and a new `artworks.collection_order` holds position within a collection. Both are densified once by a marker-guarded migration. Positions are assigned server-side at the publish chokepoint (`lib/publish-artworks.ts`) and at every `collection_id` writer, never trusted from a stored value on a row entering the shop. Pure ordering/filtering logic lives in `lib/shop-arrange.ts` so vitest can reach it; the React shelf wires state to it.

**Tech Stack:** Next.js 16 App Router, Postgres (Neon) via raw `pg`, Zod, vitest.

**Spec:** `docs/superpowers/specs/2026-07-20-shop-collections-ordering-design.md`

## Global Constraints

- **No ORM, no query builder.** Raw SQL via `lib/db.ts`, parameterized (`$1`, `$2`) always. Never concatenate a value into SQL.
- **Multi-statement writes use `withTransaction`** from `lib/db.ts`.
- **`lib/schema.sql` re-runs on every build** (`npm run build` is `tsx lib/migrate.ts && next build`). Every statement must be idempotent.
- **Never add `BEGIN`/`COMMIT` or a non-transactional statement** (`CREATE INDEX CONCURRENTLY`, `VACUUM`) to `lib/schema.sql`. `lib/migrate.ts` sends the whole file through one `pool.query`, and that implicit transaction is what makes the backfill marker atomic.
- **`statement_timeout` is 15s** (`lib/db.ts`). Any single query needing longer is a bug.
- **Gates: `npm run typecheck` and `npm test`.** NOT `npm run lint`. `next lint` was removed in Next 16 and there is no flat ESLint config, so it fails for unrelated reasons.
- **No local database.** The app cannot boot against a real DB on this box. SQL and route changes are verified by typecheck plus review here, and by the manual pass on the live deploy listed at the end.
- **API JSON keys are snake_case; JS variables are camelCase.**
- **Copy rule: no em dashes** in any user-facing string. Use commas, periods, colons, or parentheses.

---

## File Structure

**Created:**
- `lib/site-settings.ts`: reads/validates `shop_index_limit`. One shared validator for client and server.
- `lib/shop-arrange.ts`: pure scope/order/cut-line logic for the Shop shelf. Mirrors `lib/wall-arrange.ts`'s role for the Wall.
- `app/api/admin/shop/order/route.ts`: the scoped reorder endpoint.
- `app/api/admin/settings/route.ts`: writes `shop_index_limit`.
- `tests/lib/site-settings.test.ts`, `tests/lib/shop-arrange.test.ts`

**Modified:**
- `lib/schema.sql`: `collection_order`, `site_settings`, the one-time backfill.
- `lib/wall-arrange.ts`: four new fields on `LibraryPhoto`.
- `lib/publish-artworks.ts`: Rule 2 (entering published assigns a fresh position).
- `app/api/admin/artworks/[id]/route.ts`: Rules 1 and 3, drop `display_order` from the Zod schema.
- `app/api/admin/artworks/route.ts`: Rule 1 on bulk retire, Rule 3 on bulk move.
- `app/admin/wall/page.tsx`: three-query loader.
- `components/admin/WallArranger.tsx`: filter tray, scoped reorder, cut line, limit control.
- `app/admin/admin.css`: wrapping seg + head, cut-line treatment.
- `app/dev-preview/wall/page.tsx`, `tests/lib/wall-arrange-library.test.ts` : the two other `LibraryPhoto` construction sites.
- `app/(shop)/shop/page.tsx`, `app/(shop)/shop/collections/[slug]/page.tsx`, `app/(shop)/portfolio/[slug]/page.tsx`, `app/(shop)/shop/artwork/[slug]/page.tsx` : public queries.
- `components/site/Footer.tsx`: the "Index of plates" label.
- `scripts/import-manifest.ts`, `scripts/publish-selections.ts`, `README.md`.

---

### Task 1: The limit validator and reader (`lib/site-settings.ts`)

**Files:**
- Create: `lib/site-settings.ts`
- Test: `tests/lib/site-settings.test.ts`

**Interfaces:**
- Consumes: `pool` from `@/lib/db`
- Produces:
  - `SHOP_INDEX_LIMIT_MAX = 500`, `SHOP_INDEX_LIMIT_DEFAULT = 12`
  - `parseShopIndexLimit(raw: unknown): number`
  - `isValidShopIndexLimit(n: unknown): boolean`
  - `getShopIndexLimit(): Promise<number>`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/site-settings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseShopIndexLimit,
  isValidShopIndexLimit,
  SHOP_INDEX_LIMIT_DEFAULT,
  SHOP_INDEX_LIMIT_MAX,
} from '@/lib/site-settings';

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

  // Number('') === 0, which would silently mean "no limit" and dump the whole
  // catalogue onto /shop. An empty value is missing data, not a choice.
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

Run: `npx vitest run tests/lib/site-settings.test.ts`
Expected: FAIL, `Failed to resolve import "@/lib/site-settings"`

- [ ] **Step 3: Write the implementation**

Create `lib/site-settings.ts`:

```ts
import { pool } from '@/lib/db';

/** Upper bound on shop_index_limit. A typo must not ask the page for 50,000 rows. */
export const SHOP_INDEX_LIMIT_MAX = 500;
/** Current hardcoded /shop cap. Seeded into site_settings, and the fallback. */
export const SHOP_INDEX_LIMIT_DEFAULT = 12;

/**
 * Is this an acceptable admin input? The SAME rule runs on the client (inline
 * validation) and the server (Zod refinement), from this one function, so the
 * two cannot drift.
 */
export function isValidShopIndexLimit(n: unknown): boolean {
  return (
    typeof n === 'number' &&
    Number.isInteger(n) &&
    n >= 0 &&
    n <= SHOP_INDEX_LIMIT_MAX
  );
}

/**
 * Coerce a stored value into a usable limit. 0 means "no limit".
 *
 * Anything unusable returns the default rather than throwing: this value gates
 * the storefront index, so a bad row must never blank or 500 the page.
 *
 * The empty-string guard is load-bearing. Number('') is 0, and 0 means
 * unlimited here, so without it a blank row would silently publish the entire
 * catalogue.
 */
export function parseShopIndexLimit(raw: unknown): number {
  if (typeof raw === 'string' && raw.trim() === '') return SHOP_INDEX_LIMIT_DEFAULT;
  if (typeof raw !== 'string' && typeof raw !== 'number') return SHOP_INDEX_LIMIT_DEFAULT;
  const n = Number(raw);
  return isValidShopIndexLimit(n) ? n : SHOP_INDEX_LIMIT_DEFAULT;
}

/**
 * Read the limit for the public /shop grid. NEVER throws.
 *
 * app/(shop)/shop/page.tsx has no try/catch of its own, and a missing
 * site_settings table (42P01 on a fresh, preview, or restored Neon branch) or a
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/site-settings.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add lib/site-settings.ts tests/lib/site-settings.test.ts
git commit -m "feat(shop): shop_index_limit reader and shared validator"
```

---

### Task 2: Scopes, order derivation, cut line (`lib/shop-arrange.ts`)

**Files:**
- Create: `lib/shop-arrange.ts`
- Modify: `lib/wall-arrange.ts` (add four fields to `LibraryPhoto`)
- Modify: `app/dev-preview/wall/page.tsx`, `tests/lib/wall-arrange-library.test.ts` (the two other construction sites)
- Test: `tests/lib/shop-arrange.test.ts`

**Interfaces:**
- Consumes: `isInShop`, `LibraryPhoto` from `@/lib/wall-arrange`
- Produces:
  - `type ShopScope = { kind: 'all' } | { kind: 'unfiled' } | { kind: 'collection'; id: number }`
  - `scopeKey(s: ShopScope): string`, `parseScopeKey(raw: string | null): ShopScope`
  - `isArrangeable(s: ShopScope): boolean`
  - `deriveShopIds(photos: LibraryPhoto[], scope: ShopScope): number[]`
  - `shopScopeCounts(photos: LibraryPhoto[]): { all: number; unfiled: number; byCollection: Map<number, number> }`
  - `cutLineAfter(ordered: LibraryPhoto[], limit: number): number | null`

- [ ] **Step 1: Add the four fields to `LibraryPhoto`**

In `lib/wall-arrange.ts`, inside `export interface LibraryPhoto`, after `wall_rank`:

```ts
  /** Collection assignment, or null when unfiled. */
  collection_id: number | null;
  /** Collection title for the read-only tile label. Null when unfiled. */
  collection_title: string | null;
  /** Position within its collection. 0 = never placed. */
  collection_order: number;
  /** Position in the All order (the /shop sequence). 0 = never placed. */
  display_order: number;
```

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
    photo({ id: 4, status: 'draft', display_order: 0 }), // not in the shop
    photo({ id: 5, status: 'retired', display_order: 0 }), // not in the shop
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

  // The tiebreak MUST match the public queries' `, a.id`, or the admin order
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
  // The public query filters unbuyable rows out BEFORE applying LIMIT, so the
  // line has to count buyable tiles only. Counting every tile is the off-by-N.
  it('counts buyable tiles only, skipping unbuyable ones', () => {
    const ordered = [
      photo({ id: 1, buyable: true }),
      photo({ id: 2, buyable: false }),
      photo({ id: 3, buyable: true }),
      photo({ id: 4, buyable: true }),
    ];
    // limit 2 -> after the 2nd BUYABLE tile, which is index 2 (id 3)
    expect(cutLineAfter(ordered, 2)).toBe(2);
  });

  it('returns null for limit 0, which means no limit', () => {
    const ordered = [photo({ id: 1 }), photo({ id: 2 })];
    expect(cutLineAfter(ordered, 0)).toBeNull();
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/lib/shop-arrange.test.ts`
Expected: FAIL, `Failed to resolve import "@/lib/shop-arrange"`

- [ ] **Step 4: Write the implementation**

Create `lib/shop-arrange.ts`:

```ts
// Pure helpers for the Shop shelf on the Wall & Shop admin tool. No React, no
// DB. Mirrors lib/wall-arrange.ts's role for the Wall: keeping order/filter
// logic here is what makes it unit-testable, since this repo has no
// component-test harness.

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

/** Stable string form, for localStorage and for React keys. */
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
 * Index in `ordered` AFTER which the cut line is drawn, or null when no line
 * should render.
 *
 * Counts BUYABLE tiles only. The public /shop query filters unbuyable rows out
 * before it applies the LIMIT, so counting every tile would put the line in the
 * wrong place and the admin would arrange twelve and see nine.
 *
 * Null cases, all deliberate: limit 0 (unlimited), fewer buyable tiles than the
 * limit, and a cut that lands on the last tile (nothing is below it to mark).
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/lib/shop-arrange.test.ts`
Expected: PASS, 13 tests

- [ ] **Step 6: Fix the two other `LibraryPhoto` construction sites**

Typecheck will now fail in two places. In `tests/lib/wall-arrange-library.test.ts`, inside `photo()`, after `wall_rank`:

```ts
    collection_id: over.collection_id ?? null,
    collection_title: over.collection_title ?? null,
    collection_order: over.collection_order ?? 0,
    display_order: over.display_order ?? 0,
```

In `app/dev-preview/wall/page.tsx`, inside the `out.push({...})` in `mockPhotos`, after `wall_rank`:

```ts
      // A few chapters so the filter tray has something to show, and a
      // deliberate handful left unfiled so that chip is exercised too.
      collection_id: published ? (i % 3 === 0 ? null : (i % 3) + 1) : null,
      collection_title: published && i % 3 !== 0 ? `Chapter ${(i % 3) + 1}` : null,
      collection_order: i,
      display_order: i,
```

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests PASS, typecheck clean

- [ ] **Step 8: Commit**

```bash
git add lib/shop-arrange.ts lib/wall-arrange.ts tests/lib/shop-arrange.test.ts \
        tests/lib/wall-arrange-library.test.ts app/dev-preview/wall/page.tsx
git commit -m "feat(shop): scope, order derivation and cut-line logic"
```

---

### Task 3: Migration (`collection_order`, `site_settings`, the one-time backfill)

**Files:**
- Modify: `lib/schema.sql` (append at the end of the file)

**Interfaces:**
- Produces: `artworks.collection_order`, `site_settings(key, value, updated_at)`, the `shop_order_backfilled` marker row.

There is no unit test for this task. It is verified by review here and by the manual deploy pass at the end of the plan.

- [ ] **Step 1: Append the DDL**

Append to `lib/schema.sql`. Order within this block matters: `site_settings`
must exist before the `DO` block reads it.

```sql
-- Shop ordering ------------------------------------------------------------
-- collection_order: position within the row's OWN collection. Meaningful only
-- relative to collection_id. One column suffices because an artwork belongs to
-- exactly one collection; a join table would model a many-to-many that does
-- not exist. 0 = never placed (the sentinel the publish rules depend on).
ALTER TABLE artworks
  ADD COLUMN IF NOT EXISTS collection_order INT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_artworks_collection_order
  ON artworks(collection_id, collection_order);

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

-- One-time densify of BOTH orders, from the sort key visitors already see, so
-- nothing reshuffles on deploy.
--
-- PUBLISHED ROWS ONLY. Every public consumer of both orders filters to
-- status='published', so only published rows have a position that means
-- anything. Ranking all rows would hand existing drafts positions interleaved
-- among the published ones, and publishing such a draft later would drop it
-- into the MIDDLE of the sequence (possibly above the cut line, displacing
-- something) instead of appending it. Leaving non-published rows at 0 is what
-- makes append-on-entry work.
--
-- MARKER-GUARDED. lib/schema.sql re-runs on every build, and a densify that
-- re-ran every deploy would fight the append rules: a piece published at
-- MAX+1 would be silently re-ranked on the next deploy.
--
-- lib/migrate.ts sends this whole file through ONE pool.query with no explicit
-- BEGIN/COMMIT, so Postgres runs it as a single implicit transaction: the DO
-- block cannot half-run, and a failure later in the file rolls the marker back
-- too, so the backfill retries on the next build instead of being skipped.
-- Do not split the migration, and never add BEGIN/COMMIT or a
-- non-transactional statement (CREATE INDEX CONCURRENTLY, VACUUM) to this file.
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
    -- (preview + prod, or a redeploy) both see no marker and both densify, and
    -- a bare INSERT raises 23505 on the second, aborting the whole implicit
    -- transaction and failing that deploy.
    INSERT INTO site_settings (key, value) VALUES ('shop_order_backfilled', '1')
      ON CONFLICT (key) DO NOTHING;
  END IF;
END $$;
```

- [ ] **Step 2: Verify every statement is re-run safe**

Read the block back and confirm each statement individually: `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `INSERT … ON CONFLICT DO NOTHING`, and the `DO` block's own `IF NOT EXISTS` marker check. Confirm no `BEGIN`, `COMMIT`, `CREATE INDEX CONCURRENTLY`, or `VACUUM` was introduced anywhere in the file:

Run: `grep -nE '^\s*(BEGIN|COMMIT|VACUUM)|CONCURRENTLY' lib/schema.sql`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add lib/schema.sql
git commit -m "feat(shop): collection_order, site_settings, one-time order backfill"
```

---

### Task 4: Rule 2 (entering `published` always assigns a fresh position)

**Files:**
- Modify: `lib/publish-artworks.ts`

**Interfaces:**
- Consumes: the existing `transitioning` id list already computed in this file.
- Produces: no signature change. `publishArtworks(client, ids)` keeps returning `PublishResult`.

- [ ] **Step 1: Add the position assignment**

In `lib/publish-artworks.ts`, after the existing `if (eligible.length) { … }` block and before the `return`, insert:

```ts
  // Position assignment. A row entering the shop NEVER keeps its stored
  // position: production guarantees duplicate display_order values (
  // scripts/import-manifest.ts wrote per-collection manifest indices into it),
  // so any "is this position already taken" test would be wrong on the first
  // bulk publish. Assign unconditionally instead, and let the retire path zero
  // the columns on the way out.
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

- [ ] **Step 2: Update the file's docstring**

In the block comment above `publishArtworks`, add a fourth bullet after the `published_at` one:

```
 * - Rows TRANSITIONING into 'published' are assigned a fresh display_order
 *   (and collection_order, when filed) at the end of their scope. Stored
 *   positions are never trusted here; scripts/import-manifest.ts historically
 *   wrote manifest indices into display_order, so duplicates are normal. The
 *   retire path zeroes both columns, so a returning piece appends.
```

- [ ] **Step 3: Typecheck and commit**

```bash
npm run typecheck
git add lib/publish-artworks.ts
git commit -m "feat(shop): assign shop positions at the publish chokepoint"
```

---

### Task 5: Rules 1 and 3 in the per-artwork PATCH

**Files:**
- Modify: `app/api/admin/artworks/[id]/route.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `display_order` is removed from the PATCH Zod schema and can no longer be written through this route.

- [ ] **Step 1: Remove `display_order` from the Zod schema**

In the `Patch` object, delete this line:

```ts
  display_order: z.number().int().optional(),
```

Ordering has a dedicated endpoint now (Task 7) and no admin UI sends this field, so leaving a direct write path that bypasses densification is a trap.

- [ ] **Step 2: Add Rule 1 and Rule 3 beside the existing `wall_order` reset**

In the `withTransaction` callback, immediately after the existing
`if (d.on_wall !== undefined) { updateCols.push('wall_order = 0'); }` block, insert:

```ts
      // Rule 1: leaving 'published' zeroes both shop orders, exactly as
      // toggling on_wall clears wall_order directly above. Without this a
      // retired piece keeps a live-looking position and re-publishing drops it
      // back into the middle of the grid instead of appending. Constant 0, no
      // param; the column names are literals, never user keys.
      if (d.status === 'retired' || d.status === 'draft') {
        updateCols.push('display_order = 0', 'collection_order = 0');
      }

      // Rule 3: a REAL collection change appends to the end of the new
      // chapter. In an UPDATE the right-hand side sees the OLD column values,
      // so `collection_id IS DISTINCT FROM $n` compares the prior collection to
      // the incoming one in the same statement that overwrites it.
      //
      // The DISTINCT check is not optional: ArtworkRowMenu lets an admin click
      // the chapter a piece is already in, and without it that no-op would
      // re-append the piece to the end of its own chapter.
      if (d.collection_id !== undefined) {
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

Note the ordering: this must come **after** the generic `for (const [k, v] of Object.entries(d))` loop that pushes `collection_id = $k`, so both parameters exist. It already does, because the `on_wall` block it follows is after that loop.

- [ ] **Step 3: Typecheck and commit**

```bash
npm run typecheck
git add "app/api/admin/artworks/[id]/route.ts"
git commit -m "feat(shop): zero orders on retire, append on collection change"
```

---

### Task 6: Rules 1 and 3 in the bulk artworks route

**Files:**
- Modify: `app/api/admin/artworks/route.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature change.

- [ ] **Step 1: Rule 1 on bulk retire**

Replace the `action === 'retire'` query:

```ts
  } else if (action === 'retire') {
    // Zero both shop orders on the way out (Rule 1), so a piece that comes
    // back later appends rather than resurfacing on a stale position.
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

Two things this fixes over the bare `UPDATE … SET collection_id` it replaces.
`ROW_NUMBER()` because this endpoint is inherently a batch, so `MAX + 1` would
give every moved row the identical position and sort them as a clump at the
front. And `IS DISTINCT FROM` in the `t` CTE, so rows already in the target
collection are not touched at all.

- [ ] **Step 3: Typecheck and commit**

```bash
npm run typecheck
git add app/api/admin/artworks/route.ts
git commit -m "feat(shop): batch-safe order handling on bulk retire and move"
```

---

### Task 7: The reorder and settings endpoints

**Files:**
- Create: `app/api/admin/shop/order/route.ts`
- Create: `app/api/admin/settings/route.ts`

**Interfaces:**
- Consumes: `withTransaction` from `@/lib/db`, `requireAdmin` from `@/lib/session`, `requireSameOrigin` from `@/lib/origin-check`, `logger` from `@/lib/logger`, `isValidShopIndexLimit`/`SHOP_INDEX_LIMIT_MAX` from `@/lib/site-settings`.
- Produces:
  - `POST /api/admin/shop/order` accepting `{scope:'all', ids}` or `{scope:'collection', collectionId, ids}`; returns `{ok:true}`, `409 {error:'stale'}`, or `400`.
  - `PATCH /api/admin/settings` accepting `{key:'shop_index_limit', value:number}`; returns `{ok:true}`.

- [ ] **Step 1: Write the reorder route**

Create `app/api/admin/shop/order/route.ts`:

```ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { requireSameOrigin } from '@/lib/origin-check';
import { logger } from '@/lib/logger';

// Persist one SHOP scope's sequence. Scope 'all' writes display_order (the
// /shop order); scope 'collection' writes collection_order for that collection
// only. The two never write each other.
//
// The cap must stay >= the admin loader's LIMIT (app/admin/wall/page.tsx), or a
// large catalogue would POST more ids than Zod accepts and reordering would 400
// with no way to recover. Same invariant /api/admin/wall documents.
const Body = z.discriminatedUnion('scope', [
  z.object({
    scope: z.literal('all'),
    ids: z
      .array(z.number().int().positive())
      .min(1)
      .max(1000)
      .refine((a) => new Set(a).size === a.length, 'duplicate ids'),
  }),
  z.object({
    scope: z.literal('collection'),
    collectionId: z.number().int().positive(),
    ids: z
      .array(z.number().int().positive())
      .min(1)
      .max(1000)
      .refine((a) => new Set(a).size === a.length, 'duplicate ids'),
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
  try {
    await withTransaction(async (client) => {
      // Two literal statements rather than one built from `scope`. Deriving a
      // SET column name from request data is an identifier-interpolation trap
      // in a repo with no ORM.
      //
      // status='published' on BOTH scopes: without it a stale tab stamps a
      // nonzero position onto a draft and destroys the 0 sentinel that
      // append-on-publish depends on.
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

      // Guard A: every posted id matched. The WHERE clauses skip non-matching
      // rows SILENTLY, so survivors would take sparse ordinals (1, 3, 5...)
      // from the full array's WITH ORDINALITY while the skipped rows keep
      // colliding values, and the admin would still see "order saved".
      if (res.rowCount !== ids.length) throw new StaleScopeError();

      // Guard B: the payload covers the WHOLE scope. Guard A cannot catch a
      // SHORT payload: a strict subset where every row matches passes it and
      // gets renumbered 1..k, colliding with the rows outside the subset.
      const total =
        body.scope === 'all'
          ? await client.query<{ n: string }>(
              `SELECT COUNT(*)::text AS n FROM artworks WHERE status = 'published'`,
            )
          : await client.query<{ n: string }>(
              `SELECT COUNT(*)::text AS n FROM artworks
                WHERE status = 'published' AND collection_id = $1`,
              [body.collectionId],
            );
      if (Number(total.rows[0].n) !== ids.length) throw new StaleScopeError();

      // Deliberately NOT setting updated_at. The admin Library sorts
      // ORDER BY a.updated_at DESC, so every drag would reshuffle the Library
      // under the user, and app/sitemap.ts uses updated_at as lastModified, so
      // every reorder would re-stamp every published artwork in the sitemap.
      // (/api/admin/wall does stamp it; do not copy that here.)
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
      });
      stale = true;
    } else {
      logger.error('shop reorder failed', err, {
        scope: body.scope,
        idCount: ids.length,
      });
      return NextResponse.json({ error: 'save failed' }, { status: 500 });
    }
  }
  if (stale) return NextResponse.json({ error: 'stale' }, { status: 409 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Write the settings route**

Create `app/api/admin/settings/route.ts`:

```ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { requireSameOrigin } from '@/lib/origin-check';
import { logger } from '@/lib/logger';
import { isValidShopIndexLimit } from '@/lib/site-settings';

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

- [ ] **Step 3: Typecheck and commit**

```bash
npm run typecheck
git add app/api/admin/shop/order/route.ts app/api/admin/settings/route.ts
git commit -m "feat(shop): scoped reorder endpoint and settings writer"
```

---

### Task 8: Loader and the filter tray

**Files:**
- Modify: `app/admin/wall/page.tsx`
- Modify: `components/admin/WallArranger.tsx`
- Modify: `app/admin/admin.css`

**Interfaces:**
- Consumes: `deriveShopIds`, `shopScopeCounts`, `parseScopeKey`, `scopeKey`, `isArrangeable`, `ShopScope` from `@/lib/shop-arrange`; `getShopIndexLimit` from `@/lib/site-settings`.
- Produces: `WallArranger` now takes `{ photos, collections, shopIndexLimit }` where `collections: { id: number; title: string }[]`.

- [ ] **Step 1: Extend the loader**

In `app/admin/wall/page.tsx`, add the four columns to the SELECT (after `wall_rank`'s `CASE … END AS wall_rank,` line, add before `FROM artworks a`):

```sql
              a.collection_id,
              c.title AS collection_title,
              a.collection_order,
              a.display_order,
```

and change `FROM artworks a` to:

```sql
         FROM artworks a
         LEFT JOIN collections c ON c.id = a.collection_id
```

Then replace the single-query body with three, keeping the existing fail-soft
`try/catch` around all of them:

```tsx
  let photos: LibraryPhoto[] = [];
  let collections: { id: number; title: string }[] = [];
  let shopIndexLimit = SHOP_INDEX_LIMIT_DEFAULT;
  try {
    const [res, colRes, limit] = await Promise.all([
      pool.query<LibraryPhoto>(/* the existing query, with the columns above */),
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
  return (
    <WallArranger
      photos={photos}
      collections={collections}
      shopIndexLimit={shopIndexLimit}
    />
  );
```

Add the imports at the top:

```tsx
import { getShopIndexLimit, SHOP_INDEX_LIMIT_DEFAULT } from '@/lib/site-settings';
```

- [ ] **Step 2: Add scope state to `WallArranger`**

Change the component signature and add state. Replace:

```tsx
export function WallArranger({ photos: initial }: { photos: LibraryPhoto[] }) {
```

with:

```tsx
export function WallArranger({
  photos: initial,
  collections,
  shopIndexLimit: initialLimit,
}: {
  photos: LibraryPhoto[];
  collections: { id: number; title: string }[];
  shopIndexLimit: number;
}) {
```

Add beside the existing `const [filter, setFilter] = useState<FilterKey>('all');`:

```tsx
  // Which Shop scope is on screen. Read post-mount (see the effect below), so
  // SSR renders All and there is no hydration mismatch.
  const [shopScope, setShopScope] = useState<ShopScope>({ kind: 'all' });
  const [shopLimit, setShopLimit] = useState<number>(initialLimit);
```

- [ ] **Step 3: Persist and restore the scope**

Inside the existing post-mount `useEffect(() => { … }, [])` that reads
`wl-wall-bandh` and `wl-wall-min`, add before the closing `catch`:

```tsx
      // Same post-mount treatment as wl-wall-min, and for the same reason:
      // reading during render would flash the All view and its cut line before
      // switching. Every "Edit" is a round trip out of this page and back, and
      // losing your place on return was already fixed once here.
      const s = window.localStorage.getItem('wl-shop-scope');
      if (s) {
        const parsed = parseScopeKey(s);
        // A persisted scope naming a since-deleted collection falls back to
        // All, rather than rendering an empty shelf with no matching chip.
        if (parsed.kind !== 'collection' || collections.some((c) => c.id === parsed.id)) {
          setShopScope(parsed);
        }
      }
```

Add a setter used by the tray:

```tsx
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

Replace the existing `const shop = useMemo(() => photos.filter(isInShop), [photos]);` with:

```tsx
  const shopCounts = useMemo(() => shopScopeCounts(photos), [photos]);
  const shopIds = useMemo(() => deriveShopIds(photos, shopScope), [photos, shopScope]);
  const shop = useMemo(
    () => shopIds.map((id) => byId.get(id)).filter((p): p is LibraryPhoto => !!p),
    [shopIds, byId],
  );
```

`blockedCount` keeps working unchanged, since it reads `shop`.

- [ ] **Step 5: Render the tray in the Shop head**

In the Shop `<section>`'s `.wl-adm-ws-head`, after the existing `<span className="wl-adm-ws-note">…</span>` block, add:

```tsx
            <div className="wl-adm-seg wrap" role="group" aria-label="Filter the shop by collection">
              <button
                type="button"
                aria-pressed={shopScope.kind === 'all'}
                className={shopScope.kind === 'all' ? 'on' : ''}
                onClick={() => selectShopScope({ kind: 'all' })}
              >
                All <span className="sub">{shopCounts.all}</span>
              </button>
              {collections.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={shopScope.kind === 'collection' && shopScope.id === c.id}
                  className={
                    shopScope.kind === 'collection' && shopScope.id === c.id ? 'on' : ''
                  }
                  onClick={() => selectShopScope({ kind: 'collection', id: c.id })}
                >
                  {c.title} <span className="sub">{shopCounts.byCollection.get(c.id) ?? 0}</span>
                </button>
              ))}
              <button
                type="button"
                aria-pressed={shopScope.kind === 'unfiled'}
                className={shopScope.kind === 'unfiled' ? 'on' : ''}
                onClick={() => selectShopScope({ kind: 'unfiled' })}
              >
                Unfiled <span className="sub">{shopCounts.unfiled}</span>
              </button>
            </div>
```

Add the imports at the top of the file:

```tsx
import {
  cutLineAfter,
  deriveShopIds,
  isArrangeable,
  parseScopeKey,
  scopeKey,
  shopScopeCounts,
  type ShopScope,
} from '@/lib/shop-arrange';
```

- [ ] **Step 6: Scope-aware empty states**

Replace the Shop shelf's empty branch:

```tsx
            (shop.length === 0 ? (
              <div className="wl-adm-ws-empty">
                {shopScope.kind === 'all'
                  ? 'Drag photos with a print file here to put them up for sale.'
                  : shopScope.kind === 'unfiled'
                    ? 'Every photo in the shop belongs to a chapter.'
                    : 'Nothing in this chapter is in the shop yet.'}
              </div>
            ) : (
```

The All-scoped "drag photos here" copy must not show under a chapter filter,
where it reads as wrong.

- [ ] **Step 7: Make the seg control wrap**

In `app/admin/admin.css`, after the existing `.wl-adm-seg button:last-child` rule, add:

```css
/* Wrapping variant, for the Shop shelf's collection tray. The base .wl-adm-seg
   is inline-flex + overflow:hidden with white-space:nowrap buttons, so an
   overflowing row is CLIPPED, not wrapped. The :last-child border rule only
   clears the divider on the final button, which leaves a stray divider at the
   end of every wrapped row, so target the last button in each row instead. */
.wl-adm-seg.wrap {
  flex-wrap: wrap;
  overflow: visible;
}
.wl-adm-seg.wrap button {
  border-right: 0;
  box-shadow: inset -1px 0 0 var(--adm-rule);
}
.wl-adm-seg.wrap button:last-child {
  box-shadow: none;
}
```

And allow the shelf head itself to wrap. Replace line `.wl-adm-ws-head { display: flex; align-items: center; gap: 10px; }` with:

```css
.wl-adm-ws-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
```

The base `.wl-adm-seg` is shared with the artworks-list status tabs and the
Library filters; the `.wrap` modifier leaves both untouched.

- [ ] **Step 8: Reserve room for a taller Shop head**

In `clampBand`, the `LIB_FLOOR` constant reserves space for the Library. The
Shop head can now be two or three rows tall, and the band's 120px floor does not
account for it. Replace the `max` computation's comment and add a measurement:

```tsx
      // The Shop head can wrap to several rows once the collection tray and the
      // limit field are in it. Measure it rather than assuming one row, or a
      // maxed band leaves the Shop grid with no tile area at all.
      const shopHead = wall.querySelector<HTMLElement>('.wl-adm-ws-shelf.shop .wl-adm-ws-head');
      const shopHeadExtra = Math.max(0, (shopHead?.getBoundingClientRect().height ?? 0) - 32);
      max = wall.clientHeight - pad - errH - HANDLE - LIB_FLOOR - shopHeadExtra - gap * (errH ? 3 : 2);
```

- [ ] **Step 9: Typecheck, test, commit**

```bash
npm run typecheck && npm test
git add app/admin/wall/page.tsx components/admin/WallArranger.tsx app/admin/admin.css
git commit -m "feat(shop): collection filter tray on the shop shelf"
```

---

### Task 9: Scoped reorder on the Shop shelf

**Files:**
- Modify: `components/admin/WallArranger.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/shop/order` from Task 7.
- Produces: no external interface.

- [ ] **Step 1: Add scoped state, kept separate from the Wall's**

"Mirror the Wall" must not mean "share the Wall's state". Add beside the Wall's
equivalents:

```tsx
  // The Shop shelf gets its OWN saving flag, flash, saved-snapshot and focus
  // attribute. Reusing the Wall's would disable the Wall during a Shop save,
  // flash "order saved" in the Wall's head, and send focus to a Wall tile for
  // any photo that is both on the wall and in the shop (its [data-pos-id]
  // would match two elements).
  const [savingShop, setSavingShop] = useState(false);
  const [shopSavedFlash, setShopSavedFlash] = useState(false);
  const [shopOrder, setShopOrder] = useState<number[]>([]);
  const shopOrderRef = useRef<number[]>([]);
  const savedShopIds = useRef<number[]>([]);
  const [shopEditPos, setShopEditPos] = useState<number | null>(null);
```

Also compute the cut index, because the tile markup in Step 4 reads it. Place
this **after** the `shop` useMemo below, not with the state block above: it
reads `shop`, and a `const` referenced before its declaration is a
temporal-dead-zone error, not a hoist. (The limit *field* that lets an admin
change `shopLimit` arrives in Task 10; until then this renders against the
value the loader supplied.)

```tsx
  // All view only: the cut governs /shop, and a chapter view has no cut.
  // cutLineAfter counts BUYABLE tiles, because the public query filters
  // unbuyable rows out before applying its LIMIT.
  const cutAfter = useMemo(
    () => (shopScope.kind === 'all' ? cutLineAfter(shop, shopLimit) : null),
    [shopScope, shop, shopLimit],
  );
```

Extend the in-flight gate:

```tsx
  const inFlight = busy || savingOrder || savingShop;
```

Re-seed the local order whenever the derived list changes (a scope switch, or a
mutation that changes membership):

```tsx
  useEffect(() => {
    shopOrderRef.current = shopIds;
    setShopOrder(shopIds);
    savedShopIds.current = shopIds;
  }, [shopIds]);
```

and render from `shopOrder` rather than `shopIds`:

```tsx
  const shop = useMemo(
    () => shopOrder.map((id) => byId.get(id)).filter((p): p is LibraryPhoto => !!p),
    [shopOrder, byId],
  );
```

- [ ] **Step 2: Add the save function**

```tsx
  function setShopIds(next: number[] | ((cur: number[]) => number[])) {
    const v = typeof next === 'function' ? next(shopOrderRef.current) : next;
    shopOrderRef.current = v;
    setShopOrder(v);
  }

  async function persistShopOrder(ids: number[], scope: ShopScope): Promise<MutResult> {
    if (ids.length === 0) {
      savedShopIds.current = ids;
      return { ok: true, status: 200 };
    }
    try {
      const r = await fetch('/api/admin/shop/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          scope.kind === 'collection'
            ? { scope: 'collection', collectionId: scope.id, ids }
            : { scope: 'all', ids },
        ),
        signal: mutationTimeout(),
      });
      if (!r.ok) return { ok: false, status: r.status };
      savedShopIds.current = ids;
      return { ok: true, status: r.status };
    } catch (err) {
      if (isTimeout(err)) return { ok: false, status: 0, timedOut: true };
      return { ok: false, status: 0, error: 'network error' };
    }
  }

  async function commitShopOrder() {
    if (inFlight || !isArrangeable(shopScope)) return;
    const attempt = shopOrderRef.current.slice();
    if (!orderChanged(attempt, savedShopIds.current)) return;
    // Tag the request with the scope it was built against. If the admin
    // switches filters mid-flight, a rollback into the NEW scope would be
    // nonsense, so discard it and surface the error instead.
    const scopeAtSend = shopScope;
    setSavingShop(true);
    const res = await persistShopOrder(attempt, scopeAtSend);
    setSavingShop(false);
    if (res.timedOut) return reconcileAfterTimeout();
    if (scopeKey(scopeAtSend) !== scopeKey(shopScope)) {
      if (!res.ok) fail("Couldn't save the previous filter's order. Reload to see the saved order.");
      return;
    }
    if (res.status === 409) {
      // The server rolled back, so nothing was written. The pending
      // arrangement is genuinely lost, and that is correct: it was built
      // against a membership that no longer exists.
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
    setShopSavedFlash(true);
    announce(
      shopScope.kind === 'collection'
        ? 'Chapter order saved'
        : 'Shop order saved',
    );
    window.setTimeout(() => setShopSavedFlash(false), 2200);
  }
```

- [ ] **Step 3: Add the move-to-position function**

```tsx
  function focusShopPos(id: number) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[data-shop-pos-id="${id}"]`);
        if (el) el.focus({ preventScroll: true });
        else focusLibraryFallback();
      }),
    );
  }

  async function moveShopToPosition(id: number, pos1: number) {
    if (inFlight) return;
    const cur = shopOrderRef.current;
    const from = cur.indexOf(id);
    setShopEditPos(null);
    if (from === -1 || !Number.isInteger(pos1) || pos1 < 1) return focusShopPos(id);
    const to = Math.max(0, Math.min(cur.length - 1, pos1 - 1));
    if (to === from) return focusShopPos(id);
    const next = cur.slice();
    next.splice(from, 1);
    next.splice(to, 0, id);
    setShopIds(next);
    await commitShopOrder();
    focusShopPos(id);
  }
```

- [ ] **Step 4: Make the Shop tiles draggable with a position badge**

Replace the Shop grid's `<figure key={p.id} className="wl-adm-ws-tile" …>` with a
version mirroring the Wall tile. The badge is not garnish: the Shop shelf sits
in the same height-capped band as the Wall, and `dragEnter` cannot fire on a
tile clipped out of view, so without it a photo cannot move more than about a
row and there is no keyboard path at all.

```tsx
                {shop.map((p, i) => {
                  const arrangeable = isArrangeable(shopScope);
                  return (
                  <figure
                    key={p.id}
                    className={`wl-adm-ws-tile ${arrangeable ? 'grab' : ''} ${
                      drag?.id === p.id && drag.from === 'shop' ? 'dragging' : ''
                    } ${cutAfter != null && i > cutAfter ? 'below-cut' : ''}`}
                    title={p.title}
                    draggable={arrangeable && !inFlight && shopEditPos !== p.id}
                    onDragStart={(e) => {
                      if (!arrangeable || inFlight || shopEditPos === p.id) return;
                      setShopEditPos(null);
                      e.dataTransfer.setData('text/plain', String(p.id));
                      e.dataTransfer.effectAllowed = 'move';
                      setDrag({ id: p.id, from: 'shop' });
                    }}
                    onDragEnter={() => {
                      if (drag?.from !== 'shop') return;
                      setShopIds((ids) => reorder(ids, drag.id, p.id));
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    // Commit on dragEnd, NEVER drop. Chromium does not deliver
                    // a drop event when the drag source node was moved
                    // mid-drag, which a live reorder always does.
                    onDragEnd={() => {
                      setDrag(null);
                      setDropTarget(null);
                      void commitShopOrder();
                    }}
                    onDrop={(e) => e.preventDefault()}
                  >
                    {arrangeable && (shopEditPos === p.id ? (
                      <span className="wl-adm-ws-posedit">
                        <input
                          className="wl-adm-ws-posinput"
                          type="number"
                          min={1}
                          max={shop.length}
                          defaultValue={i + 1}
                          autoFocus
                          draggable={false}
                          aria-label={`Move ${p.title} to position (1 to ${shop.length})`}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={() => setShopEditPos((cur) => (cur === p.id ? null : cur))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void moveShopToPosition(p.id, Number((e.target as HTMLInputElement).value));
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              setShopEditPos(null);
                              focusShopPos(p.id);
                            }
                          }}
                        />
                        <span className="wl-adm-ws-poshint">of {shop.length} · Enter</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="wl-adm-ws-pos"
                        data-shop-pos-id={p.id}
                        aria-label={`${p.title} is at position ${i + 1} of ${shop.length}. Activate to move it.`}
                        title="Click to move this photo to a position"
                        disabled={inFlight}
                        onClick={(e) => {
                          e.stopPropagation();
                          setShopEditPos(p.id);
                        }}
                      >
                        {i + 1}
                      </button>
                    ))}
                    <div className="wl-adm-ws-badges">
                      {!p.buyable && (
                        <span className="wl-adm-ws-badge blocked">hidden · no sizes available</span>
                      )}
                      {shopScope.kind === 'all' && (
                        <span className="wl-adm-ws-badge chapter">
                          {p.collection_title ?? 'unfiled'}
                        </span>
                      )}
                      {shopScope.kind === 'unfiled' && cutAfter != null && i > cutAfter && (
                        <span className="wl-adm-ws-badge blocked">unreachable</span>
                      )}
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.image_web_url} alt={p.title} draggable={false} />
                    <figcaption className="wl-adm-ws-cap">
                      <EditLink id={p.id} title={p.title} />
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
                  );
                })}
```

Widen the `Drag` type so `from` accepts the new source:

```tsx
type Drag = { id: number; from: 'lib' | 'wall' | 'shop' } | null;
```

- [ ] **Step 5: Show the Shop's own saved flash, with the revalidation delay**

In the Shop head, beside the existing `shopHot` / `shopBad` spans:

```tsx
            {/* The public pages are `revalidate = 60` and there is no
                revalidatePath call anywhere in this repo, so a saved change can
                take up to a minute to appear. Say so here: without it the delay
                reads as "the save did not work" and invites a second save. */}
            {shopSavedFlash && (
              <span className="wl-adm-ws-saved">order saved ✓ live within a minute</span>
            )}
```

- [ ] **Step 6: Typecheck, test, commit**

```bash
npm run typecheck && npm test
git add components/admin/WallArranger.tsx
git commit -m "feat(shop): drag and type-a-position reorder on the shop shelf"
```

---

### Task 10: Cut line and the limit control

**Files:**
- Modify: `components/admin/WallArranger.tsx`
- Modify: `app/admin/admin.css`

**Interfaces:**
- Consumes: `cutLineAfter` from `@/lib/shop-arrange`; `PATCH /api/admin/settings`; `isValidShopIndexLimit`, `SHOP_INDEX_LIMIT_MAX` from `@/lib/site-settings`.
- Produces: `cutAfter` (used by Task 9's tile classes).

- [ ] **Step 1: Add the buyable count**

`cutAfter` already exists from Task 9. The limit field's readout needs the
denominator too, so add beside it:

```tsx
  const buyableCount = useMemo(() => shop.filter((p) => p.buyable).length, [shop]);
```

- [ ] **Step 2: Add the limit control and readout**

In the Shop head, rendered only when `shopScope.kind === 'all'`:

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

And at module scope, beside `PaneChip`:

```tsx
// The /shop cap, editable. 0 means no limit. Client validation uses the SAME
// predicate as the server (isValidShopIndexLimit), from one module, so the two
// cannot drift. Module scope.
function ShopLimitField({
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
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

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
        signal: mutationTimeout(),
      });
      if (!r.ok) throw new Error(String(r.status));
      onSaved(n);
    } catch {
      // Revert to the last saved value rather than leaving a number on screen
      // that does not match what /shop will do.
      setDraft(String(value));
      onError("Couldn't save the shop limit. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const shown = value === 0 ? buyableCount : Math.min(value, buyableCount);
  return (
    <span className="wl-adm-ws-limit">
      <label htmlFor="wl-shop-limit">Show first</label>
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
      <span id="wl-shop-limit-hint" className="hint">
        {invalid
          ? `Whole number, 0 to ${SHOP_INDEX_LIMIT_MAX}`
          : saving
            ? 'saving…'
            : value === 0
              ? `no limit, showing all ${buyableCount} buyable`
              : value >= buyableCount
                ? `showing all ${buyableCount} buyable`
                : `showing ${shown} of ${buyableCount} buyable`}
      </span>
    </span>
  );
}
```

Note the readout says "all {buyableCount}", never "all {value}": with a limit of
50 and 12 buyable pieces, "showing all 50 buyable" is wrong.

Add to the file's imports:

```tsx
import { isValidShopIndexLimit, SHOP_INDEX_LIMIT_MAX } from '@/lib/site-settings';
```

- [ ] **Step 3: Draw the cut line**

Wrap the Shop grid so a divider can be absolutely positioned, or simpler, give
the first below-cut tile a top rule. In `app/admin/admin.css`:

```css
/* Everything below the cut line is published and still buyable, it just does
   not appear on /shop. Deliberately not styled as an error. */
.wl-adm-ws-tile.below-cut { opacity: 0.45; }
.wl-adm-ws-tile.below-cut:hover { opacity: 0.8; }
.wl-adm-ws-badge.chapter {
  background: var(--adm-card);
  color: var(--adm-muted);
  border: 1px solid var(--adm-rule);
}
.wl-adm-ws-limit { display: inline-flex; align-items: center; gap: 6px; }
.wl-adm-ws-limit label { font-size: 12px; color: var(--adm-muted); }
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

And in the Shop grid, insert a labelled divider after the cut index:

```tsx
                    {cutAfter === i && (
                      <div className="wl-adm-ws-cut" role="separator" aria-label="Cut line: photos below this do not appear on the shop page">
                        <span>below this does not appear on /shop</span>
                      </div>
                    )}
```

placed as a sibling immediately after each `</figure>`, inside a fragment keyed
by the photo id. The divider spans the grid:

```css
.wl-adm-ws-cut {
  grid-column: 1 / -1;
  display: flex; align-items: center; gap: 10px;
  margin: 4px 0;
  font-family: var(--f-mono), monospace; font-size: 10px;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--adm-muted);
}
.wl-adm-ws-cut::before, .wl-adm-ws-cut::after {
  content: ''; flex: 1; height: 1px; background: var(--adm-rule);
}
```

- [ ] **Step 4: Typecheck, test, commit**

```bash
npm run typecheck && npm test
git add components/admin/WallArranger.tsx app/admin/admin.css
git commit -m "feat(shop): editable /shop cap with a buyable-counted cut line"
```

---

### Task 11: Public queries, header, footer

**Files:**
- Modify: `app/(shop)/shop/collections/[slug]/page.tsx`, `app/(shop)/portfolio/[slug]/page.tsx`, `app/(shop)/shop/artwork/[slug]/page.tsx`, `app/(shop)/shop/page.tsx`, `components/site/Footer.tsx`

**Interfaces:**
- Consumes: `getShopIndexLimit` from `@/lib/site-settings`.

- [ ] **Step 1: Three collection-order swaps**

In each of these, change `ORDER BY a.display_order, a.id` to
`ORDER BY a.collection_order, a.id`:

- `app/(shop)/shop/collections/[slug]/page.tsx`: the chapter grid
- `app/(shop)/portfolio/[slug]/page.tsx`: the same collection, unfiltered by buyability
- `app/(shop)/shop/artwork/[slug]/page.tsx`: the related rail (the `LIMIT 4` query)

Leave the `plate_idx` window function in the artwork page's gating query alone.
It still reads `display_order` and will drift when the shop is rearranged; the
plate-numbers spec deletes it.

- [ ] **Step 2: Apply the limit on `/shop`**

In `app/(shop)/shop/page.tsx`, change the two-query `Promise.all` to fetch the
limit alongside the counts, then run the plates query:

```tsx
  const [countsRes, limit] = await Promise.all([
    pool.query<CountsRow>(
      `SELECT COUNT(*)::int AS n, MAX(published_at)::text AS latest
       FROM artworks WHERE status='published'`,
    ),
    getShopIndexLimit(),
  ]);

  // Serial by necessity: the limit has to be known before the plates query
  // runs. Folding it in as a `LIMIT (SELECT ...)` subquery would avoid the hop
  // but put the settings read inside the grid query, so one throw takes the
  // grid down with it. Correctness beats the round trip.
  //
  // NULLIF is load-bearing: in Postgres LIMIT 0 returns ZERO ROWS, and 0 means
  // "no limit" here. LIMIT NULL is the unlimited form.
  const platesRes = await pool.query<PlateRow>(
    `SELECT a.slug,
            a.title,
            a.image_web_url,
            a.year_shot,
            a.location,
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

Add the import:

```tsx
import { getShopIndexLimit } from '@/lib/site-settings';
```

- [ ] **Step 3: Fix the header**

In the same file, replace the sheet header:

```tsx
        <header className="wl-sheet-h">
          <h2>Selected works</h2>
          <div className="wl-rule"></div>
          <span className="count">
            {String(plates.length).padStart(2, '0')} shown
          </span>
        </header>
```

The count now describes the grid rather than the archive. The masthead's
"Plates on file" stat keeps counting everything, which is where a total belongs.

- [ ] **Step 4: Fix the stale footer label**

In `components/site/Footer.tsx`, change the `/shop` link text from
`Index of plates` to `Selected works`.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck && npm test
git add "app/(shop)/shop/page.tsx" "app/(shop)/shop/collections/[slug]/page.tsx" \
        "app/(shop)/portfolio/[slug]/page.tsx" "app/(shop)/shop/artwork/[slug]/page.tsx" \
        components/site/Footer.tsx
git commit -m "feat(shop): collection order on public pages, editable /shop cap"
```

---

### Task 12: Browse by collection band

**Files:**
- Modify: `app/(shop)/shop/page.tsx`

- [ ] **Step 1: Add the band query to the existing `Promise.all`**

Task 11 left the destructuring as `const [countsRes, limit] = await Promise.all([…])`.
Widen it to three, so the band costs no extra round trip on the storefront's
busiest page:

```tsx
  const [countsRes, limit, chaptersRes] = await Promise.all([
    /* the counts query, unchanged */,
    getShopIndexLimit(),
    /* the chapters query below */,
  ]);
  const chapters = chaptersRes.rows;
```

The chapters query:

```tsx
    pool.query<{ slug: string; title: string; n: number }>(
      // Counts BUYABLE published works, not just published, and drops
      // zero-count chapters. /shop/collections counts status='published' and
      // LEFT JOINs, so reusing it verbatim here would advertise "5 plates" on
      // the storefront's busiest index and land on a visibly empty page.
      `SELECT c.slug, c.title,
              COUNT(a.id)::int AS n
         FROM collections c
         JOIN artworks a ON a.collection_id = c.id
          AND a.status = 'published'
          AND EXISTS (SELECT 1 FROM artwork_variants v
                        WHERE v.artwork_id = a.id AND v.buyable)
        GROUP BY c.id
       HAVING COUNT(a.id) > 0
        ORDER BY c.display_order, c.id`,
    ),
```

- [ ] **Step 2: Render the band below the grid**

After the `</section>` closing the `wl-sheet`:

```tsx
      {chapters.length > 0 && (
        <section className="wl-sheet wl-browse-band">
          <header className="wl-sheet-h">
            <h2>Browse by collection</h2>
            <div className="wl-rule"></div>
            <span className="count">
              {String(chapters.length).padStart(2, '0')} chapters
            </span>
          </header>
          <div className="wl-cindex-list">
            {chapters.map((c) => (
              <Link
                key={c.slug}
                href={`/shop/collections/${c.slug}`}
                className="wl-cindex-row"
              >
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
`/shop/collections`, and omitting zero-count chapters here would make it
disagree with the "Chapter 03 of 06" on the chapter and portfolio pages, which
`ROW_NUMBER()` over *all* collections.

Add `import Link from 'next/link';` if not already present.

- [ ] **Step 3: Typecheck and commit**

```bash
npm run typecheck && npm test
git add "app/(shop)/shop/page.tsx"
git commit -m "feat(shop): browse-by-collection band on the shop index"
```

---

### Task 13: Script guards

**Files:**
- Modify: `scripts/import-manifest.ts`, `scripts/publish-selections.ts`, `README.md`

- [ ] **Step 1: Stop `import-manifest` writing display order, on BOTH tables**

In the `collections` upsert, delete the line `display_order = EXCLUDED.display_order,` from the `DO UPDATE SET` clause. Leave the INSERT's `display_order` column, which seeds a sensible order for a genuinely new collection.

In the `artworks` upsert, delete `display_order` from the INSERT column list, from the `VALUES` list, and from the `DO UPDATE SET` clause, and drop `idx` from the parameter array. Add above it:

```ts
        // display_order is the curated All order now, arranged from
        // /admin/wall. Writing a manifest index here would silently overwrite
        // it on every re-import. New rows keep the column default of 0, which
        // is the "never placed" sentinel the publish rules append from.
```

- [ ] **Step 2: Apply Rule 3 to the re-file case**

`ON CONFLICT (slug) DO UPDATE SET collection_id = EXCLUDED.collection_id` re-files rows that may already be published, and those never transition into `published`, so nothing appends them. Add after the upsert, inside the same `withTransaction`:

```ts
        // A re-filed row that is ALREADY published never transitions, so the
        // publish chokepoint never assigns it a chapter position and it would
        // sort to the FRONT of its new chapter on /shop/collections/[slug],
        // /portfolio/[slug] and the related rail.
        await client.query(
          `UPDATE artworks a
              SET collection_order = COALESCE(
                    (SELECT MAX(b.collection_order) FROM artworks b
                      WHERE b.collection_id = a.collection_id
                        AND b.status = 'published' AND b.id <> a.id), 0) + 1
            WHERE a.slug = $1
              AND a.status = 'published'
              AND a.collection_order = 0
              AND a.collection_id IS NOT NULL`,
          [slug],
        );
```

- [ ] **Step 3: Fence off `publish-selections`**

At the top of `main()` in `scripts/publish-selections.ts`, before reading the selections file:

```ts
  // This script resolves artworks by (collection_id, display_order), expecting
  // display_order to be the manifest's per-collection index. The shop-ordering
  // backfill turned display_order into a global curated sequence, so that
  // lookup now matches the WRONG rows, and the converge step below demotes
  // every published row it did not match. A post-backfill run could therefore
  // mass-unpublish the shop.
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

In `README.md`, on the `npm run publish:selections` row, append:

```
(disabled after the shop-ordering backfill; display_order is the curated /shop order now)
```

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck && npm test
git add scripts/import-manifest.ts scripts/publish-selections.ts README.md
git commit -m "fix(scripts): stop clobbering curated order, fence off publish-selections"
```

---

## Final verification

- [ ] **Run the full gates**

```bash
npm run typecheck && npm test
```

Expected: typecheck clean, all tests pass. Do NOT run `npm run lint`.

- [ ] **Pre-ship checks, against production, before the deploy that runs the backfill**

```sql
-- 1. SNAPSHOT. The densify is not revertible by reverting code. Without this
--    there is no recovery if the comparison below fails.
CREATE TABLE artworks_order_backup_20260721 AS
  SELECT id, display_order, collection_id, collection_order FROM artworks;

-- 2. Shape of the data going in. Expect many nonzero values: import-manifest
--    wrote per-collection indices.
SELECT COUNT(*) FILTER (WHERE display_order <> 0) AS arranged,
       COUNT(*) AS total
  FROM artworks;

-- 3. Under the 1000 payload cap and loader limit?
SELECT COUNT(*) FROM artworks WHERE status = 'published';
```

Also confirm the Neon major version. On PostgreSQL 16 and earlier the 15s
`statement_timeout` applies to the whole multi-statement migration message, so a
slow deploy aborts it (fails safe, the marker rolls back, but the build fails).

And confirm no `scraped/selections.json` run is pending.

- [ ] **Manual pass on the live deploy**

1. Reorder in All; confirm `/shop` matches after revalidation (up to 60s).
2. Reorder within a chapter; confirm the chapter page, the portfolio page, and the related rail all match, and that `/shop` did **not** change.
3. Change the limit; confirm the cut line and the live grid agree. **Set it to `0`** and confirm the full catalogue renders rather than a blank page.
4. **Retire a piece, then re-publish it.** Confirm it appends to the end rather than landing mid-grid (Rules 1 and 2).
5. **Bulk-publish several drafts at once.** Confirm they get distinct consecutive positions, not a clump (Rule 2's `ROW_NUMBER()`).
6. **Bulk-move several photos to another chapter.** Confirm they land at the end of it, not the front (Rule 3's batch case).
7. Re-select a photo's *current* chapter from the row menu. Confirm it does **not** move (Rule 3's `IS DISTINCT FROM`).
8. Open the shelf in two tabs, reorder in one, then reorder in the other. Confirm the second gets the "shop changed in another window" message and reloads, rather than silently saving a partial order.
9. Confirm the browse band lists only chapters with buyable work, and that each link lands on a non-empty page.
