// Bulk-delete artworks lacking a print master + their R2 web objects.
//
// The deletion cascades artwork_variants. order_items.variant_id is set to
// NULL by the schema FK, but artwork_snapshot/variant_snapshot JSONB keeps
// the historical record intact for any sold orders. As an extra guard this
// script refuses to delete any artwork whose slug is referenced by a live
// (non-canceled/refunded) order — see the protectedSlugs query below.
//
// R2 deletion is best-effort and skipped if R2 creds aren't in env. The list
// of intended R2 keys is written to temp/cleanup-no-print-master-r2-keys.txt
// on --apply so a follow-up run with creds (cleanup-r2-orphans-from-file.ts)
// can finish the job. Dry runs write to a separate *-dry.txt so a casual
// re-run can't clobber a real recovery manifest.
//
// Run:
//   npx dotenv-cli -e .env.local -- tsx scripts/cleanup-no-print-master.ts
//   npx dotenv-cli -e .env.local -- tsx scripts/cleanup-no-print-master.ts --apply
// Flags:
//   --apply             actually delete (default is dry-run)
//   --allow-orphan-r2   proceed under --apply even if some R2 keys can't be
//                       derived (otherwise --apply aborts to avoid orphaning
//                       public objects with no recoverable mapping)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pool } from '@/lib/db';

// Anchor the recovery-manifest paths to the cwd captured at startup so the
// files always land in <repo>/temp regardless of where the process chdirs.
const KEY_LOG_PATH = resolve(process.cwd(), 'temp/cleanup-no-print-master-r2-keys.txt');
const KEY_LOG_DRY_PATH = resolve(
  process.cwd(),
  'temp/cleanup-no-print-master-r2-keys-dry.txt',
);

interface Row {
  id: number;
  slug: string;
  status: string;
  image_web_url: string;
}

