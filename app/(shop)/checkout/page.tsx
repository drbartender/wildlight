'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from '@stripe/react-stripe-js';
import { useCart } from '@/components/shop/CartProvider';
import { formatUSD } from '@/lib/money';
import { plateNumber } from '@/lib/plate-number';

export default function CheckoutPage() {
  const cart = useCart();
  const router = useRouter();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripePromise, setStripePromise] =
    useState<Promise<Stripe | null> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guard against StrictMode double-invocation creating two Stripe sessions.
  const requestedRef = useRef(false);
  // Holds the latest clientSecret for the stable fetchClientSecret callback
  // — Stripe's EmbeddedCheckoutProvider reads `options.fetchClientSecret`
  // once on mount, so its identity must not change after.
  const clientSecretRef = useRef<string | null>(null);
  clientSecretRef.current = clientSecret;
  // Latest cart.clear, captured by ref so the onComplete callback we hand
  // to Stripe doesn't get re-bound when the cart re-renders.
  const clearCartRef = useRef(cart.clear);
  clearCartRef.current = cart.clear;

  const lineCount = cart.lines.length;

  // Empty-cart redirect: separate from the fetch effect so the dependency
  // semantics are obvious — re-runs whenever ready/empty state changes.
  useEffect(() => {
    if (cart.ready && lineCount === 0) {
      router.replace('/cart');
    }
  }, [cart.ready, lineCount, router]);

  // Create the Stripe session once on first hydrated, non-empty mount.
  useEffect(() => {
    if (!cart.ready || lineCount === 0) return;
    if (requestedRef.current) return;
    requestedRef.current = true;

    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ac.signal,
          body: JSON.stringify({
            lines: cart.lines.map((l) => ({
              variantId: l.variantId,
              quantity: l.quantity,
            })),
          }),
        });
        const data = (await res.json()) as {
          clientSecret?: string;
          publishableKey?: string;
          error?: string;
        };
        if (ac.signal.aborted) return;
        if (!data.clientSecret || !data.publishableKey) {
          setError(data.error || 'Could not start checkout');
          requestedRef.current = false;
          return;
        }
        // loadStripe memoizes per key internally, so calling it without
        // a wrapper cache is safe and correct.
        setStripePromise(loadStripe(data.publishableKey));
        setClientSecret(data.clientSecret);
      } catch (e) {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : 'Could not start checkout');
        requestedRef.current = false;
      }
    })();

    return () => {
      ac.abort();
    };
    // cart.lines identity changes each render, but we only want to fire on
    // initial hydration. The redirect effect above handles the empty case.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.ready]);

  // Stable identity — Stripe's EmbeddedCheckoutProvider asserts options
  // don't change after mount. The ref read keeps the callback's identity
  // stable across renders even though clientSecret arrives asynchronously.
  const fetchClientSecret = useCallback(
    async () => clientSecretRef.current ?? '',
    [],
  );
  const onComplete = useCallback(() => {
    // Fires after Stripe confirms payment, before the return_url redirect —
    // closes the gap where a customer's localStorage cart still held the
    // items they just paid for.
    clearCartRef.current();
  }, []);

  if (!cart.ready) {
    return (
      <section className="wl-checkout">
        <div className="wl-checkout-loading">Loading your order…</div>
      </section>
    );
  }

  if (lineCount === 0) {
    return (
      <section className="wl-checkout">
        <h1>
          Checkout <em>—</em> empty.
        </h1>
        <div className="sub">No plates in your order.</div>
        <p className="wl-sum-note" style={{ marginTop: 24 }}>
          <Link href="/collections">Back to collections →</Link>
        </p>
      </section>
    );
  }

  return (
    <section className="wl-checkout">
      <h1>
        Your <em>checkout</em>.
      </h1>
      <div className="sub">
        {lineCount} {lineCount === 1 ? 'plate' : 'plates'} · printed to order
      </div>

      <div className="wl-checkout-stack">
        <section className="wl-checkout-summary">
          <span className="wl-summary-label">In your order</span>
          {cart.lines.map((l) => (
            <div key={l.variantId} className="wl-ci">
              <div className="wl-ci-img">
                <Image
                  src={l.imageUrl}
                  alt={l.artworkTitle}
                  fill
                  sizes="72px"
                  style={{ objectFit: 'cover' }}
                />
              </div>
              <div>
                <div className="wl-ci-title">{l.artworkTitle}</div>
                <div className="wl-ci-sub">
                  {plateNumber(l.artworkSlug)} · {l.type} · {l.size}
                  {l.finish ? ` · ${l.finish}` : ''} · ×{l.quantity}
                </div>
              </div>
              <div className="wl-ci-price">
                {formatUSD(l.priceCents * l.quantity)}
              </div>
            </div>
          ))}

          <div className="wl-checkout-totals">
            <div className="wl-sum-row">
              <span>Subtotal</span>
              <span>{formatUSD(cart.subtotalCents)}</span>
            </div>
            <div className="wl-sum-row">
              <span>Shipping &amp; tax</span>
              <span>Calculated at payment</span>
            </div>
          </div>

          <p className="wl-sum-note">
            Archival · printed to order. Ships direct from our print partner.
          </p>
          <div className="wl-checkout-back">
            <Link className="wl-btn ghost" href="/cart">
              ← Edit cart
            </Link>
          </div>
        </section>

        <section className="wl-checkout-payment">
          <span className="wl-summary-label">Payment</span>
          {error ? (
            <div className="wl-checkout-error">
              <p className="wl-sum-error">{error}</p>
              <Link href="/cart" className="wl-btn ghost">
                Back to cart
              </Link>
            </div>
          ) : !clientSecret || !stripePromise ? (
            <div className="wl-checkout-loading">
              Preparing secure payment…
            </div>
          ) : (
            <EmbeddedCheckoutProvider
              stripe={stripePromise}
              options={{ fetchClientSecret, onComplete }}
            >
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          )}
        </section>
      </div>
    </section>
  );
}
