'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { useCart } from '@/components/shop/CartProvider';
import { formatUSD } from '@/lib/money';
import { plateNumber } from '@/lib/plate-number';

export default function CartPage() {
  const cart = useCart();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const count = cart.lines.length;
  const plateWord = count === 1 ? 'plate' : 'plates';

  return (
    <section className="wl-cart">
      <h1>
        Your <em>order</em>.
      </h1>
      <div className="sub">
        {count === 0
          ? 'No plates yet'
          : `${count} ${plateWord} · printed to order in Aurora, CO`}
      </div>

      <div className="wl-cart-grid">
        <div>
          {count === 0 ? (
            <div className="wl-cart-empty">
              Browse the{' '}
              <Link href="/collections">collections</Link> to add your first
              plate.
            </div>
          ) : (
            cart.lines.map((l) => (
              <div key={l.variantId} className="wl-ci">
                <div className="wl-ci-img">
                  <Image
                    src={l.imageUrl}
                    alt={l.artworkTitle}
                    fill
                    sizes="96px"
                    style={{ objectFit: 'cover' }}
                  />
                </div>
                <div>
                  <Link
                    href={`/artwork/${l.artworkSlug}`}
                    style={{ color: 'inherit' }}
                  >
                    <div className="wl-ci-title">{l.artworkTitle}</div>
                  </Link>
                  <div className="wl-ci-sub">
                    {plateNumber(l.artworkSlug)} · {l.type} · {l.size}
                    {l.finish ? ` · ${l.finish}` : ''}
                  </div>
                  <div className="wl-ci-controls">
                    <div className="wl-qty">
                      <button
                        onClick={() => cart.setQty(l.variantId, l.quantity - 1)}
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <span>{l.quantity}</span>
                      <button
                        onClick={() => cart.setQty(l.variantId, l.quantity + 1)}
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>
                    <button
                      className="wl-ci-remove"
                      onClick={() => cart.remove(l.variantId)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <div className="wl-ci-price">
                  {formatUSD(l.priceCents * l.quantity)}
                </div>
              </div>
            ))
          )}
        </div>

        <aside className="wl-summary">
          <span className="wl-summary-label">RECEIPT</span>
          <div className="wl-sum-row">
            <span>Subtotal</span>
            <span>{formatUSD(cart.subtotalCents)}</span>
          </div>
          <div className="wl-sum-row">
            <span>Shipping &amp; tax</span>
            <span>Calculated at checkout</span>
          </div>
          <div className="wl-sum-row total">
            <span>Total</span>
            <span>{formatUSD(cart.subtotalCents)}</span>
          </div>
          <p className="wl-sum-note">
            Archival · printed to order.
            <br />
            Ships in 5–7 days from Aurora, Colorado.
          </p>
          {error && <p className="wl-sum-error">{error}</p>}
          <div
            style={{
              marginTop: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <button
              type="button"
              className="wl-btn primary"
              onClick={checkout}
              disabled={count === 0 || checkoutLoading}
            >
              {checkoutLoading ? 'Redirecting…' : 'Proceed to checkout →'}
            </button>
            <Link className="wl-btn ghost" href="/collections">
              Continue browsing
            </Link>
          </div>
        </aside>
      </div>
    </section>
  );
}
