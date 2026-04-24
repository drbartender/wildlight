import Link from 'next/link';
import Image from 'next/image';
import { pool } from '@/lib/db';
import { CollectionCard } from '@/components/shop/CollectionCard';

export const revalidate = 60;

interface Featured {
  slug: string;
  title: string;
  image_web_url: string;
}
interface CollectionRow {
  slug: string;
  title: string;
  tagline: string | null;
  cover_image_url: string | null;
}

export default async function HomePage() {
  // Pick a hero by OFFSET instead of ORDER BY random() — random() forces a
  // full-table scan that scales badly as the catalog grows. Two fast queries
  // is cheaper than one slow one.
  const [countRes, collections] = await Promise.all([
    pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM artworks WHERE status='published'`,
    ),
    pool.query<CollectionRow>(
      `SELECT slug, title, tagline, cover_image_url FROM collections ORDER BY display_order`,
    ),
  ]);
  const total = countRes.rows[0]?.n ?? 0;
  const offset = total > 0 ? Math.floor(Math.random() * total) : 0;
  const featured =
    total > 0
      ? await pool.query<Featured>(
          `SELECT slug, title, image_web_url FROM artworks
           WHERE status='published' ORDER BY id LIMIT 1 OFFSET $1`,
          [offset],
        )
      : { rows: [] as Featured[] };
  const hero = featured.rows[0];

  return (
    <>
      <section className="container" style={{ paddingTop: 40, paddingBottom: 40 }}>
        {hero ? (
          <Link href={`/artwork/${hero.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div
              style={{
                position: 'relative',
                aspectRatio: '16/9',
                background: 'var(--rule)',
                overflow: 'hidden',
              }}
            >
              <Image
                src={hero.image_web_url}
                alt={hero.title}
                fill
                priority
                sizes="100vw"
                style={{ objectFit: 'cover' }}
              />
            </div>
            <p style={{ color: 'var(--muted)', marginTop: 8, fontSize: 13 }}>{hero.title}</p>
          </Link>
        ) : (
          <div
            style={{
              aspectRatio: '16/9',
              background: 'var(--rule)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--muted)',
            }}
          >
            (no published work yet)
          </div>
        )}
        <div style={{ marginTop: 48, maxWidth: 680 }}>
          <h1>A curated selection of fine art by Dan Raby.</h1>
          <p style={{ color: 'var(--muted)', fontSize: 17 }}>
            Archival prints, canvases, and framed pieces — made to order, shipped worldwide.
          </p>
          <Link className="button" href="/collections" style={{ marginTop: 16 }}>
            Browse collections
          </Link>
        </div>
      </section>
      <section className="container" style={{ paddingBottom: 80 }}>
        <h2>Collections</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 32,
            marginTop: 24,
          }}
        >
          {collections.rows.map((c) => (
            <CollectionCard
              key={c.slug}
              slug={c.slug}
              title={c.title}
              tagline={c.tagline}
              coverUrl={c.cover_image_url}
            />
          ))}
        </div>
      </section>
    </>
  );
}
