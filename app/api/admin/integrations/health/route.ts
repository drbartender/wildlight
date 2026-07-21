export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { checkHealth } from '@/lib/integration-health';
import { adminRoute } from '@/lib/admin-route';

async function GET_impl() {
  await requireAdmin();
  const result = await checkHealth();
  return NextResponse.json(result);
}

export const GET = adminRoute(GET_impl);
