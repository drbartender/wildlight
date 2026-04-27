import Image from 'next/image';
import Link from 'next/link';
import { plateNumber } from '@/lib/plate-number';

export interface PlateCardData {
  slug: string;
  title: string;
  image_web_url: string;
  year_shot?: number | null;
  location?: string | null;
  collection_title?: string | null;
  /** Minimum variant price in cents. Omit to hide the "from" line. */
  min_price_cents?: number | null;
}

export function PlateCard({ item }: { item: PlateCardData }) {
  const plate = plateNumber(item.slug);
  const fromStr =
    item.min_price_cents != null && item.min_price_cents > 0
      ? `$${Math.floor(item.min_price_cents / 100)}+`
      : null;

  const subParts = [item.collection_title, item.year_shot, item.location]
    .filter((v): v is string | number => v != null && v !== '')
    .map(String);

  return (
    <Link
      href={`/shop/artwork/${item.slug}`}
      className="wl-plate-card"
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <div className="wl-plate-frame">
        <span className="wl-plate-no">{plate}</span>
        <div className="wl-plate-img">
          <Image
            src={item.image_web_url}
            alt={item.title}
            fill
            sizes="(max-width: 480px) 100vw, (max-width: 900px) 50vw, 25vw"
            style={{ objectFit: 'cover' }}
          />
        </div>
      </div>
      <div className="wl-plate-meta">
        <div className="wl-plate-title">{item.title}</div>
        {fromStr && <div className="wl-plate-price">{fromStr}</div>}
        {subParts.length > 0 && (
          <div className="wl-plate-sub">{subParts.join(' · ')}</div>
        )}
      </div>
    </Link>
  );
}
