export const runtime = 'nodejs';

import { requireAdmin } from '@/lib/session';
import { pool, parsePathId } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { VoiceRule } from '@/lib/voice-profile';
import { VOICE_LETTER, type VoiceNoteSample } from '@/lib/studio-voice';

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

// safeString covers the most aggressive escapes the generator needs.
// JSON.stringify handles backslash, quote, CR/LF, and control chars,
// and the double-quoted output keeps `${` and backticks inert. The
// post-pass escapes the line/paragraph separators (LINE SEPARATOR and
// PARAGRAPH SEPARATOR), which JSON.stringify does NOT emit under modern
// V8 — those code points were retroactively legalized inside JS string
// literals in ES2019, so the runtime passes them through raw. Escaping
// them anyway keeps the generated file portable to lower ES targets.
// The separator characters are built via fromCharCode so this source
// file contains no invisible bytes; split/join sidesteps the
// new-RegExp-with-separator-char quirk where the constructor escapes
// the pattern in `.source` and the regex then fails to match the raw
// character at runtime.
function safeString(s: string): string {
  const BS = String.fromCharCode(0x5c);
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  return JSON.stringify(s)
    .split(LS).join(BS + 'u2028')
    .split(PS).join(BS + 'u2029');
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
