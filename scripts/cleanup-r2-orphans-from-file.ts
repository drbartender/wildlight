// Delete a list of R2 public-bucket keys (one per line) from the public bucket.
// Pairs with cleanup-no-print-master.ts: that script writes the keys it
// couldn't delete (no R2 creds locally) to temp/cleanup-no-print-master-r2-keys.txt
// and this script finishes the job once R2 creds are in env.
//
// Guards against operator error wiping the wrong objects: every key must match
// the expected public-artwork prefix, any malformed line aborts the whole run,
// and an unexpectedly large batch needs --force.
//
// Run:
//   npx dotenv-cli -e .env.local -- tsx scripts/cleanup-r2-orphans-from-file.ts \
//     temp/cleanup-no-print-master-r2-keys.txt
//   add --apply to actually delete (otherwise dry-run); --force to allow a
//   batch larger than MAX_KEYS.
import { readFileSync } from 'node:fs';
import { deletePublic } from '@/lib/r2';

// Public-bucket keys for catalog web images live under this prefix. Anything
// else in the file is almost certainly a mistake (a private-bucket key, a
// pasted path, a wildcard) and must not be deleted.
const ALLOWED_PREFIX = 'artworks-web/';
const MAX_KEYS = 500;

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const force = args.includes('--force');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: cleanup-r2-orphans-from-file.ts <keys-file> [--apply] [--force]');
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

  // Reject anything that doesn't look like a clean public-bucket key BEFORE
  // deleting a single object — fail the whole run rather than delete the good
  // lines and leave the operator guessing which were bad.
  const bad = keys.filter(
    (k) =>
      !k.startsWith(ALLOWED_PREFIX) ||
      /\s/.test(k) ||
      k.includes('\\') ||
      k.startsWith('/') ||
      k.includes('..'),
  );
  if (bad.length) {
    console.error(
      `Aborting: ${bad.length} line(s) are not valid "${ALLOWED_PREFIX}" keys (no whitespace / backslash / leading-slash / "..").`,
    );
    for (const k of bad.slice(0, 10)) console.error(`  rejected: ${JSON.stringify(k)}`);
    process.exit(2);
  }

  if (keys.length > MAX_KEYS && !force) {
    console.error(
      `Aborting: ${keys.length} keys exceeds the ${MAX_KEYS} safety cap. Re-run with --force if this is intended.`,
    );
    process.exit(2);
  }

  console.log(`${keys.length} key(s) loaded from ${file}.`);
  const preview = (arr: string[]) => arr.map((k) => `  ${k}`).join('\n');
  console.log('First:\n' + preview(keys.slice(0, 5)));
  if (keys.length > 5) console.log('Last:\n' + preview(keys.slice(-5)));

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to delete.');
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
      console.warn(`Failed: ${k} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`Deleted ${ok}/${keys.length} (failures: ${fail}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
