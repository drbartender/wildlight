# Resolution-Aware Print Sizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each artwork only offers the print sizes its master file can produce at ≥150 DPI; under-res sizes are blocked (absent from the shop) with a per-size admin override.

**Architecture:** A pure per-size evaluator (`lib/print-resolution.ts`) decides ok/blocked from the master's short edge. A single recompute chokepoint (`lib/variant-resolution.ts`) writes `artwork_variants.min_resolution_ok`. A Postgres **generated** column `buyable = active AND (min_resolution_ok IS NOT FALSE OR resolution_override)` is the one gate every customer surface (shop grid, artwork page, checkout, Printful sync) reads. Admin sees all sizes with reasons and an override toggle. Rollout is staged and reversible (columns first ⇒ `buyable ≡ active` ⇒ no behavior change until a deliberate recompute).

**Tech Stack:** Next.js 16 App Router, raw `pg` (`lib/db.ts`, `withTransaction`), `sharp`, Cloudflare R2, Stripe, Printful, Vitest, Vercel.

**Spec:** `docs/superpowers/specs/2026-06-08-resolution-gating-design.md`

---

## File Structure

**Create:**
- `lib/variant-resolution.ts` — recompute chokepoint `refreshVariantResolution(client, artworkId)`.
- `lib/measure-master.ts` — `measureMasterDims(key)` (R2 + sharp, orientation-correct); shared by the `[id]` route.
- `app/api/admin/artworks/[id]/variants/[variantId]/route.ts` — PATCH override/active.
- `scripts/recompute-variant-resolution.ts` — `--dry-run` / `--apply` catalog recompute.
- `tests/lib/variant-resolution.test.ts` — recompute logic over a stub client.

**Modify:**
- `lib/print-resolution.ts` — export `MIN_DPI`/`GOOD_DPI`; add `evaluateSizeResolution`, `maxSupportedSize`.
- `tests/lib/print-resolution.test.ts` — tests for the two new functions.
- `lib/schema.sql` — add `min_resolution_ok`, `resolution_override`, generated `buyable`, index.
- `app/api/admin/artworks/bulk-upload/finalize/route.ts` — wrap dims write + recompute in a transaction.
- `app/api/admin/artworks/[id]/route.ts` — applyTemplate carry-forward + recompute; re-measure on `image_print_url` change + recompute.
- `app/(shop)/shop/page.tsx`, `app/(shop)/shop/collections/[slug]/page.tsx`, `app/(shop)/shop/artwork/[slug]/page.tsx` — `active` → `buyable`; hide zero-buyable artworks.
- `app/api/checkout/route.ts` — `v.active` → `v.buyable` + friendlier error.
- `lib/printful-sync.ts` — `active` → `buyable`.
- `app/api/admin/artworks/route.ts` — admin list: `active` → `buyable` + badge aggregate.
- `app/admin/artworks/[id]/page.tsx` — per-size panel + override toggle; `activeVariants` → buyable.
- `app/admin/artworks/page.tsx` — list resolution badge.
- `scripts/backfill-print-dims.ts` — call recompute per row after writing dims.
- `package.json` — `recompute:resolution` script.

---

## Task 1: Per-size resolution evaluator

**Files:**
- Modify: `lib/print-resolution.ts`
- Test: `tests/lib/print-resolution.test.ts`

- [ ] **Step 1: Write failing tests** — append to `tests/lib/print-resolution.test.ts`:

```ts
import {
  classifyPrintResolution,
  evaluateSizeResolution,
  maxSupportedSize,
  MIN_DPI,
} from '@/lib/print-resolution';

describe('evaluateSizeResolution', () => {
  it('blocks a 0.8MP file at every size (Gulls case)', () => {
    // 1050x720 → short edge 720px
    const r = evaluateSizeResolution(1050, 720, '24x36');
    expect(r.shortInches).toBe(24);
    expect(r.requiredShortPx).toBe(24 * MIN_DPI); // 3600
    expect(r.actualShortPx).toBe(720);
    expect(r.effectiveDpi).toBe(30); // 720 / 24
    expect(r.ok).toBe(false);
    expect(r.message).toContain('needs 3600px');
    expect(r.message).toContain('720px');
  });

  it('passes 8x10 but blocks 12x16 for a 4.2MP file (Cake Alley case)', () => {
    // 2578x1627 → short edge 1627px
    expect(evaluateSizeResolution(2578, 1627, '8x10').ok).toBe(true); // 1627/8 = 203
    expect(evaluateSizeResolution(2578, 1627, '12x16').ok).toBe(false); // 1627/12 = 136
  });

  it('uses the short edge regardless of orientation', () => {
    const landscape = evaluateSizeResolution(6016, 4016, '24x36');
    const portrait = evaluateSizeResolution(4016, 6016, '24x36');
    expect(landscape.actualShortPx).toBe(4016);
    expect(portrait.actualShortPx).toBe(4016);
    expect(landscape.ok).toBe(true); // 4016/24 = 167 ≥ 150
    expect(portrait.ok).toBe(true);
  });

  it('treats exactly the floor as ok (boundary)', () => {
    // short edge exactly 8 * 150 = 1200 at 8x10
    expect(evaluateSizeResolution(1600, 1200, '8x10').ok).toBe(true);
    expect(evaluateSizeResolution(1600, 1199, '8x10').ok).toBe(false);
  });

  it('returns an unmeasured result for non-positive dims', () => {
    const r = evaluateSizeResolution(0, 0, '24x36');
    expect(r.ok).toBe(false);
    expect(r.actualShortPx).toBe(0);
  });
});

describe('maxSupportedSize', () => {
  const SIZES = ['8x10', '12x16', '16x20', '18x24', '24x30', '24x36'];
  it('returns the largest size whose short edge clears the floor', () => {
    expect(maxSupportedSize(6016, 4016, SIZES)).toBe('24x36'); // all clear
    expect(maxSupportedSize(3324, 2160, SIZES)).toBe('12x16'); // 2160/16=135<150 at 16x20
    expect(maxSupportedSize(1050, 720, SIZES)).toBe(null); // nothing clears
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- print-resolution`
Expected: FAIL — `evaluateSizeResolution`/`maxSupportedSize`/`MIN_DPI` not exported.

