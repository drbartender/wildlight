// Read-only: list a few active variants on published artworks (smoke check).
// Run: node scripts/find-variants.mjs
import { config } from 'dotenv';
config({ path: '.env.local' });
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

try {
  const r = await pool.query(`
    SELECT v.id, v.price_cents, v.type, v.size, v.finish,
           a.id AS artwork_id, a.slug, a.title, a.image_web_url
      FROM artwork_variants v
      JOIN artworks a ON a.id = v.artwork_id
     WHERE v.active AND a.status = 'published'
     ORDER BY v.id
     LIMIT 5
  `);
  console.log(JSON.stringify(r.rows, null, 2));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
