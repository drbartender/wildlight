export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import {
  recentJournal,
  recentNewsletter,
  type StudioKind,
} from '@/lib/studio-drafts';

// GET /api/admin/studio/recent?kind=journal|newsletter&limit=5
//
// Powers the right-side "Recent entries" / "Recent broadcasts" rail of
// the composer. Journal returns blog_posts ordered by updated_at; the
// newsletter side merges in-flight drafts with sent broadcasts so the
// rail shows the editor's full pipeline.

export async function GET(req: Request) {
  await requireAdmin();
  const url = new URL(req.url);
  const kindRaw = url.searchParams.get('kind');
  const kind: StudioKind | null =
    kindRaw === 'journal' || kindRaw === 'newsletter' ? kindRaw : null;
  if (!kind) {
    return NextResponse.json({ error: 'kind required' }, { status: 400 });
  }

  const limitRaw = Number(url.searchParams.get('limit') ?? '5');
  const limit = Number.isInteger(limitRaw) ? Math.max(1, Math.min(20, limitRaw)) : 5;

  const items =
    kind === 'journal'
      ? await recentJournal(limit)
      : await recentNewsletter(limit);
  return NextResponse.json({ items });
}
