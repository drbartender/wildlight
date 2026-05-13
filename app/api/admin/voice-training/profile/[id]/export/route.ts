export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { pool, parsePathId } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { VoiceRule } from '@/lib/voice-profile';
import type { VoiceNoteSample } from '@/lib/studio-voice';

// GET /api/admin/voice-training/profile/[id]/export
//
// Returns a generated lib/studio-voice.ts source for the given profile.
// Dan copies it into the repo and commits when he wants the active
// profile baked into a git snapshot (the DB stays the live source of
// truth — see lib/voice-profile.ts).
//
// Vercel's filesystem is read-only, so we don't write the file here.

interface Row {
  summary: string;
  rules: unknown;
  samples: unknown;
  notes: string;
}

// JS string literal escape — single-quoted output so we only need to
// escape backslash, single quote, and newline. Used for both rules and
// samples below.
function jsString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = parsePathId(raw);
  if (id == null) {
    return new Response('bad id', { status: 400 });
  }
  try {
    const r = await pool.query<Row>(
      `SELECT summary, rules, samples, notes
       FROM voice_profiles WHERE id = $1`,
      [id],
    );
    const row = r.rows[0];
    if (!row) return new Response('not found', { status: 404 });

    const rules: VoiceRule[] = Array.isArray(row.rules)
      ? (row.rules as VoiceRule[]).filter(
          (x): x is VoiceRule =>
            !!x && typeof x.category === 'string' && typeof x.text === 'string',
        )
      : [];
    const samples: VoiceNoteSample[] = Array.isArray(row.samples)
      ? (row.samples as VoiceNoteSample[]).filter(
          (x): x is VoiceNoteSample =>
            !!x && typeof x.title === 'string' && typeof x.artist_note === 'string',
        )
      : [];

    const rulesSrc = rules
      .map(
        (r) =>
          `  { category: ${jsString(r.category)}, text: ${jsString(r.text)} },`,
      )
      .join('\n');

    const samplesSrc = samples
      .map(
        (s) =>
          `  {\n    title: ${jsString(s.title)},\n    artist_note: ${jsString(s.artist_note)},\n  },`,
      )
      .join('\n');

    const summarySrc = row.summary
      ? `\nexport const VOICE_SUMMARY = ${jsString(row.summary)};\n`
      : '';

    const ts = `// Generated from voice_profiles.id=${id} on ${new Date().toISOString()}.
// Source of truth is the DB row; this file is a versioned snapshot.

export interface VoiceNoteSample {
  title: string;
  artist_note: string;
}

export interface VoiceRule {
  category: string;
  text: string;
}

export const VOICE_LETTER: readonly string[] = [
  \`My name is Dan Raby I am the owner and Chief photographer here at Wildlight Imagery.  We work in Aurora Colorado which is an outlier of Denver Colorado in the USA. We work in many different styles of photography but we specialize in Portrait Photography,  Fine Art Photography, and  Freelance Photojournalism.\`,
  \`as for me personally, I have been a photographer exploring my light for as long as I can remember. My father handed me a camera when I was but a child and I never put it down.  I studied photography at The Colorado Institute of Art. There I learned accepted techniques and photographic rules. I learned the right way to capture light and record my world.  Since then I have practiced and honed my craft but being a typical normal photographer isn't where my passion lies.\`,
  \`I am always trying something different photographically.  I usually try and work beyond what I know and look for the light in unusual places. I like to consider myself a photographic rebel. Taking those well established photographic rules, that I learned in school,  and doing something else. Experimenting with new techniques constantly trying to find different ways to get the best image. Let's try this and see what happens.\`,
  \`But I also can use what I know and stay true to the customer requirements. Working together to create the perfect shot. I look forward to seeing what we can do for you!\`,
];
${summarySrc}
export const VOICE_RULES: readonly VoiceRule[] = [
${rulesSrc}
];

export const VOICE_NOTE_SAMPLES: readonly VoiceNoteSample[] = [
${samplesSrc}
];
`;

    return new Response(ts, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="studio-voice.profile-${id}.ts"`,
      },
    });
  } catch (err) {
    logger.error('voice export failed', err, { id });
    return new Response('export failed', { status: 500 });
  }
}
