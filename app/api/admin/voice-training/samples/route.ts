export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/session';
import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';

// POST /api/admin/voice-training/samples
//
// Add a positive ("sounds like me") or anti ("AI draft that felt off")
// writing sample. text is the body; annotation captures Dan's reason
// when this is an anti-sample.

const Body = z.object({
  kind: z.enum(['positive', 'anti']),
  title: z.string().max(200).optional(),
  text: z.string().min(1).max(20_000),
  annotation: z.string().max(2000).optional(),
  source: z.string().max(80).optional(),
});

export async function POST(req: Request) {
  await requireAdmin();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const d = parsed.data;
  try {
    const r = await pool.query<{ id: number }>(
      `INSERT INTO voice_samples (kind, title, text, annotation, source)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        d.kind,
        d.title?.trim() || null,
        d.text.trim(),
        d.annotation?.trim() || null,
        d.source?.trim() || null,
      ],
    );
    return NextResponse.json({ id: r.rows[0].id });
  } catch (err) {
    logger.error('voice sample insert failed', err);
    return NextResponse.json({ error: 'save failed' }, { status: 500 });
  }
}
