import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pool } from '@/lib/db';
import { PlateCard, type PlateCardData } from '@/components/shop/PlateCard';

export const revalidate = 60;

interface CollectionRow {
  id: number;
  title: string;
  tagline: string | null;
  idx: number;
  total: number;
}

export default async function CollectionDetail({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const col = await pool.query<CollectionRow>(
    `WITH ordered AS (
       SELECT id, title, tagline, slug,
              ROW_NUMBER() OVER (ORDER BY display_order, id) AS idx,
              COUNT(*) OVER () AS total
       FROM collections
     )
     SELECT id, title, tagline, idx::int, total::int
     FROM ordered WHERE slug = $1`,
    [slug],
  );
  if (!col.rowCount) notFound();
  const c = col.rows[0];

  const arts = await pool.query<PlateCardData>(
    `SELECT a.slug, a.title, a.image_web_url, a.year_shot, a.location,
            (SELECT MIN(price_cents) FROM artwork_variants v
                WHERE v.artwork_id = a.id AND v.active = TRUE) AS min_price_cents
     FROM artworks a
     WHERE a.collection_id = $1 AND a.status = 'published'
     ORDER BY a.display_order, a.id`,
    [c.id],
  );
  const works = arts.rows;

  const minPrice =
    works.reduce<number | null>(
      (m, w) =>
        w.min_price_cents != null
          ? m == null
            ? w.min_price_cents
            : Math.min(m, w.min_price_cents)
          : m,
      null,
    ) ?? null;

  const titleDisplay = c.title.replace(/^The /, '');

  return (
    <div>
      <header className="wl-coll-head">
        <Link href="/shop/collections" className="back">
          ← All collections
        </Link>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: 40,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div className="wl-eyebrow" style={{ marginBottom: 16 }}>
              Chapter {String(c.idx).padStart(2, '0')} of{' '}
              {String(c.total).padStart(2, '0')}
            </div>
            <h1>
              {titleDisplay}
              <em>.</em>
            </h1>
            {c.tagline && <p className="tag">{c.tagline}</p>}
          </div>
          <div className="wl-masthead-side">
            <div>
              <b>Plates</b> {String(works.length).padStart(2, '0')}
            </div>
            <div>
              <b>From</b>{' '}
              {minPrice != null ? `$${Math.floor(minPrice / 100)}` : '—'}
            </div>
            <div>
              <b>Media</b> Print · Canvas · Metal
            </div>
          </div>
        </div>
      </header>

      <div className="wl-coll-grid">
        {works.length > 0 ? (
          works.map((w) => <PlateCard key={w.slug} item={w} />)
        ) : (
          <p style={{ color: 'var(--ink-3)', gridColumn: '1 / -1' }}>
            Nothing published in this collection yet.
          </p>
        )}
      </div>
    </div>
  );
}
