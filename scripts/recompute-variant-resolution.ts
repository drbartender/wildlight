import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { pool, withTransaction } from '../lib/db';
import { evaluateSizeResolution, maxSupportedSize } from '../lib/print-resolution';
import { refreshVariantResolution } from '../lib/variant-resolution';

const APPLY = process.argv.includes('--apply');

interface Row {
  artwork_id: number;
  title: string;
  status: string;
  print_width: number | null;
  print_height: number | null;
  variant_id: number;
  size: string;
  min_resolution_ok: boolean | null;
}

async function main() {
  const { rows } = await pool.query<Row>(
    `SELECT a.id AS artwork_id, a.title, a.status, a.print_width, a.print_height,
            v.id AS variant_id, v.size, v.min_resolution_ok
     FROM artwork_variants v JOIN artworks a ON a.id = v.artwork_id
     ORDER BY a.status, a.id, v.size`,
  );

  // Group by artwork; report which would drop to zero buyable (vanish from shop).
  const byArtwork = new Map<number, Row[]>();
  for (const r of rows) {
    if (!byArtwork.has(r.artwork_id)) byArtwork.set(r.artwork_id, []);
    byArtwork.get(r.artwork_id)!.push(r);
  }

  let willBlock = 0;
  const vanishing: string[] = [];
  for (const [, group] of byArtwork) {
    const a = group[0];
    if (a.print_width == null || a.print_height == null) continue;
    let anyOk = false;
    for (const v of group) {
      const ok = evaluateSizeResolution(a.print_width, a.print_height, v.size).ok;
      if (ok) anyOk = true;
      if (!ok && v.min_resolution_ok !== false) willBlock++;
    }
    if (!anyOk) vanishing.push(`  [${a.status}] ${a.title} (#${a.artwork_id})`);
  }

  console.log(`${rows.length} variants across ${byArtwork.size} artworks.`);
  console.log(`Sizes that will become blocked: ${willBlock}`);
  console.log(`Artworks that will have NO buyable size (vanish from shop):`);
  console.log(vanishing.length ? vanishing.join('\n') : '  (none)');

  if (!APPLY) {
    // Reviewable markdown report (same spirit as the 2026-06-06 audit table).
    const md: string[] = [
      '# Resolution recompute — dry run',
      '',
      `Total: ${rows.length} variants across ${byArtwork.size} artworks. ` +
        `Sizes that will block: ${willBlock}. Artworks vanishing from shop: ${vanishing.length}.`,
      '',
      '| id | status | master | max buyable size | blocked sizes |',
      '|----|--------|--------|------------------|---------------|',
    ];
    for (const [artworkId, group] of byArtwork) {
      const a = group[0];
      const measured = a.print_width != null && a.print_height != null;
      const dims = measured ? `${a.print_width}×${a.print_height}` : 'unmeasured';
      const maxSize = measured
        ? maxSupportedSize(a.print_width!, a.print_height!, group.map((g) => g.size)) ?? 'NONE'
        : '—';
      const blocked = measured
        ? group
            .filter((g) => !evaluateSizeResolution(a.print_width!, a.print_height!, g.size).ok)
            .map((g) => g.size)
            .join(' ')
        : '';
      md.push(`| ${artworkId} | ${a.status} | ${dims} | ${maxSize} | ${blocked} |`);
    }
    mkdirSync('.review', { recursive: true });
    writeFileSync('.review/resolution-dry-run.md', md.join('\n') + '\n');
    console.log('\nDry run. Report written to .review/resolution-dry-run.md');
    console.log('Re-run with --apply to write min_resolution_ok.');
    await pool.end();
    return;
  }

  for (const artworkId of byArtwork.keys()) {
    await withTransaction((tx) => refreshVariantResolution(tx, artworkId));
  }
  console.log('\nApplied. min_resolution_ok written for all variants.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