- [ ] **Step 3: Implement** — in `lib/print-resolution.ts`, change the two private consts to exports and append the new functions:

```ts
// change these two lines from `const` to exported:
export const GOOD_DPI = 240;
export const MIN_DPI = 150;

// Sizes are catalog labels like "24x36"; the print is matched short-edge to
// short-edge, so the file's short edge governs. A label that is not WxH is a
// data error — callers treat that as "unmeasured", never a silent block.
const SIZE_RX = /^(\d+)x(\d+)$/;

export interface SizeResolution {
  size: string;
  shortInches: number;
  requiredShortPx: number;
  actualShortPx: number;
  effectiveDpi: number;
  ok: boolean;
  message: string;
}

export function shortEdgeInches(size: string): number | null {
  const m = SIZE_RX.exec(size.trim());
  if (!m) return null;
  return Math.min(Number(m[1]), Number(m[2]));
}

export function evaluateSizeResolution(
  width: number,
  height: number,
  size: string,
  floorDpi = MIN_DPI,
): SizeResolution {
  const shortInches = shortEdgeInches(size) ?? 0;
  const actualShortPx =
    width > 0 && height > 0 ? Math.min(width, height) : 0;
  const requiredShortPx = shortInches * floorDpi;
  const effectiveDpi = shortInches > 0 ? Math.round(actualShortPx / shortInches) : 0;
  const ok = shortInches > 0 && actualShortPx >= requiredShortPx;
  const message = ok
    ? `${effectiveDpi} DPI at ${size} — clears the ${floorDpi}-DPI floor.`
    : `${size} needs ${requiredShortPx}px short edge at ${floorDpi} DPI; file has ${actualShortPx}px (${effectiveDpi} DPI).`;
  return { size, shortInches, requiredShortPx, actualShortPx, effectiveDpi, ok, message };
}

/** Largest size in `sizes` whose short edge clears the floor, else null. */
export function maxSupportedSize(
  width: number,
  height: number,
  sizes: string[],
  floorDpi = MIN_DPI,
): string | null {
  const cleared = sizes
    .map((s) => ({ s, inches: shortEdgeInches(s) ?? 0 }))
    .filter((x) => x.inches > 0 && evaluateSizeResolution(width, height, x.s, floorDpi).ok)
    .sort((a, b) => b.inches - a.inches);
  return cleared.length ? cleared[0].s : null;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- print-resolution`
