// Voice profile loader. Reads the single active row from voice_profiles
// and returns it merged with the static fallback in lib/studio-voice.ts.
// The studio prompt builders in lib/studio.ts call loadActiveVoice() on
// every generate request — it's a single indexed primary-key lookup, so
// the overhead is dominated by the surrounding Claude call. We don't
// cache: the whole point of DB storage is that Dan can iterate live.

import { pool } from './db';
import { logger } from './logger';
import {
  VOICE_LETTER,
  VOICE_NOTE_SAMPLES,
  type VoiceNoteSample,
} from './studio-voice';

export interface VoiceRule {
  category: string;
  text: string;
}

export interface VoiceProfile {
  id: number | null;
  letter: readonly string[];
  samples: readonly VoiceNoteSample[];
  rules: readonly VoiceRule[];
  summary: string;
}

interface VoiceProfileRow {
  id: number;
  summary: string;
  rules: unknown;
  samples: unknown;
}

// Defensive JSONB → typed shape coercions. Bad rows fall back to empty
// arrays rather than failing the generate request.
function readRules(raw: unknown): VoiceRule[] {
  if (!Array.isArray(raw)) return [];
  const out: VoiceRule[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const obj = r as Record<string, unknown>;
    const text = typeof obj.text === 'string' ? obj.text.trim() : '';
    if (!text) continue;
    out.push({
      category:
        typeof obj.category === 'string' && obj.category.trim()
          ? obj.category.trim()
          : 'general',
      text,
    });
  }
  return out;
}

function readSamples(raw: unknown): VoiceNoteSample[] {
  if (!Array.isArray(raw)) return [];
  const out: VoiceNoteSample[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const obj = s as Record<string, unknown>;
    const title = typeof obj.title === 'string' ? obj.title.trim() : '';
    const note =
      typeof obj.artist_note === 'string'
        ? obj.artist_note.trim()
        : typeof obj.note === 'string'
          ? obj.note.trim()
          : '';
    if (!title || !note) continue;
    out.push({ title, artist_note: note });
  }
  return out;
}

export async function loadActiveVoice(): Promise<VoiceProfile> {
  try {
    const r = await pool.query<VoiceProfileRow>(
      `SELECT id, summary, rules, samples
       FROM voice_profiles
       WHERE active = TRUE
       LIMIT 1`,
    );
    const row = r.rows[0];
    if (!row) return staticFallback();

    const rules = readRules(row.rules);
    const dbSamples = readSamples(row.samples);
    // If the active profile defined samples, use only those — Dan
    // curated them specifically. Otherwise fall back to the static
    // curated list so the few-shot block is never empty.
    const samples = dbSamples.length > 0 ? dbSamples : VOICE_NOTE_SAMPLES;

    return {
      id: row.id,
      letter: VOICE_LETTER,
      samples,
      rules,
      summary: row.summary?.trim() ?? '',
    };
  } catch (err) {
    // Voice training is a luxury on top of generation — DB outage must
    // not block a draft. Fall back to the static voice corpus and warn.
    logger.warn('voice-profile.load_failed', { err });
    return staticFallback();
  }
}

function staticFallback(): VoiceProfile {
  return {
    id: null,
    letter: VOICE_LETTER,
    samples: VOICE_NOTE_SAMPLES,
    rules: [],
    summary: '',
  };
}
