export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { slugify } from '@/lib/slug';

export async function GET() {
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
export async function POST(req: Request) {
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
export async function PATCH(req: Request) {
  await requireAdmin();
  const p = Patch.safeParse(await req.json().catch(() => null));
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

export async function DELETE(req: Request) {
  await requireAdmin();
  const body = (await req.json().catch(() => ({}))) as { id?: number };
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await pool.query('DELETE FROM collections WHERE id = $1', [body.id]);
  return NextResponse.json({ ok: true });
}
