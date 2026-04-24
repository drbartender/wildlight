import { pool } from '@/lib/db';
import { CollectionCard } from '@/components/shop/CollectionCard';

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
  return (
    <section className="container" style={{ padding: '40px 0' }}>
      <h1>Collections</h1>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 32,
          marginTop: 24,
        }}
      >
        {rows.map((c) => (
          <div key={c.slug}>
            <CollectionCard
              slug={c.slug}
              title={c.title}
              tagline={c.tagline}
              coverUrl={c.cover_image_url}
            />
            <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>{c.n} pieces</p>
          </div>
        ))}
      </div>
    </section>
  );
}
