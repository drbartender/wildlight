import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { pool } from '@/lib/db';
import { ArtworkGrid, type GridItem } from '@/components/site/ArtworkGrid';

export const revalidate = 60;

interface CollectionRow {
  id: number;
  slug: string;
  title: string;
  tagline: string | null;
  display_order: number;
}

interface PlateRow extends GridItem {}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const r = await pool.query<{ title: string; tagline: string | null }>(
    'SELECT title, tagline FROM collections WHERE slug = $1',
    [slug],
  );
  const c = r.rows[0];
  if (!c) return { title: 'Collection not found' };
  return {
    title: `${c.title} — Wildlight Imagery`,
    description: c.tagline ?? undefined,
  };
}

export default async function PortfolioDetail({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const collRes = await pool.query<CollectionRow>(
    'SELECT id, slug, title, tagline, display_order FROM collections WHERE slug = $1',
    [slug],
  );
  const collection = collRes.rows[0];
  if (!collection) notFound();

  const [worksRes, allOrders] = await Promise.all([
    pool.query<PlateRow>(
      `SELECT a.slug,
              a.title,
              a.image_web_url,
              a.year_shot,
              a.location,
              c.title AS collection_title
       FROM artworks a
       LEFT JOIN collections c ON c.id = a.collection_id
       WHERE a.collection_id = $1 AND a.status = 'published'
       ORDER BY a.display_order, a.id`,
      [collection.id],
    ),
    pool.query<{ slug: string }>(
      'SELECT slug FROM collections ORDER BY display_order, id',
    ),
  ]);

  const works = worksRes.rows;
  const chapterNumber =
    allOrders.rows.findIndex((r) => r.slug === slug) + 1;

  const yearRange = (() => {
    const ys = works
      .map((w) => w.year_shot)
      .filter((y): y is number => typeof y === 'number');
    if (ys.length === 0) return 'Various';
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    return min === max ? String(min) : `${min}–${max}`;
  })();

  return (
    <div>
      <header className="wl-coll-head">
        <Link href="/portfolio" className="back">
          ← The portfolio
        </Link>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: 40,
          }}
        >
          <div>
            <div className="wl-eyebrow" style={{ marginBottom: 16 }}>
              Chapter {String(chapterNumber).padStart(2, '0')} of{' '}
              {String(allOrders.rows.length).padStart(2, '0')}
            </div>
            <h1>
              {collection.title.replace(/^The /, '')}
              <em>.</em>
            </h1>
            {collection.tagline && <p className="tag">{collection.tagline}</p>}
          </div>
          <div className="wl-masthead-side">
            <div>
              <b>Plates</b> {String(works.length).padStart(2, '0')}
            </div>
            <div>
              <b>Year</b> {yearRange}
            </div>
            <div>
              <b>Buy</b>{' '}
              <Link href="/shop" className="wlmh-meta-link">
                In the shop →
              </Link>
            </div>
          </div>
        </div>
      </header>
      {works.length > 0 ? (
        <ArtworkGrid
          items={works}
          showPrice={false}
          linkBase="/shop/artwork"
          className="wl-coll-grid wlpf-noprice"
        />
      ) : (
        <p
          style={{
            color: 'var(--ink-3)',
            fontFamily: 'var(--f-serif)',
            fontSize: 17,
            padding: '40px 56px',
          }}
        >
          No plates published in this chapter yet.
        </p>
      )}
    </div>
  );
}
