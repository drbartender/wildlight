/*
 * One-off: pull all artworks from prod DB, download each image, resize via
 * Python PIL to ~384px JPEG, write a manifest. Drives the local AI-draft
 * workflow (Claude Code views thumbnails, writes drafts, then draft-apply.mjs
 * UPDATEs each row).
 *
 * Reads .env.local for DATABASE_URL. Writes:
 *   /tmp/wlthumbs/<id>.jpg
 *   /tmp/wl-manifest.json
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import pg from 'pg';
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Use C:\tmp explicitly: bash /tmp and Node /tmp resolve differently from
// Python. C:\tmp is canonical for all three on this Windows box.
const THUMB_DIR = 'C:\\tmp\\wlthumbs';
const MANIFEST = 'C:\\tmp\\wl-manifest.json';
const THUMB_PX = 384;

mkdirSync(THUMB_DIR, { recursive: true });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const { rows } = await pool.query(`
  SELECT a.id, a.slug, a.title, a.image_web_url, a.year_shot, a.location,
         a.artist_note, c.slug AS collection_slug, c.title AS collection_title
  FROM artworks a
  LEFT JOIN collections c ON c.id = a.collection_id
  ORDER BY c.display_order NULLS LAST, a.display_order, a.id
`);

console.log(`Fetched ${rows.length} artworks. Downloading + resizing…`);

let done = 0;
let failed = 0;
const manifest = [];
const CONCURRENCY = 8;

async function processOne(r) {
  const thumbPath = `${THUMB_DIR}\\${r.id}.jpg`;
  const entry = {
    id: r.id,
    slug: r.slug,
    collection_slug: r.collection_slug,
    collection_title: r.collection_title,
    image_url: r.image_web_url,
    thumb_path: thumbPath,
    current: {
      title: r.title,
      year_shot: r.year_shot,
      location: r.location,
      artist_note: r.artist_note,
    },
  };
  manifest.push(entry);

  if (existsSync(thumbPath)) {
    done++;
    return;
  }

  // Disk round-trip avoids Windows binary-stdin corruption when Node spawns
  // Python with a piped buffer.
  const rawPath = `${THUMB_DIR}\\${r.id}.raw`;
  try {
    const res = await fetch(r.image_web_url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(rawPath, buf);

    const py = spawnSync(
      'python',
      [
        '-c',
        `import sys
from PIL import Image
img = Image.open(r"${rawPath}").convert('RGB')
img.thumbnail((${THUMB_PX}, ${THUMB_PX}), Image.LANCZOS)
img.save(r"${thumbPath}", 'JPEG', quality=82, optimize=True)
`,
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    if (py.status !== 0) {
      throw new Error(`python resize failed: ${py.stderr?.toString().slice(0, 300)}`);
    }
    done++;
  } catch (err) {
    failed++;
    console.error(`  fail id=${r.id} slug=${r.slug}: ${err.message}`);
  } finally {
    try { unlinkSync(rawPath); } catch {}
  }

  if ((done + failed) % 25 === 0) {
    process.stdout.write(`  ${done + failed}/${rows.length}\n`);
  }
}

for (let i = 0; i < rows.length; i += CONCURRENCY) {
  await Promise.all(rows.slice(i, i + CONCURRENCY).map(processOne));
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

await pool.end();
console.log(`\nDone. ${done} thumbnails ready, ${failed} failed.`);
console.log(`Manifest: ${MANIFEST}`);
console.log(`Thumbs:   ${THUMB_DIR}`);
