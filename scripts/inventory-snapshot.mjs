// One-shot inventory snapshot. Uses managed-host SSL verification
// (rejectUnauthorized: true), matching lib/db.ts conventions.
// Run: node scripts/inventory-snapshot.mjs
import { config } from 'dotenv';
config({ path: '.env.local' });
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not found in .env.local');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: true },
  connectionTimeoutMillis: 15_000,
  statement_timeout: 15_000,
});

try {
  await client.connect();

  const totals = await client.query(`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status='published')::int AS published,
      count(*) FILTER (WHERE status='draft')::int AS draft,
      count(*) FILTER (WHERE image_web_url IS NOT NULL)::int AS with_web,
      count(*) FILTER (WHERE image_print_url IS NOT NULL)::int AS sellable
    FROM artworks
  `);
  console.log('TOTALS', JSON.stringify(totals.rows[0]));

  const live = await client.query(`
    SELECT count(*)::int AS sellable_published_with_print
    FROM artworks
    WHERE status='published'
      AND image_print_url IS NOT NULL
      AND image_web_url IS NOT NULL
  `);
  console.log('SELLABLE_LIVE', JSON.stringify(live.rows[0]));

  const byCol = await client.query(`
    SELECT c.title AS collection,
           count(a.*)::int AS total,
           count(a.*) FILTER (WHERE a.status='published')::int AS published
    FROM artworks a
    LEFT JOIN collections c ON c.id = a.collection_id
    GROUP BY c.title
    ORDER BY total DESC
  `);
  console.log('BY_COLLECTION', JSON.stringify(byCol.rows));
} catch (err) {
  console.error('ERR', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
