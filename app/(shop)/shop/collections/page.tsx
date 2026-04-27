import Link from 'next/link';
import Image from 'next/image';
import { pool } from '@/lib/db';

export const revalidate = 60;

interface Row {
  slug: string;
  title: string;
  tagline: string | null;
  cover_image_url: string | null;
  n: number;
}

export default async function CollectionsIndex() {
  const { rows } = await pool.query<Row>(
    `SELECT c.slug, c.title, c.tagline, c.cover_image_url,
            COUNT(a.*) FILTER (WHERE a.status='published')::int AS n
     FROM collections c
     LEFT JOIN artworks a ON a.collection_id = c.id
     GROUP BY c.id
     ORDER BY c.display_order`,
  );

  const totalPlates = rows.reduce((s, r) => s + r.n, 0);

  return (
    <div>
      <header className="wl-cindex-head">
        <div>
          <span className="wl-eyebrow">
            The Catalog · {rows.length} {rows.length === 1 ? 'Chapter' : 'Chapters'}
          </span>
          <h1>Collections.</h1>
          <p>
            Small bodies of work, curated from twenty years of looking. Each
            collection is a chapter in a longer letter about light.
          </p>
        </div>
        <div className="wl-masthead-side">
          <div>
            <b>Chapters</b> {String(rows.length).padStart(2, '0')}
          </div>
          <div>
            <b>Plates</b> {String(totalPlates).padStart(3, '0')}
          </div>
          <div>
            <b>Media</b> Print · Canvas · Metal
          </div>
        </div>
      </header>

      <div className="wl-cindex-list">
        {rows.map((c, i) => (
          <Link
            key={c.slug}
            href={`/shop/collections/${c.slug}`}
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
                  fill
                  sizes="120px"
                  style={{ objectFit: 'cover' }}
                />
              )}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
