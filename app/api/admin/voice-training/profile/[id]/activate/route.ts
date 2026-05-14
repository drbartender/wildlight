export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { pool, parsePathId } from '@/lib/db';
import { logger } from '@/lib/logger';

// POST /api/admin/voice-training/profile/[id]/activate
//
// Promote a profile to active. One atomic UPDATE toggles every row that
// needs to flip — the previous active row (if any) and the target row.
// Wrapping in a single statement lets Postgres serialize concurrent
// activates against each other and keeps the partial unique index on
// active=TRUE intact at every commit boundary.
//
// The UPDATE's WHERE clause excludes a no-op re-activation of the
// currently active profile, so updated_at only moves when the row's
// active state actually changed.

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
    const r = await pool.query<{ id: number }>(
      `UPDATE voice_profiles
          SET active = (id = $1),
              updated_at = NOW()
        WHERE (active = TRUE OR id = $1)
          AND active <> (id = $1)
        RETURNING id`,
      [id],
    );
    // Zero rows updated = either the target is already active (no-op
    // success) or the target doesn't exist (404). Confirm with a cheap
    // existence check rather than reading the active row a second time.
    if (r.rowCount === 0) {
      const exists = await pool.query(
        'SELECT 1 FROM voice_profiles WHERE id = $1',
        [id],
      );
      if (!exists.rowCount) {
        return NextResponse.json({ error: 'not found' }, { status: 404 });
      }
    }
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '23505') {
      // Two admins flipped distinct profiles at the same moment — the
      // partial unique index serialized them and the loser landed here.
      return NextResponse.json(
        { error: 'another activation just landed — refresh' },
        { status: 409 },
      );
    }
    logger.error('voice activate failed', err, { id });
    return NextResponse.json({ error: 'activate failed' }, { status: 500 });
  }
}

// DELETE deactivates everything — useful to reset to the static defaults
// in lib/studio-voice.ts. The route uses the literal string "0" rather
// than parsePathId() because parsePathId rejects 0 (it requires n > 0).
// DO NOT refactor to `parsePathId(raw) === 0` — that returns null for
// "0" input and the convention silently breaks.
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
      `UPDATE voice_profiles
          SET active = FALSE, updated_at = NOW()
        WHERE active = TRUE`,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('voice deactivate failed', err);
    return NextResponse.json({ error: 'deactivate failed' }, { status: 500 });
  }
}
