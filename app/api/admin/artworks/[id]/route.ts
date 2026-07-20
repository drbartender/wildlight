export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool, parsePathId, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { requireSameOrigin } from '@/lib/origin-check';
import { applyTemplate, type TemplateKey } from '@/lib/variant-templates';
import { publishArtworks } from '@/lib/publish-artworks';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { refreshVariantResolution } from '@/lib/variant-resolution';
import { measureMasterDims } from '@/lib/measure-master';
import { logger } from '@/lib/logger';

function isFkViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23503';
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = parsePathId(raw);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const [a, v, e] = await Promise.all([
    pool.query(
      `SELECT a.*, c.title AS collection_title
       FROM artworks a LEFT JOIN collections c ON c.id = a.collection_id
       WHERE a.id = $1`,
      [id],
    ),
    pool.query(
      `SELECT * FROM artwork_variants WHERE artwork_id = $1 ORDER BY type, price_cents`,
      [id],
    ),
    pool.query<{ sold: number }>(
      `SELECT COUNT(oi.id)::int AS sold
       FROM order_items oi
       JOIN artwork_variants vv ON vv.id = oi.variant_id
       JOIN orders o ON o.id = oi.order_id
       WHERE vv.artwork_id = $1
         AND o.status NOT IN ('canceled', 'refunded')`,
      [id],
    ),
  ]);
  if (!a.rowCount) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({
    artwork: a.rows[0],
    variants: v.rows,
    soldCount: e.rows[0]?.sold ?? 0,
  });
}

