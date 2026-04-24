export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { fileTypeFromBuffer } from 'file-type';
import { pool, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { uploadPublic, uploadPrivate } from '@/lib/r2';
import { slugify, uniqueSlug } from '@/lib/slug';

const WEB_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const PRINT_MAX_BYTES = 80 * 1024 * 1024; // 80 MB
const WEB_ALLOWED_MIMES = new Set(['image/jpeg', 'image/png']);
const PRINT_ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/tiff']);

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

  if (webFile.size > WEB_MAX_BYTES) {
    return NextResponse.json(
      { error: `web image too large (max ${WEB_MAX_BYTES / 1024 / 1024}MB)` },
      { status: 413 },
    );
  }
  const webBuf = Buffer.from(await webFile.arrayBuffer());
  const webSniff = await fileTypeFromBuffer(webBuf);
  if (!webSniff || !WEB_ALLOWED_MIMES.has(webSniff.mime)) {
    return NextResponse.json(
      { error: 'unsupported web image format (jpeg/png only)' },
      { status: 400 },
    );
  }
  const webExt = webSniff.ext === 'png' ? 'png' : 'jpg';
  const webKey = `artworks/${collectionSlugFolder}/${slug}.${webExt}`;
  const webUrl = await uploadPublic(webKey, webBuf, webSniff.mime);

  let printKey: string | null = null;
  if (printFile instanceof File && printFile.size > 0) {
    if (printFile.size > PRINT_MAX_BYTES) {
      return NextResponse.json(
        { error: `print file too large (max ${PRINT_MAX_BYTES / 1024 / 1024}MB)` },
        { status: 413 },
      );
    }
    const printBuf = Buffer.from(await printFile.arrayBuffer());
    const printSniff = await fileTypeFromBuffer(printBuf);
    if (!printSniff || !PRINT_ALLOWED_MIMES.has(printSniff.mime)) {
      return NextResponse.json(
        { error: 'unsupported print file format (jpeg/png/tiff only)' },
        { status: 400 },
      );
    }
    const printExt =
      printSniff.ext === 'png' ? 'png' : printSniff.ext === 'tif' ? 'tif' : 'jpg';
    printKey = `artworks-print/${collectionSlugFolder}/${slug}.${printExt}`;
    await uploadPrivate(printKey, printBuf, printSniff.mime);
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
