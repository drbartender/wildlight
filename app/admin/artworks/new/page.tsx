'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

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
    const r = await fetch('/api/admin/artworks/upload', { method: 'POST', body: fd });
    const d = (await r.json()) as { id?: number; error?: string };
    setBusy(false);
    if (d.id) {
      router.push(`/admin/artworks/${d.id}`);
    } else {
      setError(d.error || 'Upload failed');
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{ maxWidth: 560, display: 'grid', gap: 12, fontSize: 14 }}
    >
      <h1 style={{ fontWeight: 400 }}>New artwork</h1>
      <label>
        Title
        <br />
        <input name="title" required style={{ width: '100%', padding: 8 }} />
      </label>
      <label>
        Collection
        <br />
        <select name="collection_id" style={{ padding: 8 }}>
          <option value="">—</option>
          {cols.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Artist note
        <br />
        <textarea
          name="artist_note"
          rows={4}
          style={{ width: '100%', padding: 8, fontFamily: 'inherit' }}
        />
      </label>
      <label>
        Web image (1600–2000px JPEG)
        <br />
        <input
          name="image_web"
          type="file"
          accept="image/jpeg,image/png"
          required
        />
      </label>
      <label>
        Print file (optional, full resolution)
        <br />
        <input name="image_print" type="file" accept="image/jpeg,image/tiff" />
      </label>
      <button className="button" disabled={busy}>
        {busy ? 'Uploading…' : 'Create draft'}
      </button>
      {error && <p style={{ color: '#b22' }}>{error}</p>}
    </form>
  );
}
