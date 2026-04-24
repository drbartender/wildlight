'use client';
import { useState, useMemo } from 'react';
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
  artworkTitle: string;
  artworkSlug: string;
  imageUrl: string;
  variants: VariantOption[];
}

export function VariantPicker({
  artworkId,
  artworkTitle,
  artworkSlug,
  imageUrl,
  variants,
}: Props) {
  const types = useMemo(() => Array.from(new Set(variants.map((v) => v.type))), [variants]);
  const [type, setType] = useState<string>(types[0] ?? '');
  const forType = variants.filter((v) => v.type === type);
  const [selId, setSelId] = useState<number | undefined>(forType[0]?.id);
  const cart = useCart();
  const [added, setAdded] = useState(false);

  const current = variants.find((v) => v.id === selId);

  if (!variants.length) {
    return (
      <p style={{ color: 'var(--muted)' }}>
        Not yet for sale — drop your email and we'll notify you when editions are ready.
      </p>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ color: 'var(--muted)', fontSize: 13 }}>Format</label>
        <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
          {types.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setType(t);
                setSelId(variants.find((v) => v.type === t)?.id);
              }}
              className="button"
              style={{
                background: t === type ? 'var(--fg)' : undefined,
                color: t === type ? 'var(--bg)' : undefined,
                textTransform: 'capitalize',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 24 }}>
        <label style={{ color: 'var(--muted)', fontSize: 13 }}>
          Size{type === 'framed' && ' / finish'}
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
          {forType.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setSelId(v.id)}
              className="button"
              style={{
                background: v.id === selId ? 'var(--fg)' : undefined,
                color: v.id === selId ? 'var(--bg)' : undefined,
              }}
            >
              {v.size}
              {v.finish ? ` · ${v.finish}` : ''} — {formatUSD(v.price_cents)}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="button"
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
        {added ? 'Added to cart' : `Add to cart — ${current ? formatUSD(current.price_cents) : ''}`}
      </button>
    </div>
  );
}
