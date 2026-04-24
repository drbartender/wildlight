'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import { StatusPill } from '@/components/admin/StatusPill';

interface Row {
  id: number;
  slug: string;
  title: string;
  status: string;
  image_web_url: string;
  collection_title: string | null;
  variant_count: number;
}

export default function AdminArtworksPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<string>('');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    const r = await fetch('/api/admin/artworks?' + qs);
    const d = (await r.json()) as { rows: Row[] };
    setRows(d.rows);
    setLoading(false);
    setSel(new Set());
  }, [status]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function bulk(action: string) {
    if (!sel.size) return;
    if (action === 'delete' && !confirm(`Delete ${sel.size} artworks?`)) return;
    await fetch('/api/admin/artworks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...sel], action }),
    });
    void reload();
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <h1 style={{ fontWeight: 400 }}>Artworks ({rows.length})</h1>
        <Link className="button" href="/admin/artworks/new" style={{ marginLeft: 'auto' }}>
          + New
        </Link>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          margin: '16px 0',
          fontSize: 14,
        }}
      >
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          style={{ padding: 6 }}
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="retired">Retired</option>
        </select>
        <span style={{ marginLeft: 'auto' }}>{sel.size} selected</span>
        <button onClick={() => bulk('publish')} disabled={!sel.size}>
          Publish
        </button>
        <button onClick={() => bulk('retire')} disabled={!sel.size}>
          Retire
        </button>
        <button
          onClick={() => bulk('delete')}
          disabled={!sel.size}
          style={{ color: '#b22' }}
        >
          Delete
        </button>
      </div>
      {loading ? (
        <p>Loading…</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>
              <th style={{ padding: 8, width: 30 }}></th>
              <th style={{ padding: 8 }}>Title</th>
              <th style={{ padding: 8 }}>Collection</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Variants</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: 8 }}>
                  <input
                    type="checkbox"
                    checked={sel.has(r.id)}
                    onChange={(e) => {
                      const n = new Set(sel);
                      if (e.target.checked) n.add(r.id);
                      else n.delete(r.id);
                      setSel(n);
                    }}
                  />
                </td>
                <td style={{ padding: 8 }}>
                  <Link
                    href={`/admin/artworks/${r.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      textDecoration: 'none',
                      color: 'inherit',
                    }}
                  >
                    <div
                      style={{
                        position: 'relative',
                        width: 48,
                        height: 48,
                        background: '#eee',
                        flexShrink: 0,
                      }}
                    >
                      <Image
                        src={r.image_web_url}
                        alt=""
                        fill
                        sizes="48px"
                        style={{ objectFit: 'cover' }}
                      />
                    </div>
                    <span>{r.title}</span>
                  </Link>
                </td>
                <td style={{ padding: 8 }}>{r.collection_title || '—'}</td>
                <td style={{ padding: 8 }}>
                  <StatusPill status={r.status} />
                </td>
                <td style={{ padding: 8 }}>{r.variant_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
