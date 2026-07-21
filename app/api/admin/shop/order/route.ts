export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { requireSameOrigin } from '@/lib/origin-check';
import { logger } from '@/lib/logger';
import { adminRoute } from '@/lib/admin-route';

// Persist one SHOP scope's sequence. Scope 'all' writes display_order (the /shop
// order); scope 'collection' writes collection_order for that collection only.
// The two never write each other.
//
// The cap must stay >= the admin loader's LIMIT (app/admin/wall/page.tsx), or a
// large catalogue would POST more ids than Zod accepts and reordering would 400
// with no way to recover. Same invariant /api/admin/wall documents. Note the
// loader's LIMIT applies across ALL statuses while Guard B below counts
// published rows, so both must be raised together as the catalogue grows.
// .max on the id is an int4 bound, not decoration: z.number().int() is just
// Number.isInteger, so 2147483648 passes Zod, reaches $1::int[], and Postgres
// raises 22003 — a 500 and a Sentry exception for what is really a 400.
const Ids = z
  .array(z.number().int().positive().max(2147483647))
  .min(1)
  .max(1000)
  .refine((a) => new Set(a).size === a.length, 'duplicate ids');

const Body = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('all'), ids: Ids }),
  z.object({
    scope: z.literal('collection'),
    collectionId: z.number().int().positive(),
    ids: Ids,
  }),
]);

/** Thrown inside the transaction to force a ROLLBACK, then mapped to 409. */
class StaleScopeError extends Error {}

async function POST_impl(req: Request) {
  await requireSameOrigin();
  await requireAdmin();

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const body = parsed.data;
  const ids = body.ids;

  let stale = false;
  let matched = -1;
  try {
    await withTransaction(async (client) => {
      // Two literal statements rather than one built from `scope`. Deriving a
      // SET column name from request data is an identifier-interpolation trap in
      // a repo with no ORM.
      //
      // status='published' on BOTH scopes: without it a stale tab stamps a
      // nonzero position onto a draft and destroys the 0 sentinel that
      // append-on-publish depends on.
      //
      // Deliberately NOT setting updated_at, even though /api/admin/wall does.
      // The admin Library sorts ORDER BY a.updated_at DESC, so every drag would
      // reshuffle the Library under the user, and app/sitemap.ts uses updated_at
      // as lastModified, so every reorder would re-stamp every published artwork
      // in the sitemap.
      const res =
        body.scope === 'all'
          ? await client.query(
              `UPDATE artworks a
                  SET display_order = v.ord
                 FROM (SELECT id, ord
                         FROM unnest($1::int[]) WITH ORDINALITY AS t(id, ord)) v
                WHERE a.id = v.id
                  AND a.status = 'published'
                  AND a.image_web_url <> ''`,
              [ids],
            )
          : await client.query(
              `UPDATE artworks a
                  SET collection_order = v.ord
                 FROM (SELECT id, ord
                         FROM unnest($1::int[]) WITH ORDINALITY AS t(id, ord)) v
                WHERE a.id = v.id
                  AND a.status = 'published'
                  AND a.image_web_url <> ''
                  AND a.collection_id = $2`,
              [ids, body.collectionId],
            );
      matched = res.rowCount ?? 0;

      // Guard A: every posted id matched. The WHERE clauses skip non-matching
      // rows SILENTLY, so survivors would take sparse ordinals (1, 3, 5...) from
      // the full array's WITH ORDINALITY while skipped rows keep colliding
      // values, and the admin would still see "order saved".
      if (matched !== ids.length) throw new StaleScopeError();

      // Guard B: the payload covers the WHOLE scope. Guard A cannot catch a
      // SHORT payload: a strict subset where every row matches passes it and
      // gets renumbered 1..k, colliding with the rows outside the subset.
      //
      // `image_web_url <> ''` mirrors the admin loader exactly. Without it a
      // published row with an empty web URL is counted here but never reaches
      // the shelf, so no payload the admin can send satisfies this guard: every
      // reorder 409s forever, and the client's 409 path reloads, turning a drag
      // into a reload loop. Any change to the loader's WHERE clause must change
      // this too.
      const total =
        body.scope === 'all'
          ? await client.query<{ n: string }>(
              `SELECT COUNT(*)::text AS n FROM artworks
                WHERE status = 'published' AND image_web_url <> ''`,
            )
          : await client.query<{ n: string }>(
              `SELECT COUNT(*)::text AS n FROM artworks
                WHERE status = 'published' AND image_web_url <> ''
                  AND collection_id = $1`,
              [body.collectionId],
            );
      if (Number(total.rows[0].n) !== ids.length) throw new StaleScopeError();
    });
  } catch (err) {
    if (err instanceof StaleScopeError) {
      // The transaction rolled back, so NOTHING was written. This is the whole
      // reason the guards run inside withTransaction: a single statement in
      // autocommit has already committed by the time any assertion runs, so a
      // post-hoc check would only report corruption it had just made durable.
      // info, not warn: two admin tabs open is ordinary user behaviour, and
      // logger.warn forwards to Sentry, so this would file a recurring event
      // for something that is working exactly as designed.
      logger.info('shop reorder rejected: scope changed', {
        scope: body.scope,
        idCount: ids.length,
        // -1 means the UPDATE itself threw before assigning. Report it as
        // unknown rather than as a row count of minus one.
        rowCount: matched < 0 ? 'unknown' : matched,
      });
      stale = true;
    } else {
      logger.error('shop reorder failed', err, {
        scope: body.scope,
        idCount: ids.length,
        rowCount: matched < 0 ? 'unknown' : matched,
      });
      return NextResponse.json({ error: 'save failed' }, { status: 500 });
    }
  }
  if (stale) return NextResponse.json({ error: 'stale' }, { status: 409 });
  return NextResponse.json({ ok: true });
}

export const POST = adminRoute(POST_impl);
