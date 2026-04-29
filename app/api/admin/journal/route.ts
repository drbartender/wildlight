export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { sanitizeJournalHtml } from '@/lib/journal-html';
import { slugify, uniqueSlug } from '@/lib/slug';
import { logger } from '@/lib/logger';

interface ListRow {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image_url: string | null;
  published: boolean;
  published_at: string | null;
  updated_at: string;
}

export async function GET() {
  await requireAdmin();
  const r = await pool.query<ListRow>(
    `SELECT id, slug, title, excerpt, cover_image_url,
            published, published_at::text, updated_at::text
     FROM blog_posts
     ORDER BY updated_at DESC`,
  );
  return NextResponse.json({ entries: r.rows });
}

const Create = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().max(100).optional(),
  excerpt: z.string().max(500).nullable().optional(),
  body: z.string().min(1).max(200000),
  cover_image_url: z.string().url().nullable().optional(),
});

export async function POST(req: Request) {
  await requireAdmin();
  const parsed = Create.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const d = parsed.data;

  // Resolve a unique slug. If client passed one, slugify+uniquify.
  // Otherwise derive from title.
  const taken = new Set(
    (await pool.query<{ slug: string }>('SELECT slug FROM blog_posts')).rows.map(
      (r) => r.slug,
    ),
  );
  const baseSlug = slugify(d.slug || d.title) || 'untitled';
  const slug = uniqueSlug(baseSlug, taken);

  const cleanBody = sanitizeJournalHtml(d.body);

  try {
    const r = await pool.query<{ id: number; slug: string }>(
      `INSERT INTO blog_posts (slug, title, excerpt, body, cover_image_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, slug`,
      [slug, d.title, d.excerpt ?? null, cleanBody, d.cover_image_url ?? null],
    );
    return NextResponse.json({ id: r.rows[0].id, slug: r.rows[0].slug });
  } catch (err) {
    logger.error('journal create failed', err);
    return NextResponse.json({ error: 'create failed' }, { status: 500 });
  }
}
