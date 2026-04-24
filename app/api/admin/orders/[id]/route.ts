export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool, parsePathId } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = parsePathId(raw);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const [o, items, events] = await Promise.all([
    pool.query('SELECT * FROM orders WHERE id = $1', [id]),
    pool.query('SELECT * FROM order_items WHERE order_id = $1', [id]),
    pool.query(
      `SELECT id, type, who, payload, created_at
       FROM order_events
       WHERE order_id = $1
       ORDER BY created_at ASC, id ASC`,
      [id],
    ),
  ]);
  if (!o.rowCount) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({
    order: o.rows[0],
    items: items.rows,
    events: events.rows,
  });
}
