'use client';
import { useCallback, useEffect, useState, use } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { VariantTable, type VRow } from '@/components/admin/VariantTable';
import { StatusPill } from '@/components/admin/StatusPill';

interface Artwork {
  id: number;
  slug: string;
  title: string;
  artist_note: string | null;
  year_shot: number | null;
  location: string | null;
  image_web_url: string;
  image_print_url: string | null;
  status: string;
  collection_id: number | null;
  collection_title: string | null;
  edition_size: number | null;
}

interface Data {
  artwork: Artwork;
  variants: VRow[];
}

export default function ArtworkEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<Data | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/artworks/${id}`);
    if (!r.ok) return;
    setData((await r.json()) as Data);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    await fetch(`/api/admin/artworks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    await load();
    setSaving(false);
  }

  if (!data) return <p>Loading…</p>;
  const a = data.artwork;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: 32 }}>
      <div>
        <div style={{ position: 'relative', aspectRatio: '4/5', background: '#eee' }}>
          <Image
            src={a.image_web_url}
            alt={a.title}
            fill
            sizes="400px"
            style={{ objectFit: 'cover' }}
          />
        </div>
        <p style={{ color: '#777', fontSize: 13, marginTop: 8 }}>
          Print file:{' '}
          {a.image_print_url ? (
            <span style={{ color: '#2a8a5c' }}>uploaded</span>
          ) : (
            <span style={{ color: '#b33030' }}>missing (required for fulfillment)</span>
          )}
        </p>
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ margin: 0, fontWeight: 400 }}>{a.title}</h1>
          <StatusPill status={a.status} />
        </div>
        <p style={{ color: '#777', fontSize: 13 }}>
          <Link href={`/artwork/${a.slug}`} target="_blank" style={{ color: 'inherit' }}>
            /artwork/{a.slug}
          </Link>
        </p>
        <Field
          label="Title"
          value={a.title}
          onSave={(v) => save({ title: v })}
        />
        <Field
          label="Artist note"
          value={a.artist_note || ''}
          multiline
          onSave={(v) => save({ artist_note: v || null })}
        />
        <Field
          label="Location"
          value={a.location || ''}
          onSave={(v) => save({ location: v || null })}
        />
        <Field
          label="Year shot"
          value={a.year_shot ?? ''}
          type="number"
          onSave={(v) => save({ year_shot: v ? Number(v) : null })}
        />
        <div style={{ marginTop: 16, fontSize: 14 }}>
          <strong>Status:</strong>{' '}
          {['draft', 'published', 'retired']
            .filter((s) => s !== a.status)
            .map((s) => (
              <button
                key={s}
                onClick={() => save({ status: s })}
                style={{ marginLeft: 8 }}
              >
                → {s}
              </button>
            ))}
        </div>
        <h3 style={{ marginTop: 32, fontWeight: 400 }}>Variants</h3>
        <VariantTable variants={data.variants} />
        {data.variants.filter((v) => v.active).length === 0 && (
          <div style={{ marginTop: 12, fontSize: 14 }}>
            Apply template:
            {(['fine_art', 'canvas', 'full'] as const).map((t) => (
              <button
                key={t}
                onClick={() => save({ applyTemplate: t })}
                style={{ marginLeft: 8 }}
              >
                {t}
              </button>
            ))}
          </div>
        )}
        {saving && <p style={{ color: '#777' }}>Saving…</p>}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onSave,
  multiline,
  type = 'text',
}: {
  label: string;
  value: string | number;
  onSave: (v: string) => void;
  multiline?: boolean;
  type?: string;
}) {
  const [v, setV] = useState(String(value ?? ''));
  useEffect(() => setV(String(value ?? '')), [value]);
  return (
    <div style={{ marginTop: 12 }}>
      <label style={{ color: '#777', fontSize: 13 }}>{label}</label>
      <br />
      {multiline ? (
        <textarea
          value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => v !== String(value ?? '') && onSave(v)}
          rows={4}
          style={{ width: '100%', padding: 6, fontFamily: 'inherit' }}
        />
      ) : (
        <input
          type={type}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => v !== String(value ?? '') && onSave(v)}
          style={{ width: '100%', padding: 6, fontFamily: 'inherit' }}
        />
      )}
    </div>
  );
}
