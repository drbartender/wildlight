import { notFound } from 'next/navigation';
import { pool } from '@/lib/db';
import { ArtworkGrid, type GridItem } from '@/components/shop/ArtworkGrid';

export const revalidate = 60;

interface CollectionRow {
  id: number;
  title: string;
  tagline: string | null;
}

export default async function CollectionDetail({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const col = await pool.query<CollectionRow>(
    'SELECT id, title, tagline FROM collections WHERE slug = $1',
    [slug],
  );
  if (!col.rowCount) notFound();
  const c = col.rows[0];

  const arts = await pool.query<GridItem>(
    `SELECT slug, title, image_web_url FROM artworks
     WHERE collection_id = $1 AND status = 'published'
     ORDER BY display_order, id`,
    [c.id],
  );

  return (
    <section className="container" style={{ padding: '40px 0' }}>
      <h1>{c.title}</h1>
      {c.tagline && (
        <p style={{ color: 'var(--muted)', maxWidth: 560 }}>{c.tagline}</p>
      )}
      {arts.rows.length ? (
        <ArtworkGrid items={arts.rows} />
      ) : (
        <p style={{ color: 'var(--muted)', marginTop: 24 }}>
          Nothing published in this collection yet.
        </p>
      )}
    </section>
  );
}
