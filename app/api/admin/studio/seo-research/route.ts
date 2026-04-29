export const runtime = 'nodejs';
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { logger } from '@/lib/logger';
import { researchSeoTrends } from '@/lib/studio';
import { recordAndCheckRateLimit } from '@/lib/rate-limit';

export async function POST() {
  const session = await requireAdmin();
  // Same Anthropic-cost rationale as /generate. SEO research is the
  // smaller-but-still-expensive web_search call; 60/hour caps it.
  const gate = await recordAndCheckRateLimit(
    'studio-seo-research',
    session.email,
    3600,
    60,
  );
  if (gate.blocked) {
    return NextResponse.json(
      { error: 'too many research calls — try again later' },
      {
        status: 429,
        headers: gate.retryAfter
          ? { 'Retry-After': String(gate.retryAfter) }
          : undefined,
      },
    );
  }
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
