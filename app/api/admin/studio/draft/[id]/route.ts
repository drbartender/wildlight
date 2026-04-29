export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parsePathId } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { logger } from '@/lib/logger';
import {
  getJournalDraft,
  patchJournalDraft,
  deleteJournalDraft,
  getNewsletterDraft,
  patchNewsletterDraft,
  deleteNewsletterDraft,
  type StudioKind,
} from '@/lib/studio-drafts';

function readKind(req: Request): StudioKind | null {
  const k = new URL(req.url).searchParams.get('kind');
  return k === 'journal' || k === 'newsletter' ? k : null;
}

// ─── GET ────────────────────────────────────────────────────────────

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const kind = readKind(req);
  if (!kind) return NextResponse.json({ error: 'kind required' }, { status: 400 });
  const id = parsePathId((await ctx.params).id);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const draft =
    kind === 'journal'
      ? await getJournalDraft(id)
      : await getNewsletterDraft(id);
  if (!draft) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ draft });
}

// ─── PATCH ──────────────────────────────────────────────────────────
//
// The composer auto-saves on debounce. Body fields are all optional —
// the client sends whatever changed. `studioMeta` accepts the loose
// shape from lib/studio-drafts (validated structurally rather than
// via a tight zod schema, since callers iterate the shape often).

// Locked schema for the studioMeta JSONB. Originally accepted as a
// loose record; an admin (or stolen-cookie actor) could pollute the
// JSONB with hostile shapes that downstream code reads naively
// (e.g. `images[0].url` pulling an object instead of a URL string).
// Keep this in sync with StudioMeta in lib/studio-drafts.ts.
const StudioImageSchema = z.object({
  url: z.string().url().max(2000),
  key: z.string().max(500).optional(),
});

const StudioMetaSchema = z
  .object({
    subjectDraft: z.string().max(2000).optional(),
    images: z.array(StudioImageSchema).max(50).optional(),
    chooseForMe: z.boolean().optional(),
    slugTouched: z.boolean().optional(),
    bodySource: z.string().max(50_000).optional(),
    seo: z
      .object({
        keywords: z.array(z.string().max(120)).max(20),
        meta: z.string().max(1000),
        related: z.array(z.string().max(200)).max(10),
        readingTime: z.string().max(40),
        generatedAt: z.string().max(60).optional(),
      })
      .optional(),
  })
  .strict();

const Patch = z.object({
  title: z.string().max(500).optional(),
  subject: z.string().max(2000).optional(),
  body: z.string().max(50_000).optional(),
  studioMeta: StudioMetaSchema.optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const kind = readKind(req);
  if (!kind) return NextResponse.json({ error: 'kind required' }, { status: 400 });
  const id = parsePathId((await ctx.params).id);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }

  try {
    if (kind === 'journal') {
      const r = await patchJournalDraft(id, parsed.data);
      return NextResponse.json({ id: r.id, slug: r.slug });
    }
    const r = await patchNewsletterDraft(id, parsed.data);
    return NextResponse.json({ id: r.id });
  } catch (err) {
    if (err instanceof Error && err.message === 'not_found') {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    if (err instanceof Error && err.message === 'already_sent') {
      return NextResponse.json(
        { error: 'newsletter already sent' },
        { status: 409 },
      );
    }
    logger.error('studio draft patch failed', err, { id, kind });
    return NextResponse.json({ error: 'update failed' }, { status: 500 });
  }
}

// ─── DELETE ─────────────────────────────────────────────────────────

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const kind = readKind(req);
  if (!kind) return NextResponse.json({ error: 'kind required' }, { status: 400 });
  const id = parsePathId((await ctx.params).id);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  try {
    const ok =
      kind === 'journal'
        ? await deleteJournalDraft(id)
        : await deleteNewsletterDraft(id);
    if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('studio draft delete failed', err, { id, kind });
    return NextResponse.json({ error: 'delete failed' }, { status: 500 });
  }
}
