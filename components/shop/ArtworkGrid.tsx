import { PlateCard, type PlateCardData } from './PlateCard';

export type GridItem = PlateCardData;

export function ArtworkGrid({ items }: { items: GridItem[] }) {
  return (
    <div className="wl-plates">
      {items.map((i) => (
        <PlateCard key={i.slug} item={i} />
      ))}
    </div>
  );
}
