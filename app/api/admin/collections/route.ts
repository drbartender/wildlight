export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { slugify } from '@/lib/slug';
import { adminRoute } from '@/lib/admin-route';

async function GET_impl() {
  await requireAdmin();
  const { rows } = await pool.query(
    'SELECT * FROM collections ORDER BY display_order, id',
  );
  return NextResponse.json({ rows });
}

const Create = z.object({
  title: z.string().min(1).max(200),
  tagline: z.string().max(500).optional(),
});
async function POST_impl(req: Request) {
  await requireAdmin();
  const p = Create.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const slug = slugify(p.data.title);
  const r = await pool.query(
    `INSERT INTO collections (slug, title, tagline) VALUES ($1, $2, $3)
     ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, tagline = EXCLUDED.tagline
     RETURNING *`,
    [slug, p.data.title, p.data.tagline || null],
  );
  return NextResponse.json(r.rows[0]);
}

const Patch = z.object({
  id: z.number().int(),
  title: z.string().optional(),
  tagline: z.string().nullable().optional(),
  display_order: z.number().int().optional(),
  cover_image_url: z.string().nullable().optional(),
});
// Atomic reorder: the full ordered id list, written in ONE statement so a
// partial failure can never leave a mix of old and new display_order values
// (same pattern as POST /api/admin/wall).
const Reorder = z.object({
  order: z
    .array(z.number().int().positive())
    .min(1)
    .max(200)
    .refine((a) => new Set(a).size === a.length, 'duplicate ids'),
});
async function PATCH_impl(req: Request) {
  await requireAdmin();
  const body = await req.json().catch(() => null);
  const reorder = Reorder.safeParse(body);
  if (reorder.success) {
    await pool.query(
      `UPDATE collections c
          SET display_order = v.ord
         FROM (
           SELECT id, ord
             FROM unnest($1::int[]) WITH ORDINALITY AS t(id, ord)
         ) v
        WHERE c.id = v.id`,
      [reorder.data.order],
    );
    return NextResponse.json({ ok: true });
  }
  const p = Patch.safeParse(body);
  if (!p.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const { id, ...rest } = p.data;
  const entries = Object.entries(rest).filter(([, v]) => v !== undefined);
  if (!entries.length) return NextResponse.json({ ok: true });
  const sets = entries.map(([k], i) => `${k} = $${i + 1}`).join(', ');
  const params: unknown[] = entries.map(([, v]) => v);
  params.push(id);
  await pool.query(
    `UPDATE collections SET ${sets} WHERE id = $${params.length}`,
    params,
  );
  return NextResponse.json({ ok: true });
}

async function DELETE_impl(req: Request) {
  await requireAdmin();
  const body = (await req.json().catch(() => ({}))) as { id?: number };
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await pool.query('DELETE FROM collections WHERE id = $1', [body.id]);
  return NextResponse.json({ ok: true });
}

export const GET = adminRoute(GET_impl);
export const POST = adminRoute(POST_impl);
export const PATCH = adminRoute(PATCH_impl);
export const DELETE = adminRoute(DELETE_impl);
