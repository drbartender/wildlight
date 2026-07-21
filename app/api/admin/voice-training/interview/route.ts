export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/session';
import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';
import { INTERVIEW_QUESTIONS } from '@/lib/voice-trainer';
import { adminRoute } from '@/lib/admin-route';

// PUT /api/admin/voice-training/interview
//
// Upsert a single interview answer keyed by question_key. The catalog
// lives in INTERVIEW_QUESTIONS — any key not in the catalog is rejected
// so a malicious or stale client can't pollute the table with arbitrary
// rows.

const Body = z.object({
  questionKey: z.string().min(1).max(80),
  answer: z.string().max(4000),
});

async function PUT_impl(req: Request) {
  await requireAdmin();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const q = INTERVIEW_QUESTIONS.find((x) => x.key === parsed.data.questionKey);
  if (!q) {
    return NextResponse.json({ error: 'unknown question' }, { status: 400 });
  }

  // Empty answer = delete the row, so the UI returns to "unanswered".
  const trimmed = parsed.data.answer.trim();
  try {
    if (!trimmed) {
      await pool.query(
        `DELETE FROM voice_interview_responses WHERE question_key = $1`,
        [q.key],
      );
      return NextResponse.json({ ok: true, deleted: true });
    }
    await pool.query(
      `INSERT INTO voice_interview_responses
         (question_key, question_text, answer, category)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (question_key)
       DO UPDATE SET answer = EXCLUDED.answer,
                     question_text = EXCLUDED.question_text,
                     category = EXCLUDED.category,
                     updated_at = NOW()`,
      [q.key, q.text, trimmed, q.category],
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('voice interview upsert failed', err);
    return NextResponse.json({ error: 'save failed' }, { status: 500 });
  }
}

export const PUT = adminRoute(PUT_impl);
