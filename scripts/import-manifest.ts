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
  // DISABLED. This script is NOT idempotent, despite its own comments saying so,
  // and a re-run is destructive in three ways.
  //
  // `takenSlugs` is seeded from every slug already in the database, and
  // `uniqueSlug` returns something not in that set, so the deterministic
  // `<collection>-<title>` slug is already taken on a second run and comes back
  // as `...-2`. That is a NEW slug, so ON CONFLICT (slug) never fires and the
  // row is INSERTed again. Because r2Key embeds the slug, the target URL
  // differs too, so the existingByUrl upload-skip misses and every image is
  // re-uploaded. A third run gives `...-3`. It also overwrites admin-edited
  // titles via `title = EXCLUDED.title`.
  //
  // Fixing it properly needs a stable identity for "which row is this manifest
  // entry", which slug cannot be — that is the bug. The alternative, seeding
  // takenSlugs per-run, lets an import silently adopt and overwrite an
  // admin-created artwork that happens to share a slug.
  //
  // It is fenced rather than repaired because its input is gone (there is no
  // scraped/ directory; the catalogue was imported in April 2026) and its
  // sibling scripts/publish-selections.ts is fenced for the same reason. If a
  // re-import is ever genuinely needed, that is a redesign, not a re-run.
  // The override is a string, not a boolean flag, so it cannot be set by
  // accident and reads as an acknowledgement at the call site. It also keeps
  // the body reachable for the type checker, which narrows everything after a
  // bare process.exit() to `never`.
  if (process.env.ALLOW_MANIFEST_IMPORT !== 'yes-i-know-this-duplicates') {
    console.error(
      'import:manifest is disabled. It is not idempotent: a re-run duplicates the ' +
        'entire catalogue as <slug>-2, re-uploads every image to R2, and overwrites ' +
        'admin-edited titles. See the comment in scripts/import-manifest.ts.\n' +
        'If you have read that comment and still mean it, set ' +
        'ALLOW_MANIFEST_IMPORT=yes-i-know-this-duplicates.',
    );
    process.exit(1);
  }

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
         title = EXCLUDED.title,
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
        // NOTE: the ON CONFLICT (slug) path below is UNREACHABLE on a re-run.
        // `takenSlugs` is seeded from every slug already in the database
        // (see above), and `uniqueSlug` returns something not in that set, so
        // the slug is new by construction and this always INSERTs. Two
        // consequences worth knowing before editing this block:
        //   1. There is no "re-file an existing artwork" path here to guard.
        //   2. Re-running this script DUPLICATES the catalogue (slug-2, slug-3)
        //      and re-uploads every image, because r2Key embeds the slug so the
        //      existingByUrl skip misses too. The header's "idempotent" claim is
        //      false. Not fixed here; see the fix list.
        //
        // display_order is the curated All order now, arranged from /admin/wall.
        // Writing a manifest index here would silently overwrite it on every
        // re-import. New rows keep the column default of 0, the "never placed"
        // sentinel the publish rules append from.
        await client.query(
          `INSERT INTO artworks (collection_id, slug, title, image_web_url, status)
           VALUES ($1, $2, $3, $4, 'draft')
           ON CONFLICT (slug) DO UPDATE SET
             collection_id = EXCLUDED.collection_id,
             title = EXCLUDED.title,
             image_web_url = EXCLUDED.image_web_url,
             updated_at = NOW()`,
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
