export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '@/lib/session';
import { logger } from '@/lib/logger';
import { signedPublicUploadUrl, publicUrlFor } from '@/lib/r2';
import { recordAndCheckRateLimit } from '@/lib/rate-limit';

// Studio composer image upload — presigned-URL path so 25-100MB images
// bypass Vercel's function body limit. Client posts {filename, type,
// size}; we mint a key + signed PUT URL; client PUTs straight to R2.
//
// On the storefront/admin side, the resulting URL is identical to what
// uploadPublic() returns from the function-mediated /upload-image
// endpoint, so the rest of the composer doesn't care which path the
// file arrived through.

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
// 100MB ceiling matches the dropzone's caption. Above this we'd be
// looking at Pro/Business R2 settings + chunked uploads.
const MAX_BYTES = 100 * 1024 * 1024;

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const Body = z.object({
  filename: z.string().min(1).max(200),
  type: z.string().min(1).max(120),
  size: z.number().int().min(1).max(MAX_BYTES),
});

export async function POST(req: Request) {
  const session = await requireAdmin();

  // 60 presigns per minute per admin email — caps R2 egress cost from
  // a stolen-cookie scenario. Generous enough that bulk-drop of 50
  // images in one go still fits under the limit.
  const gate = await recordAndCheckRateLimit(
    'studio-presign',
    session.email,
    60,
    60,
  );
  if (gate.blocked) {
    return NextResponse.json(
      { error: 'too many requests' },
      {
        status: 429,
        headers: gate.retryAfter
          ? { 'Retry-After': String(gate.retryAfter) }
          : undefined,
      },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(parsed.data.type)) {
    return NextResponse.json(
      { error: 'unsupported image type' },
      { status: 415 },
    );
  }
  if (parsed.data.size > MAX_BYTES) {
    return NextResponse.json({ error: 'image too large' }, { status: 413 });
  }

  const ext = EXT_BY_TYPE[parsed.data.type] ?? 'bin';
  const key = `journal/${randomUUID()}.${ext}`;

  try {
    const uploadUrl = await signedPublicUploadUrl(key, parsed.data.type);
    return NextResponse.json({
      uploadUrl,
      // The eventual public URL — caller stores this in studio_meta
      // and uses it as the `url` of a StudioImage entry.
      url: publicUrlFor(key),
      key,
      // Caller must PUT with this exact Content-Type — R2 enforces the
      // signed value and rejects mismatches with a 403. Browsers send
      // it automatically when File.type is set; we surface it here as
      // a sanity hint.
      contentType: parsed.data.type,
    });
  } catch (err) {
    logger.error('studio presign failed', err, { key });
    return NextResponse.json({ error: 'presign failed' }, { status: 500 });
  }
}
