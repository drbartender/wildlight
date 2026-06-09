import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { pool, withTransaction } from '../lib/db';
import {
  evaluateSizeResolution,
  maxSupportedSize,
  shortEdgeInches,
} from '../lib/print-resolution';
import { refreshVariantResolution } from '../lib/variant-resolution';

const APPLY = process.argv.includes('--apply');

interface Row {
  artwork_id: number;
  title: string;
  status: string;
  print_width: number | null;
  print_height: number | null;
  image_print_url: string | null;
  variant_id: number;
  size: string;
  min_resolution_ok: boolean | null;
}

async function main() {
  const { rows } = await pool.query<Row>(
    `SELECT a.id AS artwork_id, a.title, a.status, a.print_width, a.print_height,
            a.image_print_url,
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

  // Mirror refreshVariantResolution's branching so the dry-run report
  // matches what --apply will actually write to each row.
  let willBlockLowDpi = 0;
  let willBlockNoMaster = 0;
  let willLeaveNullUnparseable = 0;
  let willLeaveNullUnmeasured = 0;
  let willPass = 0;
  const vanishing: string[] = [];
  const noMasterArtworks: string[] = [];
  for (const [, group] of byArtwork) {
    const a = group[0];
    const hasMaster = !!a.image_print_url;
    if (!hasMaster) {
      // --apply writes min_resolution_ok=FALSE for every variant on a
      // master-less artwork (fail-CLOSED). Surface that.
      willBlockNoMaster += group.length;
      noMasterArtworks.push(`  [${a.status}] ${a.title} (#${a.artwork_id})`);
      vanishing.push(`  [${a.status}] ${a.title} (#${a.artwork_id}) — no master`);
      continue;
    }
    const measured = a.print_width != null && a.print_height != null;
    if (!measured) {
      // dims NULL but has master → fail-open NULL for every variant.
      willLeaveNullUnmeasured += group.length;
      continue;
    }
    let anyOk = false;
    for (const v of group) {
      if (shortEdgeInches(v.size) == null) {
        // Unparseable label → --apply writes NULL, not FALSE.
        willLeaveNullUnparseable++;
        continue;
      }
      const ok = evaluateSizeResolution(a.print_width!, a.print_height!, v.size).ok;
      if (ok) {
        anyOk = true;
        willPass++;
      } else {
        willBlockLowDpi++;
      }
    }
    if (!anyOk) vanishing.push(`  [${a.status}] ${a.title} (#${a.artwork_id})`);
  }

  const willBlockTotal = willBlockLowDpi + willBlockNoMaster;
  const reconcileTotal =
    willPass +
    willBlockLowDpi +
    willBlockNoMaster +
    willLeaveNullUnparseable +
    willLeaveNullUnmeasured;
  console.log(`${rows.length} variants across ${byArtwork.size} artworks.`);
  console.log(`  will pass (TRUE)                : ${willPass}`);
  console.log(`  will be blocked: low DPI (FALSE): ${willBlockLowDpi}`);
  console.log(`  will be blocked: no master (FALSE): ${willBlockNoMaster}`);
  console.log(`  unparseable size (left NULL)    : ${willLeaveNullUnparseable}`);
  console.log(`  unmeasured dims (left NULL)     : ${willLeaveNullUnmeasured}`);
  console.log(`  total reconciled                : ${reconcileTotal} / ${rows.length}`);
  console.log(`Artworks that will have NO buyable size (vanish from shop):`);
  console.log(vanishing.length ? vanishing.join('\n') : '  (none)');
  if (noMasterArtworks.length) {
    console.log(`Artworks missing a print master (every variant flips to FALSE):`);
    console.log(noMasterArtworks.join('\n'));
  }

  if (!APPLY) {
    // Reviewable markdown report (same spirit as the 2026-06-06 audit table).
    const md: string[] = [
      '# Resolution recompute — dry run',
      '',
      `Total: ${rows.length} variants across ${byArtwork.size} artworks.`,
      '',
      '## Reconciliation',
      '',
      `- pass (TRUE): ${willPass}`,
      `- blocked, low DPI (FALSE): ${willBlockLowDpi}`,
      `- blocked, no master (FALSE): ${willBlockNoMaster}`,
      `- unparseable size (left NULL): ${willLeaveNullUnparseable}`,
      `- unmeasured dims (left NULL): ${willLeaveNullUnmeasured}`,
      `- total reconciled: ${reconcileTotal} / ${rows.length}`,
      `- artworks vanishing from shop: ${vanishing.length}`,
      `- artworks missing a print master: ${noMasterArtworks.length}`,
      '',
      `Sizes that will block (FALSE): ${willBlockTotal}.`,
      '',
      '| id | status | master | dims | max buyable size | blocked (low DPI) | unparseable |',
      '|----|--------|--------|------|------------------|-------------------|-------------|',
    ];
    for (const [artworkId, group] of byArtwork) {
      const a = group[0];
      const hasMaster = !!a.image_print_url;
      const measured = a.print_width != null && a.print_height != null;
      const dims = measured ? `${a.print_width}×${a.print_height}` : 'unmeasured';
      const masterCell = hasMaster ? 'yes' : 'NO';
      const maxSize =
        hasMaster && measured
          ? maxSupportedSize(a.print_width!, a.print_height!, group.map((g) => g.size)) ?? 'NONE'
          : '—';
      const blocked =
        hasMaster && measured
          ? group
              .filter(
                (g) =>
                  shortEdgeInches(g.size) != null &&
                  !evaluateSizeResolution(a.print_width!, a.print_height!, g.size).ok,
              )
              .map((g) => g.size)
              .join(' ')
          : hasMaster
            ? ''
            : 'ALL (no master)';
      const unparseable =
        hasMaster && measured
          ? group
              .filter((g) => shortEdgeInches(g.size) == null)
              .map((g) => g.size)
              .join(' ')
          : '';
      md.push(
        `| ${artworkId} | ${a.status} | ${masterCell} | ${dims} | ${maxSize} | ${blocked} | ${unparseable} |`,
      );
    }
    mkdirSync('.review', { recursive: true });
    writeFileSync('.review/resolution-dry-run.md', md.join('\n') + '\n');
    console.log('\nDry run. Report written to .review/resolution-dry-run.md');
    console.log('Re-run with --apply to write min_resolution_ok.');
    await pool.end();
    return;
  }

  const total = byArtwork.size;
  let processed = 0;
  let failed = 0;
  for (const artworkId of byArtwork.keys()) {
    try {
      await withTransaction((tx) => refreshVariantResolution(tx, artworkId));
      processed++;
    } catch (err) {
      failed++;
      console.error('recompute failed', { artworkId, err });
    }
    // Progress every 25 artworks (and at the end) so a long run is observable.
    if ((processed + failed) % 25 === 0 || processed + failed === total) {
      console.log(`progress: ${processed + failed}/${total} (failed: ${failed})`);
    }
  }
  console.log(
    `\nApplied. summary: ${JSON.stringify({ processed, failed, total })}`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
