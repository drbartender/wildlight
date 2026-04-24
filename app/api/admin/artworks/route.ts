export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export async function GET(req: Request) {
  await requireAdmin();
  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const collection = url.searchParams.get('collection');
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (status) {
    clauses.push(`a.status = $${params.length + 1}`);
    params.push(status);
  }
  if (collection) {
    clauses.push(`c.slug = $${params.length + 1}`);
    params.push(collection);
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const { rows } = await pool.query(
    `SELECT a.id, a.slug, a.title, a.status, a.image_web_url, a.image_print_url,
            a.artist_note, a.year_shot, a.location,
            a.updated_at,
            c.title AS collection_title, c.slug AS collection_slug,
            (SELECT COUNT(*)::int FROM artwork_variants v
              WHERE v.artwork_id = a.id AND v.active) AS variant_count,
            (SELECT MIN(price_cents) FROM artwork_variants v
              WHERE v.artwork_id = a.id AND v.active) AS min_price_cents,
            (SELECT MAX(price_cents) FROM artwork_variants v
              WHERE v.artwork_id = a.id AND v.active) AS max_price_cents
     FROM artworks a
     LEFT JOIN collections c ON c.id = a.collection_id
     ${where}
     ORDER BY a.updated_at DESC LIMIT 1000`,
    params,
  );
  return NextResponse.json({ rows });
}

const BulkBody = z.object({
  ids: z.array(z.number().int()).min(1),
  action: z.enum(['publish', 'retire', 'delete', 'move']),
  collectionId: z.number().int().optional(),
});

export async function POST(req: Request) {
  await requireAdmin();
  const parsed = BulkBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const { ids, action, collectionId } = parsed.data;
  if (action === 'publish') {
    await pool.query(
      `UPDATE artworks SET status='published', updated_at=NOW() WHERE id = ANY($1)`,
      [ids],
    );
  } else if (action === 'retire') {
    await pool.query(
      `UPDATE artworks SET status='retired', updated_at=NOW() WHERE id = ANY($1)`,
      [ids],
    );
  } else if (action === 'delete') {
    await pool.query('DELETE FROM artworks WHERE id = ANY($1)', [ids]);
  } else if (action === 'move') {
    if (!collectionId) {
      return NextResponse.json({ error: 'collectionId required' }, { status: 400 });
    }
    await pool.query(
      `UPDATE artworks SET collection_id=$2, updated_at=NOW() WHERE id = ANY($1)`,
      [ids, collectionId],
    );
  }
  return NextResponse.json({ ok: true });
}
