import '@/lib/load-env';
import {
  getPrivateBucketCors,
  putPrivateBucketCors,
  getPublicBucketCors,
  putPublicBucketCors,
} from '@/lib/r2';

// CORS rules for the R2 buckets — needed because both the bulk artwork
// upload page (private bucket) and the studio composer (public bucket)
// PUT directly from the browser to a presigned URL. Without this, the
// browser blocks the cross-origin request and the upload fails with a
// generic "PUT network error" (no HTTP status reaches the JS).
//
// PutBucketCors REPLACES the policy — it does not merge. If you add a
// second rule for a different surface, include both rules in RULES below.
//
// Edit ALLOWED_ORIGINS if the production domain or Vercel project name
// changes. The `wildlight-*.vercel.app` wildcard scopes previews to this
// project (per .vercel/project.json) instead of every Vercel tenant.
const ALLOWED_ORIGINS = [
  'https://wildlightimagery.shop',
  'https://www.wildlightimagery.shop',
  'https://wildlightimagery.com',
  'https://www.wildlightimagery.com',
  'https://wildlight-*.vercel.app',
  'http://localhost:3000',
];

const RULES = [
  {
    AllowedOrigins: ALLOWED_ORIGINS,
    AllowedMethods: ['PUT'],
    AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag'],
    MaxAgeSeconds: 3600,
  },
];

const TARGETS = {
  private: { get: getPrivateBucketCors, put: putPrivateBucketCors },
  public: { get: getPublicBucketCors, put: putPublicBucketCors },
} as const;
type Target = keyof typeof TARGETS;

async function main() {
  const apply = process.argv.includes('--apply');
  // Pick targets via flags; default = both buckets so a fresh setup
  // covers everything in one command. `--private-only` and
  // `--public-only` keep the script useful when only one needs work.
  const wantPrivate = !process.argv.includes('--public-only');
  const wantPublic = !process.argv.includes('--private-only');
  const targets: Target[] = [];
  if (wantPrivate) targets.push('private');
  if (wantPublic) targets.push('public');

  for (const t of targets) {
    console.log(`\n=== ${t.toUpperCase()} bucket ===`);
    console.log('Current CORS:');
    const current = await TARGETS[t].get();
    console.log(JSON.stringify(current, null, 2));

    console.log('\nProposed CORS rules:');
    console.log(JSON.stringify(RULES, null, 2));

    if (!apply) continue;

    await TARGETS[t].put(RULES);
    console.log('\nCORS rules applied.');

    console.log('\nVerification — re-reading current CORS:');
    const after = await TARGETS[t].get();
    console.log(JSON.stringify(after, null, 2));
  }

  if (!apply) {
    console.log(
      '\nDry run. Re-run with --apply to push these rules. Add --private-only or --public-only to scope to one bucket.',
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
