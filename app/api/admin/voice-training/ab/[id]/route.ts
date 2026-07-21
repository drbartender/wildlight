export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/session';
import { pool, parsePathId } from '@/lib/db';
import { logger } from '@/lib/logger';
import { adminRoute } from '@/lib/admin-route';

// PATCH /api/admin/voice-training/ab/[id]
//
// Record Dan's pick on an existing A/B pair. Allows re-judging the same
// pair (overwrites prior pick + reason + bumps judged_at).

const Body = z.object({
  pick: z.enum(['A', 'B', 'neither']),
  reason: z.string().max(1000).optional(),
});

async function PATCH_impl(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = parsePathId(raw);
  if (id == null) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  try {
    const r = await pool.query(
      `UPDATE voice_ab_pairs
       SET pick = $1, pick_reason = $2, judged_at = NOW()
       WHERE id = $3`,
      [parsed.data.pick, parsed.data.reason?.trim() || null, id],
    );
    if (!r.rowCount) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('voice ab judge failed', err, { id });
    return NextResponse.json({ error: 'save failed' }, { status: 500 });
  }
}

// DELETE drops the pair entirely — useful when a generated pair is
// degenerate (both variants near-identical, or the model went off-topic).
async function DELETE_impl(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = parsePathId(raw);
  if (id == null) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }
  try {
    const r = await pool.query('DELETE FROM voice_ab_pairs WHERE id = $1', [id]);
    if (!r.rowCount) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('voice ab delete failed', err, { id });
    return NextResponse.json({ error: 'delete failed' }, { status: 500 });
  }
}

export const PATCH = adminRoute(PATCH_impl);
export const DELETE = adminRoute(DELETE_impl);
