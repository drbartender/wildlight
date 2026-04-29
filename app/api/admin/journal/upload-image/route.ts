export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '@/lib/session';
import { uploadPublic } from '@/lib/r2';
import { logger } from '@/lib/logger';

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export async function POST(req: Request) {
  await requireAdmin();

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'no file' }, { status: 400 });
  }

  const contentType = file.type;
  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json(
      { error: 'unsupported image type' },
      { status: 415 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'image too large' }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = EXT_BY_TYPE[contentType] ?? 'bin';
  const key = `journal/${randomUUID()}.${ext}`;

  try {
    const url = await uploadPublic(key, buf, contentType);
    return NextResponse.json({ url, key });
  } catch (err) {
    logger.error('journal image upload failed', err);
    return NextResponse.json({ error: 'upload failed' }, { status: 502 });
  }
}
