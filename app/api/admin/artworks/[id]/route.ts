export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool, parsePathId, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { applyTemplate, type TemplateKey } from '@/lib/variant-templates';
import { publishArtworks } from '@/lib/publish-artworks';
import { ConflictError, NotFoundError } from '@/lib/errors';

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
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = parsePathId(raw);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const d = parsed.data;

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
      if (d.applyTemplate) {
        const variants = applyTemplate(d.applyTemplate as TemplateKey);
        await client.query(
          'UPDATE artwork_variants SET active = FALSE WHERE artwork_id = $1',
          [id],
        );
        for (const v of variants) {
          await client.query(
            `INSERT INTO artwork_variants
               (artwork_id, type, size, finish, price_cents, cost_cents, active)
             VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
            [id, v.type, v.size, v.finish, v.price_cents, v.cost_cents],
          );
        }
      }
    });
  } catch (err) {
    if (err instanceof ConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = parsePathId(raw);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  await pool.query('DELETE FROM artworks WHERE id = $1', [id]);
  return NextResponse.json({ ok: true });
}
