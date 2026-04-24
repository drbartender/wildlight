import 'dotenv/config';
import probe from 'probe-image-size';
import { pool } from '../lib/db';

interface Row {
  id: number;
  image_web_url: string;
}

// `image_web_url` isn't schema-constrained to a prefix the way
// `image_print_url` is, so a hypothetical bad PATCH could seed an
// internal URL. Accept only the R2-public host or common CDN hostnames.
const ALLOWED_HOST_SUFFIXES = [
  '.r2.dev',
  '.r2.cloudflarestorage.com',
  'wildlight.co',
  'wildlightimagery.com',
];

function allowedHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return ALLOWED_HOST_SUFFIXES.some(
    (s) => host === s.replace(/^\./, '') || host.endsWith(s),
  );
}

async function main() {
  const { rows } = await pool.query<Row>(
    `SELECT id, image_web_url
     FROM artworks
     WHERE (image_width IS NULL OR image_height IS NULL)
       AND image_web_url IS NOT NULL`,
  );
  console.log(`${rows.length} artworks missing dimensions.`);

  for (const row of rows) {
    if (!allowedHost(row.image_web_url)) {
      console.error(
        `err ${String(row.id).padStart(4)}  refusing non-allowlisted host: ${row.image_web_url}`,
      );
      continue;
    }
    try {
      const dims = await probe(row.image_web_url, { timeout: 10_000 });
      await pool.query(
        `UPDATE artworks SET image_width = $1, image_height = $2 WHERE id = $3`,
        [dims.width, dims.height, row.id],
      );
      console.log(`ok  ${String(row.id).padStart(4)}  ${dims.width}x${dims.height}`);
    } catch (err) {
      console.error(
        `err ${String(row.id).padStart(4)}  ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
