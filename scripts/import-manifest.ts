/*
 * Reads ./scraped/manifest.json, uploads every image to R2 (public bucket),
 * and inserts collection + draft artwork rows into Postgres.
 *
 * ADDITIVE ONLY, and genuinely idempotent. A re-run inserts anything new in the
 * manifest and touches nothing that already exists: no duplicate rows, no
 * re-uploads, no overwriting of anything edited in the admin since.
 *
 * That rests on two things working together, and breaking either one brings the
 * old bug back:
 *   1. Slug planning depends only on the manifest (lib/manifest-slugs.ts), so a
 *      re-run computes the SAME slug and collides with its own prior row. The
 *      old code seeded its taken-slugs set from the database, so every entry's
 *      own row made its slug look taken and it minted `-2` instead, which
 *      duplicated the catalogue and (because the R2 key embeds the slug)
 *      re-uploaded every image.
 *   2. Every write is ON CONFLICT DO NOTHING / COALESCE. An UPDATE here cannot
 *      tell an untouched imported row from one Dan has since retitled,
 *      recollected or re-imaged, so it must not write at all. Use the admin for
 *      changes; this script is for adding what is missing.
 */
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { pool, withTransaction } from '@/lib/db';
import { uploadPublic } from '@/lib/r2';
import { slugify } from '@/lib/slug';
import { canonicalSlug, planManifestSlugs } from '@/lib/manifest-slugs';

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
  for (const c of manifest.collections) {
    const canon = canonicalSlug(c.slug) || canonicalSlug(c.title);
    const hint = COLLECTION_HINTS[canon];
    const title = hint?.title || titleize(canon);

    // INSERT if new; on conflict, preserve existing tagline/cover and title in
    // case we renamed.
    //
    // display_order is NOT bumped on conflict any more. It is the arranged
    // collection order now (set from /admin/collections), and it drives the
    // admin filter tray and the /shop browse band, so a re-import must not
    // reset it. A genuinely new collection appends instead (see below).
    const res = await pool.query(
      // A NEW collection appends. `i` (the raw manifest index) would drop it
      // among the already-arranged positions, and on the first import into a
      // database that already has collections it would put every new one at
      // the FRONT of /admin/collections and the /shop browse band.
      `INSERT INTO collections (slug, title, tagline, display_order)
       VALUES ($1, $2, $3,
               (SELECT COALESCE(MAX(display_order), 0) + 1 FROM collections))
       ON CONFLICT (slug) DO UPDATE SET
         -- COALESCE, never EXCLUDED: a plain assignment would overwrite a title
         -- or tagline edited in the admin every time this ran. DO NOTHING is not
         -- an option here because the RETURNING id is needed either way.
         title = COALESCE(collections.title, EXCLUDED.title),
         tagline = COALESCE(collections.tagline, EXCLUDED.tagline)
       RETURNING id`,
      [canon, title, hint?.tagline || null],
    );
    collectionDbId.set(canon, res.rows[0].id);
    // eslint-disable-next-line no-console
    console.log(`  collection "${title}" (${canon}) -> id=${res.rows[0].id}`);
  }

  // --- bring existing artwork state into memory for idempotent re-runs --
  const existing = await pool.query<{ slug: string; image_web_url: string }>(
    'SELECT slug, image_web_url FROM artworks',
  );
  const existingByUrl = new Set<string>(existing.rows.map((r) => r.image_web_url));

  // Slug planning depends ONLY on the manifest (lib/manifest-slugs.ts), never
  // on what is already in the database. That is what makes a re-run land on
  // its own prior rows instead of minting slug-2 and duplicating everything.
  const plan = planManifestSlugs(manifest.collections);

  const publicBase = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!publicBase) throw new Error('R2_PUBLIC_BASE_URL missing — set it before running');

  // --- walk each collection, upload + upsert artwork rows ---------------
  let totalImported = 0;
  for (const [ci, c] of manifest.collections.entries()) {
    const canon = plan[ci].canon;
    const colId = collectionDbId.get(canon);
    if (!colId) continue;

    // eslint-disable-next-line no-console
    console.log(`\n[${canon}] ${c.artworks.length} artworks`);
    for (const [idx, a] of c.artworks.entries()) {
      const baseName =
        slugify(a.title === a.slug ? '' : a.title) ||
        slugify(a.slug) ||
        `${canon}-${String(idx + 1).padStart(3, '0')}`;
      const slug = plan[ci].slugs[idx];

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
        // The ON CONFLICT path below IS reachable now, and is the whole
        // mechanism: a re-run plans the same slug, hits its own prior row, and
        // does nothing. It used to be unreachable because slugs were planned
        // against the database, so every re-run minted a fresh slug and
        // INSERTed a duplicate.
        //
        // display_order is deliberately absent. It is the curated /shop order
        // now, arranged from /admin/wall, and writing a manifest index into it
        // would silently overwrite that. New rows keep the column default of 0,
        // which is the "never placed" sentinel the publish rules append from.
        await client.query(
          `INSERT INTO artworks (collection_id, slug, title, image_web_url, status)
           VALUES ($1, $2, $3, $4, 'draft')
           ON CONFLICT (slug) DO NOTHING`,
          [colId, slug, titleGuess, targetUrl],
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
