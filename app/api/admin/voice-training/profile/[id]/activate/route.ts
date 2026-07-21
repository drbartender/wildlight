export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { pool, withTransaction, parsePathId } from '@/lib/db';
import { logger } from '@/lib/logger';
import { adminRoute } from '@/lib/admin-route';

// POST /api/admin/voice-training/profile/[id]/activate
//
// Promote a profile to active. Two-step inside a single transaction:
//   1. SELECT … FOR UPDATE on the target — gates the whole flow on
//      existence and locks the target against concurrent DELETE.
//   2. Atomic UPDATE that flips every row whose active flag needs to
//      change in one statement.
//
// The partial unique index `uniq_voice_profiles_active` is the
// load-bearing serializer for two distinct admins activating two
// distinct profiles concurrently: the second one's commit trips the
// index and we surface the 23505 as a 409. The single-statement UPDATE
// just guarantees we never leave a torn intermediate state on the path
// of a single activate.
//
// The bug this re-fix closes: the previous round-one rewrite collapsed
// the existence check into "rowCount === 0 means not found OR no-op."
// That's wrong — for a non-existent target id while another row is
// active, the UPDATE matches the live active row, deactivates it,
// returns rowCount=1, and we'd return 200 OK while silently dropping
// the active profile.

async function POST_impl(
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
      // FOR UPDATE locks the target row for the duration of the
      // transaction — prevents a concurrent DELETE from racing the
      // activate and leaving us with a stale UPDATE.
      const t = await client.query(
        'SELECT 1 FROM voice_profiles WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!t.rowCount) return { found: false };
      await client.query(
        `UPDATE voice_profiles
            SET active = (id = $1),
                updated_at = NOW()
          WHERE (active = TRUE OR id = $1)
            AND active <> (id = $1)`,
        [id],
      );
      return { found: true };
    });
    if (!result.found) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
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
async function DELETE_impl(
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

export const POST = adminRoute(POST_impl);
export const DELETE = adminRoute(DELETE_impl);
