'use client';

import Image from 'next/image';
import { useRef, useState } from 'react';
import { Lightbox } from './Lightbox';
import { formatPlate } from '@/lib/plate-number';

export interface WallItem {
  slug: string;
  title: string;
  image_web_url: string;
  year_shot?: number | null;
  location?: string | null;
  collection_title?: string | null;
  /** True when status='published' — i.e. actually available as a print. */
  available: boolean;
  /** Stored accession number. Required: a missing one renders "WL–NaN". */
  plate_no: number;
}

/**
 * The vintage wall: Dan's body of work shown as a dense, unsorted "wall of
 * photos" (the feel of the old wildlightimagery.com gallery). Every frame
 * opens a lightbox; the few `available` frames carry a tick and offer a path
 * into the shop from the lightbox. Look-only — never links straight to a
 * detail page, since draft artworks 404 there.
 */
export function VintageWall({ items }: { items: WallItem[] }) {
  const [active, setActive] = useState<number | null>(null);
  // Remember which frame opened the viewer so focus returns there on close.
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  function open(i: number, el: HTMLButtonElement) {
    triggerRef.current = el;
    setActive(i);
  }
  function close() {
    setActive(null);
    const t = triggerRef.current;
    if (t) requestAnimationFrame(() => t.focus());
  }

  return (
    <>
      {/* inert while the viewer is open: the wall behind the scrim must not
          be tabbable or clickable. */}
      <div className="wl-wall" inert={active !== null ? true : undefined}>
        {items.map((it, i) => (
          <button
            type="button"
            key={it.slug}
            className="wl-wall-item"
            onClick={(e) => open(i, e.currentTarget)}
            aria-label={`View ${it.title}${
              it.available ? ' — available as a print' : ''
            }`}
          >
            {/* next/image fills the fixed-aspect cell and serves a ~200px
                AVIF/WebP from the 2000px web master — the wall stays light
                without a separate thumbnail tier. */}
            <Image
              src={it.image_web_url}
              alt={it.title}
              fill
              sizes="(max-width: 520px) 50vw, (max-width: 1024px) 33vw, 240px"
              loading={i < 12 ? 'eager' : 'lazy'}
              style={{ objectFit: 'cover' }}
            />
            {it.available && (
              <span className="wl-wall-tick" aria-hidden="true" />
            )}
            {/* Plate first, so the number always survives: .t is nowrap with
                ellipsis in a 240px cell, so a long title truncates and the
                number would be the casualty if it came second.
                "Print" is a SIBLING of .t, not part of it — inside, the
                ellipsis would eat it on exactly the tiles it matters for.
                It spells out what the corner tick means, on hover, where
                there is room for words. Not announced: the button carries an
                explicit aria-label that already says "available as a
                print", and that label overrides this content. */}
            <span className="wl-wall-cap">
              <span className="t">
                {formatPlate(it.plate_no)} · {it.title}
              </span>
              {it.available && <span className="print">Print</span>}
            </span>
          </button>
        ))}
      </div>
      {active !== null && (
        <Lightbox
          items={items}
          index={active}
          onClose={close}
          onIndex={setActive}
        />
      )}
    </>
  );
}
