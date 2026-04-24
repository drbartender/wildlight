'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import { AdminPill } from '@/components/admin/AdminPill';
import { AdminTopBar } from '@/components/admin/AdminTopBar';

interface Row {
  id: number;
  slug: string;
  title: string;
  status: string;
  image_web_url: string;
  image_print_url: string | null;
  has_note: boolean;
  year_shot: number | null;
  location: string | null;
  collection_title: string | null;
  variant_count: number;
  min_price_cents: number | null;
  max_price_cents: number | null;
  updated_at: string;
}

function fmtRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const mins = Math.floor((now - d.getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString();
}

function fmtPrice(min: number | null, max: number | null): string {
  if (min == null) return '—';
  const a = Math.floor(min / 100);
  if (max == null || max === min) return `$${a}`;
  return `$${a}–$${Math.floor(max / 100)}`;
}

export default function AdminArtworksPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<string>('all');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (status !== 'all') qs.set('status', status);
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

  const [batchRunning, setBatchRunning] = useState<null | 'draft' | 'variants'>(null);
  const [batchProgress, setBatchProgress] = useState<{
    done: number;
    total: number;
    failed: number;
  }>({ done: 0, total: 0, failed: 0 });

  const emptyVariants = rows.filter((r) => r.variant_count === 0);

  async function batchAiDraft() {
    if (batchRunning) return;
    // Snapshot the target list so mid-batch state changes can't shift
    // the iteration (e.g. if the user flips a filter).
    const targets = rows.slice();
    if (
      !confirm(
        `Rewrite title, location, and artist note for all ${targets.length} artworks? This overwrites existing values.`,
      )
    ) {
      return;
    }
    setBatchRunning('draft');
    setBatchProgress({ done: 0, total: targets.length, failed: 0 });

    // Run with small concurrency. Anthropic prompt cache (ephemeral,
    // 5-min TTL on our system prompt) works fine when up to a handful
    // of requests are in flight against the same cache key.
    const CONCURRENCY = 3;
    let done = 0;
    let failed = 0;
    let firstError: string | null = null;
    const runOne = async (r: Row): Promise<void> => {
      try {
        const res = await fetch(`/api/admin/artworks/${r.id}/ai-draft`, {
          method: 'POST',
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`ai-draft HTTP ${res.status}: ${text.slice(0, 200)}`);
        }
        const body = (await res.json()) as {
          year_shot: number | null;
          title: string;
          location: string | null;
          artist_note: string;
        };
        // Title/location/note overwrite always; year_shot only fills empty
        // (EXIF-only — we never let the AI guess a year).
        const patch: Record<string, unknown> = {};
        if (body.year_shot != null && r.year_shot == null) patch.year_shot = body.year_shot;
        if (body.title) patch.title = body.title;
        if (body.location) patch.location = body.location;
        if (body.artist_note) patch.artist_note = body.artist_note;
        if (Object.keys(patch).length) {
          const pr = await fetch(`/api/admin/artworks/${r.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          });
          if (!pr.ok) {
            const text = await pr.text().catch(() => '');
            throw new Error(`PATCH HTTP ${pr.status}: ${text.slice(0, 200)}`);
          }
        }
      } catch (err) {
        failed += 1;
        if (!firstError) {
          firstError = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.error(`ai-draft failed for artwork ${r.id} (${r.slug}):`, err);
        }
      }
      done += 1;
      setBatchProgress({ done, total: targets.length, failed });
    };

    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      await Promise.all(targets.slice(i, i + CONCURRENCY).map(runOne));
    }
    setBatchRunning(null);
    if (failed > 0) {
      alert(
        `Done. ${done - failed} succeeded, ${failed} failed.\n\nFirst error: ${firstError ?? '(unknown)'}\n\nOpen DevTools → Console for details.`,
      );
    }
    await reload();
  }

  async function batchApplyFull() {
    if (batchRunning) return;
    const targets = rows.filter((r) => r.variant_count === 0);
    setBatchRunning('variants');
    setBatchProgress({ done: 0, total: targets.length, failed: 0 });
    let done = 0;
    let failed = 0;
    for (const r of targets) {
      try {
        const res = await fetch(`/api/admin/artworks/${r.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ applyTemplate: 'full' }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        failed += 1;
      }
      done += 1;
      setBatchProgress({ done, total: targets.length, failed });
    }
    setBatchRunning(null);
    await reload();
  }

  const tabs = ['all', 'published', 'draft', 'retired'] as const;
  const counts: Record<string, number> = {
    all: rows.length,
    published: rows.filter((r) => r.status === 'published').length,
    draft: rows.filter((r) => r.status === 'draft').length,
    retired: rows.filter((r) => r.status === 'retired').length,
  };

  return (
    <>
      <AdminTopBar
        title="Artworks"
        subtitle={`Catalog · ${rows.length} ${rows.length === 1 ? 'piece' : 'pieces'}`}
      />

      <div className="wl-adm-page tight">
        <div className="wl-adm-subhead">
          <div className="wl-adm-seg">
            {tabs.map((f) => (
              <button
                key={f}
                className={status === f ? 'on' : ''}
                onClick={() => setStatus(f)}
              >
                {f === 'all' ? 'All' : f}
                <span className="sub">{counts[f] ?? 0}</span>
              </button>
            ))}
          </div>
          <span className="spacer" />
          {sel.size > 0 && (
            <>
              <span className="selcount">{sel.size} selected</span>
              <button className="wl-adm-btn small" onClick={() => bulk('publish')}>
                Publish
              </button>
              <button className="wl-adm-btn small" onClick={() => bulk('retire')}>
                Retire
              </button>
              <button
                className="wl-adm-btn small danger"
                onClick={() => bulk('delete')}
              >
                Delete
              </button>
              <span style={{ width: 1, height: 18, background: 'var(--adm-rule)' }} />
            </>
          )}
          <button
            type="button"
            className="wl-adm-btn small"
            onClick={batchAiDraft}
            disabled={batchRunning !== null || rows.length === 0}
          >
            {batchRunning === 'draft'
              ? `Drafting ${batchProgress.done}/${batchProgress.total}${batchProgress.failed > 0 ? ` · ${batchProgress.failed} failed` : ''}…`
              : `AI-draft all (${rows.length})`}
          </button>
          <button
            type="button"
            className="wl-adm-btn small"
            onClick={batchApplyFull}
            disabled={batchRunning !== null || emptyVariants.length === 0}
          >
            {batchRunning === 'variants'
              ? `Applying ${batchProgress.done}/${batchProgress.total}…`
              : `Apply full template to ${emptyVariants.length} empty`}
          </button>
          <Link
            href="/admin/artworks/new"
            className="wl-adm-btn small primary"
          >
            + New artwork
          </Link>
        </div>

        <div className="wl-adm-card" style={{ overflow: 'hidden' }}>
          {loading ? (
            <div
              style={{
                padding: 20,
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
              No artworks{status !== 'all' ? ` in "${status}"` : ''}.
            </div>
          ) : (
            <table className="wl-adm-table">
              <thead>
                <tr>
                  <th style={{ width: 34, paddingLeft: 16 }}>
                    <input type="checkbox" disabled aria-label="select all" />
                  </th>
                  <th>Artwork</th>
                  <th>Collection</th>
                  <th>Status</th>
                  <th className="right">Variants</th>
                  <th className="right">Price</th>
                  <th>Updated</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={sel.has(r.id) ? 'selected' : ''}>
                    <td style={{ paddingLeft: 16 }}>
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
                    <td>
                      <Link
                        href={`/admin/artworks/${r.id}`}
                        className="wl-adm-art-row-title"
                      >
                        <div className="wl-adm-art-row-thumb">
                          <Image
                            src={r.image_web_url}
                            alt=""
                            fill
                            sizes="40px"
                            style={{ objectFit: 'cover' }}
                          />
                        </div>
                        <div>
                          <div className="t">{r.title}</div>
                          <div className="s">
                            {r.slug}
                            {!r.image_print_url && (
                              <span className="noprint">· no print file</span>
                            )}
                          </div>
                        </div>
                      </Link>
                    </td>
                    <td style={{ color: 'var(--adm-ink-2)' }}>
                      {r.collection_title || '—'}
                    </td>
                    <td>
                      <AdminPill status={r.status} />
                    </td>
                    <td className="right mono muted">{r.variant_count || '—'}</td>
                    <td className="right mono">
                      {fmtPrice(r.min_price_cents, r.max_price_cents)}
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {fmtRelative(r.updated_at)}
                    </td>
                    <td className="muted right" style={{ paddingRight: 16 }}>
                      ⋯
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
