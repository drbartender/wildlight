import {
  listPrivatePrefix,
  listPublicPrefix,
  deletePrivate,
  deletePublic,
} from '@/lib/r2';

const MAX_AGE_HOURS = 24;

interface Bucket {
  label: 'private' | 'public';
  list: (prefix: string) => Promise<
    Array<{ key: string; lastModified: Date | null; size: number }>
  >;
  del: (key: string) => Promise<void>;
}

const BUCKETS: Bucket[] = [
  { label: 'private', list: listPrivatePrefix, del: deletePrivate },
  { label: 'public', list: listPublicPrefix, del: deletePublic },
];

async function main() {
  const apply = process.argv.includes('--apply');
  const cutoff = Date.now() - MAX_AGE_HOURS * 3600 * 1000;

  let totalStale = 0;
  let totalDeleted = 0;

  for (const bucket of BUCKETS) {
    const items = await bucket.list('incoming/');
    const stale = items.filter((it) => {
      const ts = it.lastModified?.getTime() ?? 0;
      return ts > 0 && ts < cutoff;
    });
    if (!stale.length) {
      console.log(`[${bucket.label}] no staged objects older than ${MAX_AGE_HOURS}h.`);
      continue;
    }

    totalStale += stale.length;
    console.log(`[${bucket.label}] ${stale.length} stale staging object(s):`);
    for (const it of stale) {
      const ageH = Math.floor(
        (Date.now() - (it.lastModified?.getTime() ?? 0)) / 3600 / 1000,
      );
      console.log(
        `  - ${it.key}  ${(it.size / 1024 / 1024).toFixed(1)}MB  ${ageH}h old`,
      );
    }

    if (!apply) continue;

    for (const it of stale) {
      try {
        await bucket.del(it.key);
        totalDeleted++;
      } catch (err) {
        console.warn(
          `[${bucket.label}] failed to delete ${it.key}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  if (!apply) {
    if (totalStale > 0) {
      console.log(`\nDry run. Re-run with --apply to delete ${totalStale} object(s).`);
    }
    return;
  }
  console.log(`\nDeleted ${totalDeleted} of ${totalStale} stale staging object(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
