export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fileTypeFromBuffer } from 'file-type';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import {
  getPrivateBuffer,
  uploadPublic,
  copyAndDeletePrivate,
  deletePrivate,
  deletePublic,
} from '@/lib/r2';
import { deriveWebFromPrint } from '@/lib/image-derive';
import { slugify } from '@/lib/slug';
import { draftArtworkMetadata } from '@/lib/ai-draft';
import { readExifFromBuffer } from '@/lib/exif';
import { logger } from '@/lib/logger';

const STAGED_RX = /^incoming\/[0-9a-f-]{36}\.(jpg|jpeg|png|tif|tiff)$/i;
const PRINT_ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/tiff']);

const Body = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('update'),
    artworkId: z.number().int().positive(),
    stagedKey: z.string().regex(STAGED_RX),
  }),
  z.object({
    mode: z.literal('create'),
    stagedKey: z.string().regex(STAGED_RX),
    collectionId: z.number().int().positive().nullable(),
  }),
]);

interface ArtworkRow {
  id: number;
  slug: string;
  collection_id: number | null;
  collection_slug: string | null;
}

async function loadArtwork(id: number): Promise<ArtworkRow | null> {
  const r = await pool.query<ArtworkRow>(
    `SELECT a.id, a.slug, a.collection_id, c.slug AS collection_slug
     FROM artworks a LEFT JOIN collections c ON c.id = a.collection_id
     WHERE a.id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

async function loadCollection(id: number | null): Promise<string | null> {
  if (id == null) return null;
  const r = await pool.query<{ slug: string }>(
    'SELECT slug FROM collections WHERE id = $1',
    [id],
  );
  return r.rows[0]?.slug ?? null;
}

function printExtFromMime(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/tiff') return 'tif';
  return 'jpg';
}

export async function POST(req: Request) {
  await requireAdmin();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const input = parsed.data;

  // 1. Read the staged file from R2 once.
  let masterBuf: Buffer;
  try {
    masterBuf = await getPrivateBuffer(input.stagedKey);
  } catch (err) {
    logger.error('finalize: staged file unreadable', err, {
      stagedKey: input.stagedKey,
    });
    return NextResponse.json(
      { error: 'staged file not found or unreadable' },
      { status: 404 },
    );
  }

  // 2. Sniff the actual mime — never trust the contentType from presign.
  const sniff = await fileTypeFromBuffer(masterBuf);
  if (!sniff || !PRINT_ALLOWED_MIMES.has(sniff.mime)) {
    await deletePrivate(input.stagedKey).catch(() => {});
    return NextResponse.json(
      { error: 'unsupported file format (jpeg/png/tiff only)' },
      { status: 415 },
    );
  }
  const printExt = printExtFromMime(sniff.mime);

  // 3. Derive the web image. Failures here are unrecoverable for this file.
  let derived;
  try {
    derived = await deriveWebFromPrint(masterBuf);
  } catch (err) {
    logger.error('finalize: derive failed', err, {
      stagedKey: input.stagedKey,
      mime: sniff.mime,
    });
    await deletePrivate(input.stagedKey).catch(() => {});
    return NextResponse.json(
      {
        error:
          "couldn't process this format — please export as standard JPEG or TIFF",
      },
      { status: 415 },
    );
  }

  // 4. Resolve target slug + collection folder + reserve artwork row.
  //
  // Both modes pre-reserve the artwork row before any canonical R2 writes,
  // then commit the URLs in a single UPDATE in step 7. If steps 5–7 fail,
  // a single rollback path (catch at the bottom) cleans up files at the
  // canonical keys + deletes the reserved row in create mode. This avoids
  // the prior "row inserted with empty URLs, R2 fails, broken row hidden
  // by IS NULL filter" failure mode.
  let artworkId: number;
  let slug: string;
  let collectionFolder: string;
  let createdRowId: number | null = null;
  let tempWebKey: string | null = null;

  if (input.mode === 'update') {
    const a = await loadArtwork(input.artworkId);
    if (!a) {
      await deletePrivate(input.stagedKey).catch(() => {});
      return NextResponse.json({ error: 'artwork not found' }, { status: 404 });
    }
    artworkId = a.id;
    slug = a.slug;
    collectionFolder =
      a.collection_slug || (a.collection_id ? String(a.collection_id) : 'misc');
  } else {
    // CREATE: write the derived web JPEG to a temp public key so AI-draft
    // can fetch it; then EXIF + AI-draft to seed the title; then atomically
    // reserve the artwork row via INSERT ON CONFLICT (slug). The temp web
    // file is best-effort deleted; any leftover gets reaped by
    // scripts/cleanup-staged.ts.
    const stagedUuid = input.stagedKey.split('/')[1].split('.')[0];
    tempWebKey = `incoming/${stagedUuid}.jpg`;
    const tempWebUrl = await uploadPublic(
      tempWebKey,
      derived.buf,
      derived.contentType,
    );

    const collectionSlug = await loadCollection(input.collectionId);
    let title = `Untitled ${new Date().toISOString().slice(0, 10)}`;
    let artistNote: string | null = null;
    let location: string | null = null;
    let yearShot: number | null = null;

    // EXIF and AI-draft are independent — splitting the try blocks so an
    // EXIF read failure doesn't skip the AI path (or vice versa). Both
    // failures fall back to placeholder values and a logged warning.
    let gps: { lat: number; lon: number } | null = null;
    try {
      const exif = await readExifFromBuffer(masterBuf);
      yearShot = exif.year_shot;
      gps = exif.gps;
    } catch (err) {
      logger.warn('finalize create: exif read failed', { err });
    }
    try {
      const draft = await draftArtworkMetadata({
        imageUrl: tempWebUrl,
        collectionSlug,
        gps,
      });
      title = draft.title;
      artistNote = draft.artist_note;
      location = draft.location;
    } catch (err) {
      logger.warn('finalize create: ai-draft failed; falling back to placeholder', {
        err,
      });
    }

    collectionFolder =
      collectionSlug ||
      (input.collectionId ? String(input.collectionId) : 'misc');

    // Atomic slug reservation via INSERT ON CONFLICT loop. Replaces the
    // SELECT-then-INSERT TOCTOU race that could 500 on concurrent creates
    // with similar AI-drafted titles.
    const baseSlug = slugify(title) || 'untitled';
    let reserved: { id: number; slug: string } | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
      const r = await pool.query<{ id: number }>(
        `INSERT INTO artworks
           (collection_id, slug, title, artist_note, location, year_shot,
            image_web_url, image_print_url, status)
         VALUES ($1, $2, $3, $4, $5, $6, '', '', 'draft')
         ON CONFLICT (slug) DO NOTHING
         RETURNING id`,
        [input.collectionId, candidate, title, artistNote, location, yearShot],
      );
      if (r.rowCount) {
        reserved = { id: r.rows[0].id, slug: candidate };
        break;
      }
    }
    if (!reserved) {
      await deletePrivate(input.stagedKey).catch(() => {});
      await deletePublic(tempWebKey).catch(() => {});
      return NextResponse.json(
        { error: 'too many slug collisions; please retry' },
        { status: 409 },
      );
    }
    artworkId = reserved.id;
    slug = reserved.slug;
    createdRowId = reserved.id;
  }

  // 5–7. Canonical R2 writes + DB URL update — wrapped so partial failures
  // can be rolled back. In update mode we leave the existing row alone; in
  // create mode we delete the row we just reserved so we don't leak rows
  // with empty URLs.
  const webKey = `artworks/${collectionFolder}/${slug}.jpg`;
  const printKey = `artworks-print/${collectionFolder}/${slug}.${printExt}`;
  let webUrl: string;

  try {
    webUrl = await uploadPublic(webKey, derived.buf, derived.contentType);
    await copyAndDeletePrivate(input.stagedKey, printKey);
    await pool.query(
      `UPDATE artworks
       SET image_web_url = $1, image_print_url = $2, updated_at = NOW()
       WHERE id = $3`,
      [webUrl, printKey, artworkId],
    );
  } catch (err) {
    logger.error('finalize: canonical write or DB update failed', err, {
      mode: input.mode,
      artworkId,
    });
    if (createdRowId != null) {
      await pool
        .query('DELETE FROM artworks WHERE id = $1', [createdRowId])
        .catch(() => {});
    }
    await deletePublic(webKey).catch(() => {});
    await deletePrivate(printKey).catch(() => {});
    await deletePrivate(input.stagedKey).catch(() => {});
    return NextResponse.json(
      { error: 'finalize failed; please retry' },
      { status: 500 },
    );
  } finally {
    if (tempWebKey) {
      await deletePublic(tempWebKey).catch(() => {});
    }
  }

  return NextResponse.json({
    artworkId,
    slug,
    image_web_url: webUrl,
    image_print_url: printKey,
  });
}
