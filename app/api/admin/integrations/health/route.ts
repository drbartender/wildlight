export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { checkHealth } from '@/lib/integration-health';

export async function GET() {
  await requireAdmin();
  const result = await checkHealth();
  return NextResponse.json(result);
}
