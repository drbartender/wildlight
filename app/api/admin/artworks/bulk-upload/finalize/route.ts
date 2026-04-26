export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fileTypeFromBuffer } from 'file-type';
import { pool, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import {
  getPrivateBuffer,
  uploadPublic,
  copyAndDeletePrivate,
  deletePrivate,
  deletePublic,
} from '@/lib/r2';
import { deriveWebFromPrint } from '@/lib/image-derive';
import { slugify, uniqueSlug } from '@/lib/slug';
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

  // 4. Resolve target slug + collection folder for the canonical keys.
  let artworkId: number;
  let slug: string;
  let collectionFolder: string;

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
    // CREATE: AI-draft a title first; we need the slug before we can store
    // either file at its canonical key. AI-draft requires a public URL;
    // upload the web tier to a temporary public key keyed by the staging
    // uuid so it's reachable, then move/overwrite once we have the slug.
    const stagedUuid = input.stagedKey.split('/')[1].split('.')[0];
    const tempWebKey = `incoming/${stagedUuid}.jpg`;
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
    try {
      const exif = await readExifFromBuffer(masterBuf);
      yearShot = exif.year_shot;
      const draft = await draftArtworkMetadata({
        imageUrl: tempWebUrl,
        collectionSlug,
        gps: exif.gps,
      });
      title = draft.title;
      artistNote = draft.artist_note;
      location = draft.location;
    } catch (err) {
      logger.warn('finalize create: ai-draft failed; falling back to placeholder', {
        err,
      });
    }

    const taken = new Set<string>(
      (
        await pool.query<{ slug: string }>('SELECT slug FROM artworks')
      ).rows.map((r) => r.slug),
    );
    slug = uniqueSlug(slugify(title) || 'untitled', taken);
    collectionFolder =
      collectionSlug ||
      (input.collectionId ? String(input.collectionId) : 'misc');

    const r = await pool.query<{ id: number }>(
      `INSERT INTO artworks
         (collection_id, slug, title, artist_note, location, year_shot,
          image_web_url, image_print_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, '', '', 'draft')
       RETURNING id`,
      [input.collectionId, slug, title, artistNote, location, yearShot],
    );
    artworkId = r.rows[0].id;

    try {
      await deletePublic(tempWebKey);
    } catch {
      /* fall through — orphan reaping handles it */
    }
  }

  // 5. Upload the derived web image at its canonical key.
  const webKey = `artworks/${collectionFolder}/${slug}.jpg`;
  const webUrl = await uploadPublic(webKey, derived.buf, derived.contentType);

  // 6. Move the master from incoming/ to its canonical key.
  const printKey = `artworks-print/${collectionFolder}/${slug}.${printExt}`;
  await copyAndDeletePrivate(input.stagedKey, printKey);

  // 7. Record the URLs on the artwork row.
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE artworks
       SET image_web_url = $1, image_print_url = $2, updated_at = NOW()
       WHERE id = $3`,
      [webUrl, printKey, artworkId],
    );
  });

  return NextResponse.json({
    artworkId,
    slug,
    image_web_url: webUrl,
    image_print_url: printKey,
  });
}
