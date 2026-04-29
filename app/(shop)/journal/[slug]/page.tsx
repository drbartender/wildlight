import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { pool } from '@/lib/db';
import { EmailCaptureStrip } from '@/components/site/EmailCaptureStrip';

export const revalidate = 60;

interface EntryRow {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string;
  cover_image_url: string | null;
  published_at: string;
  chapter_number: number;
  total: number;
}

interface NeighborRow {
  slug: string;
  title: string;
}

function fmtMonth(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const r = await pool.query<{ title: string; excerpt: string | null }>(
    `SELECT title, excerpt FROM blog_posts
     WHERE slug = $1 AND published = TRUE`,
    [slug],
  );
  const e = r.rows[0];
  if (!e) return { title: 'Chapter not found' };
  return {
    title: `${e.title} — Wildlight Imagery`,
    description: e.excerpt ?? undefined,
  };
}

export default async function JournalEntryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const r = await pool.query<EntryRow>(
    `WITH ord AS (
       SELECT id, slug, title, excerpt, body, cover_image_url,
              published_at,
              ROW_NUMBER() OVER (ORDER BY published_at ASC) AS chapter_number,
              COUNT(*) OVER () AS total
       FROM blog_posts WHERE published = TRUE
     )
     SELECT id, slug, title, excerpt, body, cover_image_url,
            published_at::text, chapter_number::int, total::int
     FROM ord WHERE slug = $1`,
    [slug],
  );

  const entry = r.rows[0];
  if (!entry) notFound();

  const [prevRes, nextRes] = await Promise.all([
    pool.query<NeighborRow>(
      `SELECT slug, title FROM blog_posts
       WHERE published = TRUE AND published_at < $1
       ORDER BY published_at DESC LIMIT 1`,
      [entry.published_at],
    ),
    pool.query<NeighborRow>(
      `SELECT slug, title FROM blog_posts
       WHERE published = TRUE AND published_at > $1
       ORDER BY published_at ASC LIMIT 1`,
      [entry.published_at],
    ),
  ]);
  const prev = prevRes.rows[0];
  const next = nextRes.rows[0];

  return (
    <article className="wl-journal-entry">
      <header className="wl-journal-entry-h">
        <Link href="/journal" className="back">
          ← The journal
        </Link>
        <span className="wl-eyebrow">
          Chapter {String(entry.chapter_number).padStart(2, '0')} of{' '}
          {String(entry.total).padStart(2, '0')} ·{' '}
          {fmtMonth(entry.published_at)}
        </span>
        <h1>{entry.title}</h1>
        {entry.excerpt && <p className="lede">{entry.excerpt}</p>}
      </header>

      {entry.cover_image_url && (
        <div className="wl-journal-entry-cover">
          <Image
            src={entry.cover_image_url}
            alt={entry.title}
            width={1200}
            height={750}
            sizes="(max-width: 900px) 100vw, 1200px"
            style={{ width: '100%', height: 'auto', objectFit: 'cover' }}
          />
        </div>
      )}

      {/* Body HTML is sanitized at write time (lib/journal-html.ts). */}
      <div
        className="wl-journal-body"
        dangerouslySetInnerHTML={{ __html: entry.body }}
      />

      <nav className="wl-journal-nav">
        {prev ? (
          <Link className="prev" href={`/journal/${prev.slug}`}>
            <span className="wl-mono">Previous chapter</span>
            <span className="t">{prev.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link className="next" href={`/journal/${next.slug}`}>
            <span className="wl-mono">Next chapter</span>
            <span className="t">{next.title}</span>
          </Link>
        ) : (
          <span />
        )}
      </nav>

      <section className="wlmh-news-section">
        <EmailCaptureStrip
          source="journal-entry"
          eyebrow="A quiet letter"
          headline="Want the next chapter in your inbox?"
          body="New work, the occasional studio note, and first look at limited editions before they list. No more than once a month."
        />
      </section>
    </article>
  );
}
