export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { getPrivateBucketCors, signedPrivateUploadUrl } from '@/lib/r2';

// Read-only diagnostic for the bulk-upload presigned-PUT path. Returns
// the bucket production is actually targeting + the CORS policy that's
// actually applied to it + the parsed parts of a fresh presigned URL,
// so a "PUT network error" from the browser can be diagnosed against
// real values instead of guesses.
//
// TEMPORARY — added to diagnose the 2026-04 bulk-upload CORS failure.
// Remove (or rename + repurpose as a permanent ops endpoint) once the
// upload path is confirmed working in production.
export async function GET() {
  await requireAdmin();

  const bucketPrivate = process.env.R2_BUCKET_PRIVATE ?? null;
  const accountIdPresent = !!process.env.R2_ACCOUNT_ID;

  let cors: unknown = null;
  let corsError: string | null = null;
  try {
    cors = await getPrivateBucketCors();
  } catch (err) {
    corsError = err instanceof Error ? err.message : String(err);
  }

  let sample: { hostname: string; pathname: string; checksumParams: string[] } | null = null;
  let sampleError: string | null = null;
  try {
    // Fixed key — overwritten on repeat calls; reaped by `cleanup:staged`.
    const url = await signedPrivateUploadUrl(
      'incoming/r2-debug-probe.jpg',
      'image/jpeg',
      60,
    );
    const u = new URL(url);
    sample = {
      hostname: u.hostname,
      pathname: u.pathname,
      checksumParams: [...u.searchParams.keys()].filter((k) =>
        k.toLowerCase().includes('checksum'),
      ),
    };
  } catch (err) {
    sampleError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json({
    env: {
      R2_BUCKET_PRIVATE: bucketPrivate,
      R2_ACCOUNT_ID_set: accountIdPresent,
    },
    cors,
    corsError,
    sample,
    sampleError,
  });
}
