export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { requireSameOrigin } from '@/lib/origin-check';

// Persist the homepage "vintage wall" sequence. The body is the full,
// ordered list of artwork ids; wall_order is set to each id's 1-based
// position. Separate from display_order (shop/portfolio), which is never
// touched here.
const Body = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(2000),
});

export async function POST(req: Request) {
  await requireSameOrigin();
  await requireAdmin();

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const { ids } = parsed.data;

  // unnest WITH ORDINALITY gives each id its 1-based position in one
  // statement — no per-row round-trips.
  await pool.query(
    `UPDATE artworks a
        SET wall_order = v.ord, updated_at = NOW()
       FROM (
         SELECT id, ord
           FROM unnest($1::int[]) WITH ORDINALITY AS t(id, ord)
       ) v
      WHERE a.id = v.id`,
    [ids],
  );

  return NextResponse.json({ ok: true });
}
