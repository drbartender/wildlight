export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export async function GET() {
  await requireAdmin();
  const { rows } = await pool.query(
    `SELECT o.id, o.status, o.customer_email, o.customer_name, o.total_cents,
            o.shipping_address, o.is_test,
            o.created_at::text, o.printful_order_id,
            (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id) AS item_count
     FROM orders o
     ORDER BY o.created_at DESC
     LIMIT 500`,
  );
  return NextResponse.json({ rows });
}
