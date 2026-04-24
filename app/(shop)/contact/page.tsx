'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function ContactForm() {
  const qp = useSearchParams();
  const topic = qp.get('license')
    ? `license:${qp.get('license')}`
    : qp.get('topic') || '';
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('loading');
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, topic }),
    });
    setState(res.ok ? 'done' : 'error');
  }

  if (state === 'done') {
    return (
      <section className="container" style={{ padding: '40px 0', maxWidth: 560 }}>
        <h1>Thank you.</h1>
        <p>We'll be in touch shortly.</p>
      </section>
    );
  }

  const inp: React.CSSProperties = {
    padding: 10,
    border: '1px solid var(--rule)',
    background: 'white',
    fontFamily: 'inherit',
    fontSize: 15,
  };

  return (
    <section className="container" style={{ padding: '40px 0', maxWidth: 560 }}>
      <h1>Contact</h1>
      {topic && <p style={{ color: 'var(--muted)' }}>Regarding: {topic}</p>}
      <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
        <input
          required
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          style={inp}
        />
        <input
          required
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          style={inp}
        />
        <input
          placeholder="Subject"
          value={form.subject}
          onChange={(e) => setForm({ ...form, subject: e.target.value })}
          style={inp}
        />
        <textarea
          required
          rows={8}
          placeholder="Message"
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
          style={inp}
        />
        <button className="button" disabled={state === 'loading'}>
          {state === 'loading' ? 'Sending…' : 'Send'}
        </button>
        {state === 'error' && (
          <p style={{ color: '#b22' }}>
            Something went wrong — please try again or email directly.
          </p>
        )}
      </form>
    </section>
  );
}

export default function ContactPage() {
  return (
    <Suspense fallback={<section className="container" style={{ padding: 40 }}>Loading…</section>}>
      <ContactForm />
    </Suspense>
  );
}
