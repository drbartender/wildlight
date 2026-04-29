export const runtime = 'nodejs';
export const maxDuration = 60; // vision + body generation can run 20-40s
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/session';
import { logger } from '@/lib/logger';
import { safeHttpUrl } from '@/lib/url';
import {
  generateFromImage,
  generateFromTitle,
  generateCombination,
  generateImproved,
  type JournalDraft,
  type ImageInput,
} from '@/lib/studio';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

// JSON path — title / improve / image-by-URL.
const JsonBody = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('title'),
    title: z.string().min(1).max(200),
  }),
  z.object({
    mode: z.literal('image'),
    imageUrl: z.string().url(),
    titleHint: z.string().max(200).optional(),
  }),
  z.object({
    mode: z.literal('combination'),
    imageUrl: z.string().url(),
    title: z.string().min(1).max(200),
  }),
  z.object({
    mode: z.literal('improve'),
    body: z.string().min(1).max(50_000),
    feedback: z.string().max(1000).optional(),
  }),
]);

export async function POST(req: Request) {
  await requireAdmin();

  const contentType = req.headers.get('content-type') || '';

  // Multipart path — image upload (image / combination modes).
  if (contentType.startsWith('multipart/form-data')) {
    return handleMultipart(req);
  }

  // JSON path
  const json = await req.json().catch(() => null);
  const parsed = JsonBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const d = parsed.data;

  try {
    let draft: JournalDraft;
    switch (d.mode) {
      case 'title':
        draft = await generateFromTitle({ title: d.title });
        break;
      case 'image': {
        const url = safeHttpUrl(d.imageUrl);
        if (!url)
          return NextResponse.json({ error: 'bad image url' }, { status: 400 });
        draft = await generateFromImage({
          image: { url },
          titleHint: d.titleHint,
        });
        break;
      }
      case 'combination': {
        const url = safeHttpUrl(d.imageUrl);
        if (!url)
          return NextResponse.json({ error: 'bad image url' }, { status: 400 });
        draft = await generateCombination({
          image: { url },
          title: d.title,
        });
        break;
      }
      case 'improve':
        draft = await generateImproved({
          body: d.body,
          feedback: d.feedback,
        });
        break;
    }
    return NextResponse.json({ draft });
  } catch (err) {
    logger.error('studio generate failed', err, { mode: d.mode });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'generation failed' },
      { status: 502 },
    );
  }
}

async function handleMultipart(req: Request): Promise<Response> {
  const form = await req.formData().catch(() => null);
  if (!form)
    return NextResponse.json({ error: 'invalid form' }, { status: 400 });

  const mode = form.get('mode');
  const file = form.get('file');
  if (typeof mode !== 'string' || !['image', 'combination'].includes(mode)) {
    return NextResponse.json({ error: 'invalid mode' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'no file' }, { status: 400 });
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: 'unsupported image type' },
      { status: 415 },
    );
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: 'image too large' }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const image: ImageInput = {
    base64: { data: buf.toString('base64'), mediaType: file.type },
  };

  const titleHint =
    typeof form.get('titleHint') === 'string'
      ? (form.get('titleHint') as string).slice(0, 200)
      : undefined;
  const title =
    typeof form.get('title') === 'string'
      ? (form.get('title') as string).slice(0, 200)
      : undefined;

  try {
    const draft =
      mode === 'image'
        ? await generateFromImage({ image, titleHint })
        : await generateCombination({ image, title: title ?? '' });
    return NextResponse.json({ draft });
  } catch (err) {
    logger.error('studio generate (multipart) failed', err, { mode });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'generation failed' },
      { status: 502 },
    );
  }
}
