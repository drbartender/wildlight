export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool, parsePathId } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { requireSameOrigin } from '@/lib/origin-check';
import { logger } from '@/lib/logger';
import { adminRoute } from '@/lib/admin-route';

const Body = z
  .object({
    resolution_override: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .refine((b) => b.resolution_override !== undefined || b.active !== undefined, {
    message: 'nothing to update',
  });

async function PATCH_impl(
  req: Request,
  ctx: { params: Promise<{ id: string; variantId: string }> },
) {
  await requireSameOrigin();
  const admin = await requireAdmin(); // AdminTokenPayload — has .id (the "who")
  const { id: rawId, variantId: rawV } = await ctx.params;
  const artworkId = parsePathId(rawId);
  const variantId = parsePathId(rawV);
  if (artworkId == null || variantId == null) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const d = parsed.data;

  // An override forces a size buyable. Refuse it on an artwork with no print
  // master — there would be nothing to fulfill. (The admin panel only offers
  // override on measured masters; this guards the raw API.)
  if (d.resolution_override === true) {
    const m = await pool.query<{ image_print_url: string | null }>(
      'SELECT image_print_url FROM artworks WHERE id = $1',
      [artworkId],
    );
    if (!m.rows[0]?.image_print_url) {
      return NextResponse.json(
        { error: 'cannot override: artwork has no print master' },
        { status: 409 },
      );
    }
  }

  const cols: string[] = [];
  const vals: unknown[] = [];
  if (d.resolution_override !== undefined) {
    cols.push(`resolution_override = $${vals.length + 1}`);
    vals.push(d.resolution_override);
  }
  if (d.active !== undefined) {
    cols.push(`active = $${vals.length + 1}`);
    vals.push(d.active);
  }
  // IDOR guard is part of the write: variant must belong to this artwork.
  vals.push(variantId, artworkId);
  const r = await pool.query(
    `UPDATE artwork_variants SET ${cols.join(', ')}
     WHERE id = $${vals.length - 1} AND artwork_id = $${vals.length}
     RETURNING id, size, active, resolution_override, min_resolution_ok, buyable`,
    vals,
  );
  if (!r.rowCount) {
    return NextResponse.json({ error: 'variant not found' }, { status: 404 });
  }
  logger.info('variant override/active changed', {
    by: admin.id,
    artworkId,
    variantId,
    change: d,
    result: r.rows[0],
  });
  return NextResponse.json({ variant: r.rows[0] });
}

export const PATCH = adminRoute(PATCH_impl);
