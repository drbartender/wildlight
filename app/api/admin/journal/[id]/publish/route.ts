export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool, parsePathId } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { logger } from '@/lib/logger';

const Body = z.object({ published: z.boolean() });

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = parsePathId(raw);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }

  // First-publish stamps published_at; later toggles preserve it (so
  // chapter numbers stay stable across unpublish/republish cycles).
  try {
    const r = await pool.query<{ id: number; published_at: string | null }>(
      `UPDATE blog_posts
       SET published = $1,
           published_at = COALESCE(published_at, CASE WHEN $1 THEN NOW() ELSE NULL END),
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, published_at::text`,
      [parsed.data.published, id],
    );
    if (!r.rowCount) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({
      id: r.rows[0].id,
      published: parsed.data.published,
      published_at: r.rows[0].published_at,
    });
  } catch (err) {
    logger.error('journal publish toggle failed', err);
    return NextResponse.json({ error: 'publish failed' }, { status: 500 });
  }
}
