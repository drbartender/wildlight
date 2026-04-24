'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { useCart } from '@/components/shop/CartProvider';
import { formatUSD } from '@/lib/money';

export default function CartPage() {
  const cart = useCart();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (cart.lines.length === 0) {
    return (
      <section className="container" style={{ padding: '40px 0' }}>
        <h1>Cart</h1>
        <p>Your cart is empty.</p>
        <Link className="button" href="/collections">
          Browse collections
        </Link>
      </section>
    );
  }

  async function checkout() {
    setCheckoutLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: cart.lines.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
          })),
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || 'Checkout failed');
        setCheckoutLoading(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed');
      setCheckoutLoading(false);
    }
  }

  return (
    <section className="container" style={{ padding: '40px 0' }}>
      <h1>Cart</h1>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 320px',
          gap: 48,
          marginTop: 24,
        }}
      >
        <div>
          {cart.lines.map((l) => (
            <div
              key={l.variantId}
              style={{
                display: 'grid',
                gridTemplateColumns: '100px 1fr auto',
                gap: 16,
                alignItems: 'center',
                padding: '12px 0',
                borderBottom: '1px solid var(--rule)',
              }}
            >
              <div style={{ position: 'relative', aspectRatio: '1/1' }}>
                <Image
                  src={l.imageUrl}
                  alt={l.artworkTitle}
                  fill
                  sizes="100px"
                  style={{ objectFit: 'cover' }}
                />
              </div>
              <div>
                <Link href={`/artwork/${l.artworkSlug}`} style={{ color: 'inherit' }}>
                  <strong>{l.artworkTitle}</strong>
                </Link>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                  {l.type} · {l.size}
                  {l.finish ? ` · ${l.finish}` : ''}
                </div>
                <div style={{ marginTop: 4 }}>
                  <input
                    type="number"
                    min={1}
                    value={l.quantity}
                    onChange={(e) =>
                      cart.setQty(l.variantId, parseInt(e.target.value) || 1)
                    }
                    style={{ width: 60, padding: 4 }}
                  />
                  <button
                    style={{
                      marginLeft: 12,
                      background: 'none',
                      border: 'none',
                      color: 'var(--muted)',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: 13,
                    }}
                    onClick={() => cart.remove(l.variantId)}
                  >
                    remove
                  </button>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {formatUSD(l.priceCents * l.quantity)}
              </div>
            </div>
          ))}
        </div>
        <aside>
          <div style={{ border: '1px solid var(--rule)', padding: 16, background: 'white' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Subtotal</span>
              <span>{formatUSD(cart.subtotalCents)}</span>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
              Shipping and tax calculated at checkout.
            </p>
            {error && (
              <p style={{ color: '#b22', fontSize: 13 }}>{error}</p>
            )}
            <button
              className="button"
              style={{ width: '100%', marginTop: 16 }}
              onClick={checkout}
              disabled={checkoutLoading}
            >
              {checkoutLoading ? 'Redirecting…' : 'Checkout'}
            </button>
          </div>
        </aside>
      </div>
    </section>
  );
}
