import 'dotenv/config';
import sharp from 'sharp';
import { pool } from '../lib/db';
import { getPrivateBuffer } from '../lib/r2';

interface Row {
  id: number;
  image_print_url: string;
}

async function main() {
  const { rows } = await pool.query<Row>(
    `SELECT id, image_print_url
     FROM artworks
     WHERE image_print_url IS NOT NULL
       AND image_print_url <> ''
       AND (print_width IS NULL OR print_height IS NULL)`,
  );
  console.log(`${rows.length} artworks missing print dimensions.`);

  for (const row of rows) {
    try {
      // image_print_url is the R2 private path key (artworks-print/.../...).
      // PATCH route enforces the prefix; we still re-check here so a
      // hypothetical malformed row can't be passed to getPrivateBuffer.
      if (!row.image_print_url.startsWith('artworks-print/')) {
        console.error(`err ${String(row.id).padStart(4)}  bad key: ${row.image_print_url}`);
        continue;
      }
      const buf = await getPrivateBuffer(row.image_print_url);
      const meta = await sharp(buf).metadata();
      if (!meta.width || !meta.height) {
        console.error(`err ${String(row.id).padStart(4)}  no dimensions read`);
        continue;
      }
      const rotated = (meta.orientation ?? 1) >= 5 && (meta.orientation ?? 1) <= 8;
      const w = rotated ? meta.height : meta.width;
      const h = rotated ? meta.width : meta.height;
      await pool.query(
        `UPDATE artworks SET print_width = $1, print_height = $2 WHERE id = $3`,
        [w, h, row.id],
      );
      console.log(`ok  ${String(row.id).padStart(4)}  ${w}×${h}`);
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
