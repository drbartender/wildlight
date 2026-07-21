export const runtime = 'nodejs';

import { requireAdmin } from '@/lib/session';
import { pool, parsePathId } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { VoiceRule } from '@/lib/voice-profile';
import { VOICE_LETTER, type VoiceNoteSample } from '@/lib/studio-voice';
import { safeString } from '@/lib/voice-export';
import { adminRoute } from '@/lib/admin-route';

// GET /api/admin/voice-training/profile/[id]/export
//
// Returns a generated lib/studio-voice.ts source for the given profile.
// Dan copies it into the repo and commits when he wants the active
// profile baked into a git snapshot (the DB stays the live source of
// truth — see lib/voice-profile.ts).
//
// VOICE_LETTER lives in lib/studio-voice.ts (not in voice_profiles), so
// the export reads it fresh at request time and snapshots the current
// committed copy alongside the profile-derived rules/samples.
//
// Vercel's filesystem is read-only, so we don't write the file here.

interface Row {
  summary: string;
  rules: unknown;
  samples: unknown;
}


async function GET_impl(
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
      `SELECT summary, rules, samples
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

    const letterSrc = VOICE_LETTER.map((p) => `  ${safeString(p)}`).join(
      ',\n',
    );

    const rulesSrc = rules
      .map(
        (r) =>
          `  { category: ${safeString(r.category)}, text: ${safeString(r.text)} },`,
      )
      .join('\n');

    const samplesSrc = samples
      .map(
        (s) =>
          `  {\n    title: ${safeString(s.title)},\n    artist_note: ${safeString(s.artist_note)},\n  },`,
      )
      .join('\n');

    const summarySrc = row.summary
      ? `\nexport const VOICE_SUMMARY = ${safeString(row.summary)};\n`
      : '';

    const ts = `// Generated from voice_profiles.id=${id} on ${new Date().toISOString()}.
// Source of truth for rules/samples is the DB row; the artist letter is
// read fresh from the current lib/studio-voice.ts at export time. Commit
// this file to bake the snapshot into the repo.

export interface VoiceNoteSample {
  title: string;
  artist_note: string;
}

export interface VoiceRule {
  category: string;
  text: string;
}

export const VOICE_LETTER: readonly string[] = [
${letterSrc},
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
        'Content-Type': 'application/typescript; charset=utf-8',
        'Content-Disposition': `attachment; filename="studio-voice.profile-${id}.ts"`,
      },
    });
  } catch (err) {
    logger.error('voice export failed', err, { id });
    return new Response('export failed', { status: 500 });
  }
}

export const GET = adminRoute(GET_impl);
