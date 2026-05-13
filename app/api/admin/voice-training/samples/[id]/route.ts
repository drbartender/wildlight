export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { pool, parsePathId } from '@/lib/db';
import { logger } from '@/lib/logger';

// DELETE /api/admin/voice-training/samples/[id]

export async function DELETE(
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
    const r = await pool.query('DELETE FROM voice_samples WHERE id = $1', [id]);
    if (!r.rowCount) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('voice sample delete failed', err, { id });
    return NextResponse.json({ error: 'delete failed' }, { status: 500 });
  }
}
