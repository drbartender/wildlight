'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminTopBar } from '@/components/admin/AdminTopBar';

// Broadcast send history. Splits out of the old /admin/subscribers
// ?tab=history view so the subscriber-list page can stay focused.
// Reuses the existing /api/admin/subscribers/broadcasts endpoint —
// no DB shape change here.

interface BroadcastRow {
  id: number;
  subject: string;
  recipient_count: number;
  sent_at: string;
  sent_by: string | null;
}

export default function BroadcastHistoryPage() {
  const [rows, setRows] = useState<BroadcastRow[] | null>(null);

  useEffect(() => {
    fetch('/api/admin/subscribers/broadcasts')
      .then((r) => r.json())
      .then((d: { rows: BroadcastRow[] }) => setRows(d.rows))
      .catch(() => setRows([]));
  }, []);

  return (
    <>
      <AdminTopBar
        title="Broadcast history"
        subtitle="Subscribers · Audit log"
      />

      <div className="wl-adm-page tight">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: 18,
          }}
        >
          <Link
            href="/admin/subscribers"
            className="wl-adm-btn small ghost"
            style={{ marginRight: 'auto' }}
          >
            ← Subscribers
          </Link>
          <Link
            href="/admin/studio?kind=newsletter"
            className="wl-adm-btn small primary"
          >
            New broadcast →
          </Link>
        </div>

        {rows === null ? (
          <div
            className="wl-adm-card"
            style={{
              padding: 20,
              color: 'var(--adm-muted)',
              fontSize: 13,
            }}
          >
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="wl-adm-card">
            <div className="wl-adm-history-empty">
              Nothing sent yet. Your first broadcast will show up here.
            </div>
          </div>
        ) : (
          <>
            {/* Atelier — editorial list */}
            <div className="wl-adm-card wl-adm-history-atelier">
              {rows.map((b, i) => (
                <div
                  key={b.id}
                  className="row"
                  id={`b-${b.id}`}
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
                  {rows.map((b) => (
                    <tr key={b.id} id={`b-${b.id}`}>
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
      </div>
    </>
  );
}
