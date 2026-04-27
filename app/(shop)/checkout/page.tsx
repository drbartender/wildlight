'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadStripe, type Stripe, type Appearance } from '@stripe/stripe-js';
import { useCart } from '@/components/shop/CartProvider';
import { formatUSD } from '@/lib/money';
import { plateNumber } from '@/lib/plate-number';

// Resolve our CSS variables (which flip on the [data-mood] attribute) to
// hex values that the Stripe Appearance API can ingest. Stripe doesn't
// understand `var(...)`, so anything theme-aware has to be read from
// computed styles at the time the SDK initializes.
function readAppearance(): Appearance {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) =>
    cs.getPropertyValue(name).trim() || fallback;
  const ink = v('--ink', '#16130c');
  const ink2 = v('--ink-2', '#3b362a');
  const ink3 = v('--ink-3', '#6a6452');
  const ink4 = v('--ink-4', '#95907d');
  const paper = v('--paper', '#f2ede1');
  const paper2 = v('--paper-2', '#ebe4d3');
  return {
    theme: 'stripe',
    variables: {
      colorPrimary: ink,
      colorBackground: paper,
      colorText: ink,
      colorTextSecondary: ink3,
      colorDanger: '#b3261e',
      colorIconTab: ink3,
      colorIconTabSelected: ink,
      fontFamily: 'Georgia, "Times New Roman", serif',
      fontSizeBase: '15px',
      fontWeightNormal: '400',
      fontWeightMedium: '500',
      fontWeightBold: '600',
      borderRadius: '2px',
      spacingUnit: '4px',
      spacingGridRow: '14px',
    },
    rules: {
      '.Label': {
        fontSize: '12px',
        fontWeight: '500',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: ink3,
      },
      '.Input': {
        backgroundColor: paper,
        border: `1px solid ${ink4}`,
        color: ink,
        boxShadow: 'none',
        padding: '12px 14px',
      },
      '.Input:hover': {
        borderColor: ink3,
      },
      '.Input:focus': {
        borderColor: ink,
        boxShadow: 'none',
      },
      '.Input--invalid': {
        borderColor: '#b3261e',
        color: ink,
      },
      '.Tab': {
        backgroundColor: paper2,
        border: `1px solid ${ink4}`,
        color: ink2,
        boxShadow: 'none',
      },
      '.Tab:hover': {
        borderColor: ink3,
        color: ink,
      },
      '.Tab--selected': {
        borderColor: ink,
        backgroundColor: paper,
        color: ink,
        boxShadow: 'none',
      },
      '.Block': {
        backgroundColor: paper,
        border: `1px solid ${ink4}`,
        boxShadow: 'none',
      },
      '.AccordionItem': {
        backgroundColor: paper,
        border: `1px solid ${ink4}`,
        boxShadow: 'none',
      },
      '.PickerItem': {
        backgroundColor: paper,
        border: `1px solid ${ink4}`,
        color: ink,
        boxShadow: 'none',
      },
      '.PickerItem--selected': {
        borderColor: ink,
        backgroundColor: paper2,
      },
    },
  };
}

