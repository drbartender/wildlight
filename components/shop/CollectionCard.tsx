import Image from 'next/image';
import Link from 'next/link';

export interface CollectionCardProps {
  slug: string;
  title: string;
  tagline?: string | null;
  coverUrl: string | null;
}

export function CollectionCard({ slug, title, tagline, coverUrl }: CollectionCardProps) {
  return (
    <Link
      href={`/collections/${slug}`}
      style={{ textDecoration: 'none', display: 'block', color: 'inherit' }}
    >
      <div
        style={{
          aspectRatio: '4/5',
          background: 'var(--rule)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {coverUrl && (
          <Image
            src={coverUrl}
            alt={title}
            fill
            sizes="(max-width: 900px) 100vw, 33vw"
            style={{ objectFit: 'cover' }}
          />
        )}
      </div>
      <h3 style={{ marginTop: 12, marginBottom: 4 }}>{title}</h3>
      {tagline && (
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>{tagline}</p>
      )}
    </Link>
  );
}
