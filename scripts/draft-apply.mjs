/*
 * One-off: read /tmp/wl-drafts.json (produced by Claude viewing thumbnails)
 * and UPDATE artworks.title/location/artist_note for each id. Skips year_shot
 * (EXIF-only — never AI-guessed).
 *
 * Idempotent: rerun safe. Wrapped in a transaction per row so a single bad
 * row can't poison the whole batch.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import pg from 'pg';
import { readFileSync } from 'node:fs';

const DRAFTS_PATH = process.argv[2] || 'C:\\tmp\\wl-drafts.json';
const drafts = JSON.parse(readFileSync(DRAFTS_PATH, 'utf8'));

console.log(`Loaded ${drafts.length} drafts from ${DRAFTS_PATH}`);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

let ok = 0;
let skipped = 0;
let failed = 0;
const failures = [];

for (const d of drafts) {
  if (!d.id || !d.title || !d.artist_note) {
    skipped++;
    continue;
  }
  try {
    const res = await pool.query(
      `UPDATE artworks
       SET title = $1, location = $2, artist_note = $3, updated_at = NOW()
       WHERE id = $4`,
      [d.title, d.location ?? null, d.artist_note, d.id],
    );
    if (res.rowCount === 0) {
      failed++;
      failures.push({ id: d.id, reason: 'no row' });
    } else {
      ok++;
    }
  } catch (err) {
    failed++;
    failures.push({ id: d.id, reason: err.message });
  }
  if ((ok + failed + skipped) % 25 === 0) {
    process.stdout.write(`  ${ok + failed + skipped}/${drafts.length}\n`);
  }
}

await pool.end();

console.log(`\nDone. ${ok} updated, ${skipped} skipped (incomplete drafts), ${failed} failed.`);
if (failures.length) {
  console.log('Failures:');
  for (const f of failures) console.log(`  id=${f.id} reason=${f.reason}`);
}
