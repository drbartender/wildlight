export const runtime = 'nodejs';
// Unified mode runs SEO research (web_search 10-30s) + generation
// (vision/body 20-40s) sequentially in the worst case. 120s gives the
// composer headroom without blowing past Vercel's default 300s ceiling.
export const maxDuration = 120;

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/session';
import { logger } from '@/lib/logger';
import { safeHttpUrl } from '@/lib/url';
import { generateUnified } from '@/lib/studio';
import { recordAndCheckRateLimit } from '@/lib/rate-limit';

// POST /api/admin/studio/generate
//
// Single mode after the review pass — the composer never calls the
// legacy mode-by-mode JSON branches or the multipart image-upload
// path. They lived for one minor release and were removed when the
// review showed only `mode: 'unified'` reaches this handler. Image
// inputs come in as URLs (already uploaded to R2 via /upload-image
// or /upload-presign), not as raw files.

const Body = z.object({
  mode: z.literal('unified'),
  kind: z.enum(['journal', 'newsletter']),
  imageUrls: z.array(z.string().url()).max(12).optional(),
  title: z.string().max(200).optional(),
  subject: z.string().max(500).optional(),
  body: z.string().max(50_000).optional(),
  chooseForMe: z.boolean().optional(),
});

export async function POST(req: Request) {
  const session = await requireAdmin();
  // Each call burns Anthropic budget (~$0.05-0.20 of model time + web
  // search) — this is the cost-amplification surface a stolen cookie
  // would target. 30/hour gives normal use plenty of headroom while
  // capping the blast radius.
  const gate = await recordAndCheckRateLimit(
    'studio-generate',
    session.email,
    3600,
    30,
  );
  if (gate.blocked) {
    return NextResponse.json(
      { error: 'too many generations — try again later' },
      {
        status: 429,
        headers: gate.retryAfter
          ? { 'Retry-After': String(gate.retryAfter) }
          : undefined,
      },
    );
  }
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const d = parsed.data;

  // Validate every image URL before we spend a 30s research call.
  // safeHttpUrl returns the canonical form on success, null on a
  // disallowed scheme; we only forward canonicalized values.
  const cleanUrls: string[] = [];
  for (const u of d.imageUrls ?? []) {
    const safe = safeHttpUrl(u);
    if (!safe) {
      return NextResponse.json({ error: 'bad image url' }, { status: 400 });
    }
    cleanUrls.push(safe);
  }

  try {
    const result = await generateUnified({
      kind: d.kind,
      imageUrls: cleanUrls,
      title: d.title,
      subject: d.subject,
      body: d.body,
      chooseForMe: d.chooseForMe,
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.error('studio generate failed', err, { kind: d.kind });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'generation failed' },
      { status: 502 },
    );
  }
}
