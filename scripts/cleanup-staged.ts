import { listPrivatePrefix, deletePrivate } from '@/lib/r2';

const MAX_AGE_HOURS = 24;

async function main() {
  const apply = process.argv.includes('--apply');
  const cutoff = Date.now() - MAX_AGE_HOURS * 3600 * 1000;

  const items = await listPrivatePrefix('incoming/');
  const stale = items.filter((it) => {
    const ts = it.lastModified?.getTime() ?? 0;
    return ts > 0 && ts < cutoff;
  });

  if (!stale.length) {
    console.log(`No staged objects older than ${MAX_AGE_HOURS}h.`);
    return;
  }

  console.log(`Found ${stale.length} stale staging object(s):`);
  for (const it of stale) {
    const ageH = Math.floor(
      (Date.now() - (it.lastModified?.getTime() ?? 0)) / 3600 / 1000,
    );
    console.log(
      `  - ${it.key}  ${(it.size / 1024 / 1024).toFixed(1)}MB  ${ageH}h old`,
    );
  }

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to delete them.');
    return;
  }

  let n = 0;
  for (const it of stale) {
    try {
      await deletePrivate(it.key);
      n++;
    } catch (err) {
      console.warn(
        `failed to delete ${it.key}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  console.log(`\nDeleted ${n} of ${stale.length} stale staging object(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
