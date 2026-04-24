import 'dotenv/config';
import probe from 'probe-image-size';
import { pool } from '../lib/db';

interface Row {
  id: number;
  image_web_url: string;
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
    try {
      const dims = await probe(row.image_web_url);
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
