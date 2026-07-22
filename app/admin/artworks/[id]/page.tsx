'use client';

import { useCallback, useEffect, useState, use } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { VariantTable, type VRow } from '@/components/admin/VariantTable';
import { AdminPill } from '@/components/admin/AdminPill';
import { AdminTopBar } from '@/components/admin/AdminTopBar';
import { AdminField } from '@/components/admin/AdminField';
import { formatPlate } from '@/lib/plate-number';
import {
  classifyPrintResolution,
  evaluateSizeResolution,
  MIN_DPI,
} from '@/lib/print-resolution';

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
  print_width: number | null;
  print_height: number | null;
  status: string;
  collection_id: number | null;
  collection_title: string | null;
  edition_size: number | null;
  signed: boolean;
  /**
   * Stored accession number. Typed nullable only because this interface is
   * hand-maintained against a `SELECT a.*`; the column is NOT NULL in the
   * database.
   */
  plate_no: number | null;
}

interface Data {
  artwork: Artwork;
  variants: VRow[];
  soldCount: number;
}

interface CollectionOpt {
  id: number;
  title: string;
}

export default function ArtworkEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<Data | null>(null);
  const [collections, setCollections] = useState<CollectionOpt[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/artworks/${id}`);
    if (!r.ok) return;
    setData((await r.json()) as Data);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await fetch('/api/admin/collections');
      if (!r.ok || cancelled) return;
      const d = (await r.json()) as { rows: CollectionOpt[] };
      if (cancelled) return;
      setCollections(d.rows.map((c) => ({ id: c.id, title: c.title })));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [saveError, setSaveError] = useState<string | null>(null);

  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    setSaveError(null);
    const r = await fetch(`/api/admin/artworks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      const body = (await r.json().catch(() => null)) as { error?: string } | null;
      setSaveError(body?.error ?? `Save failed (HTTP ${r.status}).`);
      setSaving(false);
      return;
    }
    await load();
    setSaving(false);
  }

  const [savingVariant, setSavingVariant] = useState<number | null>(null);

  async function toggleOverride(variantId: number, next: boolean) {
    if (next && !confirm('Offer this size despite low resolution? It will print soft.')) {
      return;
    }
    setSavingVariant(variantId);
    try {
      const res = await fetch(`/api/admin/artworks/${id}/variants/${variantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution_override: next }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveError(j.error || 'Could not update size.');
        return;
      }
      await load();
    } finally {
      setSavingVariant(null);
    }
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
        <AdminTopBar title="Artwork" subtitle="Artworks" />
        <div className="wl-adm-page">
          <p style={{ color: 'var(--adm-muted)' }}>Loading…</p>
        </div>
      </>
    );
  }

  const a = data.artwork;
  const buyableVariants = data.variants.filter((v) => v.buyable).length;
  const printResolution =
    a.print_width && a.print_height
      ? classifyPrintResolution(a.print_width, a.print_height)
      : null;

  return (
    <>
      <AdminTopBar title={a.title} subtitle="Artworks" />

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
                  {printResolution ? (
                    <div
                      className={`state res res-${printResolution.level}`}
                      title={printResolution.message}
                    >
                      {printResolution.level === 'good' ? (
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
                      ) : (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M12 9v4M12 17h.01" />
                          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                        </svg>
                      )}
                      <span>
                        {a.print_width}×{a.print_height} · {printResolution.effectiveDpi} DPI at 24"
                        {printResolution.level !== 'good' &&
                          ` · max good size ${printResolution.maxGoodEdgeInches}"`}
                      </span>
                    </div>
                  ) : (
                    <div className="state res res-unknown">
                      <span>Resolution unknown — re-upload or run backfill.</span>
                    </div>
                  )}
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
                  href={`/shop/artwork/${a.slug}`}
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
              {/* Read-only. Assigned once at insert and never rewritten, so
                  there is nothing to edit. Deliberately NOT on the admin
                  thumbnails: 1f23519 and d67d411 stripped names and prices off
                  those tiles to quiet them. This is the one place you would go
                  looking for it on purpose. */}
              <AdminField label="Plate">
                <span className="wl-adm-field-static">
                  {a.plate_no != null ? formatPlate(a.plate_no) : 'not set'}
                </span>
              </AdminField>
              <AdminField label="Collection">
                <select
                  className="wl-adm-field-select"
                  value={a.collection_id ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    save({ collection_id: v === '' ? null : Number(v) });
                  }}
                >
                  <option value="">Uncategorized</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </AdminField>
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
            {a.edition_size != null && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: 'var(--adm-muted)',
                  fontFamily: 'var(--f-mono), monospace',
                }}
              >
                {data.soldCount} of {a.edition_size} sold ·{' '}
                {Math.max(0, a.edition_size - data.soldCount)} remaining
              </div>
            )}
            <div style={{ marginTop: 14 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={a.signed}
                  onChange={(e) => save({ signed: e.target.checked })}
                />
                <span>Signed by the artist</span>
              </label>
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
                .map((s) => {
                  const blocked = s === 'published' && !a.image_print_url;
                  return (
                    <button
                      key={s}
                      type="button"
                      className="wl-adm-btn small ghost"
                      onClick={() => save({ status: s })}
                      disabled={blocked}
                      title={blocked ? 'Upload a print master before publishing.' : undefined}
                    >
                      → {s}
                    </button>
                  );
                })}
              {!a.image_print_url && (
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--adm-muted)',
                    marginLeft: 8,
                  }}
                >
                  Upload a print master before publishing.
                </span>
              )}
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
                  {buyableVariants} buyable · retail = cost × 2.1, rounded to $5
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
              {a.print_width && a.print_height && data.variants.length > 0 && (
                <div className="wl-adm-card" style={{ marginTop: 12, padding: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                    Print sizes · master {a.print_width}×{a.print_height} · floor {MIN_DPI} DPI
                  </div>
                  {data.variants.map((v) => {
                    const ev = evaluateSizeResolution(
                      a.print_width as number,
                      a.print_height as number,
                      v.size,
                    );
                    const state = v.buyable
                      ? v.resolution_override
                        ? 'override'
                        : 'ok'
                      : 'blocked';
                    return (
                      <div
                        key={v.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          fontSize: 12,
                          padding: '4px 0',
                          color:
                            state === 'blocked' ? 'var(--adm-red)' : 'var(--adm-muted)',
                        }}
                      >
                        <span style={{ width: 120 }}>
                          {v.type} · {v.size}
                        </span>
                        <span style={{ width: 64 }}>{ev.effectiveDpi} DPI</span>
                        <span style={{ flex: 1 }}>
                          {state === 'override'
                            ? 'offered (override)'
                            : v.buyable
                              ? 'offered'
                              : ev.message}
                        </span>
                        {state === 'override' && v.printful_sync_variant_id == null && (
                          <span style={{ color: 'var(--adm-muted)', fontSize: 11 }}>
                            run sync:printful to make orderable
                          </span>
                        )}
                        {!ev.ok && (
                          <button
                            type="button"
                            className="wl-adm-btn small"
                            disabled={savingVariant === v.id}
                            onClick={() => toggleOverride(v.id, !v.resolution_override)}
                          >
                            {v.resolution_override ? 'Remove override' : 'Override'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {data.variants.every((v) => !v.buyable) && (
                    <div style={{ fontSize: 12, color: 'var(--adm-red)', marginTop: 8 }}>
                      ⚠ No size meets the {MIN_DPI}-DPI floor — this piece is hidden from
                      the shop until you re-upload a larger master or override a size.
                    </div>
                  )}
                </div>
              )}
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
            {saveError && (
              <p
                style={{
                  color: 'var(--adm-red)',
                  fontSize: 12,
                  marginTop: 12,
                }}
                role="alert"
              >
                {saveError}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
