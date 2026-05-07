import 'dotenv/config';
import { listPublicPrefix, publicUrlFor } from '../lib/r2';

// Quick diagnostic: list a few keys under a public-bucket prefix and
// HEAD their public URL to confirm the custom domain → bucket mapping
// is actually serving the same bytes the bucket holds. Run when an
// upstream image consumer (Anthropic, etc.) reports "Unable to download
// the file" — if HEADs return 404 here, the mapping is broken.
async function main() {
  const prefixes = ['journal/', 'incoming/', 'artworks/'];
  for (const prefix of prefixes) {
    process.stdout.write(`\n── prefix: ${prefix} ──\n`);
    const all = await listPublicPrefix(prefix);
    if (all.length === 0) {
      process.stdout.write('  (no objects)\n');
      continue;
    }
    // Sort newest first so we test recent uploads (most likely the ones
    // Anthropic was failing on).
    const newest = [...all]
      .sort((a, b) => {
        const at = a.lastModified?.getTime() ?? 0;
        const bt = b.lastModified?.getTime() ?? 0;
        return bt - at;
      })
      .slice(0, 3);
    for (const obj of newest) {
      const url = publicUrlFor(obj.key);
      try {
        const r = await fetch(url, { method: 'HEAD' });
        process.stdout.write(
          `  ${r.status}  ${url}  (size: ${obj.size}, served-len: ${r.headers.get('content-length') ?? '—'}, ct: ${r.headers.get('content-type') ?? '—'}, cf: ${r.headers.get('cf-cache-status') ?? '—'})\n`,
        );
      } catch (err) {
        process.stdout.write(
          `  ERR  ${url}  ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
