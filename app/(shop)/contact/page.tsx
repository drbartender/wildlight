'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { plateNumber } from '@/lib/plate-number';

type Reason = 'commission' | 'corporate-gift' | 'license' | 'order' | 'hello';

const REASON_OPTIONS: { value: Reason; label: string }[] = [
  { value: 'commission', label: 'Commission a piece' },
  { value: 'corporate-gift', label: 'Corporate gift or bulk order' },
  { value: 'license', label: 'License an image' },
  { value: 'order', label: 'Question about an order' },
  { value: 'hello', label: 'Just saying hello' },
];

const REASON_LABEL: Record<Reason, string> = Object.fromEntries(
  REASON_OPTIONS.map((r) => [r.value, r.label]),
) as Record<Reason, string>;

function isReason(v: string | null): v is Reason {
  return !!v && REASON_OPTIONS.some((r) => r.value === v);
}

function ContactForm() {
  const qp = useSearchParams();

  // Query-param routing:
  //   /contact?reason=commission&piece=<slug>
  //   /contact?reason=license&piece=<slug>
  //   /contact?license=<slug>           (legacy — keep working)
  //   /contact?topic=<free-form>        (legacy)
  const legacyLicenseSlug = qp.get('license');
  const initialReason: Reason = isReason(qp.get('reason'))
    ? (qp.get('reason') as Reason)
    : legacyLicenseSlug
      ? 'license'
      : 'commission';
  const piece = qp.get('piece') || legacyLicenseSlug || '';

  const [reason, setReason] = useState<Reason>(initialReason);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  // Honeypot: invisible to humans, filled by naive bots. Server silently
  // accepts the submission without sending if this is non-empty.
  const [website, setWebsite] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>(
    'idle',
  );

  // When a piece is referenced, seed the message with a friendly opener so the
  // user doesn't have to re-state which plate this is about.
  useEffect(() => {
    if (!piece || message) return;
    const plate = plateNumber(piece);
    const verb =
      reason === 'commission'
        ? 'a commission related to'
        : reason === 'license'
          ? 'licensing'
          : reason === 'corporate-gift'
            ? 'a corporate gift version of'
            : 'this plate';
    setMessage(`I'm interested in ${verb} ${plate} (${piece}).\n\n`);
    // deps intentionally narrow — this is a one-shot seed on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('loading');
    const subject = piece
      ? `${REASON_LABEL[reason]} — ${plateNumber(piece)}`
      : REASON_LABEL[reason];
    const topic = piece ? `${reason}:${piece}` : reason;
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, subject, message, topic, website }),
    });
    setState(res.ok ? 'done' : 'error');
  }

  if (state === 'done') {
    return (
      <section className="wl-contact">
        <span className="wl-eyebrow" style={{ display: 'inline-flex', marginBottom: 20 }}>
          Correspondence
        </span>
        <h1>
          Thank <em>you</em>.
        </h1>
        <p className="lede">
          Dan will get back to you — usually within a day.
        </p>
      </section>
    );
  }

  return (
    <section className="wl-contact">
      <span
        className="wl-eyebrow"
        style={{ display: 'inline-flex', marginBottom: 20 }}
      >
        Correspondence
      </span>
      <h1>
        Say <em>hello</em>.
      </h1>
      <p className="lede">
        Commissions, corporate gifts, licensing, a question about a plate, or
        just a note. Dan answers every one, usually within a day.
      </p>

      <div className="wl-contact-grid">
        <form className="wl-contact-form" onSubmit={submit}>
          {/* Honeypot — visually hidden, off the tab order, no autocomplete.
              Real users never see or fill this; bots that auto-fill every
              field get silently dropped server-side. */}
          <label
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: '-9999px',
              width: 1,
              height: 1,
              overflow: 'hidden',
            }}
          >
            Website
            <input
              type="text"
              name="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
            />
          </label>
          {piece && (
            <div className="ref-pill">
              <span>Re:</span>
              <b>{plateNumber(piece)}</b>
              <span>·</span>
              <span>{piece}</span>
            </div>
          )}
          <label>
            <span>Name</span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="your name"
            />
          </label>
          <label>
            <span>Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@studio.com"
            />
          </label>
          <label>
            <span>Reason</span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as Reason)}
            >
              {REASON_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Message</span>
            <textarea
              required
              rows={6}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell Dan what you have in mind."
            />
          </label>
          <button
            type="submit"
            className="wl-btn primary"
            style={{ alignSelf: 'flex-start', marginTop: 12 }}
            disabled={state === 'loading'}
          >
            {state === 'loading' ? 'Sending…' : 'Send →'}
          </button>
          {state === 'error' && (
            <p style={{ color: 'var(--s-red)', fontFamily: 'var(--f-serif)' }}>
              Something went wrong — please try again or email Dan directly.
            </p>
          )}
        </form>

        <div className="wl-contact-side">
          <div className="block">
            <h3>Direct</h3>
            <p>
              dan@wildlightimagery.shop
              <br />
              720.363.9430
            </p>
          </div>
          <div className="block">
            <h3>Studio</h3>
            <p>
              Aurora, Colorado
              <br />
              By appointment only
            </p>
          </div>
          <div className="block">
            <h3>Hours</h3>
            <p>
              Mon–Fri, most afternoons
              <br />
              Weekends in the field
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function ContactPage() {
  return (
    <Suspense
      fallback={
        <section className="wl-contact">
          <p className="lede">Loading…</p>
        </section>
      }
    >
      <ContactForm />
    </Suspense>
  );
}
