export const runtime = 'nodejs';
// Single A/B pair generates one Claude call (~1k tokens). 60s budget
// is plenty — keep well under Vercel's default ceiling.
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/session';
import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';
import { generateAbPair } from '@/lib/voice-trainer';
import { recordAndCheckRateLimit } from '@/lib/rate-limit';

// POST /api/admin/voice-training/ab
//
// Calls the model to draft two short variants of the same micro-prompt
// along a stylistic axis, then persists the pair in voice_ab_pairs with
// pick=null. The client returns later via PATCH /ab/[id] to record the
// judgment.

const Body = z.object({
  seed: z.string().max(800).optional(),
});

export async function POST(req: Request) {
  const session = await requireAdmin();
  // Same per-admin model-call cap as /studio/generate. Each pair burns
  // ~1k tokens; 30/hr leaves plenty of room for normal training rhythms.
  const gate = await recordAndCheckRateLimit(
    'voice-ab',
    session.email,
    3600,
    30,
  );
  if (gate.blocked) {
    return NextResponse.json(
      { error: 'too many pair generations — try again later' },
      {
        status: 429,
        headers: gate.retryAfter
          ? { 'Retry-After': String(gate.retryAfter) }
          : undefined,
      },
    );
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  try {
    const pair = await generateAbPair(parsed.data.seed);
    const r = await pool.query<{ id: number }>(
      `INSERT INTO voice_ab_pairs (prompt, variant_a, variant_b)
       VALUES ($1, $2, $3) RETURNING id`,
      [pair.prompt, pair.variantA, pair.variantB],
    );
    return NextResponse.json({
      id: r.rows[0].id,
      prompt: pair.prompt,
      variantA: pair.variantA,
      variantB: pair.variantB,
    });
  } catch (err) {
    logger.error('voice ab generate failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'generate failed' },
      { status: 502 },
    );
  }
}
