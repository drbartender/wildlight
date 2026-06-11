// Read-only: download + measure print masters that have no recorded
// print_width/print_height. Does NOT write to the DB.
// Run: npx dotenv -e .env.vercel.local -- npx tsx scripts/measure-unmeasured.ts
import 'dotenv/config';
import sharp from 'sharp';
import { pool } from '../lib/db';
import { getPrivateBuffer } from '../lib/r2';

interface Row {
  id: number;
  title: string;
  status: string;
  image_print_url: string;
}

const BIGGEST_LONG_EDGE = 36; // 24x36 is the largest paper/canvas/framed size

function grade(dpi: number): string {
  if (dpi >= 300) return 'EXCELLENT';
  if (dpi >= 240) return 'great';
  if (dpi >= 180) return 'good';
  if (dpi >= 150) return 'ok';
  return 'SOFT';
}

async function main() {
  const { rows } = await pool.query<Row>(
    `SELECT id, title, status, image_print_url
     FROM artworks
     WHERE image_print_url IS NOT NULL AND image_print_url <> ''
       AND (print_width IS NULL OR print_height IS NULL)
     ORDER BY status, id`,
  );
  console.log(`Measuring ${rows.length} unmeasured print masters (read-only)...\n`);
  console.log(' id  status      print W×H        MP     long  DPI@36"  verdict   title');
  console.log('─'.repeat(104));

  for (const row of rows) {
    try {
      if (!row.image_print_url.startsWith('artworks-print/')) {
        console.log(`${String(row.id).padStart(3)}  bad key: ${row.image_print_url}`);
        continue;
      }
      const buf = await getPrivateBuffer(row.image_print_url);
      const meta = await sharp(buf).metadata();
      if (!meta.width || !meta.height) {
        console.log(`${String(row.id).padStart(3)}  no dimensions read`);
        continue;
      }
      const rotated = (meta.orientation ?? 1) >= 5 && (meta.orientation ?? 1) <= 8;
      const w = rotated ? meta.height : meta.width;
      const h = rotated ? meta.width : meta.height;
      const le = Math.max(w, h);
      const mp = (w * h) / 1e6;
      const dpi36 = Math.round(le / BIGGEST_LONG_EDGE);
      console.log(
        `${String(row.id).padStart(3)}  ${row.status.padEnd(10)}  ${`${w}×${h}`.padEnd(15)}  ${mp.toFixed(1).padStart(4)}  ${String(le).padStart(5)}   ${String(dpi36).padStart(5)}   ${grade(dpi36).padEnd(9)} ${row.title}`,
      );
    } catch (err) {
      console.log(`${String(row.id).padStart(3)}  ERROR ${err instanceof Error ? err.message : err}`);
    }
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
