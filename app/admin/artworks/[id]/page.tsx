'use client';

import { useCallback, useEffect, useState, use } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { VariantTable, type VRow } from '@/components/admin/VariantTable';
import { AdminPill } from '@/components/admin/AdminPill';
import { AdminTopBar } from '@/components/admin/AdminTopBar';
import { AdminField } from '@/components/admin/AdminField';

interface Artwork {
  id: number;
  slug: string;
  title: string;
  artist_note: string | null;
  year_shot: number | null;
  location: string | null;
  image_web_url: string;
  image_print_url: string | null;
  image_width: number | null;
  image_height: number | null;
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

  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftConfidence, setDraftConfidence] = useState<'high' | 'low' | null>(null);

  async function draftWithAi() {
    setDrafting(true);
    setDraftError(null);
    setDraftConfidence(null);
    // Snapshot the current year_shot — only field we still gate on
    // emptiness (EXIF-only; we never let the AI guess a year).
    const snapshot = {
      year_shot: data?.artwork.year_shot ?? null,
    };
    try {
      const r = await fetch(`/api/admin/artworks/${id}/ai-draft`, { method: 'POST' });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      const body = (await r.json()) as {
        year_shot: number | null;
        title: string;
        location: string | null;
        artist_note: string;
        confidence: 'high' | 'low';
      };
      const patch: Record<string, unknown> = {};
      if (body.year_shot != null && snapshot.year_shot == null) patch.year_shot = body.year_shot;
      if (body.title) patch.title = body.title;
      if (body.location) patch.location = body.location;
      if (body.artist_note) patch.artist_note = body.artist_note;
      if (Object.keys(patch).length > 0) {
        await save(patch);
        setDraftConfidence(body.confidence);
      }
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : String(err));
    } finally {
      setDrafting(false);
    }
  }

  if (!data) {
    return (
      <>
        <AdminTopBar title="Artwork" subtitle="Catalog" />
        <div className="wl-adm-page">
          <p style={{ color: 'var(--adm-muted)' }}>Loading…</p>
        </div>
      </>
    );
  }

  const a = data.artwork;
  const activeVariants = data.variants.filter((v) => v.active).length;

  return (
    <>
      <AdminTopBar title={a.title} subtitle="Artwork" />

      <div className="wl-adm-page">
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

        <div className="wl-adm-art-detail">
          <div>
            <div className="wl-adm-art-image-card">
              <div className="wl-adm-art-image-frame">
                <Image
                  src={a.image_web_url}
                  alt={a.title}
                  fill
                  sizes="420px"
                  style={{ objectFit: 'cover' }}
                />
              </div>
              <div className="wl-adm-art-image-meta">
                <span>
                  {a.image_width && a.image_height
                    ? `image_web · ${a.image_width}×${a.image_height}`
                    : 'image_web_url'}
                </span>
                <span>R2 public</span>
              </div>
            </div>

            <div className="wl-adm-print-card">
              <div className="head">Print file</div>
              {a.image_print_url ? (
                <>
                  <div className="state ok">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    Uploaded · R2 private
                  </div>
                  <div className="path">{a.image_print_url}</div>
                </>
              ) : (
                <div className="state miss">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 8v5M12 16h.01" />
                  </svg>
                  Missing — required for fulfillment.
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="wl-adm-art-head">
              <h1>{a.title}</h1>
              <AdminPill status={a.status} />
              <div className="actions">
                <Link
                  className="wl-adm-btn small ghost"
                  href={`/artwork/${a.slug}`}
                  target="_blank"
                >
                  View on site ↗
                </Link>
              </div>
            </div>
            <div
              className="path"
              style={{
                fontFamily: 'var(--f-mono), monospace',
                fontSize: 11,
                color: 'var(--adm-muted)',
                marginTop: 4,
              }}
            >
              /artwork/{a.slug}
            </div>

            <div className="wl-adm-ai-draft-row">
              <button
                type="button"
                className="wl-adm-btn small"
                onClick={draftWithAi}
                disabled={drafting}
              >
                {drafting ? 'Drafting…' : 'Draft with AI'}
              </button>
              {draftConfidence === 'low' && (
                <span className="wl-adm-ai-confidence-low">low confidence</span>
              )}
              {draftError && (
                <span className="wl-adm-ai-draft-err">{draftError}</span>
              )}
              <span className="wl-adm-ai-draft-hint">
                Rewrites Title, Location, and Artist note. Year only fills if empty.
              </span>
            </div>

            <div style={{ marginTop: 20 }} className="wl-adm-field-grid">
              <AdminField
                label="Title"
                value={a.title}
                onSave={(v) => save({ title: v })}
              />
              <AdminField
                label="Location"
                value={a.location || ''}
                onSave={(v) => save({ location: v || null })}
              />
              <AdminField
                label="Year shot"
                type="number"
                value={a.year_shot ?? ''}
                onSave={(v) => save({ year_shot: v ? Number(v) : null })}
              />
              <AdminField
                label="Edition size"
                type="number"
                value={a.edition_size ?? ''}
                onSave={(v) => save({ edition_size: v ? Number(v) : null })}
              />
            </div>
            <div style={{ marginTop: 14 }}>
              <AdminField
                label="Artist note"
                multiline
                rows={4}
                value={a.artist_note || ''}
                onSave={(v) => save({ artist_note: v || null })}
              />
            </div>

            <div className="wl-adm-status-switcher" style={{ marginTop: 18 }}>
              <span className="lbl">Status</span>
              {(['draft', 'published', 'retired'] as const)
                .filter((s) => s !== a.status)
                .map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="wl-adm-btn small ghost"
                    onClick={() => save({ status: s })}
                  >
                    → {s}
                  </button>
                ))}
            </div>

            <div style={{ marginTop: 28 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 10,
                  marginBottom: 8,
                }}
              >
                <h3 style={{ fontSize: 16 }}>Variants</h3>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--adm-muted)',
                  }}
                >
                  {activeVariants} active · retail = cost × 2.1, rounded to $5
                </span>
              </div>
              <div className="wl-adm-card" style={{ overflow: 'hidden' }}>
                <VariantTable variants={data.variants} />
                {data.variants.length === 0 && (
                  <div
                    style={{
                      padding: 20,
                      fontSize: 13,
                      color: 'var(--adm-muted)',
                    }}
                  >
                    No variants yet. Apply a template:
                    <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                      {(['fine_art', 'canvas', 'full'] as const).map((t) => (
                        <button
                          key={t}
                          className="wl-adm-btn small"
                          onClick={() => save({ applyTemplate: t })}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {saving && (
              <p
                style={{
                  color: 'var(--adm-muted)',
                  fontSize: 12,
                  marginTop: 12,
                }}
              >
                Saving…
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
