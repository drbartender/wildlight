'use client';

import { useState } from 'react';

export function PasswordForm() {
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
    setMsg(
      r.ok
        ? 'Password updated.'
        : 'Failed — check your current password and try again.',
    );
    if (r.ok) {
      setCur('');
      setN('');
    }
  }

  return (
    <form
      onSubmit={change}
      style={{ display: 'grid', gap: 12, marginTop: 16, maxWidth: 400 }}
    >
      <label className="wl-adm-field">
        <span className="wl-adm-field-label">Current password</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={cur}
          onChange={(e) => setCur(e.target.value)}
          className="wl-adm-field-input"
        />
      </label>
      <label className="wl-adm-field">
        <span className="wl-adm-field-label">
          New password · 12+ chars
        </span>
        <input
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={n}
          onChange={(e) => setN(e.target.value)}
          className="wl-adm-field-input"
        />
      </label>
      <div>
        <button className="wl-adm-btn primary" disabled={busy}>
          {busy ? 'Updating…' : 'Update password'}
        </button>
      </div>
      {msg && (
        <p
          style={{
            fontSize: 13,
            color: msg.startsWith('Password')
              ? 'var(--adm-green)'
              : 'var(--adm-red)',
          }}
        >
          {msg}
        </p>
      )}
    </form>
  );
}
