export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { applyTemplate, type TemplateKey } from '@/lib/variant-templates';

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = parseId(raw);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const [a, v] = await Promise.all([
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
  ]);
  if (!a.rowCount) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ artwork: a.rows[0], variants: v.rows });
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
  const id = parseId(raw);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const d = parsed.data;

  await withTransaction(async (client) => {
    // If status is transitioning to 'published', stamp published_at.
    // We don't clear published_at when going back to draft/retired —
    // it's the last-published timestamp, not a current-state flag.
    let stampPublishedAt = false;
    if (d.status === 'published') {
      const prev = await client.query<{ status: string }>(
        'SELECT status FROM artworks WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (prev.rowCount && prev.rows[0].status !== 'published') {
        stampPublishedAt = true;
      }
    }

    const updateCols: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(d)) {
      if (k === 'applyTemplate' || v === undefined) continue;
      updateCols.push(`${k} = $${vals.length + 1}`);
      vals.push(v);
    }
    if (stampPublishedAt) {
      updateCols.push(`published_at = NOW()`);
    }
    if (updateCols.length) {
      vals.push(id);
      await client.query(
        `UPDATE artworks SET ${updateCols.join(', ')}, updated_at=NOW()
         WHERE id = $${vals.length}`,
        vals,
      );
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

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = parseId(raw);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  await pool.query('DELETE FROM artworks WHERE id = $1', [id]);
  return NextResponse.json({ ok: true });
}
