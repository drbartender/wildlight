'use client';
import { useState } from 'react';

export function EmailCaptureStrip({ source = 'footer' }: { source?: string }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

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
      <p style={{ color: 'var(--muted)' }}>
        Thank you — we'll be in touch sparingly.
      </p>
    );
  }
  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 8, maxWidth: 480 }}>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Be told about new work"
        style={{
          flex: 1,
          padding: 10,
          border: '1px solid var(--rule)',
          fontFamily: 'inherit',
          background: 'white',
        }}
      />
      <button className="button" disabled={state === 'loading'}>
        {state === 'loading' ? '…' : 'Subscribe'}
      </button>
    </form>
  );
}
