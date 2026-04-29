export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool, parsePathId } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { sanitizeJournalHtml } from '@/lib/journal-html';
import { slugify, uniqueSlug } from '@/lib/slug';
import { logger } from '@/lib/logger';

interface Row {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string;
  cover_image_url: string | null;
  published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = parsePathId(raw);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const r = await pool.query<Row>(
    `SELECT id, slug, title, excerpt, body, cover_image_url,
            published, published_at::text, created_at::text, updated_at::text
     FROM blog_posts WHERE id = $1`,
    [id],
  );
  if (!r.rowCount) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ entry: r.rows[0] });
}

const Patch = z.object({
  title: z.string().min(1).max(200).optional(),
  slug: z.string().min(1).max(100).optional(),
  excerpt: z.string().max(500).nullable().optional(),
  body: z.string().min(1).max(200000).optional(),
  cover_image_url: z.string().url().nullable().optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = parsePathId(raw);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const d = parsed.data;

  // If slug is being changed, ensure uniqueness across other rows.
  let resolvedSlug: string | undefined;
  if (d.slug != null) {
    const taken = new Set(
      (
        await pool.query<{ slug: string }>(
          'SELECT slug FROM blog_posts WHERE id <> $1',
          [id],
        )
      ).rows.map((r) => r.slug),
    );
    const baseSlug = slugify(d.slug) || 'untitled';
    resolvedSlug = uniqueSlug(baseSlug, taken);
  }

  const cleanBody = d.body != null ? sanitizeJournalHtml(d.body) : undefined;

  // Build dynamic SET — only change fields that were sent. updated_at is
  // always bumped via a literal NOW() (not parameterized).
  const sets: string[] = [];
  const vals: unknown[] = [];
  function add(col: string, val: unknown) {
    sets.push(`${col} = $${sets.length + 1}`);
    vals.push(val);
  }
  if (d.title != null) add('title', d.title);
  if (resolvedSlug != null) add('slug', resolvedSlug);
  if ('excerpt' in d) add('excerpt', d.excerpt ?? null);
  if (cleanBody != null) add('body', cleanBody);
  if ('cover_image_url' in d) add('cover_image_url', d.cover_image_url ?? null);

  if (sets.length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const sql = `UPDATE blog_posts SET ${sets.join(', ')}, updated_at = NOW()
               WHERE id = $${vals.length + 1}
               RETURNING id, slug`;

  try {
    const r = await pool.query<{ id: number; slug: string }>(sql, [...vals, id]);
    if (!r.rowCount) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ id: r.rows[0].id, slug: r.rows[0].slug });
  } catch (err) {
    logger.error('journal patch failed', err);
    return NextResponse.json({ error: 'update failed' }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = parsePathId(raw);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const r = await pool.query('DELETE FROM blog_posts WHERE id = $1', [id]);
  if (!r.rowCount) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
