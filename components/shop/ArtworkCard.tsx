import Link from 'next/link';
import Image from 'next/image';

export function ArtworkCard({
  slug,
  title,
  imageUrl,
}: {
  slug: string;
  title: string;
  imageUrl: string;
}) {
  return (
    <Link
      href={`/artwork/${slug}`}
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
    >
      <div
        style={{
          position: 'relative',
          aspectRatio: '1/1',
          background: 'var(--rule)',
          overflow: 'hidden',
        }}
      >
        <Image
          src={imageUrl}
          alt={title}
          fill
          sizes="(max-width: 900px) 50vw, 25vw"
          style={{ objectFit: 'cover' }}
        />
      </div>
      <p style={{ marginTop: 8, fontSize: 13, color: 'var(--muted)' }}>{title}</p>
    </Link>
  );
}
