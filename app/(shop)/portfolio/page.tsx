import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { pool } from '@/lib/db';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'The portfolio — Wildlight Imagery',
  description:
    'Twenty years of looking, gathered into collections — each a chapter in a longer letter about how I see.',
};

interface CollectionRow {
  slug: string;
  title: string;
  tagline: string | null;
  cover_image_url: string | null;
  display_order: number;
  n: number;
}

interface CountsRow {
  total: number;
  latest: string | null;
}

function seasonOf(date: Date): string {
  const m = date.getUTCMonth();
  const y = date.getUTCFullYear();
  const yy = `'${String(y).slice(2)}`;
  if (m === 11 || m <= 1)
    return `Winter ${m === 11 ? `'${String(y + 1).slice(2)}` : yy}`;
  if (m <= 4) return `Spring ${yy}`;
  if (m <= 7) return `Summer ${yy}`;
  return `Fall ${yy}`;
}

export default async function PortfolioIndex() {
  const [collsRes, countsRes] = await Promise.all([
    pool.query<CollectionRow>(
      `SELECT c.slug, c.title, c.tagline, c.cover_image_url, c.display_order,
              COALESCE(COUNT(a.id) FILTER (WHERE a.status = 'published'), 0)::int AS n
       FROM collections c
       LEFT JOIN artworks a ON a.collection_id = c.id
       GROUP BY c.id
       ORDER BY c.display_order, c.id`,
    ),
    pool.query<CountsRow>(
      `SELECT COUNT(*)::int AS total, MAX(published_at)::text AS latest
       FROM artworks WHERE status='published'`,
    ),
  ]);

  const collections = collsRes.rows;
  const total = countsRes.rows[0]?.total ?? 0;
  const latestRaw = countsRes.rows[0]?.latest ?? null;
  const latestLabel = latestRaw ? seasonOf(new Date(latestRaw)) : '—';

  return (
    <div>
      <header className="wl-cindex-head">
        <div>
          <span className="wl-eyebrow">
            The portfolio · {collections.length} chapters
          </span>
          <h1>
            The portfolio<em>.</em>
          </h1>
          <p>
            Twenty years of looking, gathered into collections — each a chapter
            in a longer letter about how I see.
          </p>
        </div>
        <div className="wl-masthead-side">
          <div>
            <b>Chapters</b> {String(collections.length).padStart(2, '0')}
          </div>
          <div>
            <b>Plates</b> {String(total).padStart(3, '0')}
          </div>
          <div>
            <b>Updated</b> {latestLabel}
          </div>
        </div>
      </header>
      <div className="wl-cindex-list">
        {collections.map((c, i) => (
          <Link
            key={c.slug}
            href={`/portfolio/${c.slug}`}
            className="wl-cindex-row"
          >
            <span className="no">CH · {String(i + 1).padStart(2, '0')}</span>
            <span className="title">{c.title.replace(/^The /, '')}</span>
            <span className="tagline">{c.tagline ?? ''}</span>
            <span className="count">
              {c.n} {c.n === 1 ? 'plate' : 'plates'}
            </span>
            <span className="thumb">
              {c.cover_image_url && (
                <Image
                  src={c.cover_image_url}
                  alt={c.title}
                  width={72}
                  height={72}
                  style={{ objectFit: 'cover' }}
                />
              )}
            </span>
          </Link>
        ))}
      </div>
      <div className="wlpf-footnote">
        <span className="wl-mono">Footnote</span>
        <p>Photojournalism work — coming back when the archive lands.</p>
      </div>
    </div>
  );
}
