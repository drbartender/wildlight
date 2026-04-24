'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AdminTopBar } from '@/components/admin/AdminTopBar';

interface Col {
  id: number;
  title: string;
}

export default function NewArtwork() {
  const [cols, setCols] = useState<Col[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/admin/collections')
      .then((r) => r.json())
      .then((d: { rows: Col[] }) => setCols(d.rows))
      .catch(() => setCols([]));
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const r = await fetch('/api/admin/artworks/upload', {
      method: 'POST',
      body: fd,
    });
    const d = (await r.json()) as { id?: number; error?: string };
    setBusy(false);
    if (d.id) {
      router.push(`/admin/artworks/${d.id}`);
    } else {
      setError(d.error || 'Upload failed');
    }
  }

  return (
    <>
      <AdminTopBar title="New artwork" subtitle="Catalog · Upload" />

      <div className="wl-adm-page" style={{ maxWidth: 640 }}>
        <Link
          href="/admin/artworks"
          style={{
            color: 'var(--adm-muted)',
            fontSize: 12,
            marginTop: -12,
          }}
        >
          ← All artworks
        </Link>

        <form
          onSubmit={submit}
          className="wl-adm-card"
          style={{ padding: 24, display: 'grid', gap: 14 }}
        >
          <label className="wl-adm-field">
            <span className="wl-adm-field-label">Title</span>
            <input
              className="wl-adm-field-input"
              name="title"
              required
              placeholder="e.g. Oregon Coast, June"
            />
          </label>

          <label className="wl-adm-field">
            <span className="wl-adm-field-label">Collection</span>
            <select className="wl-adm-field-select" name="collection_id">
              <option value="">— Unassigned —</option>
              {cols.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>

          <label className="wl-adm-field">
            <span className="wl-adm-field-label">Artist note</span>
            <textarea
              className="wl-adm-field-textarea"
              name="artist_note"
              rows={4}
              placeholder="Where, why, technique. Shown verbatim on the public page."
            />
          </label>

          <label className="wl-adm-field">
            <span className="wl-adm-field-label">
              Web image · 1600–2000px JPEG
            </span>
            <input
              name="image_web"
              type="file"
              accept="image/jpeg,image/png"
              required
              style={{ fontSize: 13 }}
            />
          </label>

          <label className="wl-adm-field">
            <span className="wl-adm-field-label">
              Print file · full resolution (optional, required before publish)
            </span>
            <input
              name="image_print"
              type="file"
              accept="image/jpeg,image/tiff"
              style={{ fontSize: 13 }}
            />
          </label>

          <div>
            <button type="submit" className="wl-adm-btn primary" disabled={busy}>
              {busy ? 'Uploading…' : 'Create draft'}
            </button>
          </div>
          {error && (
            <p style={{ color: 'var(--adm-red)', fontSize: 13 }}>{error}</p>
          )}
        </form>
      </div>
    </>
  );
}
