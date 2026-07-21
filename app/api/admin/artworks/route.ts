export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { requireSameOrigin } from '@/lib/origin-check';
import { publishArtworks } from '@/lib/publish-artworks';
import { ConflictError } from '@/lib/errors';
import { adminRoute } from '@/lib/admin-route';

function isFkViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23503';
}

async function GET_impl(req: Request) {
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
            (SELECT bool_or(v.min_resolution_ok IS NULL AND NOT v.resolution_override)
               FROM artwork_variants v
              WHERE v.artwork_id = a.id) AS has_unmeasured,
            (SELECT bool_and(v.min_resolution_ok IS NOT FALSE OR v.resolution_override)
               FROM artwork_variants v
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

async function POST_impl(req: Request) {
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
    // Rule 1: zero both shop orders on the way out, so a piece that comes back
    // later appends rather than resurfacing on a stale position. Same reset the
    // per-artwork PATCH does, and what makes the publish path's unconditional
    // assignment safe.
    await pool.query(
      `UPDATE artworks
          SET status='retired', display_order = 0, collection_order = 0,
              updated_at=NOW()
        WHERE id = ANY($1)`,
      [ids],
    );
  } else if (action === 'delete') {
    // Same gate as the per-artwork DELETE: block the batch if ANY selected
    // artwork has order history — including canceled and refunded orders.
    // order_items.variant_id is ON DELETE SET NULL and artwork_variants
    // cascades from artworks, so deleting silently severs the link to those
    // orders and the isFkViolation catch below can never fire for them.
    // Filtering on order status here is what let a refunded-order artwork be
    // destroyed. Steer admins to Retire, which preserves the history.
    // Check + delete in one transaction, for parity with the per-artwork
    // DELETE (an order landing between the two statements can't slip past).
    try {
      await withTransaction(async (client) => {
        const blocked = await client.query<{ id: number; title: string }>(
          `SELECT a.id, a.title
           FROM artworks a
           WHERE a.id = ANY($1)
             AND EXISTS (
               SELECT 1 FROM order_items oi
               JOIN artwork_variants vv ON vv.id = oi.variant_id
               WHERE vv.artwork_id = a.id
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
          throw new ConflictError(
            `Cannot delete: ${titles}${more} ${blocked.rowCount === 1 ? 'has' : 'have'} order history. Retire instead.`,
          );
        }
        await client.query('DELETE FROM artworks WHERE id = ANY($1)', [ids]);
      });
    } catch (err) {
      if (err instanceof ConflictError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
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
      // The FK violation below can no longer be relied on to catch a bad
      // collection: when the t CTE is empty (every id already in the target, or
      // no id matched) the UPDATE touches zero rows, `collection_id = $2` is
      // never evaluated, and a move to a nonexistent collection would return
      // ok:true. Check explicitly.
      const target = await pool.query('SELECT 1 FROM collections WHERE id = $1', [
        collectionId,
      ]);
      if (!target.rowCount) {
        return NextResponse.json(
          { error: 'Target collection does not exist.' },
          { status: 400 },
        );
      }
      // Rule 3, batch-safe. This endpoint takes an ids[] and does one UPDATE,
      // so MAX + 1 would give every moved row the identical collection_order
      // and sort them as a clump at the FRONT of the target chapter. And
      // IS DISTINCT FROM in the t CTE means rows already in the target are not
      // touched at all: an empty t cross-joins to zero rows, the intended
      // no-op.
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

export const GET = adminRoute(GET_impl);
export const POST = adminRoute(POST_impl);
