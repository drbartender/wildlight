/*
 * Reads ./scraped/manifest.json, uploads every image to R2 (public bucket),
 * and upserts collection + draft artwork rows into Postgres.
 *
 * Idempotent — safe to re-run. Skips re-upload if an artwork with the same
 * target R2 URL is already in the DB.
 */
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { pool, withTransaction } from '@/lib/db';
import { uploadPublic } from '@/lib/r2';
import { slugify, uniqueSlug } from '@/lib/slug';

config({ path: '.env.local' });

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

/**
 * Strip trailing `-\d+` dedup suffix the scraper added when discovering the
 * same collection via multiple URLs. "the-sun-3" -> "the-sun".
 */
function canonicalSlug(raw: string): string {
  return slugify(raw).replace(/-\d+$/, '');
}

/** "the-sun" -> "The Sun". */
function titleize(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Hand-picked lyrical taglines per the design spec. Safe to edit later in the
 * admin UI; re-running this import does NOT overwrite existing tagline/cover.
 */
const COLLECTION_HINTS: Record<string, { title: string; tagline: string }> = {
  'the-sun': { title: 'The Sun', tagline: 'Golden hour, natural light, the long lean of day.' },
  'the-night': { title: 'The Night', tagline: 'Low light, starlight, and the hours most cameras miss.' },
  'the-land': { title: 'The Land', tagline: 'Terrain, vista, and the slow geology of place.' },
  'the-macro': { title: 'The Macro', tagline: 'Small things held longer than the eye normally allows.' },
  flowers: { title: 'Flowers', tagline: 'Botanical studies.' },
  'the-unique': { title: 'The Unique', tagline: 'Experiments, one-offs, and the photographs that refuse a category.' },
};

async function main() {
  const manifestPath = resolve(process.cwd(), 'scraped/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  // eslint-disable-next-line no-console
  console.log(`Importing ${manifest.collections.length} collections from ${manifestPath}`);

  // --- upsert collections (canonical slugs + hints) ---------------------
  const collectionDbId = new Map<string, number>();  // canonical slug -> db id
  for (const [i, c] of manifest.collections.entries()) {
    const canon = canonicalSlug(c.slug) || canonicalSlug(c.title);
    const hint = COLLECTION_HINTS[canon];
    const title = hint?.title || titleize(canon);

    // INSERT if new; on conflict, preserve existing tagline/cover but bump display_order
    // and title in case we renamed.
    const res = await pool.query(
      `INSERT INTO collections (slug, title, tagline, display_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title,
         tagline = COALESCE(collections.tagline, EXCLUDED.tagline),
         display_order = EXCLUDED.display_order
       RETURNING id`,
      [canon, title, hint?.tagline || null, i],
    );
    collectionDbId.set(canon, res.rows[0].id);
    // eslint-disable-next-line no-console
    console.log(`  collection "${title}" (${canon}) -> id=${res.rows[0].id}`);
  }

  // --- bring existing artwork state into memory for idempotent re-runs --
  const existing = await pool.query<{ slug: string; image_web_url: string }>(
    'SELECT slug, image_web_url FROM artworks',
  );
  const takenSlugs = new Set<string>(existing.rows.map((r) => r.slug));
  const existingByUrl = new Set<string>(existing.rows.map((r) => r.image_web_url));

  const publicBase = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!publicBase) throw new Error('R2_PUBLIC_BASE_URL missing — set it before running');

  // --- walk each collection, upload + upsert artwork rows ---------------
  let totalImported = 0;
  for (const c of manifest.collections) {
    const canon = canonicalSlug(c.slug) || canonicalSlug(c.title);
    const colId = collectionDbId.get(canon);
    if (!colId) continue;

    // eslint-disable-next-line no-console
    console.log(`\n[${canon}] ${c.artworks.length} artworks`);
    for (const [idx, a] of c.artworks.entries()) {
      const baseName =
        slugify(a.title === a.slug ? '' : a.title) ||
        slugify(a.slug) ||
        `${canon}-${String(idx + 1).padStart(3, '0')}`;
      // Namespace slugs by collection to avoid cross-collection collisions.
      const qualifiedBase = `${canon}-${baseName}`;
      const slug = uniqueSlug(qualifiedBase, takenSlugs);
      takenSlugs.add(slug);

      const ext = (extname(a.filename) || '.jpg').toLowerCase();
      const r2Key = `artworks/${canon}/${slug}${ext}`;
      const targetUrl = `${publicBase}/${r2Key}`;
      const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';

      // Upload only if this target URL isn't already in the DB.
      if (!existingByUrl.has(targetUrl)) {
        // Prefer the scraper's local copy; fall back to re-downloading from the source URL.
        const localPath = join(process.cwd(), 'scraped', c.slug, a.filename);
        let body: Buffer;
        try {
          body = readFileSync(localPath);
        } catch {
          // eslint-disable-next-line no-console
          console.warn(`    local file missing for ${a.filename}, refetching ${a.sourceUrl}`);
          const res = await fetch(a.sourceUrl);
          if (!res.ok) {
            console.warn(`    fetch failed ${res.status}; skipping`);
            continue;
          }
          body = Buffer.from(await res.arrayBuffer());
        }
        await uploadPublic(r2Key, body, contentType);
      }

      // Title: prefer human-written when it differs from filename-slug.
      const titleGuess = a.title && a.title !== a.slug ? a.title : titleize(baseName);

      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO artworks (collection_id, slug, title, image_web_url, status, display_order)
           VALUES ($1, $2, $3, $4, 'draft', $5)
           ON CONFLICT (slug) DO UPDATE SET
             collection_id = EXCLUDED.collection_id,
             title = EXCLUDED.title,
             image_web_url = EXCLUDED.image_web_url,
             display_order = EXCLUDED.display_order,
             updated_at = NOW()`,
          [colId, slug, titleGuess, targetUrl, idx],
        );
      });
      totalImported++;
      process.stdout.write('.');
    }
    process.stdout.write('\n');
  }

  // --- summary ---------------------------------------------------------
  const counts = await pool.query(
    `SELECT c.title, COUNT(a.id)::int AS n
     FROM collections c LEFT JOIN artworks a ON a.collection_id = c.id
     GROUP BY c.id, c.title ORDER BY c.display_order`,
  );
  // eslint-disable-next-line no-console
  console.log(`\nImport complete — ${totalImported} artworks processed.`);
  for (const row of counts.rows) {
    // eslint-disable-next-line no-console
    console.log(`  ${row.title}: ${row.n}`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
