export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { uploadPublic, uploadPrivate } from '@/lib/r2';
import { slugify, uniqueSlug } from '@/lib/slug';

// Next's Node runtime default limit on request body depends on config; for large
// images you may need to bump `experimental.serverActions.bodySizeLimit` in
// next.config.ts. We already set 25mb.

export async function POST(req: Request) {
  await requireAdmin();
  const form = await req.formData();
  const title = String(form.get('title') || '').trim();
  const collectionIdRaw = form.get('collection_id');
  const collectionId = collectionIdRaw ? Number(collectionIdRaw) : null;
  const artistNote = (form.get('artist_note') || '').toString() || null;
  const webFile = form.get('image_web');
  const printFile = form.get('image_print');

  if (!title) {
    return NextResponse.json({ error: 'title required' }, { status: 400 });
  }
  if (!(webFile instanceof File)) {
    return NextResponse.json({ error: 'image_web required' }, { status: 400 });
  }

  const existing = await pool.query<{ slug: string }>('SELECT slug FROM artworks');
  const taken = new Set<string>(existing.rows.map((r) => r.slug));
  const base = slugify(title) || 'untitled';
  const slug = uniqueSlug(base, taken);

  const collectionSlugFolder =
    collectionId != null ? String(collectionId) : 'misc';

  const webBuf = Buffer.from(await webFile.arrayBuffer());
  const webKey = `artworks/${collectionSlugFolder}/${slug}.jpg`;
  const webUrl = await uploadPublic(webKey, webBuf, webFile.type || 'image/jpeg');

  let printKey: string | null = null;
  if (printFile instanceof File && printFile.size > 0) {
    const printBuf = Buffer.from(await printFile.arrayBuffer());
    printKey = `artworks-print/${collectionSlugFolder}/${slug}.jpg`;
    await uploadPrivate(printKey, printBuf, printFile.type || 'image/jpeg');
  }

  let id = 0;
  await withTransaction(async (client) => {
    const r = await client.query<{ id: number }>(
      `INSERT INTO artworks (collection_id, slug, title, artist_note, image_web_url, image_print_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft') RETURNING id`,
      [collectionId, slug, title, artistNote, webUrl, printKey],
    );
    id = r.rows[0].id;
  });

  return NextResponse.json({ id, slug });
}
