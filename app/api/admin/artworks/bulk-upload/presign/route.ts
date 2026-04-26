export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { requireAdmin } from '@/lib/session';
import { signedPrivateUploadUrl } from '@/lib/r2';

const MAX_SIZE = 500 * 1024 * 1024;

const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/tiff': 'tif',
};

const Body = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(64),
  size: z.number().int().positive(),
});

export async function POST(req: Request) {
  await requireAdmin();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const { contentType, size } = parsed.data;
  const ext = ALLOWED_MIME[contentType];
  if (!ext) {
    return NextResponse.json(
      { error: 'unsupported content type (jpeg/png/tiff only)' },
      { status: 415 },
    );
  }
  if (size > MAX_SIZE) {
    return NextResponse.json(
      { error: `file too large (max ${Math.floor(MAX_SIZE / 1024 / 1024)}MB)` },
      { status: 413 },
    );
  }

  const key = `incoming/${uuidv4()}.${ext}`;
  const url = await signedPrivateUploadUrl(key, contentType, 900);
  return NextResponse.json({
    key,
    url,
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
  });
}
