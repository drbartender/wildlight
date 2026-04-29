'use client';
import { useState } from 'react';

export interface EmailCaptureStripProps {
  source?: string;
  /**
   * Eyebrow text above the headline. Defaults to the marketing-home tone.
   */
  eyebrow?: string;
  /** Headline (h3). Defaults to the marketing-home tone. */
  headline?: string;
  /** Body paragraph. Defaults to the marketing-home tone. */
  body?: string;
}

export function EmailCaptureStrip({
  source = 'footer',
  eyebrow = 'Notes from the field',
  headline = 'Quarterly notes, in your inbox.',
  body = 'New chapters, new prints, occasional limited editions. Sent quarterly — never more.',
}: EmailCaptureStripProps) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>(
    'idle',
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('loading');
    const res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, source }),
    });
    setState(res.ok ? 'done' : 'error');
  }

  if (state === 'done') {
    return (
      <p className="wl-email-capture-ok">
        Thank you — we&apos;ll be in touch sparingly.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="wl-news">
      <div className="wl-news-copy">
        <span className="wl-eyebrow">{eyebrow}</span>
        <h3>{headline}</h3>
        <p>{body}</p>
      </div>
      <div className="wl-news-form">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@studio.com"
          aria-label="Email address"
        />
        <button
          className="wl-btn primary"
          type="submit"
          disabled={state === 'loading'}
        >
          {state === 'loading' ? 'Subscribing…' : 'Subscribe →'}
        </button>
        <span className="wl-news-fine">
          Unsubscribe in one click. We never share your address.
        </span>
        {state === 'error' && (
          <span className="wl-news-fine" style={{ color: 'var(--s-red)' }}>
            Could not subscribe — please try again.
          </span>
        )}
      </div>
    </form>
  );
}
