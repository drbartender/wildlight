'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AdminPill } from '@/components/admin/AdminPill';
import { AdminTopBar } from '@/components/admin/AdminTopBar';

interface Row {
  id: number;
  email: string;
  source: string | null;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  created_at: string;
}

type Tab = 'list' | 'broadcast' | 'history';

function statusOf(r: Row): string {
  if (r.unsubscribed_at) return 'unsub';
  if (r.confirmed_at) return 'active';
  return 'pending';
}

function fmtJoined(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return 'Today';
  const yd = new Date(now);
  yd.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yd.getFullYear() &&
    d.getMonth() === yd.getMonth() &&
    d.getDate() === yd.getDate()
  )
    return 'Yesterday';
  const days = Math.floor((now.getTime() - d.getTime()) / (24 * 3600 * 1000));
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString();
}

interface BroadcastRow {
  id: number;
  subject: string;
  recipient_count: number;
  sent_at: string;
  sent_by: string | null;
}

function SubscribersInner() {
  const qp = useSearchParams();
  const initialTab = (qp.get('tab') as Tab) || 'list';
  const [tab, setTab] = useState<Tab>(
    ['list', 'broadcast', 'history'].includes(initialTab) ? initialTab : 'list',
  );
  const [rows, setRows] = useState<Row[]>([]);

  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState(
    `<p>Dear friends,</p>\n<p>…</p>\n<p>Dan</p>`,
  );
  const [testTo, setTestTo] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState<string>(() => crypto.randomUUID());

  const [broadcasts, setBroadcasts] = useState<BroadcastRow[]>([]);
  const [broadcastsLoading, setBroadcastsLoading] = useState(false);

  useEffect(() => {
    fetch('/api/admin/subscribers')
      .then((r) => r.json())
      .then((d: { rows: Row[] }) => setRows(d.rows))
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    if (tab !== 'history') return;
    setBroadcastsLoading(true);
    fetch('/api/admin/subscribers/broadcasts')
      .then((r) => r.json())
      .then((d: { rows: BroadcastRow[] }) => setBroadcasts(d.rows))
      .catch(() => setBroadcasts([]))
      .finally(() => setBroadcastsLoading(false));
  }, [tab]);

  const activeCount = useMemo(
    () => rows.filter((r) => r.confirmed_at && !r.unsubscribed_at).length,
    [rows],
  );

  async function send(body: Record<string, unknown>) {
    setState('sending');
    setError(null);
    const r = await fetch('/api/admin/subscribers/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = (await r.json()) as { error?: string };
    if (!r.ok) {
      setError(d.error || 'send failed');
      setState('idle');
      return;
    }
    setState('done');
    if (!('testTo' in body)) {
      // Rotate the idempotency key so a future full send gets a new UUID.
      setIdemKey(crypto.randomUUID());
    }
  }

  return (
    <>
      <AdminTopBar title="Subscribers" subtitle="Mailing list" />

      <div className="wl-adm-page tight">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* Atelier tab bar */}
          <div
            className="wl-adm-tabs wl-adm-subs-tabs-atelier"
            style={{ flex: 1 }}
          >
            {(
              [
                ['list', 'Subscribers'],
                ['broadcast', 'New broadcast'],
                ['history', 'History'],
              ] as [Tab, string][]
            ).map(([k, l]) => (
              <button
                key={k}
                className={tab === k ? 'on' : ''}
                onClick={() => setTab(k)}
              >
                {l}
              </button>
            ))}
          </div>

          {/* Darkroom tab bar */}
          <div className="wl-adm-subs-tabs-darkroom" style={{ flex: 1 }}>
            {(
              [
                ['list', `subscribers [${rows.length}]`],
                ['broadcast', 'new_broadcast'],
                ['history', `history [${broadcasts.length}]`],
              ] as [Tab, string][]
            ).map(([k, l]) => (
              <button
                key={k}
                className={tab === k ? 'on' : ''}
                onClick={() => setTab(k)}
              >
                {l}
              </button>
            ))}
          </div>

          <span style={{ fontSize: 12, color: 'var(--adm-muted)' }}>
            {activeCount} active · {rows.length} total
          </span>
        </div>

        {tab === 'list' && (
          <div className="wl-adm-card" style={{ overflow: 'hidden' }}>
            {rows.length === 0 ? (
              <div
                style={{
                  padding: 40,
                  textAlign: 'center',
                  color: 'var(--adm-muted)',
                  fontSize: 13,
                }}
              >
                No subscribers yet.
              </div>
            ) : (
              <table className="wl-adm-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Source</th>
                    <th>Joined</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.email}</td>
                      <td className="mono muted">{r.source || '—'}</td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {fmtJoined(r.created_at)}
                      </td>
                      <td>
                        <AdminPill status={statusOf(r)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'broadcast' && (
          <div className="wl-adm-broadcast">
            <div
              className="wl-adm-card"
              style={{ padding: 20, display: 'grid', gap: 14 }}
            >
              <label className="wl-adm-field">
                <span className="wl-adm-field-label">Subject</span>
                <input
                  className="wl-adm-field-input"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="New from the studio · Spring 2026"
                />
              </label>
              <label className="wl-adm-field">
                <span className="wl-adm-field-label">Body · HTML</span>
                <textarea
                  value={html}
                  onChange={(e) => setHtml(e.target.value)}
                  rows={14}
                />
              </label>
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <input
                  className="wl-adm-field-input"
                  style={{ flex: '1 1 200px', padding: '8px 10px' }}
                  type="email"
                  placeholder="test-to@email.com"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                />
                <button
                  type="button"
                  className="wl-adm-btn small"
                  disabled={
                    !testTo || !subject || !html || state === 'sending'
                  }
                  onClick={() => send({ subject, html, testTo })}
                >
                  Send test
                </button>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  className="wl-adm-btn primary"
                  disabled={
                    !activeCount ||
                    !subject ||
                    !html ||
                    state === 'sending'
                  }
                  onClick={() => {
                    if (
                      !confirm(
                        `Send to ${activeCount} active subscriber${activeCount === 1 ? '' : 's'}?`,
                      )
                    )
                      return;
                    void send({ subject, html, idempotencyKey: idemKey });
                  }}
                >
                  {state === 'sending'
                    ? 'Sending…'
                    : `Send to ${activeCount} subscriber${activeCount === 1 ? '' : 's'}`}
                </button>
              </div>
              {state === 'done' && (
                <p
                  style={{
                    color: 'var(--adm-green)',
                    fontSize: 13,
                  }}
                >
                  Sent.
                </p>
              )}
              {error && (
                <p style={{ color: 'var(--adm-red)', fontSize: 13 }}>
                  {error}
                </p>
              )}
            </div>

            <div
              className="wl-adm-card"
              style={{ padding: 18, alignSelf: 'start' }}
            >
              <div
                style={{
                  fontFamily: 'var(--f-mono), monospace',
                  fontSize: 11,
                  letterSpacing: '0.16em',
                  color: 'var(--adm-muted)',
                  textTransform: 'uppercase',
                  marginBottom: 12,
                }}
              >
                Preview
              </div>
              <div className="wl-adm-broadcast-preview">
                <div className="stamp">Wildlight Imagery</div>
                <div className="subj">{subject || '—'}</div>
                <div
                  style={{ marginTop: 14 }}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              </div>
            </div>
          </div>
        )}

        {tab === 'history' && (
          <>
            {broadcastsLoading ? (
              <div
                className="wl-adm-card"
                style={{
                  padding: 20,
                  color: 'var(--adm-muted)',
                  fontSize: 13,
                }}
              >
                Loading broadcast history…
              </div>
            ) : broadcasts.length === 0 ? (
              <div className="wl-adm-card">
                <div className="wl-adm-history-empty">
                  Nothing sent yet. Your first broadcast will show up here.
                </div>
              </div>
            ) : (
              <>
                {/* Atelier — editorial list */}
                <div className="wl-adm-card wl-adm-history-atelier">
                  {broadcasts.map((b, i) => (
                    <div
                      key={b.id}
                      className="row"
                      style={{
                        borderTop: i ? '1px solid var(--adm-rule)' : 'none',
                      }}
                    >
                      <div className="ttl">{b.subject}</div>
                      <div className="meta">
                        <span>{new Date(b.sent_at).toLocaleString()}</span>
                        <span>·</span>
                        <span className="mono">
                          {b.recipient_count} recipients
                        </span>
                      </div>
                      <div className="by">{b.sent_by || 'system'}</div>
                    </div>
                  ))}
                </div>

                {/* Darkroom — tabular panel */}
                <div className="wl-adm-panel wl-adm-history-darkroom">
                  <table className="wl-adm-table mono">
                    <thead>
                      <tr>
                        <th>sent_at</th>
                        <th>subject</th>
                        <th className="right">recipients</th>
                        <th className="right">open_rate</th>
                        <th className="right">click_rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {broadcasts.map((b) => (
                        <tr key={b.id}>
                          <td className="muted">
                            {new Date(b.sent_at).toLocaleDateString(undefined, {
                              month: 'short',
                              day: '2-digit',
                            })}
                            {' · '}
                            {new Date(b.sent_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td>{b.subject}</td>
                          <td className="right">{b.recipient_count}</td>
                          <td
                            className="right"
                            style={{ color: 'var(--adm-green)' }}
                          >
                            —
                          </td>
                          <td
                            className="right"
                            style={{ color: 'var(--adm-green)' }}
                          >
                            —
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="f">
                    // open/click rates not tracked yet — requires resend
                    webhook + link rewriting
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

export default function AdminSubscribersPage() {
  return (
    <Suspense
      fallback={
        <>
          <AdminTopBar title="Subscribers" subtitle="Mailing list" />
          <div className="wl-adm-page">
            <p style={{ color: 'var(--adm-muted)' }}>Loading…</p>
          </div>
        </>
      }
    >
      <SubscribersInner />
    </Suspense>
  );
}
