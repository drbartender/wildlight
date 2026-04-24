export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { readExifFromBuffer } from '@/lib/exif';
import { draftArtworkMetadata } from '@/lib/ai-draft';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id } = await ctx.params;

  const { rows } = await pool.query<{
    title: string;
    image_web_url: string;
    collection_slug: string | null;
  }>(
    `SELECT a.title, a.image_web_url, c.slug AS collection_slug
     FROM artworks a LEFT JOIN collections c ON c.id = a.collection_id
     WHERE a.id = $1`,
    [id],
  );
  if (!rows.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const a = rows[0];

  let buf: Buffer;
  try {
    const r = await fetch(a.image_web_url);
    if (!r.ok) throw new Error(`image fetch ${r.status}`);
    buf = Buffer.from(await r.arrayBuffer());
  } catch (err) {
    return NextResponse.json(
      { error: 'image fetch failed', detail: String(err) },
      { status: 502 },
    );
  }

  const mime = a.image_web_url.toLowerCase().endsWith('.png')
    ? 'image/png'
    : 'image/jpeg';
  const { year_shot, gps } = await readExifFromBuffer(buf);

  try {
    const draft = await draftArtworkMetadata({
      imageBuf: buf,
      mime,
      title: a.title,
      collectionSlug: a.collection_slug,
      gps,
    });
    return NextResponse.json({
      year_shot,
      location: draft.location,
      artist_note: draft.artist_note,
      confidence: draft.confidence,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'ai-draft failed', detail: String(err) },
      { status: 502 },
    );
  }
}
