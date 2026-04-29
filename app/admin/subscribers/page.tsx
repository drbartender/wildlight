'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AdminPill } from '@/components/admin/AdminPill';
import { AdminTopBar } from '@/components/admin/AdminTopBar';

// Slimmed subscriber list — broadcast composer + history moved under
// Studio (/admin/studio?kind=newsletter and /admin/subscribers/history).
// This page is now a focused subscriber list. Old `?tab=broadcast`
// links bounce over to the composer so existing bookmarks keep working.

interface Row {
  id: number;
  email: string;
  source: string | null;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  created_at: string;
}

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

function SubscribersInner() {
  const qp = useSearchParams();
  const router = useRouter();

  // Bounce legacy ?tab=broadcast / ?tab=history links to their new homes.
  useEffect(() => {
    const tab = qp.get('tab');
    if (tab === 'broadcast') {
      router.replace('/admin/studio?kind=newsletter');
    } else if (tab === 'history') {
      router.replace('/admin/subscribers/history');
    }
  }, [qp, router]);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/subscribers')
      .then((r) => r.json())
      .then((d: { rows: Row[] }) => setRows(d.rows))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  const activeCount = useMemo(
    () => rows.filter((r) => r.confirmed_at && !r.unsubscribed_at).length,
    [rows],
  );

  return (
    <>
      <AdminTopBar title="Subscribers" subtitle="Mailing list" />

      <div className="wl-adm-page tight">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            marginBottom: 18,
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--adm-muted)' }}>
            {activeCount} active · {rows.length} total
          </span>
          <span style={{ flex: 1 }} />
          <Link
            href="/admin/subscribers/history"
            className="wl-adm-btn small ghost"
          >
            Broadcast history
          </Link>
          <Link
            href="/admin/studio?kind=newsletter"
            className="wl-adm-btn small primary"
          >
            New broadcast →
          </Link>
        </div>

        <div className="wl-adm-card" style={{ overflow: 'hidden' }}>
          {loading ? (
            <div
              style={{
                padding: 40,
                textAlign: 'center',
                color: 'var(--adm-muted)',
                fontSize: 13,
              }}
            >
              Loading…
            </div>
          ) : rows.length === 0 ? (
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
