export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { pool, withTransaction, parsePathId } from '@/lib/db';
import { logger } from '@/lib/logger';

// POST /api/admin/voice-training/profile/[id]/activate
//
// Promote a profile to active. The unique partial index on
// voice_profiles((TRUE)) WHERE active = TRUE means we MUST unset the
// prior active row before setting this one — otherwise the UPDATE
// trips the constraint. One transaction; the prior row stays as a
// versioned snapshot.

export async function POST(
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
    const result = await withTransaction(async (client) => {
      const check = await client.query<{ id: number }>(
        'SELECT id FROM voice_profiles WHERE id = $1',
        [id],
      );
      if (!check.rowCount) return null;
      await client.query(
        `UPDATE voice_profiles SET active = FALSE WHERE active = TRUE AND id <> $1`,
        [id],
      );
      await client.query(
        `UPDATE voice_profiles SET active = TRUE WHERE id = $1`,
        [id],
      );
      return { id };
    });
    if (!result) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, id: result.id });
  } catch (err) {
    logger.error('voice activate failed', err, { id });
    return NextResponse.json({ error: 'activate failed' }, { status: 500 });
  }
}

// DELETE deactivates everything — useful to reset to the static defaults
// in lib/studio-voice.ts. id=0 is the conventional "all" target.
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id: raw } = await ctx.params;
  if (raw !== '0') {
    return NextResponse.json({ error: 'use id=0 to deactivate all' }, { status: 400 });
  }
  try {
    await pool.query(
      'UPDATE voice_profiles SET active = FALSE WHERE active = TRUE',
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('voice deactivate failed', err);
    return NextResponse.json({ error: 'deactivate failed' }, { status: 500 });
  }
}
