// Delete a list of R2 public-bucket keys (one per line) from the public bucket.
// Pairs with cleanup-no-print-master.ts: that script writes the keys it
// couldn't delete (no R2 creds locally) to temp/cleanup-no-print-master-r2-keys.txt
// and this script finishes the job once R2 creds are in env.
//
// Run:
//   npx dotenv-cli -e .env.local -- tsx scripts/cleanup-r2-orphans-from-file.ts \
//     temp/cleanup-no-print-master-r2-keys.txt
//   add --apply to actually delete (otherwise dry-run).
import { readFileSync } from 'node:fs';
import { deletePublic } from '@/lib/r2';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: cleanup-r2-orphans-from-file.ts <keys-file> [--apply]');
    process.exit(2);
  }

  const haveR2 =
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_PUBLIC;
  if (!haveR2) {
    console.error(
      'R2 credentials missing. Need R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_PUBLIC.',
    );
    process.exit(2);
  }

  const keys = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`${keys.length} key(s) loaded from ${file}.`);
  if (!apply) {
    console.log('Dry run. Re-run with --apply to delete.');
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const k of keys) {
    try {
      await deletePublic(k);
      ok++;
    } catch (err) {
      fail++;
      console.warn(
        `Failed: ${k} — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  console.log(`Deleted ${ok}/${keys.length} (failures: ${fail}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
