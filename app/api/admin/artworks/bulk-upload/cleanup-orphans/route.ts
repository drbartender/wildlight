export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export async function GET() {
  await requireAdmin();
  const r = await pool.query<{ id: number; slug: string; title: string }>(
    `SELECT id, slug, title FROM artworks
     WHERE status = 'published' AND image_print_url IS NULL
     ORDER BY id`,
  );
  return NextResponse.json({ count: r.rowCount, rows: r.rows });
}

export async function POST() {
  await requireAdmin();
  const r = await pool.query<{ slug: string }>(
    `UPDATE artworks
     SET status = 'draft', updated_at = NOW()
     WHERE status = 'published' AND image_print_url IS NULL
     RETURNING slug`,
  );
  return NextResponse.json({
    demoted: r.rowCount ?? 0,
    slugs: r.rows.map((row) => row.slug),
  });
}
