'use client';
import { useState } from 'react';

export function EmailCaptureStrip({ source = 'footer' }: { source?: string }) {
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
        Thank you — we'll be in touch sparingly.
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="wl-email-capture">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Be told about new work"
        aria-label="Email address"
      />
      <button disabled={state === 'loading'}>
        {state === 'loading' ? '…' : 'Subscribe'}
      </button>
    </form>
  );
}
