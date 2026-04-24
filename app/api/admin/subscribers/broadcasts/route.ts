export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export async function GET() {
  await requireAdmin();
  const { rows } = await pool.query<{
    id: number;
    subject: string;
    recipient_count: number;
    sent_at: string;
    sent_by: string | null;
  }>(
    `SELECT id, subject, recipient_count, sent_at::text, sent_by
     FROM broadcast_log
     ORDER BY sent_at DESC
     LIMIT 200`,
  );
  return NextResponse.json({ rows });
}
