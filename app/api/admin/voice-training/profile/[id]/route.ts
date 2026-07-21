export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { pool, parsePathId } from '@/lib/db';
import { logger } from '@/lib/logger';
import { adminRoute } from '@/lib/admin-route';

// DELETE /api/admin/voice-training/profile/[id]
//
// Hard-deletes an inactive profile row. Refuses to delete the active
// row — the operator must deactivate first (DELETE /profile/0/activate).
// Nothing in the codebase carries a foreign key against voice_profiles,
// so this is a simple guard against an accidental double-click loop
// emptying the table while keeping ACTIVE invariants intact.

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
    const r = await pool.query(
      'DELETE FROM voice_profiles WHERE id = $1 AND active = FALSE',
      [id],
    );
    if (!r.rowCount) {
      const exists = await pool.query<{ active: boolean }>(
        'SELECT active FROM voice_profiles WHERE id = $1',
        [id],
      );
      if (!exists.rowCount) {
        return NextResponse.json({ error: 'not found' }, { status: 404 });
      }
      return NextResponse.json(
        { error: 'cannot delete active profile — deactivate first' },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    logger.error('voice profile delete failed', err, { id });
    return NextResponse.json({ error: 'delete failed' }, { status: 500 });
  }
}

export const DELETE = adminRoute(DELETE_impl);
