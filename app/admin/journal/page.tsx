'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminPill } from '@/components/admin/AdminPill';

interface ListEntry {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image_url: string | null;
  published: boolean;
  published_at: string | null;
  updated_at: string;
}

type Filter = 'all' | 'published' | 'drafts';

export default function JournalListPage() {
  const [entries, setEntries] = useState<ListEntry[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    void fetch('/api/admin/journal')
      .then((r) => r.json())
      .then((j: { entries: ListEntry[] }) => setEntries(j.entries));
  }, []);

  const filtered =
    entries == null
      ? null
      : entries.filter((e) =>
          filter === 'all'
            ? true
            : filter === 'published'
              ? e.published
              : !e.published,
        );

  return (
    <div className="wl-adm-page">
      <div className="wl-adm-page-h">
        <h1>Journal</h1>
        <Link href="/admin/journal/new" className="wl-adm-btn primary">
          New chapter
        </Link>
      </div>

      <div className="wl-adm-tabs">
        {(['all', 'published', 'drafts'] as Filter[]).map((k) => (
          <button
            key={k}
            type="button"
            className={`wl-adm-tab ${filter === k ? 'on' : ''}`}
            onClick={() => setFilter(k)}
          >
            {k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>

      {filtered == null ? (
        <p className="wl-adm-muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="wl-adm-muted">No chapters yet.</p>
      ) : (
        <table className="wl-adm-tbl">
          <thead>
            <tr>
              <th>Status</th>
              <th>Title</th>
              <th>Slug</th>
              <th>Published</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id}>
                <td>
                  <AdminPill status={e.published ? 'published' : 'draft'} />
                </td>
                <td>{e.title}</td>
                <td className="wl-adm-mono">{e.slug}</td>
                <td className="wl-adm-mono">
                  {e.published_at
                    ? new Date(e.published_at).toLocaleDateString()
                    : '—'}
                </td>
                <td className="wl-adm-mono">
                  {new Date(e.updated_at).toLocaleDateString()}
                </td>
                <td>
                  <Link
                    href={`/admin/journal/${e.id}`}
                    className="wl-adm-btn small ghost"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
