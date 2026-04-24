'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useCart } from './CartProvider';
import { formatUSD } from '@/lib/money';

export interface VariantOption {
  id: number;
  type: string;
  size: string;
  finish: string | null;
  price_cents: number;
}

interface Props {
  artworkId: number;
  artworkSlug: string;
  artworkTitle: string;
  imageUrl: string;
  plateNo: string;
  chapterTitle: string | null;
  yearShot: number | null;
  note: string | null;
  variants: VariantOption[];
}

// Human labels for variant types, with a fallback that title-cases unknowns.
function mediumLabel(type: string): string {
  const map: Record<string, string> = {
    fine_art: 'Fine art print',
    canvas: 'Canvas wrap',
    framed: 'Framed',
    metal: 'Metal',
  };
  if (map[type]) return map[type];
  return type
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function OrderCard({
  artworkId,
  artworkSlug,
  artworkTitle,
  imageUrl,
  plateNo,
  chapterTitle,
  yearShot,
  note,
  variants,
}: Props) {
  const types = useMemo(
    () => Array.from(new Set(variants.map((v) => v.type))),
    [variants],
  );
  const [type, setType] = useState<string>(types[0] ?? '');
  const forType = useMemo(
    () => variants.filter((v) => v.type === type),
    [variants, type],
  );
  const [variantId, setVariantId] = useState<number | undefined>(
    forType[0]?.id,
  );
  const current = variants.find((v) => v.id === variantId) ?? forType[0];

  const cart = useCart();
  const [added, setAdded] = useState(false);

  // Split "Title, subtitle" so only the first clause is italicized.
  const commaIx = artworkTitle.indexOf(',');
  const headHead = commaIx >= 0 ? artworkTitle.slice(0, commaIx) : artworkTitle;
  const headTail = commaIx >= 0 ? artworkTitle.slice(commaIx) : '';

  if (!variants.length) {
    return (
      <aside className="wl-art-card">
        <h1>
          <em>{headHead}</em>
          {headTail}
        </h1>
        <div className="facts">
          <span>
            <b>Plate</b> {plateNo}
          </span>
          {chapterTitle && (
            <span>
              <b>Chapter</b> {chapterTitle}
            </span>
          )}
          {yearShot && (
            <span>
              <b>Year</b> {yearShot}
            </span>
          )}
        </div>
        {note && <p className="note">&ldquo;{note}&rdquo;</p>}
        <p
          style={{
            fontFamily: 'var(--f-serif)',
            fontStyle: 'italic',
            color: 'var(--ink-2)',
            margin: '20px 0 0',
          }}
        >
          Not yet for sale — editions coming. Drop your email in the footer
          and we'll let you know when they're ready.
        </p>
        <div className="actions" style={{ marginTop: 24 }}>
          <Link
            className="wl-btn ghost"
            href={`/contact?reason=commission&piece=${artworkSlug}`}
          >
            Commission or gift this →
          </Link>
        </div>
      </aside>
    );
  }

  return (
    <aside className="wl-art-card">
      <h1>
        <em>{headHead}</em>
        {headTail}
      </h1>
      <div className="facts">
        <span>
          <b>Plate</b> {plateNo}
        </span>
        {chapterTitle && (
          <span>
            <b>Chapter</b> {chapterTitle}
          </span>
        )}
        {yearShot && (
          <span>
            <b>Year</b> {yearShot}
          </span>
        )}
      </div>
      {note && <p className="note">&ldquo;{note}&rdquo;</p>}

      <div className="row">
        <span className="label">Medium</span>
        <div className="wl-chips">
          {types.map((k) => (
            <button
              key={k}
              type="button"
              className={`wl-chip ${type === k ? 'on' : ''}`}
              onClick={() => {
                setType(k);
                const first = variants.find((v) => v.type === k);
                setVariantId(first?.id);
              }}
            >
              {mediumLabel(k)}
            </button>
          ))}
        </div>
      </div>

      <div className="row">
        <span className="label">Size</span>
        <div className="wl-chips">
          {forType.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`wl-chip ${variantId === v.id ? 'on' : ''}`}
              onClick={() => setVariantId(v.id)}
            >
              {v.size} <em>{formatUSD(v.price_cents)}</em>
            </button>
          ))}
        </div>
      </div>

      {current?.finish && (
        <div className="row">
          <span className="label">Finish</span>
          <div className="wl-chips">
            <button className="wl-chip on" type="button" aria-disabled="true">
              {current.finish}
            </button>
          </div>
        </div>
      )}

      <div className="total-row">
        <span className="amt">
          {current ? formatUSD(current.price_cents) : '—'}
          <em>+ shipping</em>
        </span>
        <span className="wl-mono">Ready in 5–7 days</span>
      </div>

      <div className="actions">
        <button
          type="button"
          className="wl-btn primary"
          disabled={!current}
          onClick={() => {
            if (!current) return;
            cart.add({
              variantId: current.id,
              artworkId,
              artworkSlug,
              artworkTitle,
              imageUrl,
              type: current.type,
              size: current.size,
              finish: current.finish,
              priceCents: current.price_cents,
            });
            setAdded(true);
            setTimeout(() => setAdded(false), 1800);
          }}
        >
          {added ? 'Added to order ✓' : 'Add to order →'}
        </button>
        <Link
          className="wl-btn ghost"
          href={`/contact?reason=commission&piece=${artworkSlug}`}
        >
          Commission or gift this →
        </Link>
      </div>

      <div className="wl-art-stamp">
        <span>Archival · Printed to order</span>
        <span className="dot"></span>
      </div>

      <Link
        className="wl-art-license"
        href={`/contact?reason=license&piece=${artworkSlug}`}
      >
        License this image →
      </Link>
    </aside>
  );
}