const Patch = z.object({
  title: z.string().min(1).max(200).optional(),
  artist_note: z.string().max(5000).nullable().optional(),
  year_shot: z.number().int().min(1900).max(2100).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  status: z.enum(['draft', 'published', 'retired']).optional(),
  collection_id: z.number().int().nullable().optional(),
  display_order: z.number().int().optional(),
  on_wall: z.boolean().optional(),
  edition_size: z.number().int().positive().nullable().optional(),
  signed: z.boolean().optional(),
  // Keys live under `artworks-print/<collection-or-id>/<slug>.<ext>`; enforce
  // the prefix + sane characters so an admin PATCH can't stash an arbitrary
  // string (e.g. a URL) that later gets passed to the R2 signer.
  image_print_url: z
    .string()
    .regex(/^artworks-print\/[a-z0-9/_.-]+\.(jpg|jpeg|png|tif|tiff)$/i)
    .max(300)
    .nullable()
    .optional(),
  applyTemplate: z.enum(['fine_art', 'canvas', 'full']).optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireSameOrigin();
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = parsePathId(raw);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const d = parsed.data;

  // Measure a changed master OUTSIDE the transaction — getPrivateBuffer (R2)
  // + sharp decode is a multi-second network read; doing it inside
  // withTransaction would hold a Neon pool connection idle for its duration.
  // A null/failed measure leaves dims NULL (fail-open / unmeasured).
  let newDims: { width: number; height: number } | null = null;
  let measureFailed = false;
  if (d.image_print_url) {
    try {
      newDims = await measureMasterDims(d.image_print_url);
    } catch (err) {
      logger.warn('artwork PATCH: could not measure new master; dims set NULL', {
        id,
        key: d.image_print_url,
        err,
      });
      newDims = null;
      measureFailed = true;
    }
  }

  try {
    await withTransaction(async (client) => {
      // status='published' goes through the shared publish gate so the
      // print-master invariant + first-publish published_at stamp stay in
      // one place (also used by the bulk endpoint and publish-selections).
      if (d.status === 'published') {
        const out = await publishArtworks(client, [id]);
        if (out.skipped > 0) {
          throw new ConflictError('cannot publish: print master required');
        }
      }

      const updateCols: string[] = [];
      const vals: unknown[] = [];
      for (const [k, v] of Object.entries(d)) {
        if (k === 'applyTemplate' || v === undefined) continue;
        // Helper already wrote status + published_at + updated_at.
        if (k === 'status' && v === 'published') continue;
        updateCols.push(`${k} = $${vals.length + 1}`);
        vals.push(v);
      }
      // Toggling wall membership clears any saved arrangement position, so a
      // piece taken off the wall and later put back sorts to the END of the
      // public wall (which orders by wall_order) until explicitly re-arranged —
      // instead of resurfacing mid-wall on its stale wall_order. Constant 0, no
      // param; column names come from the fixed Zod schema, never user keys.
      if (d.on_wall !== undefined) {
        updateCols.push('wall_order = 0');
      }
      if (updateCols.length) {
        vals.push(id);
        const u = await client.query(
          `UPDATE artworks SET ${updateCols.join(', ')}, updated_at=NOW()
           WHERE id = $${vals.length}`,
          vals,
        );
        if (!u.rowCount && d.status !== 'published') {
          // No row matched and the publish helper didn't already prove the row
          // exists — surface 404 rather than a silent no-op.
          throw new NotFoundError();
        }
      }
      // A changed master re-evaluates every size against the dims measured
      // above (null when cleared or unmeasurable). `image_print_url: undefined`
      // = not touched; null = cleared; a string = new key (measured already).
      if (d.image_print_url !== undefined) {
        await client.query(
          `UPDATE artworks SET print_width = $1, print_height = $2 WHERE id = $3`,
          [newDims?.width ?? null, newDims?.height ?? null, id],
        );
        await refreshVariantResolution(client, id);
      }

      if (d.applyTemplate) {
        const variants = applyTemplate(d.applyTemplate as TemplateKey);
        const keyOf = (t: string, s: string, f: string | null) => `${t}|${s}|${f ?? ''}`;
        const wanted = new Set(variants.map((v) => keyOf(v.type, v.size, v.finish)));

        // UPSERT — never DELETE. Deleting would null out order_items.variant_id
        // (ON DELETE SET NULL) for sold sizes and drop the Printful linkage
        // (printful_sync_variant_id) and the variant id. Instead: deactivate
        // rows no longer in the template, then update-or-insert each template
        // row. Existing rows keep their id, resolution_override, and
        // printful_sync_variant_id; overrides therefore survive automatically.
        const existing = await client.query<{
          id: number;
          type: string;
          size: string;
          finish: string | null;
        }>(
          `SELECT id, type, size, finish FROM artwork_variants WHERE artwork_id = $1`,
          [id],
        );
        for (const row of existing.rows) {
          if (!wanted.has(keyOf(row.type, row.size, row.finish))) {
            await client.query(
              'UPDATE artwork_variants SET active = FALSE WHERE id = $1',
              [row.id],
            );
          }
        }
        for (const v of variants) {
          // finish may be NULL — IS NOT DISTINCT FROM matches NULL=NULL.
          const upd = await client.query(
            `UPDATE artwork_variants
             SET price_cents = $1, cost_cents = $2, active = TRUE
             WHERE artwork_id = $3 AND type = $4 AND size = $5
               AND finish IS NOT DISTINCT FROM $6`,
            [v.price_cents, v.cost_cents, id, v.type, v.size, v.finish],
          );
          if (!upd.rowCount) {
            await client.query(
              `INSERT INTO artwork_variants
                 (artwork_id, type, size, finish, price_cents, cost_cents, active)
               VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
              [id, v.type, v.size, v.finish, v.price_cents, v.cost_cents],
            );
          }
        }
        await refreshVariantResolution(client, id);
      }
    });
  } catch (err) {
    if (err instanceof ConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    if (isFkViolation(err)) {
      // e.g. collection_id pointing at a deleted collection. The FK rejects
      // before our update lands; surface as a friendly 400 instead of 500.
      return NextResponse.json(
        { error: 'referenced row does not exist' },
        { status: 400 },
      );
    }
    throw err;
  }

  return NextResponse.json(
    measureFailed
      ? {
          ok: true,
          warning:
            'master could not be measured — sizes are unverified',
        }
      : { ok: true },
  );
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireSameOrigin();
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = parsePathId(raw);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  // Block a hard delete when ANY order_items reference this artwork's
  // variants — including canceled and refunded orders.
  //
  // Two reasons this must not filter on order status:
  //  1. order_items.variant_id is ON DELETE SET NULL and artwork_variants
  //     cascades from artworks, so deleting SILENTLY severs the link to
  //     historical sales. The isFkViolation 409 below can therefore never fire
  //     for order history — it is not a backstop.
  //  2. A refunded order is still order history. Severing it corrupts every
  //     live join, including this very guard for future deletes.
  // Steer admins to "Retire" instead, which preserves everything.
  //
  // Check + delete run in one transaction so an order landing between them
  // can't slip past the guard.
  try {
    await withTransaction(async (client) => {
      const { rows } = await client.query<{ has_orders: boolean }>(
        `SELECT EXISTS (
           SELECT 1
             FROM order_items oi
             JOIN artwork_variants vv ON vv.id = oi.variant_id
            WHERE vv.artwork_id = $1
         ) AS has_orders`,
        [id],
      );
      if (rows[0]?.has_orders) {
        throw new ConflictError(
          'Cannot delete: this artwork has order history. Retire it instead to hide it from the shop while preserving that history.',
        );
      }
      await client.query('DELETE FROM artworks WHERE id = $1', [id]);
    });
  } catch (err) {
    if (err instanceof ConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (isFkViolation(err)) {
      return NextResponse.json(
        { error: 'Cannot delete: artwork is still referenced. Retire it instead.' },
        { status: 409 },
      );
    }
    throw err;
  }
  return NextResponse.json({ ok: true });
}
