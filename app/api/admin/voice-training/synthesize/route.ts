export const runtime = 'nodejs';
// Synthesize calls Claude with the full corpus (interview + samples +
// A/B picks). ~3-5k tokens, single tool-call. 90s budget gives the
// model headroom on cold caches.
export const maxDuration = 90;

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';
import { synthesizeProfile, type SynthesizeInput } from '@/lib/voice-trainer';
import { recordAndCheckRateLimit } from '@/lib/rate-limit';

// POST /api/admin/voice-training/synthesize
//
// Ingest everything Dan has provided, run synthesizeProfile, persist
// the result as a new voice_profiles row with active=FALSE. The route
// returns the new row's id so the client can offer "Activate" right
// away.

interface InterviewRow {
  question_text: string;
  answer: string;
  category: string | null;
}
interface SampleRow {
  kind: 'positive' | 'anti';
  title: string | null;
  text: string;
  annotation: string | null;
}
interface AbRow {
  prompt: string;
  variant_a: string;
  variant_b: string;
  pick: 'A' | 'B' | 'neither';
  pick_reason: string | null;
}

export async function POST() {
  const session = await requireAdmin();
  // Synthesize is the heaviest call in the trainer (~5k tokens). Cap at
  // 10/hr so a runaway loop or stolen cookie can't drain budget.
  const gate = await recordAndCheckRateLimit(
    'voice-synthesize',
    session.email,
    3600,
    10,
  );
  if (gate.blocked) {
    return NextResponse.json(
      { error: 'too many synthesize runs — try again later' },
      {
        status: 429,
        headers: gate.retryAfter
          ? { 'Retry-After': String(gate.retryAfter) }
          : undefined,
      },
    );
  }
  try {
    const [interview, samples, ab] = await Promise.all([
      pool.query<InterviewRow>(
        `SELECT question_text, answer, category
         FROM voice_interview_responses
         ORDER BY category NULLS LAST, question_key`,
      ),
      pool.query<SampleRow>(
        `SELECT kind, title, text, annotation
         FROM voice_samples
         ORDER BY created_at ASC`,
      ),
      pool.query<AbRow>(
        `SELECT prompt, variant_a, variant_b, pick, pick_reason
         FROM voice_ab_pairs
         WHERE pick IS NOT NULL AND pick <> 'neither'`,
      ),
    ]);

    if (
      interview.rows.length === 0 &&
      samples.rows.length === 0 &&
      ab.rows.length === 0
    ) {
      return NextResponse.json(
        { error: 'nothing to synthesize — answer a question or add a sample first' },
        { status: 400 },
      );
    }

    const input: SynthesizeInput = {
      interview: interview.rows.map((r) => ({
        question: r.question_text,
        answer: r.answer,
        category: r.category,
      })),
      positiveSamples: samples.rows
        .filter((r) => r.kind === 'positive')
        .map((r) => ({
          title: r.title,
          text: r.text,
          annotation: r.annotation,
        })),
      antiSamples: samples.rows
        .filter((r) => r.kind === 'anti')
        .map((r) => ({
          title: r.title,
          text: r.text,
          annotation: r.annotation,
        })),
      abJudgments: ab.rows.map((r) => ({
        prompt: r.prompt,
        chosen: r.pick === 'A' ? r.variant_a : r.variant_b,
        rejected: r.pick === 'A' ? r.variant_b : r.variant_a,
        reason: r.pick_reason,
      })),
    };

    const out = await synthesizeProfile(input);

    const r = await pool.query<{ id: number }>(
      `INSERT INTO voice_profiles
         (active, summary, rules, samples, notes, created_by)
       VALUES (FALSE, $1, $2::jsonb, $3::jsonb, $4, $5)
       RETURNING id`,
      [
        out.summary,
        JSON.stringify(out.rules),
        JSON.stringify(out.samples),
        out.notes,
        session.email,
      ],
    );

    return NextResponse.json({
      id: r.rows[0].id,
      summary: out.summary,
      rules: out.rules,
      samples: out.samples,
      notes: out.notes,
    });
  } catch (err) {
    logger.error('voice synthesize failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'synthesize failed' },
      { status: 502 },
    );
  }
}