Expected: PASS (all old + new tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add lib/print-resolution.ts tests/lib/print-resolution.test.ts
git commit -m "feat(resolution): per-size DPI evaluator + maxSupportedSize"
```

---

## Task 2: Recompute chokepoint

**Files:**
- Create: `lib/variant-resolution.ts`
- Test: `tests/lib/variant-resolution.test.ts`

- [ ] **Step 1: Write failing test** — `tests/lib/variant-resolution.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { refreshVariantResolution } from '@/lib/variant-resolution';

// Minimal stub of the pg PoolClient surface refreshVariantResolution uses.
function stubClient(artworkRow: { print_width: number | null; print_height: number | null } | null, variantRows: Array<{ id: number; size: string }>) {
  const updates: Array<{ id: number; ok: boolean | null }> = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/FROM artworks/.test(sql)) {
        return { rows: artworkRow ? [artworkRow] : [], rowCount: artworkRow ? 1 : 0 };
      }
      if (/FROM artwork_variants/.test(sql)) {
        return { rows: variantRows, rowCount: variantRows.length };
      }
      if (/UPDATE artwork_variants/.test(sql)) {
        // params: [min_resolution_ok, variantId]
        updates.push({ ok: params![0] as boolean | null, id: params![1] as number });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  return { client, updates };
}

describe('refreshVariantResolution', () => {
  it('marks each variant ok/blocked from the master short edge', async () => {
    const { client, updates } = stubClient(
      { print_width: 1050, print_height: 720 }, // short 720
      [{ id: 1, size: '8x10' }, { id: 2, size: '24x36' }],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await refreshVariantResolution(client as any, 42);
    expect(updates).toContainEqual({ id: 1, ok: false }); // 720/8 = 90 < 150
    expect(updates).toContainEqual({ id: 2, ok: false });
    expect(res.blocked).toBe(2);
    expect(res.ok).toBe(0);
  });

  it('writes NULL min_resolution_ok when the artwork has no dims', async () => {
    const { client, updates } = stubClient(
      { print_width: null, print_height: null },
      [{ id: 7, size: '8x10' }],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await refreshVariantResolution(client as any, 42);
    expect(updates).toContainEqual({ id: 7, ok: null });
  });

  it('reads the artwork via the passed client (in-transaction)', async () => {
    const { client } = stubClient({ print_width: 6016, print_height: 4016 }, []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await refreshVariantResolution(client as any, 42);
    expect(client.query).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- variant-resolution`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `lib/variant-resolution.ts`:

```ts
import type { PoolClient } from 'pg';
import { evaluateSizeResolution } from './print-resolution';
import { logger } from './logger';

export interface RefreshResult {
  updated: number;
  ok: number;
  blocked: number;
  unmeasured: number;
}

/**
 * Single writer of artwork_variants.min_resolution_ok. Caller owns the
 * transaction — pass a PoolClient so a dims write earlier in the same
 * transaction is visible (mirrors lib/publish-artworks.ts). `buyable`
 * re-derives automatically via the generated column.
 */
export async function refreshVariantResolution(
  client: PoolClient,
  artworkId: number,
): Promise<RefreshResult> {
  const a = await client.query<{ print_width: number | null; print_height: number | null }>(
    `SELECT print_width, print_height FROM artworks WHERE id = $1`,
    [artworkId],
  );
  const dims = a.rows[0];
  const w = dims?.print_width ?? null;
  const h = dims?.print_height ?? null;

  const variants = await client.query<{ id: number; size: string }>(
    `SELECT id, size FROM artwork_variants WHERE artwork_id = $1`,
    [artworkId],
  );

  const res: RefreshResult = { updated: 0, ok: 0, blocked: 0, unmeasured: 0 };
  for (const v of variants.rows) {
    let ok: boolean | null;
    if (w == null || h == null) {
      ok = null; // unmeasured → fail-open via `min_resolution_ok IS NOT FALSE`
      res.unmeasured++;
    } else {
      ok = evaluateSizeResolution(w, h, v.size).ok;
      if (ok) res.ok++;
      else res.blocked++;
    }
    await client.query(
      `UPDATE artwork_variants SET min_resolution_ok = $1 WHERE id = $2`,
      [ok, v.id],
    );
    res.updated++;
  }
  logger.info('variant-resolution refresh', { artworkId, ...res });
  return res;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- variant-resolution`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add lib/variant-resolution.ts tests/lib/variant-resolution.test.ts
git commit -m "feat(resolution): refreshVariantResolution recompute chokepoint"
```

---

## Task 3: Schema — columns, generated `buyable`, index

**Files:**
- Modify: `lib/schema.sql` (append after the `print_width`/`print_height` block, ~line 492)

- [ ] **Step 1: Add the migration block** — append to `lib/schema.sql`:

```sql
-- ─── Resolution gating ─────────────────────────────────────────────
-- min_resolution_ok: does the master clear the 150-DPI floor at THIS size?
--   Written only by lib/variant-resolution.ts. NULL = not yet measured.
-- resolution_override: admin force-offers a size despite low resolution.
-- buyable (generated): the single gate every shop/checkout/sync query reads.
--   NULL min_resolution_ok is fail-open (IS NOT FALSE), so adding these
--   columns is a no-op until a recompute writes real TRUE/FALSE values.
ALTER TABLE artwork_variants
  ADD COLUMN IF NOT EXISTS min_resolution_ok   BOOLEAN,
  ADD COLUMN IF NOT EXISTS resolution_override BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE artwork_variants
  ADD COLUMN IF NOT EXISTS buyable BOOLEAN
    GENERATED ALWAYS AS (
      active AND (min_resolution_ok IS NOT FALSE OR resolution_override)
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_variants_artwork_buyable
  ON artwork_variants(artwork_id) WHERE buyable;
```

- [ ] **Step 2: Apply the migration**

Run: `npm run migrate`
Expected: completes without error (it is idempotent; re-running is safe).

- [ ] **Step 3: Verify columns + generated behavior**

Run:
```bash
npx dotenv -e .env.local -- node -e "const pg=require('pg');(async()=>{const c=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:true}});await c.connect();const r=await c.query(\"SELECT column_name,is_generated FROM information_schema.columns WHERE table_name='artwork_variants' AND column_name IN ('min_resolution_ok','resolution_override','buyable') ORDER BY column_name\");console.log(r.rows);const b=await c.query('SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE buyable)::int buyable FROM artwork_variants');console.log(b.rows[0]);await c.end()})()"
```
Expected: three columns present, `buyable` shows `is_generated = ALWAYS`, and `buyable` count == total (every row still `active`, `min_resolution_ok` NULL ⇒ buyable ≡ active). **No behavior change yet.**

- [ ] **Step 4: Commit**

```bash
git add lib/schema.sql
git commit -m "feat(resolution): add min_resolution_ok, resolution_override, generated buyable"
```

---

## Task 4: Capture + recompute at upload (finalize)

**Files:**
- Modify: `app/api/admin/artworks/bulk-upload/finalize/route.ts:239-251`

- [ ] **Step 1: Import the chokepoint + `withTransaction`** — at the top imports of `finalize/route.ts`, add:

```ts
import { withTransaction } from '@/lib/db';
import { refreshVariantResolution } from '@/lib/variant-resolution';
```
(`pool` is already imported; keep it.)

- [ ] **Step 2: Wrap the dims write + recompute in one transaction** — replace the standalone `await pool.query(\`UPDATE artworks SET image_web_url ...\`)` call (lines ~242-251) with:

```ts
    webUrl = await uploadPublic(webKey, derived.buf, derived.contentType);
    await copyAndDeletePrivate(input.stagedKey, printKey);
    await withTransaction(async (tx) => {
      await tx.query(
        `UPDATE artworks
         SET image_web_url   = $1,
             image_print_url = $2,
             print_width     = $3,
             print_height    = $4,
             updated_at      = NOW()
         WHERE id = $5`,
        [webUrl, printKey, derived.masterWidth, derived.masterHeight, artworkId],
      );
      // Variants exist only after a template is applied; refresh is a no-op
      // until then, and re-runs correctly once they do.
      await refreshVariantResolution(tx, artworkId);
    });
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Manual verification** (per CLAUDE.md — R2/upload needs e2e). With `npm run dev`, upload a master to an existing artwork that already has variants via the bulk-upload page; then query that artwork's variants and confirm `min_resolution_ok` is now TRUE/FALSE (not NULL) per size. Run:
```bash
npx dotenv -e .env.local -- node -e "const pg=require('pg');(async()=>{const c=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:true}});await c.connect();const r=await c.query('SELECT size,min_resolution_ok,buyable FROM artwork_variants WHERE artwork_id=$1 ORDER BY size',[<ARTWORK_ID>]);console.log(r.rows);await c.end()})()"
```
Expected: rows show booleans matching the file's resolution.

- [ ] **Step 5: Commit**

```bash
git add "app/api/admin/artworks/bulk-upload/finalize/route.ts"
git commit -m "feat(resolution): recompute variant resolution on master upload"
```

---

## Task 5: `[id]` route — template carry-forward + re-measure on master change

**Files:**
- Create: `lib/measure-master.ts`
- Modify: `app/api/admin/artworks/[id]/route.ts`

- [ ] **Step 1: Create the shared dims-measurer** — `lib/measure-master.ts`:

```ts
import sharp from 'sharp';
import { getPrivateBuffer } from './r2';

/**
 * Read a print master from R2 and return its orientation-corrected pixel
 * dimensions. Mirrors scripts/backfill-print-dims.ts so every path that
 * changes a master measures it the same way.
 */
export async function measureMasterDims(
  key: string,
): Promise<{ width: number; height: number }> {
  if (!key.startsWith('artworks-print/')) {
    throw new Error(`refusing to measure non-print key: ${key}`);
  }
  const buf = await getPrivateBuffer(key);
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) throw new Error('no dimensions read');
  const rotated = (meta.orientation ?? 1) >= 5 && (meta.orientation ?? 1) <= 8;
  return rotated
    ? { width: meta.height, height: meta.width }
    : { width: meta.width, height: meta.height };
}
```

- [ ] **Step 2: Import into the `[id]` route** — add to imports of `app/api/admin/artworks/[id]/route.ts`:

```ts
import { refreshVariantResolution } from '@/lib/variant-resolution';
import { measureMasterDims } from '@/lib/measure-master';
import { logger } from '@/lib/logger';
```

- [ ] **Step 3: Re-measure when `image_print_url` changes** — inside the `withTransaction` block in PATCH, immediately AFTER the `if (updateCols.length) { ... }` block and BEFORE the `if (d.applyTemplate)` block, add:

```ts
      // A changed master must re-measure dims (the PATCH only validates the
      // key shape) and re-evaluate every size, else the gate uses stale dims.
      if (d.image_print_url) {
        try {
          const { width, height } = await measureMasterDims(d.image_print_url);
          await client.query(
            `UPDATE artworks SET print_width = $1, print_height = $2 WHERE id = $3`,
            [width, height, id],
          );
        } catch (err) {
          logger.warn('artwork PATCH: could not measure new master; dims set NULL', {
            id,
            key: d.image_print_url,
            err,
          });
          await client.query(
            `UPDATE artworks SET print_width = NULL, print_height = NULL WHERE id = $1`,
            [id],
          );
        }
        await refreshVariantResolution(client, id);
      }
```

- [ ] **Step 4: Carry overrides forward + recompute on template re-apply** — replace the existing `if (d.applyTemplate) { ... }` block (lines ~123-137) with:

```ts
      if (d.applyTemplate) {
        const variants = applyTemplate(d.applyTemplate as TemplateKey);
        // Preserve any prior override / manual-active choices so re-applying a
        // template (e.g. to fix a price) does not silently reset them.
        const prior = await client.query<{
          type: string;
          size: string;
          finish: string | null;
          active: boolean;
          resolution_override: boolean;
        }>(
          `SELECT type, size, finish, active, resolution_override
           FROM artwork_variants WHERE artwork_id = $1`,
          [id],
        );
        const keyOf = (t: string, s: string, f: string | null) => `${t}|${s}|${f ?? ''}`;
        const carry = new Map(
          prior.rows.map((r) => [
            keyOf(r.type, r.size, r.finish),
            { active: r.active, override: r.resolution_override },
          ]),
        );
        await client.query('DELETE FROM artwork_variants WHERE artwork_id = $1', [id]);
        for (const v of variants) {
          const prev = carry.get(keyOf(v.type, v.size, v.finish));
          await client.query(
            `INSERT INTO artwork_variants
               (artwork_id, type, size, finish, price_cents, cost_cents, active, resolution_override)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              id, v.type, v.size, v.finish, v.price_cents, v.cost_cents,
              prev?.active ?? true,
              prev?.override ?? false,
            ],
          );
        }
        await refreshVariantResolution(client, id);
      }
```

> Note: this switches from the previous "UPDATE … SET active=FALSE then INSERT" (which orphaned old rows) to DELETE + re-INSERT. `order_items.variant_id` is `ON DELETE SET NULL` and orders snapshot their line items, so historical orders are unaffected; the DELETE only removes catalog rows. This is safe and keeps one row per `(type,size,finish)`.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Manual verification.** With `npm run dev`: (a) on an artwork, override a blocked size, re-apply the same template, and confirm the override survives; (b) PATCH a new `image_print_url` and confirm `print_width`/`print_height` and `min_resolution_ok` update.

- [ ] **Step 7: Commit**

```bash
git add lib/measure-master.ts "app/api/admin/artworks/[id]/route.ts"
git commit -m "feat(resolution): carry overrides across template re-apply; re-measure on master change"
```

---

## Task 6: Variant override / active PATCH endpoint

**Files:**
- Create: `app/api/admin/artworks/[id]/variants/[variantId]/route.ts`

- [ ] **Step 1: Implement the endpoint**:

```ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool, parsePathId } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { requireSameOrigin } from '@/lib/origin-check';
import { logger } from '@/lib/logger';

const Body = z
  .object({
    resolution_override: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .refine((b) => b.resolution_override !== undefined || b.active !== undefined, {
    message: 'nothing to update',
  });

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; variantId: string }> },
) {
  await requireSameOrigin();
  await requireAdmin();
  const { id: rawId, variantId: rawV } = await ctx.params;
  const artworkId = parsePathId(rawId);
  const variantId = parsePathId(rawV);
  if (artworkId == null || variantId == null) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const d = parsed.data;

  const cols: string[] = [];
  const vals: unknown[] = [];
  if (d.resolution_override !== undefined) {
    cols.push(`resolution_override = $${vals.length + 1}`);
    vals.push(d.resolution_override);
  }
  if (d.active !== undefined) {
    cols.push(`active = $${vals.length + 1}`);
    vals.push(d.active);
  }
  // IDOR guard is part of the write: variant must belong to this artwork.
  vals.push(variantId, artworkId);
  const r = await pool.query(
    `UPDATE artwork_variants SET ${cols.join(', ')}
     WHERE id = $${vals.length - 1} AND artwork_id = $${vals.length}
     RETURNING id, size, active, resolution_override, min_resolution_ok, buyable`,
    vals,
  );
  if (!r.rowCount) {
    return NextResponse.json({ error: 'variant not found' }, { status: 404 });
  }
  logger.info('variant override/active changed', {
    artworkId,
    variantId,
    ...d,
    result: r.rows[0],
  });
  return NextResponse.json({ variant: r.rows[0] });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual verification.** With `npm run dev`, from the artwork detail page (after Task 9) or via a same-origin fetch, toggle `resolution_override` true→false on a blocked variant and confirm the returned `buyable` flips accordingly. A request with a `variantId` from a different artwork must 404.

- [ ] **Step 4: Commit**

```bash
git add "app/api/admin/artworks/[id]/variants/[variantId]/route.ts"
git commit -m "feat(resolution): admin variant override/active PATCH endpoint"
```

---

## Task 7: Switch customer surfaces to `buyable` + hide zero-buyable artworks

**Files:**
- Modify: `app/(shop)/shop/page.tsx`, `app/(shop)/shop/collections/[slug]/page.tsx`, `app/(shop)/shop/artwork/[slug]/page.tsx`, `app/api/checkout/route.ts`, `lib/printful-sync.ts`

- [ ] **Step 1: Home/shop grid (`shop/page.tsx`)** — in the plates query (~lines 30-43): change the min-price subquery `AND v.active = TRUE` → `AND v.buyable`, and add a visibility gate so an all-blocked piece never appears. Replace the `WHERE a.status = 'published'` line with:

```sql
       WHERE a.status = 'published'
         AND EXISTS (SELECT 1 FROM artwork_variants v
                       WHERE v.artwork_id = a.id AND v.buyable)
```
and change the subquery line to:
```sql
              (SELECT MIN(price_cents) FROM artwork_variants v
                 WHERE v.artwork_id = a.id AND v.buyable) AS min_price_cents
```

- [ ] **Step 2: Collection grid (`collections/[slug]/page.tsx:37-44`)** — same two changes:

```sql
    `SELECT a.slug, a.title, a.image_web_url, a.year_shot, a.location,
            (SELECT MIN(price_cents) FROM artwork_variants v
                WHERE v.artwork_id = a.id AND v.buyable) AS min_price_cents
     FROM artworks a
     WHERE a.collection_id = $1 AND a.status = 'published'
       AND EXISTS (SELECT 1 FROM artwork_variants v
                     WHERE v.artwork_id = a.id AND v.buyable)
     ORDER BY a.display_order, a.id`,
```

- [ ] **Step 3: Artwork detail (`artwork/[slug]/page.tsx`)** — (a) the offered-variants query (line 98) `AND active = TRUE` → `AND buyable`; (b) the related-artworks min-price subquery (line 106) `AND v.active = TRUE` → `AND v.buyable`; (c) after `const variants = variantsRes.rows;` (line 116), add a zero-buyable guard so a direct URL to an all-blocked piece 404s:

```ts
  const variants = variantsRes.rows;
  // An all-blocked published piece is not for sale — keep it out of the shop
  // entirely (matches the grid's EXISTS filter). It reappears automatically
  // once a size becomes buyable.
  if (variants.length === 0) notFound();
```

- [ ] **Step 4: Checkout (`app/api/checkout/route.ts`)** — change the variant lookup (line 56) and give a clearer message. Replace lines 47-67 with:

```ts
    const result = await pool.query<VariantRow & { published: boolean; buyable: boolean }>(
      `SELECT v.id, v.price_cents, v.cost_cents, v.printful_sync_variant_id,
              v.type, v.size, v.finish, v.artwork_id,
              a.title AS artwork_title, a.slug AS artwork_slug,
              a.image_web_url, a.image_print_url,
              c.title AS collection_title,
              (a.status = 'published') AS published,
              v.buyable AS buyable
       FROM artwork_variants v
       JOIN artworks a ON a.id = v.artwork_id
       LEFT JOIN collections c ON c.id = a.collection_id
       WHERE v.id = ANY($1::int[])`,
      [ids],
    );
    rows = result.rows;
  } catch (err) {
    logger.error('checkout variant lookup failed', err);
    return NextResponse.json({ error: 'checkout_init_failed' }, { status: 502 });
  }

  const sellable = rows.filter((r) => r.published && r.buyable);
  if (sellable.length !== ids.length) {
    const blocked = rows.find((r) => r.published && !r.buyable);
    return NextResponse.json(
      {
        error: blocked
          ? `"${blocked.artwork_title}" isn't available in ${blocked.size} right now.`
          : 'some items unavailable',
      },
      { status: 400 },
    );
  }
```

> Keep the rest of the route unchanged (it already builds `byId` from `rows`; with the guard above, every requested id is published + buyable).

- [ ] **Step 5: Printful sync (`lib/printful-sync.ts:41`)** — change `AND active = TRUE` → `AND buyable` so only buyable (incl. overridden) variants are provisioned.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Manual verification.** No data is blocked yet (all `min_resolution_ok` NULL ⇒ buyable ≡ active), so the shop must look **identical** to before. With `npm run dev`, load `/shop`, a collection, and an artwork page — all render as before. (Enforcement engages only at Task 10's apply step.)

- [ ] **Step 8: Commit**

```bash
git add "app/(shop)/shop/page.tsx" "app/(shop)/shop/collections/[slug]/page.tsx" "app/(shop)/shop/artwork/[slug]/page.tsx" "app/api/checkout/route.ts" lib/printful-sync.ts
git commit -m "feat(resolution): gate shop, checkout, and sync on buyable; hide zero-buyable pieces"
```

---

## Task 8: Admin list — `buyable` + resolution badge data

**Files:**
- Modify: `app/api/admin/artworks/route.ts:43-48`

- [ ] **Step 1: Switch counts/prices to `buyable` and add badge aggregates** — replace the three subqueries (lines 43-48) with:

```sql
            (SELECT COUNT(*)::int FROM artwork_variants v
              WHERE v.artwork_id = a.id AND v.buyable) AS variant_count,
            (SELECT MIN(price_cents) FROM artwork_variants v
              WHERE v.artwork_id = a.id AND v.buyable) AS min_price_cents,
            (SELECT MAX(price_cents) FROM artwork_variants v
              WHERE v.artwork_id = a.id AND v.buyable) AS max_price_cents,
            (SELECT COUNT(*)::int FROM artwork_variants v
              WHERE v.artwork_id = a.id) AS total_variant_count,
            (SELECT bool_or(v.min_resolution_ok IS NULL) FROM artwork_variants v
              WHERE v.artwork_id = a.id) AS has_unmeasured,
            (SELECT bool_and(v.min_resolution_ok IS NOT FALSE) FROM artwork_variants v
              WHERE v.artwork_id = a.id) AS all_sizes_ok
```

> `variant_count` (buyable) drives the price-range/badge; `total_variant_count` distinguishes "0 buyable of 6" (blocked) from "no variants yet" (un-templated). `has_unmeasured`/`all_sizes_ok` feed the badge in Task 9.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/api/admin/artworks/route.ts"
git commit -m "feat(resolution): admin list reads buyable + resolution badge aggregates"
```

---

## Task 9: Admin UI — per-size panel, override toggle, list badge

**Files:**
- Modify: `app/admin/artworks/[id]/page.tsx`, `app/admin/artworks/page.tsx`

- [ ] **Step 1: Surface the new variant fields in the detail GET type.** In `app/admin/artworks/[id]/page.tsx`, find the `Variant` type used for `data.variants` and add the fields the GET now returns (the GET at `app/api/admin/artworks/[id]/route.ts:30-33` is `SELECT *`, so `min_resolution_ok`, `resolution_override`, `buyable` are already returned). Extend the local type:

```ts
interface Variant {
  id: number;
  type: string;
  size: string;
  finish: string | null;
  price_cents: number;
  active: boolean;
  min_resolution_ok: boolean | null;
  resolution_override: boolean;
  buyable: boolean;
}
```

- [ ] **Step 2: Replace the `activeVariants` count (line 151) with a buyable count:**

```ts
  const buyableVariants = data.variants.filter((v) => v.buyable).length;
```
and update its single usage in the JSX (the header count) to `buyableVariants`.

- [ ] **Step 3: Add a size-resolution panel.** Near the variant/template section of the page, render each variant with its per-size verdict and an override control. Add this block (uses `a.print_width`/`a.print_height` already in scope and `evaluateSizeResolution`):

```tsx
{a.print_width && a.print_height && data.variants.length > 0 && (
  <div className="wl-adm-size-gate">
    <div className="head">
      Print sizes · master {a.print_width}×{a.print_height} · floor {MIN_DPI} DPI
    </div>
    {data.variants.map((v) => {
      const ev = evaluateSizeResolution(a.print_width!, a.print_height!, v.size);
      const state = v.buyable ? (v.resolution_override ? 'override' : 'ok') : 'blocked';
      return (
        <div key={v.id} className={`row res-${state}`}>
          <span className="size">{v.type} · {v.size}</span>
          <span className="dpi">{ev.effectiveDpi} DPI</span>
          <span className="msg">
            {state === 'override' ? 'offered (override)' : v.buyable ? 'offered' : ev.message}
          </span>
          {!ev.ok && (
            <button
              type="button"
              disabled={savingVariant === v.id}
              onClick={() => toggleOverride(v.id, !v.resolution_override)}
            >
              {v.resolution_override ? 'Remove override' : 'Override'}
            </button>
          )}
        </div>
      );
    })}
    {data.variants.every((v) => !v.buyable) && (
      <div className="row res-blocked">
        ⚠ No size meets the {MIN_DPI}-DPI floor — this piece is hidden from the
        shop until you re-upload a larger master or override a size.
      </div>
    )}
  </div>
)}
```

- [ ] **Step 4: Add the toggle handler + import.** Add `import { evaluateSizeResolution, MIN_DPI } from '@/lib/print-resolution';` and, alongside the component's other state, add a saving flag and the handler:

```ts
const [savingVariant, setSavingVariant] = useState<number | null>(null);

async function toggleOverride(variantId: number, next: boolean) {
  if (next && !confirm('Offer this size despite low resolution? It will print soft.')) return;
  setSavingVariant(variantId);
  try {
    const res = await fetch(`/api/admin/artworks/${a.id}/variants/${variantId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolution_override: next }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setSaveError(j.error || 'Could not update size.'); // reuse existing error state
      return;
    }
    await load(); // existing refetch used elsewhere on this page
  } finally {
    setSavingVariant(null);
  }
}
```

> If the page's existing error state isn't named `setSaveError`, use whatever the page already uses (grep the file for the pattern used by `save(...)`); reuse it rather than adding a new toast.

- [ ] **Step 5: Reminder copy for the Printful step.** When `v.resolution_override` is true but `v.buyable` is true and the variant has no `printful_sync_variant_id`, the order would hit `needs_review`. Add a one-line note under an overridden row: `"Run sync:printful to make this size orderable."` (The GET already returns `printful_sync_variant_id` via `SELECT *`; add it to the `Variant` type and gate the note on it being null.)

- [ ] **Step 6: List badge (`app/admin/artworks/page.tsx`).** The list endpoint now returns `total_variant_count`, `variant_count` (buyable), `has_unmeasured`, `all_sizes_ok`. Add a badge per row:

```tsx
function ResBadge({ a }: { a: { total_variant_count: number; variant_count: number; has_unmeasured: boolean | null; all_sizes_ok: boolean | null } }) {
  if (a.total_variant_count === 0) return <span className="wl-badge muted">no sizes</span>;
  if (a.has_unmeasured) return <span className="wl-badge muted">— unmeasured</span>;
  if (a.variant_count === 0) return <span className="wl-badge warn">⚠ blocked</span>;
  if (a.all_sizes_ok) return <span className="wl-badge ok">all sizes ✓</span>;
  return <span className="wl-badge warn">⚠ {a.variant_count} of {a.total_variant_count}</span>;
}
```
Render `<ResBadge a={row} />` in each list row and extend the row type with the four fields.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Manual verification.** With `npm run dev`, open an artwork with a low-res master: the panel shows per-size DPI + blocked reasons; clicking Override flips the row to "offered (override)" and the badge/price update after refetch.

- [ ] **Step 9: Commit**

```bash
git add "app/admin/artworks/[id]/page.tsx" "app/admin/artworks/page.tsx"
git commit -m "feat(resolution): admin size-gate panel, override toggle, list badge"
```

---

## Task 10: Recompute script + backfill hook

**Files:**
- Create: `scripts/recompute-variant-resolution.ts`
- Modify: `scripts/backfill-print-dims.ts`, `package.json`

- [ ] **Step 1: Recompute script with dry-run/apply** — `scripts/recompute-variant-resolution.ts`:

```ts
import 'dotenv/config';
import { pool, withTransaction } from '../lib/db';
import { evaluateSizeResolution } from '../lib/print-resolution';
import { refreshVariantResolution } from '../lib/variant-resolution';

const APPLY = process.argv.includes('--apply');

interface Row {
  artwork_id: number;
  title: string;
  status: string;
  print_width: number | null;
  print_height: number | null;
  variant_id: number;
  size: string;
  min_resolution_ok: boolean | null;
}

async function main() {
  const { rows } = await pool.query<Row>(
    `SELECT a.id AS artwork_id, a.title, a.status, a.print_width, a.print_height,
            v.id AS variant_id, v.size, v.min_resolution_ok
     FROM artwork_variants v JOIN artworks a ON a.id = v.artwork_id
     ORDER BY a.status, a.id, v.size`,
  );

  // Group by artwork; report which would drop to zero buyable (vanish from shop).
  const byArtwork = new Map<number, Row[]>();
  for (const r of rows) {
    if (!byArtwork.has(r.artwork_id)) byArtwork.set(r.artwork_id, []);
    byArtwork.get(r.artwork_id)!.push(r);
  }

  let willBlock = 0;
  const vanishing: string[] = [];
  for (const [, group] of byArtwork) {
    const a = group[0];
    if (a.print_width == null || a.print_height == null) continue;
    let anyOk = false;
    for (const v of group) {
      const ok = evaluateSizeResolution(a.print_width, a.print_height, v.size).ok;
      if (ok) anyOk = true;
      if (!ok && v.min_resolution_ok !== false) willBlock++;
    }
    if (!anyOk) vanishing.push(`  [${a.status}] ${a.title} (#${a.artwork_id})`);
  }

  console.log(`${rows.length} variants across ${byArtwork.size} artworks.`);
  console.log(`Sizes that will become blocked: ${willBlock}`);
  console.log(`Artworks that will have NO buyable size (vanish from shop):`);
  console.log(vanishing.length ? vanishing.join('\n') : '  (none)');

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write min_resolution_ok.');
    await pool.end();
    return;
  }

  for (const artworkId of byArtwork.keys()) {
    await withTransaction((tx) => refreshVariantResolution(tx, artworkId));
  }
  console.log('\nApplied. min_resolution_ok written for all variants.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Hook recompute into the dims backfill** — in `scripts/backfill-print-dims.ts`, after the `UPDATE artworks SET print_width...` succeeds for a row, recompute that artwork. Add the import `import { withTransaction } from '../lib/db';` and `import { refreshVariantResolution } from '../lib/variant-resolution';`, then after the existing per-row `UPDATE` add:

```ts
      await withTransaction((tx) => refreshVariantResolution(tx, row.id));
```

- [ ] **Step 3: Add the npm script** — in `package.json` scripts:

```json
    "recompute:resolution": "tsx scripts/recompute-variant-resolution.ts",
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Dry-run against the real catalog**

Run: `npx dotenv -e .env.local -- npm run recompute:resolution`
Expected: prints the blocked-size count and the list of artworks that would vanish (should include *Gulls at Dusk*, *Sail Against the Sun* clears only 8×10, etc., matching the spec's expected impact). **Writes nothing.**

- [ ] **Step 6: Commit**

```bash
git add scripts/recompute-variant-resolution.ts scripts/backfill-print-dims.ts package.json
git commit -m "feat(resolution): recompute script (dry-run/apply) + backfill recompute hook"
```

---

## Task 11: Rollout (manual, ordered)

No code — execute against the deployed app in this order. Each step is reversible (revert = nothing has blocked until 11.4 applies).

- [ ] **Step 1: Ship Tasks 1–9.** Migration runs at build (`tsx lib/migrate.ts && next build`); columns land, `buyable ≡ active`, shop unchanged. Verify the shop visually matches production.

- [ ] **Step 2: Measure the 27 unmeasured masters.**

Run: `npx dotenv -e .env.local -- npm run backfill:print-dims`
Expected: fills `print_width`/`print_height` for the unmeasured pieces (incl. the 8 published) and recomputes each. *Egret, Lifting Off* logs an R2 "key does not exist" error and is skipped — expected (dangling master); it stays unmeasured/fail-open.

- [ ] **Step 3: Dry-run the recompute and review.**

Run: `npx dotenv -e .env.local -- npm run recompute:resolution`
Expected: review the "vanish from shop" list with Dan before applying.

- [ ] **Step 4: Apply.**

Run: `npx dotenv -e .env.local -- npm run recompute:resolution -- --apply`
Expected: `min_resolution_ok` written for every variant; enforcement now live. Verify: *Gulls at Dusk* is gone from `/shop` and its URL 404s; *Sail Against the Sun* offers only 8×10; the four clean pieces are unchanged.

- [ ] **Step 5: Re-sync Printful for any overrides.** If Dan overrode any blocked size, run `npm run sync:printful <artworkId>` so it gets a `printful_sync_variant_id` before it can be ordered.

---

## Self-Review notes

- **Spec coverage:** evaluator (T1), recompute chokepoint (T2), schema+generated buyable (T3), upload capture (T4), template carry-forward + re-measure (T5), override endpoint (T6), customer gating + zero-buyable hide (T7), admin list+badge (T8), admin panel+override UI (T9), dry-run/apply + backfill hook (T10), staged rollout (T11). All spec sections mapped.
- **Names are consistent:** `evaluateSizeResolution`, `maxSupportedSize`, `MIN_DPI`, `refreshVariantResolution`, `measureMasterDims`, `buyable`, `min_resolution_ok`, `resolution_override` used identically across tasks.
- **Observability:** `logger.info` in the recompute and the variant PATCH (no `admin_audit_log` table exists — not invented).
- **Reversibility:** revert = change `buyable` filters back to `active`; data preserved; `min_resolution_ok` can be reset to NULL to fully disengage.
