import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { pool } from '@/lib/db';
import { VariantPicker, type VariantOption } from '@/components/shop/VariantPicker';

export const revalidate = 60;

interface ArtworkRow {
  id: number;
  slug: string;
  title: string;
  artist_note: string | null;
  year_shot: number | null;
  location: string | null;
  image_web_url: string;
  collection_slug: string | null;
  collection_title: string | null;
}

export default async function ArtworkPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const arts = await pool.query<ArtworkRow>(
    `SELECT a.id, a.slug, a.title, a.artist_note, a.year_shot, a.location,
            a.image_web_url,
            c.slug AS collection_slug, c.title AS collection_title
     FROM artworks a
     LEFT JOIN collections c ON c.id = a.collection_id
     WHERE a.slug = $1 AND a.status = 'published'`,
    [slug],
  );
  if (!arts.rowCount) notFound();
  const art = arts.rows[0];

  const { rows: variants } = await pool.query<VariantOption>(
    `SELECT id, type, size, finish, price_cents FROM artwork_variants
     WHERE artwork_id = $1 AND active = TRUE
     ORDER BY type, price_cents`,
    [art.id],
  );

  return (
    <section
      className="container"
      style={{
        padding: '40px 0',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
        gap: 48,
      }}
    >
      <div style={{ position: 'relative', aspectRatio: '4/5', background: 'var(--rule)' }}>
        <Image
          src={art.image_web_url}
          alt={art.title}
          fill
          priority
          sizes="(max-width: 900px) 100vw, 58vw"
          style={{ objectFit: 'cover' }}
        />
      </div>
      <div>
        {art.collection_title && art.collection_slug && (
          <Link
            href={`/collections/${art.collection_slug}`}
            style={{ color: 'var(--muted)', fontSize: 13, textDecoration: 'none' }}
          >
            {art.collection_title}
          </Link>
        )}
        <h1 style={{ marginTop: 8 }}>{art.title}</h1>
        {art.artist_note && (
          <p style={{ marginTop: 16, maxWidth: 520, whiteSpace: 'pre-wrap' }}>
            {art.artist_note}
          </p>
        )}
        {(art.location || art.year_shot) && (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>
            {art.location}
            {art.location && art.year_shot ? ', ' : ''}
            {art.year_shot}
          </p>
        )}
        <div style={{ marginTop: 32 }}>
          <VariantPicker
            artworkId={art.id}
            artworkTitle={art.title}
            artworkSlug={art.slug}
            imageUrl={art.image_web_url}
            variants={variants}
          />
          <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 16 }}>
            Made to order — ships within 7 business days.
          </p>
          <p style={{ marginTop: 32 }}>
            <Link
              href={`/contact?license=${art.slug}`}
              style={{ color: 'var(--muted)', fontSize: 14 }}
            >
              License this image →
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
