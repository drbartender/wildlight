export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';
import { INTERVIEW_QUESTIONS } from '@/lib/voice-trainer';
import { adminRoute } from '@/lib/admin-route';

// GET /api/admin/voice-training/state
//
// One-shot bootstrap for the trainer UI. Returns:
//   - the interview catalog plus any saved answers (keyed by question_key)
//   - counts of positive/anti samples + recent N of each
//   - recent A/B pairs (judged + un-judged)
//   - all voice_profile rows (most recent first), with the active one marked
//
// Single round-trip so the UI renders in one paint after auth.

const SAMPLE_PREVIEW_CHARS = 2000;

interface InterviewRow {
  question_key: string;
  answer: string;
  updated_at: string;
}
interface SampleRow {
  id: number;
  kind: 'positive' | 'anti';
  title: string | null;
  text: string;
  annotation: string | null;
  created_at: string;
}
interface AbRow {
  id: number;
  prompt: string;
  variant_a: string;
  variant_b: string;
  pick: 'A' | 'B' | 'neither' | null;
  pick_reason: string | null;
  created_at: string;
  judged_at: string | null;
}
interface ProfileRow {
  id: number;
  active: boolean;
  summary: string;
  rules: unknown;
  samples: unknown;
  notes: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

async function GET_impl() {
  await requireAdmin();
  try {
    const [answers, samples, ab, profiles] = await Promise.all([
      pool.query<InterviewRow>(
        // LIMIT is defensive — INTERVIEW_QUESTIONS is small and the
        // route validates question_key on write, but a future bypass
        // could grow the table unbounded. 500 still vastly exceeds the
        // catalog size.
        `SELECT question_key, answer, updated_at::text
         FROM voice_interview_responses
         LIMIT 500`,
      ),
      pool.query<SampleRow>(
        `SELECT id, kind, title, text, annotation, created_at::text
         FROM voice_samples
         ORDER BY created_at DESC
         LIMIT 200`,
      ),
      pool.query<AbRow>(
        `SELECT id, prompt, variant_a, variant_b, pick, pick_reason,
                created_at::text, judged_at::text
         FROM voice_ab_pairs
         ORDER BY created_at DESC
         LIMIT 50`,
      ),
      pool.query<ProfileRow>(
        `SELECT id, active, summary, rules, samples, notes,
                created_at::text, updated_at::text, created_by
         FROM voice_profiles
         ORDER BY created_at DESC
         LIMIT 20`,
      ),
    ]);

    const answersByKey = new Map<string, { answer: string; updatedAt: string }>();
    for (const r of answers.rows) {
      answersByKey.set(r.question_key, {
        answer: r.answer,
        updatedAt: r.updated_at,
      });
    }

    return NextResponse.json({
      questions: INTERVIEW_QUESTIONS.map((q) => ({
        ...q,
        answer: answersByKey.get(q.key)?.answer ?? '',
        answeredAt: answersByKey.get(q.key)?.updatedAt ?? null,
      })),
      // Sample `text` is capped at 20k chars on write but the UI list
      // view only needs a preview — full text is loaded into the
      // synthesize call directly from voice_samples. Truncate to keep
      // the state payload bounded and avoid shipping long pasted blocks
      // on every page paint.
      samples: samples.rows.map((r) => {
        const truncated = r.text.length > SAMPLE_PREVIEW_CHARS;
        return {
          id: r.id,
          kind: r.kind,
          title: r.title,
          text: truncated
            ? `${r.text.slice(0, SAMPLE_PREVIEW_CHARS)}…`
            : r.text,
          textTruncated: truncated,
          annotation: r.annotation,
          createdAt: r.created_at,
        };
      }),
      counts: {
        positive: samples.rows.filter((r) => r.kind === 'positive').length,
        anti: samples.rows.filter((r) => r.kind === 'anti').length,
        answered: answers.rows.length,
        abJudged: ab.rows.filter((r) => r.judged_at !== null).length,
      },
      ab: ab.rows.map((r) => ({
        id: r.id,
        prompt: r.prompt,
        variantA: r.variant_a,
        variantB: r.variant_b,
        pick: r.pick,
        pickReason: r.pick_reason,
        createdAt: r.created_at,
        judgedAt: r.judged_at,
      })),
      profiles: profiles.rows.map((r) => ({
        id: r.id,
        active: r.active,
        summary: r.summary,
        rules: Array.isArray(r.rules) ? r.rules : [],
        samples: Array.isArray(r.samples) ? r.samples : [],
        notes: r.notes,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        createdBy: r.created_by,
      })),
    });
  } catch (err) {
    logger.error('voice-training state fetch failed', err);
    return NextResponse.json({ error: 'load failed' }, { status: 500 });
  }
}

export const GET = adminRoute(GET_impl);
