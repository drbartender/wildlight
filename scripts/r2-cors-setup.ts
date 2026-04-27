import '@/lib/load-env';
import { getPrivateBucketCors, putPrivateBucketCors } from '@/lib/r2';

// CORS rules for the private bucket — needed because the bulk-upload page
// PUTs directly from the browser to a presigned R2 URL. Without this, the
// browser blocks the cross-origin request and the upload fails with a
// generic "PUT network error" (no HTTP status reaches the JS).
//
// PutBucketCors REPLACES the policy — it does not merge. If you add a
// second rule for a different surface (e.g. a future direct-from-browser
// endpoint), include both rules in RULES below.
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

async function main() {
  const apply = process.argv.includes('--apply');

  console.log('Current private-bucket CORS:');
  const current = await getPrivateBucketCors();
  console.log(JSON.stringify(current, null, 2));

  console.log('\nProposed CORS rules:');
  console.log(JSON.stringify(RULES, null, 2));

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to push these rules.');
    return;
  }

  await putPrivateBucketCors(RULES);
  console.log('\nCORS rules applied.');

  console.log('\nVerification — re-reading current CORS:');
  const after = await getPrivateBucketCors();
  console.log(JSON.stringify(after, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
