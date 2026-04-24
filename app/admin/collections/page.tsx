'use client';
import { useEffect, useState } from 'react';

interface Row {
  id: number;
  slug: string;
  title: string;
  tagline: string | null;
  display_order: number;
  cover_image_url: string | null;
}

export default function AdminCollections() {
  const [rows, setRows] = useState<Row[]>([]);

  async function reload() {
    const r = await fetch('/api/admin/collections');
    const d = (await r.json()) as { rows: Row[] };
    setRows(d.rows);
  }

  useEffect(() => {
    void reload();
  }, []);

  async function patch(id: number, body: Partial<Row>) {
    await fetch('/api/admin/collections', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    });
    void reload();
  }

  async function create() {
    const title = prompt('Collection title');
    if (!title) return;
    await fetch('/api/admin/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    void reload();
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <h1 style={{ fontWeight: 400 }}>Collections</h1>
        <button className="button" onClick={create} style={{ marginLeft: 'auto' }}>
          + New
        </button>
      </div>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          marginTop: 16,
          fontSize: 14,
        }}
      >
        <thead>
          <tr style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>
            <th style={{ padding: 8, width: 80 }}>Order</th>
            <th style={{ padding: 8 }}>Title</th>
            <th style={{ padding: 8 }}>Tagline</th>
            <th style={{ padding: 8 }}>Slug</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 8 }}>
                <input
                  type="number"
                  defaultValue={r.display_order}
                  onBlur={(e) => patch(r.id, { display_order: Number(e.target.value) })}
                  style={{ width: 60, padding: 4 }}
                />
              </td>
              <td style={{ padding: 8 }}>
                <input
                  defaultValue={r.title}
                  onBlur={(e) => patch(r.id, { title: e.target.value })}
                  style={{ width: '100%', padding: 4, fontFamily: 'inherit' }}
                />
              </td>
              <td style={{ padding: 8 }}>
                <input
                  defaultValue={r.tagline || ''}
                  onBlur={(e) => patch(r.id, { tagline: e.target.value || null })}
                  style={{ width: '100%', padding: 4, fontFamily: 'inherit' }}
                />
              </td>
              <td style={{ padding: 8, color: '#777' }}>{r.slug}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
