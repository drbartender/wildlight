import { pool } from '@/lib/db';

async function main() {
  const apply = process.argv.includes('--apply');

  const r = await pool.query<{ id: number; slug: string; title: string }>(
    `SELECT id, slug, title FROM artworks
     WHERE status = 'published' AND image_print_url IS NULL
     ORDER BY id`,
  );

  if (!r.rowCount) {
    console.log('No published artworks are missing a print master.');
    await pool.end();
    return;
  }

  console.log(`Found ${r.rowCount} published artwork(s) without a print master:`);
  for (const row of r.rows) {
    console.log(`  - id=${row.id}  slug=${row.slug}  "${row.title}"`);
  }

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to demote them to draft.');
    await pool.end();
    return;
  }

  const u = await pool.query<{ slug: string }>(
    `UPDATE artworks
     SET status = 'draft', updated_at = NOW()
     WHERE status = 'published' AND image_print_url IS NULL
     RETURNING slug`,
  );
  console.log(`\nDemoted ${u.rowCount ?? 0} artwork(s).`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
