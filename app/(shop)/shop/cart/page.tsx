'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCart } from '@/components/shop/CartProvider';
import { formatUSD } from '@/lib/money';
import { plateNumber } from '@/lib/plate-number';

export default function CartPage() {
  const cart = useCart();

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
          : `${count} ${plateWord} · printed to order`}
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
            Ships in 5–7 days, direct from our print partner.
          </p>
          <div
            style={{
              marginTop: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {count > 0 && (
              <Link className="wl-btn primary" href="/checkout">
                Proceed to checkout →
              </Link>
            )}
            <Link className="wl-btn ghost" href="/collections">
              Continue browsing
            </Link>
          </div>
        </aside>
      </div>
    </section>
  );
}
