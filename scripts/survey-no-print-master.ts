// One-off survey: list artworks lacking a print master + total counts.
// Read-only.
// Run: npx dotenv-cli -e .env.local -- tsx scripts/survey-no-print-master.ts
import { pool } from '@/lib/db';

async function main() {
  const total = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM artworks`,
  );
  const noPrint = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM artworks WHERE image_print_url IS NULL`,
  );
  const byStatus = await pool.query<{ status: string; n: number }>(
    `SELECT status, COUNT(*)::int AS n FROM artworks GROUP BY status ORDER BY status`,
  );

  console.log(`Total artworks: ${total.rows[0].n}`);
  console.log(`Without print master: ${noPrint.rows[0].n}`);
  console.log('By status:');
  for (const r of byStatus.rows) console.log(`  ${r.status}: ${r.n}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
