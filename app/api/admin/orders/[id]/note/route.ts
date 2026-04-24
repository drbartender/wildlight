export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool, parsePathId } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

const Body = z.object({ text: z.string().min(1).max(500) });

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = parsePathId(raw);
  if (id == null) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  // Verify the order exists first; otherwise the FK failure on insert
  // would throw a pg error that Next turns into a 500 with a leaked
  // message. 404 early instead.
  const existing = await pool.query<{ id: number }>(
    `SELECT id FROM orders WHERE id = $1`,
    [id],
  );
  if (!existing.rowCount) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const { rows } = await pool.query<{
    id: number;
    created_at: string;
  }>(
    `INSERT INTO order_events (order_id, type, who, payload)
     VALUES ($1, 'admin_note', 'admin', $2::jsonb)
     RETURNING id, created_at`,
    [id, JSON.stringify({ text: parsed.data.text })],
  );

  return NextResponse.json(
    {
      event: {
        id: rows[0].id,
        type: 'admin_note',
        who: 'admin',
        payload: { text: parsed.data.text },
        created_at: rows[0].created_at,
      },
    },
    { status: 201 },
  );
}
