export const runtime = 'nodejs';
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { logger } from '@/lib/logger';
import { researchSeoTrends } from '@/lib/studio';

export async function POST() {
  await requireAdmin();
  try {
    const angles = await researchSeoTrends();
    return NextResponse.json({ angles });
  } catch (err) {
    logger.error('studio seo-research failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'research failed' },
      { status: 502 },
    );
  }
}
