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

  return (
    <div
      style={{
        maxWidth: 360,
        margin: '10vh auto',
        fontFamily: 'Georgia, serif',
        padding: 24,
      }}
    >
      <h1 style={{ fontWeight: 400 }}>Admin</h1>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <label>
          Email
          <br />
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: '100%', padding: 8, fontFamily: 'inherit' }}
          />
        </label>
        <label>
          Password
          <br />
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: '100%', padding: 8, fontFamily: 'inherit' }}
          />
        </label>
        {error && <p style={{ color: '#b22' }}>{error}</p>}
        <button
          className="button"
          disabled={loading}
          style={{ marginTop: 4 }}
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
