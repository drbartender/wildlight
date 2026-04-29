import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { pool } from '@/lib/db';
import { EmailCaptureStrip } from '@/components/site/EmailCaptureStrip';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'The journal — Wildlight Imagery',
  description:
    'Notes from the studio and the field. New chapter every season — sometimes more.',
};

const PER_PAGE = 20;

interface ListRow {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image_url: string | null;
  published_at: string;
  chapter_number: number;
}

interface CountRow {
  total: number;
}

function fmtMonth(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default async function JournalIndex({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const offset = (page - 1) * PER_PAGE;

  const [rowsRes, countRes] = await Promise.all([
    pool.query<ListRow>(
      `SELECT id, slug, title, excerpt, cover_image_url,
              published_at::text,
              ROW_NUMBER() OVER (ORDER BY published_at ASC)::int AS chapter_number
       FROM blog_posts
       WHERE published = TRUE
       ORDER BY published_at DESC
       LIMIT $1 OFFSET $2`,
      [PER_PAGE, offset],
    ),
    pool.query<CountRow>(
      `SELECT COUNT(*)::int AS total FROM blog_posts WHERE published = TRUE`,
    ),
  ]);

  const rows = rowsRes.rows;
  const total = countRes.rows[0]?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div>
      <header className="wl-cindex-head">
        <div>
          <span className="wl-eyebrow">The journal · {total} chapters</span>
          <h1>
            The journal<em>.</em>
          </h1>
          <p>
            Notes from the studio and the field. Behind the shot, around it,
            and in between — collected, ongoing.
          </p>
        </div>
        <div className="wl-masthead-side">
          <div>
            <b>Chapters</b> {String(total).padStart(2, '0')}
          </div>
          <div>
            <b>Cadence</b> Quarterly
          </div>
          <div>
            <b>Page</b> {page} / {totalPages}
          </div>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="wl-journal-empty">
          No chapters published yet — the first one is on its way.
        </p>
      ) : (
        <ul className="wl-journal-list">
          {rows.map((r) => (
            <li key={r.id} className="wl-journal-row">
              <Link href={`/journal/${r.slug}`}>
                <span className="ch">
                  CH · {String(r.chapter_number).padStart(2, '0')}
                </span>
                <div className="body">
                  <h2 className="title">{r.title}</h2>
                  {r.excerpt && <p className="excerpt">{r.excerpt}</p>}
                  <span className="date">{fmtMonth(r.published_at)}</span>
                </div>
                {r.cover_image_url && (
                  <div className="thumb">
                    <Image
                      src={r.cover_image_url}
                      alt={r.title}
                      width={120}
                      height={120}
                      style={{ objectFit: 'cover' }}
                    />
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <nav className="wl-journal-pager">
          {page > 1 ? (
            <Link href={`/journal?page=${page - 1}`}>← Previous</Link>
          ) : (
            <span />
          )}
          <span className="wl-mono">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={`/journal?page=${page + 1}`}>Next →</Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      <section className="wlmh-news-section">
        <EmailCaptureStrip
          source="journal-index"
          eyebrow="A quiet letter"
          headline="The next chapter, in your inbox."
          body="New work, the occasional studio note, and first look at limited editions before they list. No more than once a month."
        />
      </section>
    </div>
  );
}