function r2KeyFromUrl(url: string, base: string): string | null {
  if (!url.startsWith(base)) return null;
  return url.slice(base.length).replace(/^\//, '');
}

async function main() {
  const apply = process.argv.includes('--apply');
  const allowOrphanR2 = process.argv.includes('--allow-orphan-r2');

  // Under --apply, refuse to silently use the hardcoded production CDN host:
  // if R2_PUBLIC_BASE_URL is wrong/unset, every key derives to null and the
  // DB delete would orphan every public object. Require it explicitly.
  const envBase = process.env.R2_PUBLIC_BASE_URL?.trim();
  if (apply && !envBase) {
    throw new Error(
      'R2_PUBLIC_BASE_URL must be set for --apply (refusing to guess the CDN host and risk orphaning R2 objects).',
    );
  }
  // Public CDN host is not a secret; fall back to the known prod host for
  // dry-run reporting only.
  const base = (envBase || 'https://images.wildlightimagery.shop').replace(/\/$/, '');

  const candidates = (
    await pool.query<Row>(
      `SELECT id, slug, status, image_web_url
       FROM artworks
       WHERE image_print_url IS NULL
       ORDER BY id`,
    )
  ).rows;

  if (!candidates.length) {
    console.log('Nothing to clean up.');
    await pool.end();
    return;
  }

  // Exclude any artwork referenced by a live order. Mirrors the "counts as
  // sold" predicate in lib/editions.ts and joins via the indexed
  // order_items.artwork_snapshot slug.
  const protectedSlugs = new Set(
    (
      await pool.query<{ slug: string }>(
        `SELECT DISTINCT oi.artwork_snapshot->>'slug' AS slug
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.status NOT IN ('canceled', 'refunded')
           AND oi.artwork_snapshot->>'slug' IS NOT NULL`,
      )
    ).rows.map((r) => r.slug),
  );

  const protectedRows = candidates.filter((r) => protectedSlugs.has(r.slug));
  const targets = candidates.filter((r) => !protectedSlugs.has(r.slug));

  if (protectedRows.length) {
    console.log(
      `Protected (referenced by a live order — NOT deleting): ${protectedRows.length}`,
    );
    for (const r of protectedRows) console.log(`  #${r.id} ${r.slug} (${r.status})`);
  }

  if (!targets.length) {
    console.log(
      'All no-print-master artworks are referenced by live orders. Nothing to delete.',
    );
    await pool.end();
    return;
  }

  const r2Keys: string[] = [];
  const skippedKeys: string[] = [];
  for (const r of targets) {
    const key = r2KeyFromUrl(r.image_web_url, base);
    if (key) r2Keys.push(key);
    else skippedKeys.push(r.image_web_url);
  }

  console.log(`Targets: ${targets.length} artwork(s) without a print master.`);
  const byStatus: Record<string, number> = {};
  for (const r of targets) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  for (const [s, n] of Object.entries(byStatus)) console.log(`  ${s}: ${n}`);
  console.log(`R2 keys derivable: ${r2Keys.length}`);
  if (skippedKeys.length) {
    console.log(`R2 keys NOT derivable (URL outside ${base}): ${skippedKeys.length}`);
  }

  // Safety: if some web URLs didn't map to R2 keys, deleting the DB rows now
  // would orphan those objects with no recoverable mapping. Abort unless the
  // operator explicitly accepts that with --allow-orphan-r2. (Checked before
  // any write so an aborted run leaves no half-state.)
  if (apply && skippedKeys.length && !allowOrphanR2) {
    await pool.end();
    throw new Error(
      `Refusing to --apply: ${skippedKeys.length} R2 key(s) could not be derived from ${base}. ` +
        `Fix R2_PUBLIC_BASE_URL, or pass --allow-orphan-r2 to delete the DB rows anyway and orphan those objects.`,
    );
  }

  // Write the key manifest. Dry runs go to a separate file so re-running a dry
  // pass after an --apply can't clobber the real recovery list.
  const manifestPath = apply ? KEY_LOG_PATH : KEY_LOG_DRY_PATH;
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, r2Keys.join('\n') + (r2Keys.length ? '\n' : ''));
  console.log(`Wrote ${r2Keys.length} R2 key(s) to ${manifestPath}`);

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to delete from DB and R2.');
    await pool.end();
    return;
  }

  // ── DB delete ───────────────────────────────────────────────────────
  const ids = targets.map((r) => r.id);
  const del = await pool.query<{ id: number }>(
    `DELETE FROM artworks WHERE id = ANY($1::int[]) RETURNING id`,
    [ids],
  );
  console.log(`\nDB: deleted ${del.rowCount}/${ids.length} artwork rows.`);

  // ── R2 delete (best-effort) ─────────────────────────────────────────
  const haveR2 =
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_PUBLIC;

  if (!haveR2) {
    console.log(
      `R2: credentials not in env — skipped. Re-run cleanup-r2-orphans-from-file.ts with R2 creds to delete the ${r2Keys.length} object(s) listed in ${KEY_LOG_PATH}.`,
    );
    await pool.end();
    return;
  }

  const { deletePublic } = await import('@/lib/r2');
  let okR2 = 0;
  let failR2 = 0;
  const failedKeys: string[] = [];
  for (const k of r2Keys) {
    try {
      await deletePublic(k);
      okR2++;
    } catch (err) {
      failR2++;
      failedKeys.push(k);
      console.warn(
        `R2 delete failed for ${k}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  console.log(`R2: deleted ${okR2}/${r2Keys.length} object(s) (failures: ${failR2}).`);
  // Rewrite the manifest with only the keys that still need deleting, so the
  // recovery list reflects remaining work rather than the full processed set.
  writeFileSync(KEY_LOG_PATH, failedKeys.join('\n') + (failedKeys.length ? '\n' : ''));
  if (failedKeys.length) {
    console.log(
      `Wrote ${failedKeys.length} still-orphaned R2 key(s) to ${KEY_LOG_PATH} for retry.`,
    );
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
