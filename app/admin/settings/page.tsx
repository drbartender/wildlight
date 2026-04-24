'use client';
import { useState } from 'react';

export default function Settings() {
  const [cur, setCur] = useState('');
  const [n, setN] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function change(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await fetch('/api/admin/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: cur, newPassword: n }),
    });
    setBusy(false);
    setMsg(r.ok ? 'Password updated.' : 'Failed — check your current password and try again.');
    if (r.ok) {
      setCur('');
      setN('');
    }
  }

  return (
    <div>
      <h1 style={{ fontWeight: 400 }}>Settings</h1>
      <h3 style={{ marginTop: 24, fontWeight: 400 }}>Change password</h3>
      <form onSubmit={change} style={{ display: 'grid', gap: 8, maxWidth: 400 }}>
        <input
          type="password"
          required
          placeholder="Current password"
          autoComplete="current-password"
          value={cur}
          onChange={(e) => setCur(e.target.value)}
          style={{ padding: 8, fontFamily: 'inherit' }}
        />
        <input
          type="password"
          required
          minLength={12}
          placeholder="New password (12+ chars)"
          autoComplete="new-password"
          value={n}
          onChange={(e) => setN(e.target.value)}
          style={{ padding: 8, fontFamily: 'inherit' }}
        />
        <button className="button" disabled={busy}>
          {busy ? 'Updating…' : 'Update'}
        </button>
        {msg && <p>{msg}</p>}
      </form>

      <h3 style={{ marginTop: 48, fontWeight: 400 }}>Operational notes</h3>
      <p style={{ color: '#777', fontSize: 14, maxWidth: 640 }}>
        API keys (Stripe, Printful, Resend) live in Vercel environment variables and are not
        editable here. Schema migrations run from the git repo via <code>npm run migrate</code>.
        Reach out to Dallas if a key or environment variable needs to rotate.
      </p>
    </div>
  );
}
