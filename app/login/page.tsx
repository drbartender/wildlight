'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (!res.ok) {
      setError('Invalid credentials');
      return;
    }
    router.push('/admin');
    router.refresh();
  }

  const fields = (
    <>
      <label className="wl-adm-field">
        <span className="wl-adm-field-label">Email</span>
        <input
          className="wl-adm-field-input"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@wildlight.co"
        />
      </label>
      <label className="wl-adm-field">
        <span className="wl-adm-field-label">Password</span>
        <input
          className="wl-adm-field-input"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
    </>
  );

  return (
    <>
      {/* Atelier login */}
      <div className="wl-adm-login wl-adm-login-atelier">
        <div className="stack">
          <div className="brand">
            <div className="w">Wildlight</div>
            <div className="s">Imagery · Studio</div>
          </div>
          <form onSubmit={submit} className="card">
            {fields}
            {error && <p className="err">{error}</p>}
            <button
              type="submit"
              className="wl-adm-btn primary"
              disabled={loading}
              style={{ justifyContent: 'center', padding: '10px' }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <div className="foot">Trouble signing in? Contact Dallas.</div>
        </div>
      </div>

      {/* Darkroom login */}
      <div className="wl-adm-login wl-adm-login-darkroom">
        <div className="stack">
          <div className="brand">
            <div className="icon" aria-hidden="true">W</div>
            <div className="txt">
              <div className="w">wildlight</div>
              <div className="s">admin · v2.4</div>
            </div>
            <span className="health">● all systems ok</span>
          </div>
          <form onSubmit={submit} className="card">
            {fields}
            {error && <p className="err">{error}</p>}
            <button
              type="submit"
              className="wl-adm-btn primary"
              disabled={loading}
              style={{
                justifyContent: 'center',
                padding: '7px',
                fontFamily: 'var(--f-mono), monospace',
              }}
            >
              {loading ? 'signing in…' : '→ sign in'}
            </button>
          </form>
          <div className="foot">// session expires after 7d inactivity</div>
        </div>
      </div>
    </>
  );
}
