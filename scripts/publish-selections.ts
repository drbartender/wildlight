/*
 * Reads scraped/selections.json (exported from scraped/curate.html) and flips
 * the chosen artworks to status='published'. Anything currently 'published'
 * but NOT in the selection gets dropped back to 'draft' so re-runs converge.
 *
 * Usage:
 *   npm run publish:selections           # dry-run, prints what would change
 *   npm run publish:selections -- --apply  # actually commit
 *
 * Mapping: each selection has { collection_title, collection_index }.
 *   - collection_title is the manifest collection name (e.g. "the-sun-3")
 *   - import-manifest.ts canonicalizes that ("the-sun") and uses idx as display_order
 *   - so we look up by (collection.slug, artwork.display_order)
 */
import { config } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { slugify } from '@/lib/slug';
import { publishArtworks } from '@/lib/publish-artworks';

// Load .env.local first, let .env.production.local override when present.
// Pull prod env with:
//   npx vercel -Q ~/.vercel-cli env pull --environment=production .env.production.local --yes
config({ path: '.env.local' });
if (existsSync('.env.production.local')) {
  config({ path: '.env.production.local', override: true });
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is empty. Pull prod env first:');
  console.error('  npx vercel -Q ~/.vercel-cli env pull --environment=production .env.production.local --yes');
  process.exit(1);
}

// Diagnostic — show which DB we're hitting (host only, no creds).
try {
  const u = new URL(url.replace(/^postgres(ql)?:/, 'http:'));
  console.log(`DB: ${u.hostname}${u.port ? ':' + u.port : ''} / ${u.pathname.slice(1)}\n`);
} catch {
  console.log('DB: (unparseable URL)\n');
}

const wantsNoSsl =
  /@(localhost|127\.0\.0\.1|::1)(:\d+)?\//.test(url) ||
  /[?&]sslmode=disable\b/i.test(url);
const pool = new Pool({
  connectionString: url,
  ssl: wantsNoSsl ? false : { rejectUnauthorized: true },
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
  statement_timeout: 30_000,
});

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

interface Selection {
  collection_title: string;
  collection_index: number;
  filename: string;
  slug: string;
  title: string;
}
interface SelectionsFile {
  exported_at: string;
  count: number;
  target: number;
  selections: Selection[];
}

function canonicalSlug(raw: string): string {
  return slugify(raw).replace(/-\d+$/, '');
}

async function main() {
  const apply = process.argv.includes('--apply');
  const path = resolve(process.cwd(), 'scraped/selections.json');
  const file = JSON.parse(readFileSync(path, 'utf8')) as SelectionsFile;

  console.log(`Loaded ${file.selections.length} selections from ${path}`);
  console.log(`(target was ${file.target}, exported ${file.exported_at})\n`);

  if (file.selections.length !== file.target) {
    console.warn(`! count ${file.selections.length} != target ${file.target}\n`);
  }

  // group by canonical collection slug
  const byCollection = new Map<string, number[]>();
  for (const s of file.selections) {
    const canon = canonicalSlug(s.collection_title);
    if (!byCollection.has(canon)) byCollection.set(canon, []);
    byCollection.get(canon)!.push(s.collection_index);
  }

  // find each artwork in the DB
  type Row = { id: number; slug: string; title: string; status: string; display_order: number };
  const targetIds = new Set<number>();
  const missing: string[] = [];
  for (const [canon, indices] of byCollection) {
    const colRes = await pool.query<{ id: number }>(
      'SELECT id FROM collections WHERE slug = $1',
      [canon],
    );
    if (!colRes.rows.length) {
      console.warn(`! collection "${canon}" not in DB — skipping ${indices.length} selections`);
      indices.forEach((i) => missing.push(`${canon}[${i}]`));
      continue;
    }
    const colId = colRes.rows[0].id;
    const artRes = await pool.query<Row>(
      `SELECT id, slug, title, status, display_order
       FROM artworks
       WHERE collection_id = $1 AND display_order = ANY($2::int[])
       ORDER BY display_order`,
      [colId, indices],
    );
    const found = new Set(artRes.rows.map((r) => r.display_order));
    for (const i of indices) {
      if (!found.has(i)) missing.push(`${canon}[${i}]`);
    }
    artRes.rows.forEach((r) => targetIds.add(r.id));
    console.log(`  ${canon}: ${artRes.rows.length} matched of ${indices.length} requested`);
  }

  if (missing.length) {
    console.warn(`\n! ${missing.length} selections did not match a DB row:`);
    missing.forEach((m) => console.warn('    ' + m));
  }

  // figure out the diff: who needs to flip published -> draft, and who draft -> published
  const allRes = await pool.query<{ id: number; slug: string; status: string }>(
    'SELECT id, slug, status FROM artworks',
  );
  const toPublish: { id: number; slug: string }[] = [];
  const toUnpublish: { id: number; slug: string }[] = [];
  for (const r of allRes.rows) {
    const want = targetIds.has(r.id) ? 'published' : 'draft';
    if (r.status === 'published' && want === 'draft') toUnpublish.push(r);
    else if (r.status !== 'published' && want === 'published') toPublish.push(r);
  }

  console.log(`\nDiff:`);
  console.log(`  → publish: ${toPublish.length}`);
  toPublish.forEach((r) => console.log(`      + ${r.slug}`));
  console.log(`  → unpublish (revert to draft): ${toUnpublish.length}`);
  toUnpublish.forEach((r) => console.log(`      - ${r.slug}`));

  if (!apply) {
    console.log(`\n(dry run — no DB changes. Re-run with --apply to commit.)`);
    await pool.end();
    return;
  }

  if (toPublish.length === 0 && toUnpublish.length === 0) {
    console.log(`\nNothing to change. DB already matches selections.`);
    await pool.end();
    return;
  }

  let publishSkipped = 0;
  await withTransaction(async (client) => {
    if (toPublish.length) {
      // Shared gate enforces image_print_url IS NOT NULL + stamps
      // published_at on first-publish, matching the API surface.
      const out = await publishArtworks(
        client,
        toPublish.map((r) => r.id),
      );
      publishSkipped = out.skipped;
    }
    if (toUnpublish.length) {
      await client.query(
        `UPDATE artworks SET status='draft', updated_at=NOW() WHERE id = ANY($1::int[])`,
        [toUnpublish.map((r) => r.id)],
      );
    }
  });

  if (publishSkipped > 0) {
    console.warn(
      `\n! ${publishSkipped} of ${toPublish.length} could not publish (missing print master).`,
    );
  }
  console.log(`\nApplied. ${toPublish.length - publishSkipped} published, ${toUnpublish.length} reverted to draft.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
