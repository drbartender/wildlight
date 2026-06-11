// Bulk-delete artworks lacking a print master + their R2 web objects.
//
// The deletion cascades artwork_variants. order_items.variant_id is set to
// NULL by the schema FK, but artwork_snapshot/variant_snapshot JSONB keeps
// the historical record intact for any sold orders.
//
// R2 deletion is best-effort and skipped silently if R2 creds aren't in
// env. The list of intended R2 keys is always written to
// temp/cleanup-no-print-master-r2-keys.txt so a follow-up run with creds
// can finish the job.
//
// Run:
//   npx dotenv-cli -e .env.local -- tsx scripts/cleanup-no-print-master.ts
//   npx dotenv-cli -e .env.local -- tsx scripts/cleanup-no-print-master.ts --apply
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pool } from '@/lib/db';

const KEY_LOG_PATH = 'temp/cleanup-no-print-master-r2-keys.txt';

interface Row {
  id: number;
  slug: string;
  status: string;
  image_web_url: string;
}

function r2KeyFromUrl(url: string, base: string | undefined): string | null {
  if (!base) return null;
  if (!url.startsWith(base)) return null;
  return url.slice(base.length).replace(/^\//, '');
}

async function main() {
  const apply = process.argv.includes('--apply');

  const rows = (
    await pool.query<Row>(
      `SELECT id, slug, status, image_web_url
       FROM artworks
       WHERE image_print_url IS NULL
       ORDER BY id`,
    )
  ).rows;

  if (!rows.length) {
    console.log('Nothing to clean up.');
    await pool.end();
    return;
  }

  // Public CDN host is not a secret. Fall back to the known production
  // host when env isn't populated locally so the key list still gets
  // written for a follow-up R2 cleanup pass.
  const envBase = process.env.R2_PUBLIC_BASE_URL?.trim();
  const base = (envBase || 'https://images.wildlightimagery.shop').replace(/\/$/, '');
  const r2Keys: string[] = [];
  const skippedKeys: string[] = [];
  for (const r of rows) {
    const key = r2KeyFromUrl(r.image_web_url, base);
    if (key) r2Keys.push(key);
    else skippedKeys.push(r.image_web_url);
  }

  console.log(`Targets: ${rows.length} artwork(s) without a print master.`);
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  for (const [s, n] of Object.entries(byStatus)) console.log(`  ${s}: ${n}`);
  console.log(`R2 keys derivable: ${r2Keys.length}`);
  if (skippedKeys.length) {
    console.log(`R2 keys NOT derivable (URL outside base): ${skippedKeys.length}`);
  }

  // Always write the key log so it survives even if R2 delete is skipped.
  mkdirSync(dirname(KEY_LOG_PATH), { recursive: true });
  writeFileSync(KEY_LOG_PATH, r2Keys.join('\n') + (r2Keys.length ? '\n' : ''));
  console.log(`Wrote ${r2Keys.length} R2 key(s) to ${KEY_LOG_PATH}`);

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to delete from DB and R2.');
    await pool.end();
    return;
  }

  // ── DB delete ───────────────────────────────────────────────────────
  const ids = rows.map((r) => r.id);
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
      `R2: credentials not in env — skipped. Re-run with R2 creds in env to delete the ${r2Keys.length} object(s) listed in ${KEY_LOG_PATH}.`,
    );
    await pool.end();
    return;
  }

  const { deletePublic } = await import('@/lib/r2');
  let okR2 = 0;
  let failR2 = 0;
  for (const k of r2Keys) {
    try {
      await deletePublic(k);
      okR2++;
    } catch (err) {
      failR2++;
      console.warn(
        `R2 delete failed for ${k}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  console.log(`R2: deleted ${okR2}/${r2Keys.length} object(s) (failures: ${failR2}).`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
