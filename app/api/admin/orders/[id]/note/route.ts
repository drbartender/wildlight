export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

const Body = z.object({ text: z.string().min(1).max(500) });

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = Number(raw);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
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