export default function CheckoutPage() {
  const cart = useCart();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);

  // Mount points for Stripe Elements.
  const expressMount = useRef<HTMLDivElement | null>(null);
  const contactMount = useRef<HTMLDivElement | null>(null);
  const shippingMount = useRef<HTMLDivElement | null>(null);
  const paymentMount = useRef<HTMLDivElement | null>(null);

  // Imperative SDK handle. Held in a ref so the confirm handler reads the
  // latest one without forcing the effect to re-run.
  // The exact type lives in @stripe/stripe-js but isn't re-exported by the
  // top-level entry — we keep it loose here since we only call documented
  // methods.
  const sdkRef = useRef<{
    loadActions: () => Promise<{
      type: 'success' | 'error';
      actions?: {
        confirm: (a?: { returnUrl?: string }) => Promise<unknown>;
      };
      error?: { message: string };
    }>;
    changeAppearance: (a: Appearance) => void;
  } | null>(null);

  // Guard against StrictMode double-invoke creating two Stripe sessions.
  const requestedRef = useRef(false);
  // Latest cart.clear, captured by ref so the post-confirm cleanup is stable.
  const clearCartRef = useRef(cart.clear);
  clearCartRef.current = cart.clear;

  const lineCount = cart.lines.length;

  useEffect(() => {
    if (cart.ready && lineCount === 0) {
      router.replace('/cart');
    }
  }, [cart.ready, lineCount, router]);

  useEffect(() => {
    if (!cart.ready || lineCount === 0) return;
    if (requestedRef.current) return;
    requestedRef.current = true;

    const ac = new AbortController();
    let stripe: Stripe | null = null;
    let cleanup: (() => void) | null = null;

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
        stripe = await loadStripe(data.publishableKey);
        if (!stripe || ac.signal.aborted) return;

        // initCheckoutElementsSdk is the entry point for Custom Checkout
        // (ui_mode: 'elements'). Returns an imperative SDK we mount
        // elements from.
        const sdk = (
          stripe as unknown as {
            initCheckoutElementsSdk: (opts: {
              clientSecret: string;
              elementsOptions?: { appearance?: Appearance };
            }) => typeof sdkRef extends { current: infer S } ? S : never;
          }
        ).initCheckoutElementsSdk({
          clientSecret: data.clientSecret,
          elementsOptions: { appearance: readAppearance() },
        }) as unknown as NonNullable<typeof sdkRef.current> & {
          createContactDetailsElement: () => { mount: (el: HTMLElement) => void; destroy: () => void };
          createShippingAddressElement: () => { mount: (el: HTMLElement) => void; destroy: () => void };
          createPaymentElement: () => { mount: (el: HTMLElement) => void; destroy: () => void };
          createExpressCheckoutElement: () => { mount: (el: HTMLElement) => void; destroy: () => void };
        };
        sdkRef.current = sdk;

        const elements: Array<{ destroy: () => void }> = [];
        if (expressMount.current) {
          const ec = sdk.createExpressCheckoutElement();
          ec.mount(expressMount.current);
          elements.push(ec);
        }
        if (contactMount.current) {
          const cd = sdk.createContactDetailsElement();
          cd.mount(contactMount.current);
          elements.push(cd);
        }
        if (shippingMount.current) {
          const sh = sdk.createShippingAddressElement();
          sh.mount(shippingMount.current);
          elements.push(sh);
        }
        if (paymentMount.current) {
          const pe = sdk.createPaymentElement();
          pe.mount(paymentMount.current);
          elements.push(pe);
        }

        // Re-skin when the user toggles Bone ↔ Ink. The button in the
        // header sets data-mood on <html>; observing that attribute keeps
        // the Stripe widget in lockstep without forcing a reload.
        const obs = new MutationObserver(() => {
          sdkRef.current?.changeAppearance(readAppearance());
        });
        obs.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-mood'],
        });

        cleanup = () => {
          obs.disconnect();
          for (const el of elements) {
            try {
              el.destroy();
            } catch {
              // already torn down
            }
          }
        };
        setReady(true);
      } catch (e) {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : 'Could not start checkout');
        requestedRef.current = false;
      }
    })();

    return () => {
      ac.abort();
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.ready]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sdkRef.current || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await sdkRef.current.loadActions();
      if (res.type !== 'success' || !res.actions) {
        setError(res.error?.message || 'Checkout could not load');
        setSubmitting(false);
        return;
      }
      const siteUrl =
        process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
      // Clear the cart now so the customer doesn't return to a stale list
      // if they hit Back from the order page. The webhook owns truth from
      // here on; the localStorage cart is just a UI buffer.
      clearCartRef.current();
      const result = (await res.actions.confirm({
        returnUrl: `${siteUrl}/api/orders/by-session/{CHECKOUT_SESSION_ID}`,
      })) as { type?: string; error?: { message?: string } };
      // Stripe handles the redirect on success; reaching here means the
      // confirm returned without redirecting, usually due to a buyer-side
      // error.
      if (result?.error?.message) {
        setError(result.error.message);
        setSubmitting(false);
        return;
      }
      if (result?.type && result.type !== 'success') {
        setError('Payment did not complete. Please try again.');
        setSubmitting(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
      setSubmitting(false);
    }
  }

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

        <form className="wl-checkout-payment" onSubmit={handleSubmit}>
          <span className="wl-summary-label">Payment</span>

          {!ready && !error && (
            <div className="wl-checkout-loading">
              Preparing secure payment…
            </div>
          )}

          <div
            className="wl-checkout-fields"
            style={{ display: ready ? 'flex' : 'none' }}
          >
            <div ref={expressMount} className="wl-checkout-field" />
            <div ref={contactMount} className="wl-checkout-field" />
            <div ref={shippingMount} className="wl-checkout-field" />
            <div ref={paymentMount} className="wl-checkout-field" />

            {error && <p className="wl-sum-error">{error}</p>}

            <button
              type="submit"
              className="wl-btn primary"
              disabled={submitting}
            >
              {submitting
                ? 'Processing…'
                : `Pay ${formatUSD(cart.subtotalCents)}+`}
            </button>
            <p className="wl-checkout-fineprint">
              Final total includes shipping and tax, computed before charging.
            </p>
          </div>

          {error && !ready && (
            <div className="wl-checkout-error">
              <p className="wl-sum-error">{error}</p>
              <Link href="/cart" className="wl-btn ghost">
                Back to cart
              </Link>
            </div>
          )}
        </form>
      </div>
    </section>
  );
}
