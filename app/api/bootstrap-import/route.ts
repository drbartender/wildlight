/*
 * One-time server-side manifest import. Reads data/archive-manifest.json,
 * downloads each source image from wildlightimagery.com, uploads to R2,
 * and upserts a draft artwork row. Secured by BOOTSTRAP_SECRET.
 *
 * Chunked to stay under Vercel's 300s function timeout. Idempotent: safe
 * to re-invoke until all images are imported.
 *
 * Call:
 *   POST /api/bootstrap-import { secret, offset, limit }
 *
 * Response includes `nextOffset` — keep calling until it's null or matches
 * the total count.
 *
 * Delete this route + its manifest + BOOTSTRAP_SECRET once import completes.
 */
export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import crypto from 'node:crypto';
import { pool, withTransaction } from '@/lib/db';
import { uploadPublic } from '@/lib/r2';
import { slugify, uniqueSlug } from '@/lib/slug';

const Body = z.object({
  secret: z.string().min(1),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(50).default(25),
});

interface ManifestArtwork {
  slug: string;
  filename: string;
  title: string;
  alt: string;
  sourceUrl: string;
  bytes: number;
}
interface ManifestCollection {
  url: string;
  title: string;
  slug: string;
  artworks: ManifestArtwork[];
}
interface Manifest {
  scrapedAt: string;
  base: string;
  collections: ManifestCollection[];
}

function canonicalSlug(raw: string): string {
  return slugify(raw).replace(/-\d+$/, '');
}
function titleize(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const COLLECTION_HINTS: Record<string, { title: string; tagline: string }> = {
  'the-sun': { title: 'The Sun', tagline: 'Golden hour, natural light, the long lean of day.' },
  'the-night': { title: 'The Night', tagline: 'Low light, starlight, and the hours most cameras miss.' },
  'the-land': { title: 'The Land', tagline: 'Terrain, vista, and the slow geology of place.' },
  'the-macro': { title: 'The Macro', tagline: 'Small things held longer than the eye normally allows.' },
  flowers: { title: 'Flowers', tagline: 'Botanical studies.' },
  'the-unique': { title: 'The Unique', tagline: 'Experiments, one-offs, and the photographs that refuse a category.' },
};

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function loadManifest(): Manifest {
  const p = resolve(process.cwd(), 'data/archive-manifest.json');
  return JSON.parse(readFileSync(p, 'utf8')) as Manifest;
}

interface FlatArtwork {
  colCanonSlug: string;
  colTitle: string;
  colTagline: string | null;
  colDisplayOrder: number;
  idxInCol: number;
  title: string;
  rawSlug: string;
  filename: string;
  sourceUrl: string;
}

function flatten(manifest: Manifest): FlatArtwork[] {
  const flat: FlatArtwork[] = [];
  manifest.collections.forEach((c, colIdx) => {
    const canon = canonicalSlug(c.slug) || canonicalSlug(c.title);
    const hint = COLLECTION_HINTS[canon];
    const colTitle = hint?.title || titleize(canon);
    const colTagline = hint?.tagline || null;
    c.artworks.forEach((a, idx) => {
      flat.push({
        colCanonSlug: canon,
        colTitle,
        colTagline,
        colDisplayOrder: colIdx,
        idxInCol: idx,
        title: a.title && a.title !== a.slug ? a.title : titleize(slugify(a.slug) || ''),
        rawSlug:
          slugify(a.title === a.slug ? '' : a.title) ||
          slugify(a.slug) ||
          `${canon}-${String(idx + 1).padStart(3, '0')}`,
        filename: a.filename,
        sourceUrl: a.sourceUrl,
      });
    });
  });
  return flat;
}

export async function POST(req: Request) {
  const expected = process.env.BOOTSTRAP_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'bootstrap disabled' }, { status: 503 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  if (!constantTimeEqual(parsed.data.secret, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const publicBase = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!publicBase) return NextResponse.json({ error: 'R2_PUBLIC_BASE_URL missing' }, { status: 500 });

  const manifest = loadManifest();
  const all = flatten(manifest);
  const total = all.length;
  const { offset, limit } = parsed.data;
  const slice = all.slice(offset, offset + limit);

  // Ensure collections exist on first call; cheap idempotent upsert.
  const colIds = new Map<string, number>();
  for (const c of manifest.collections) {
    const canon = canonicalSlug(c.slug) || canonicalSlug(c.title);
    const hint = COLLECTION_HINTS[canon];
    const title = hint?.title || titleize(canon);
    const res = await pool.query<{ id: number }>(
      `INSERT INTO collections (slug, title, tagline, display_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title,
         tagline = COALESCE(collections.tagline, EXCLUDED.tagline),
         display_order = EXCLUDED.display_order
       RETURNING id`,
      [canon, title, hint?.tagline || null, manifest.collections.indexOf(c)],
    );
    colIds.set(canon, res.rows[0].id);
  }

  // Existing slugs (for unique-suffix disambiguation).
  const existing = await pool.query<{ slug: string; image_web_url: string }>(
    'SELECT slug, image_web_url FROM artworks',
  );
  const takenSlugs = new Set<string>(existing.rows.map((r) => r.slug));
  const existingByUrl = new Set<string>(existing.rows.map((r) => r.image_web_url));

  let imported = 0;
  let skipped = 0;
  const failures: Array<{ url: string; error: string }> = [];

  for (const a of slice) {
    const colId = colIds.get(a.colCanonSlug);
    if (!colId) {
      skipped++;
      continue;
    }
    const base = `${a.colCanonSlug}-${a.rawSlug}`;
    const slug = takenSlugs.has(base) ? uniqueSlug(base, takenSlugs) : base;
    takenSlugs.add(slug);

    const ext = (extname(a.filename) || '.jpg').toLowerCase();
    const key = `artworks/${a.colCanonSlug}/${slug}${ext}`;
    const targetUrl = `${publicBase}/${key}`;

    if (existingByUrl.has(targetUrl)) {
      skipped++;
      continue;
    }

    try {
      const res = await fetch(a.sourceUrl, {
        headers: { 'User-Agent': 'wildlight-import/1.0' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';
      await uploadPublic(key, buf, contentType);

      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO artworks (collection_id, slug, title, image_web_url, status, display_order)
           VALUES ($1, $2, $3, $4, 'draft', $5)
           ON CONFLICT (slug) DO UPDATE SET
             image_web_url = EXCLUDED.image_web_url,
             title = EXCLUDED.title,
             display_order = EXCLUDED.display_order,
             updated_at = NOW()`,
          [colId, slug, a.title || slug, targetUrl, a.idxInCol],
        );
      });
      existingByUrl.add(targetUrl);
      imported++;
    } catch (err) {
      failures.push({
        url: a.sourceUrl,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const processed = offset + slice.length;
  const nextOffset = processed < total ? processed : null;
  return NextResponse.json({
    ok: true,
    total,
    offset,
    processed: slice.length,
    imported,
    skipped,
    failures,
    nextOffset,
  });
}
