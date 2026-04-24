export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id } = await ctx.params;
  const [o, items] = await Promise.all([
    pool.query('SELECT * FROM orders WHERE id = $1', [id]),
    pool.query('SELECT * FROM order_items WHERE order_id = $1', [id]),
  ]);
  if (!o.rowCount) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ order: o.rows[0], items: items.rows });
}
