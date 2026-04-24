import { ArtworkCard } from './ArtworkCard';

export interface GridItem {
  slug: string;
  title: string;
  image_web_url: string;
}

export function ArtworkGrid({ items }: { items: GridItem[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 20,
        marginTop: 24,
      }}
    >
      {items.map((i) => (
        <ArtworkCard
          key={i.slug}
          slug={i.slug}
          title={i.title}
          imageUrl={i.image_web_url}
        />
      ))}
    </div>
  );
}
