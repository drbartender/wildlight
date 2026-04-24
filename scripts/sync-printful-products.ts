import { config } from 'dotenv';
import { pool } from '@/lib/db';
import { syncArtworkProducts } from '@/lib/printful-sync';

config({ path: '.env.local' });

async function main() {
  const arg = process.argv[2];
  const targets: number[] = [];
  if (arg === 'all') {
    const r = await pool.query<{ id: number }>(
      `SELECT id FROM artworks WHERE status='published' AND image_print_url IS NOT NULL`,
    );
    for (const row of r.rows) targets.push(row.id);
  } else if (arg) {
    targets.push(Number(arg));
  } else {
    console.error('usage: npm run sync:printful <artworkId | "all">');
    process.exit(1);
  }

  for (const id of targets) {
    if (!id) continue;
    try {
      const res = await syncArtworkProducts(id);
      // eslint-disable-next-line no-console
      console.log(`art ${id}: ${res.created} variants synced`);
    } catch (err) {
      console.warn(
        `art ${id}: FAIL ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
