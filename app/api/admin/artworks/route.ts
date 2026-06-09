export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { requireSameOrigin } from '@/lib/origin-check';
import { publishArtworks } from '@/lib/publish-artworks';

function isFkViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23503';
}

export async function GET(req: Request) {
  await requireAdmin();
  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const collection = url.searchParams.get('collection');
  const needsPrint = url.searchParams.get('needs_print') === '1';
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
  if (needsPrint) {
    clauses.push('a.image_print_url IS NULL');
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  // Return `has_note` as a boolean instead of the full artist_note text.
  // The client only needs to count empties; shipping prose per row
  // bloats the payload for no rendering benefit.
  const { rows } = await pool.query(
    `SELECT a.id, a.slug, a.title, a.status, a.image_web_url, a.image_print_url,
            (a.artist_note IS NOT NULL AND length(trim(a.artist_note)) > 0) AS has_note,
            a.year_shot, a.location,
            a.updated_at,
            a.collection_id,
            c.title AS collection_title, c.slug AS collection_slug,
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
  await requireSameOrigin();
  await requireAdmin();
  const parsed = BulkBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const { ids, action, collectionId } = parsed.data;
  if (action === 'publish') {
    // Shared helper enforces the print-master invariant and stamps
    // published_at on first-publish — same gate as the per-artwork PATCH
    // and scripts/publish-selections.ts.
    const out = await withTransaction((client) =>
      publishArtworks(client, ids),
    );
    return NextResponse.json({
      ok: true,
      published: out.published,
      skipped: out.skipped,
    });
  } else if (action === 'retire') {
    await pool.query(
      `UPDATE artworks SET status='retired', updated_at=NOW() WHERE id = ANY($1)`,
      [ids],
    );
  } else if (action === 'delete') {
    // Same sold-count gate as the per-artwork DELETE — block the whole
    // batch if any selected artwork has live order_items references.
    const blocked = await pool.query<{ id: number; title: string }>(
      `SELECT a.id, a.title
       FROM artworks a
       WHERE a.id = ANY($1)
         AND EXISTS (
           SELECT 1 FROM order_items oi
           JOIN artwork_variants vv ON vv.id = oi.variant_id
           JOIN orders o ON o.id = oi.order_id
           WHERE vv.artwork_id = a.id
             AND o.status NOT IN ('canceled', 'refunded')
         )`,
      [ids],
    );
    if (blocked.rowCount && blocked.rowCount > 0) {
      const titles = blocked.rows
        .slice(0, 3)
        .map((r) => r.title)
        .join(', ');
      const more =
        blocked.rowCount > 3 ? ` and ${blocked.rowCount - 3} more` : '';
      return NextResponse.json(
        {
          error: `Cannot delete: ${titles}${more} ${blocked.rowCount === 1 ? 'has' : 'have'} sold orders. Retire instead.`,
        },
        { status: 409 },
      );
    }
    try {
      await pool.query('DELETE FROM artworks WHERE id = ANY($1)', [ids]);
    } catch (err) {
      if (isFkViolation(err)) {
        return NextResponse.json(
          { error: 'Cannot delete: one or more artworks are still referenced.' },
          { status: 409 },
        );
      }
      throw err;
    }
  } else if (action === 'move') {
    if (!collectionId) {
      return NextResponse.json({ error: 'collectionId required' }, { status: 400 });
    }
    try {
      await pool.query(
        `UPDATE artworks SET collection_id=$2, updated_at=NOW() WHERE id = ANY($1)`,
        [ids, collectionId],
      );
    } catch (err) {
      if (isFkViolation(err)) {
        return NextResponse.json(
          { error: 'Target collection does not exist.' },
          { status: 400 },
        );
      }
      throw err;
    }
  }
  return NextResponse.json({ ok: true });
}
