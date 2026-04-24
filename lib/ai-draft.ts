import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-6';
const MAX_NOTE_CHARS = 180;

export interface DraftInput {
  imageBuf: Buffer;
  mime: 'image/jpeg' | 'image/png';
  title: string;
  collectionSlug: string | null;
  gps: { lat: number; lon: number } | null;
}

export interface DraftResult {
  location: string | null;
  artist_note: string;
  confidence: 'high' | 'low';
}

const SYSTEM = `You write the metadata line for a fine-art photograph.

Voice: first person, terse, sensory, a craftsman's aside. One or two short sentences.

Rules:
- Draw ONLY from what is visible in the frame. Do not invent biography or unverifiable claims.
- artist_note: at most 180 characters, 1-2 sentences, first-person narrator voice.
- location: "City, State" (US) or "City, Country" (non-US). Use null when genuinely ambiguous. If GPS coordinates are provided, the location must be consistent with them.
- confidence: "low" if you are guessing about location or the image is hard to read; otherwise "high".

Respond with a single strict JSON object and nothing else:
{"location": "City, State" | null, "artist_note": "...", "confidence": "high" | "low"}`;

function userPreamble(input: DraftInput): string {
  const parts = [
    `Title: ${input.title}`,
    input.collectionSlug ? `Collection: ${input.collectionSlug}` : null,
    input.gps
      ? `GPS hint: lat ${input.gps.lat.toFixed(4)}, lon ${input.gps.lon.toFixed(4)}`
      : null,
  ].filter(Boolean);
  return parts.join('\n');
}

function validate(raw: unknown): DraftResult {
  if (!raw || typeof raw !== 'object') throw new Error('non-object response');
  const r = raw as Record<string, unknown>;
  const loc = r.location;
  const note = r.artist_note;
  const conf = r.confidence;
  if (typeof note !== 'string' || !note.trim()) throw new Error('missing artist_note');
  if (note.length > MAX_NOTE_CHARS) throw new Error('artist_note too long');
  if (conf !== 'high' && conf !== 'low') throw new Error('bad confidence');
  const location =
    loc == null ? null : typeof loc === 'string' && loc.trim() ? loc : null;
  return { location, artist_note: note, confidence: conf };
}

export async function draftArtworkMetadata(input: DraftInput): Promise<DraftResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');
  const client = new Anthropic({ apiKey });
  const image = input.imageBuf.toString('base64');

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 512,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: input.mime,
                  data: image,
                },
              },
              { type: 'text', text: userPreamble(input) },
            ],
          },
        ],
      });
      const text = res.content
        .flatMap((b) => (b.type === 'text' ? [b.text] : []))
        .join('\n')
        .trim();
      const firstBrace = text.indexOf('{');
      const lastBrace = text.lastIndexOf('}');
      if (firstBrace < 0 || lastBrace < firstBrace)
        throw new Error('no JSON in response');
      const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));
      return validate(parsed);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('ai-draft failed');
}
