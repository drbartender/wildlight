import { PlateCard, type PlateCardData } from './PlateCard';

export type GridItem = PlateCardData;

export interface ArtworkGridProps {
  items: GridItem[];
  showPrice?: boolean;
  linkBase?: string;
  /** Optional override for the wrapping element's class. */
  className?: string;
}

export function ArtworkGrid({
  items,
  showPrice = true,
  linkBase = '/shop/artwork',
  className = 'wl-plates',
}: ArtworkGridProps) {
  return (
    <div className={className}>
      {items.map((i) => (
        <PlateCard
          key={i.slug}
          item={i}
          showPrice={showPrice}
          linkBase={linkBase}
        />
      ))}
    </div>
  );
}
