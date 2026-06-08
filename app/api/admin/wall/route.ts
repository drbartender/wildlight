export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { requireSameOrigin } from '@/lib/origin-check';

// Persist the homepage "vintage wall" sequence. The body is the full,
// ordered list of artwork ids; wall_order is set to each id's 1-based
// position. Separate from display_order (shop/portfolio), which is never
// touched here. The page LIMIT is 300, so a legitimate save is well under
// the 500 cap; ids must be unique (the unnest below would otherwise assign
// one row two positions).
const Body = z.object({
  ids: z
    .array(z.number().int().positive())
    .min(1)
    .max(500)
    .refine((a) => new Set(a).size === a.length, 'duplicate ids'),
});

export async function POST(req: Request) {
  await requireSameOrigin();
  await requireAdmin();

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const { ids } = parsed.data;

  try {
    await withTransaction(async (client) => {
      // Clear any previously-arranged row that isn't in this payload, so the
      // only rows with a nonzero wall_order are exactly the submitted set —
      // no stale values can lead the homepage sort.
      await client.query(
        `UPDATE artworks SET wall_order = 0
          WHERE wall_order <> 0 AND id <> ALL($1::int[])`,
        [ids],
      );
      // Assign wall_order = 1-based position in the submitted sequence.
      // unnest WITH ORDINALITY does it in one statement, no per-row trips.
      await client.query(
        `UPDATE artworks a
            SET wall_order = v.ord, updated_at = NOW()
           FROM (
             SELECT id, ord
               FROM unnest($1::int[]) WITH ORDINALITY AS t(id, ord)
           ) v
          WHERE a.id = v.id`,
        [ids],
      );
    });
  } catch (err) {
    console.error('[admin/wall] save failed:', err);
    return NextResponse.json({ error: 'save failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
