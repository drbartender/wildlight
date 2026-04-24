'use client';
import { useEffect, useState } from 'react';

interface Row {
  id: number;
  email: string;
  source: string | null;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  created_at: string;
}

export default function AdminSubscribers() {
  const [rows, setRows] = useState<Row[]>([]);
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('');
  const [test, setTest] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/subscribers')
      .then((r) => r.json())
      .then((d: { rows: Row[] }) => setRows(d.rows))
      .catch(() => setRows([]));
  }, []);

  const activeCount = rows.filter(
    (r) => r.confirmed_at && !r.unsubscribed_at,
  ).length;

  async function send(body: Record<string, unknown>) {
    setState('sending');
    setError(null);
    const r = await fetch('/api/admin/subscribers/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = (await r.json()) as { error?: string };
    if (!r.ok) setError(d.error || 'send failed');
    setState(r.ok ? 'done' : 'idle');
  }

  async function sendTest() {
    if (!test) return;
    await send({ subject, html, testTo: test });
  }
  async function broadcast() {
    if (!confirm(`Send to ${activeCount} subscribers?`)) return;
    await send({ subject, html });
  }

  return (
    <div>
      <h1 style={{ fontWeight: 400 }}>
        Subscribers ({activeCount} active / {rows.length} total)
      </h1>

      <details style={{ margin: '16px 0' }}>
        <summary style={{ cursor: 'pointer' }}>New broadcast</summary>
        <div style={{ display: 'grid', gap: 8, marginTop: 12, maxWidth: 720 }}>
          <input
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            style={{ padding: 8, fontFamily: 'inherit' }}
          />
          <textarea
            rows={12}
            placeholder="HTML body"
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            style={{ padding: 8, fontFamily: 'monospace', fontSize: 13 }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              placeholder="test-to@email"
              value={test}
              onChange={(e) => setTest(e.target.value)}
              style={{ padding: 8, fontFamily: 'inherit', flex: 1 }}
            />
            <button
              onClick={sendTest}
              disabled={!test || !subject || !html || state === 'sending'}
            >
              Send test
            </button>
            <button
              onClick={broadcast}
              disabled={!activeCount || !subject || !html || state === 'sending'}
              style={{ marginLeft: 'auto' }}
            >
              Send broadcast
            </button>
          </div>
          {state === 'done' && <p style={{ color: '#2a8a5c' }}>Sent.</p>}
          {error && <p style={{ color: '#b22' }}>{error}</p>}
        </div>
      </details>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>
            <th style={{ padding: 8 }}>Email</th>
            <th style={{ padding: 8 }}>Source</th>
            <th style={{ padding: 8 }}>Joined</th>
            <th style={{ padding: 8 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 8 }}>{r.email}</td>
              <td style={{ padding: 8 }}>{r.source || '—'}</td>
              <td style={{ padding: 8 }}>
                {new Date(r.created_at).toLocaleDateString()}
              </td>
              <td style={{ padding: 8, color: r.unsubscribed_at ? '#b22' : '#2a8a5c' }}>
                {r.unsubscribed_at ? 'unsub' : r.confirmed_at ? 'active' : 'pending'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
