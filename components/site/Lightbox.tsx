'use client';

import Link from 'next/link';
import { useCallback, useEffect } from 'react';
import type { WallItem } from './VintageWall';
import { plateNumber } from '@/lib/plate-number';

/**
 * In-place viewer for the vintage wall. Dark scrim regardless of mood —
 * best for looking at photographs. Esc + arrow keys + click-out, with a
 * body scroll-lock (same pattern as the Nav dialog).
 */
export function Lightbox({
  items,
  index,
  onClose,
  onIndex,
}: {
  items: WallItem[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
}) {
  const item = items[index];

  const go = useCallback(
    (dir: number) => {
      onIndex((index + dir + items.length) % items.length);
    },
    [index, items.length, onIndex],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [go, onClose]);

  if (!item) return null;

  const sub = [item.collection_title, item.location, item.year_shot]
    .filter((v): v is string | number => v != null && v !== '')
    .map(String)
    .join(' · ');

  return (
    <div
      className="wl-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
      onClick={onClose}
    >
      <div className="wl-lightbox-stage" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="wl-lightbox-close"
          onClick={onClose}
          aria-label="Close viewer"
        >
          Close ✕
        </button>
        {items.length > 1 && (
          <button
            type="button"
            className="wl-lightbox-arrow prev"
            onClick={() => go(-1)}
            aria-label="Previous photograph"
          >
            ‹
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="wl-lightbox-img"
          src={item.image_web_url}
          alt={item.title}
        />
        {items.length > 1 && (
          <button
            type="button"
            className="wl-lightbox-arrow next"
            onClick={() => go(1)}
            aria-label="Next photograph"
          >
            ›
          </button>
        )}
      </div>
      <div className="wl-lightbox-cap" onClick={(e) => e.stopPropagation()}>
        <span className="title">{item.title}</span>
        {sub && <span className="sub">{sub}</span>}
        {item.available ? (
          <Link className="wl-lightbox-shop" href={`/shop/artwork/${item.slug}`}>
            See print options →
          </Link>
        ) : (
          <span className="sub">{plateNumber(item.slug)} · from the archive</span>
        )}
        <span className="count">
          {index + 1} / {items.length}
        </span>
      </div>
    </div>
  );
}
