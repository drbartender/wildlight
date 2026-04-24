export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { readExifFromBuffer } from '@/lib/exif';
import { draftArtworkMetadata, isRetryableAnthropicError } from '@/lib/ai-draft';

function isAllowedImageHost(url: string): boolean {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (!base) return false;
  try {
    return new URL(url).host === new URL(base).host;
  } catch {
    return false;
  }
}

/**
 * Fetch just enough bytes to read EXIF. Most JPEGs put DateTimeOriginal + GPS
 * within the first ~64 KB; 256 KB is a safe ceiling. If the server doesn't
 * honor Range, it returns 200 with the full body and we still work.
 */
async function fetchForExif(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-262143' } });
    if (!r.ok && r.status !== 206) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id } = await ctx.params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const { rows } = await pool.query<{
    image_web_url: string;
    collection_slug: string | null;
    year_shot: number | null;
  }>(
    `SELECT a.image_web_url, a.year_shot, c.slug AS collection_slug
     FROM artworks a LEFT JOIN collections c ON c.id = a.collection_id
     WHERE a.id = $1`,
    [numericId],
  );
  if (!rows.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const a = rows[0];

  if (!isAllowedImageHost(a.image_web_url)) {
    return NextResponse.json(
      { error: 'image url not from allowed host' },
      { status: 400 },
    );
  }

  // EXIF is read locally from a small byte range — skip the fetch entirely
  // when year_shot is already populated. AI-draft reads the image via
  // Anthropic's URL source, so no full buffer ever passes through this route.
  let year_shot: number | null = a.year_shot;
  let gps: { lat: number; lon: number } | null = null;
  if (year_shot == null) {
    const buf = await fetchForExif(a.image_web_url);
    if (buf) {
      const exif = await readExifFromBuffer(buf);
      year_shot = exif.year_shot;
      gps = exif.gps;
    }
  }

  try {
    const draft = await draftArtworkMetadata({
      imageUrl: a.image_web_url,
      collectionSlug: a.collection_slug,
      gps,
    });
    return NextResponse.json({
      year_shot,
      title: draft.title,
      location: draft.location,
      artist_note: draft.artist_note,
      confidence: draft.confidence,
    });
  } catch (err) {
    // Map rate-limit / transient upstream errors to 429 so the UI can
    // distinguish them from other failures.
    const status = isRetryableAnthropicError(err) ? 429 : 502;
    // Log the full error server-side; only leak details to the client in
    // non-production builds. Admin-only, but stack text on the wire is
    // still a smell.
    console.error('ai-draft failed', err);
    const body: { error: string; detail?: string } = { error: 'ai-draft failed' };
    if (process.env.NODE_ENV !== 'production') body.detail = String(err);
    return NextResponse.json(body, { status });
  }
}
