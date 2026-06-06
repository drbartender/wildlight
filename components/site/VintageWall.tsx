'use client';

import { useState } from 'react';
import { Lightbox } from './Lightbox';

export interface WallItem {
  slug: string;
  title: string;
  image_web_url: string;
  year_shot?: number | null;
  location?: string | null;
  collection_title?: string | null;
  /** True when status='published' — i.e. actually available as a print. */
  available: boolean;
}

/**
 * The vintage wall: Dan's body of work shown as a dense, unsorted "wall of
 * photos" (the feel of the old wildlightimagery.com gallery). Every frame
 * opens a lightbox; the few `available` frames carry a dot and offer a path
 * into the shop from the lightbox. Look-only — never links straight to a
 * detail page, since draft artworks 404 there.
 */
export function VintageWall({ items }: { items: WallItem[] }) {
  const [active, setActive] = useState<number | null>(null);

  return (
    <>
      <div className="wl-wall">
        {items.map((it, i) => (
          <button
            type="button"
            key={it.slug}
            className="wl-wall-item"
            onClick={() => setActive(i)}
            aria-label={`View ${it.title}${
              it.available ? ' — available as a print' : ''
            }`}
          >
            {/* Plain img on purpose: ~100 look-only vintage examples with no
                stored dimensions; lazy-loading keeps the wall light. A
                thumbnail tier is a tracked follow-up. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={it.image_web_url}
              alt={it.title}
              loading="lazy"
              decoding="async"
            />
            {it.available && <span className="wl-wall-dot" aria-hidden="true" />}
            <span className="wl-wall-cap">{it.title}</span>
          </button>
        ))}
      </div>
      {active !== null && (
        <Lightbox
          items={items}
          index={active}
          onClose={() => setActive(null)}
          onIndex={setActive}
        />
      )}
    </>
  );
}
