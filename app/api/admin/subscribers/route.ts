export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { adminRoute } from '@/lib/admin-route';

async function GET_impl() {
  await requireAdmin();
  const { rows } = await pool.query(
    `SELECT id, email, source, confirmed_at, unsubscribed_at, created_at
     FROM subscribers ORDER BY created_at DESC LIMIT 2000`,
  );
  return NextResponse.json({ rows });
}

export const GET = adminRoute(GET_impl);
