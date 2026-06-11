import { pool } from '../lib/db.ts';
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
process.exit(0);
