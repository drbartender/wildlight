'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { AdminPill } from '@/components/admin/AdminPill';
import { AdminTopBar } from '@/components/admin/AdminTopBar';
import { ArtworkRowMenu } from '@/components/admin/ArtworkRowMenu';

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
  collection_id: number | null;
  collection_title: string | null;
  variant_count: number;
  total_variant_count: number;
  has_unmeasured: boolean | null;
  all_sizes_ok: boolean | null;
  min_price_cents: number | null;
  max_price_cents: number | null;
  updated_at: string;
}

function ResBadge({
  a,
}: {
  a: {
    total_variant_count: number;
    variant_count: number;
    has_unmeasured: boolean | null;
    all_sizes_ok: boolean | null;
  };
}) {
  if (a.total_variant_count === 0) return null;
  const s = { marginLeft: 6, fontSize: 10 };
  // Known-blocked states take priority over "unmeasured" — a piece with a
  // measured-FALSE size should not read as merely unmeasured.
  if (a.variant_count === 0)
    return <span style={{ ...s, color: 'var(--adm-red)' }}>⚠ blocked</span>;
  if (a.variant_count < a.total_variant_count)
    return (
      <span style={{ ...s, color: 'var(--adm-red)' }}>
        ⚠ {a.variant_count}/{a.total_variant_count}
      </span>
    );
  if (a.has_unmeasured)
    return <span style={{ ...s, color: 'var(--adm-muted)' }}>— unmeasured</span>;
  if (a.all_sizes_ok)
    return <span style={{ ...s, color: 'var(--adm-muted)' }}>✓ all sizes</span>;
  return (
    <span style={{ ...s, color: 'var(--adm-red)' }}>
      ⚠ {a.variant_count}/{a.total_variant_count}
    </span>
  );
}

interface CollectionOpt {
  id: number;
  title: string;
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
  const [collections, setCollections] = useState<CollectionOpt[]>([]);
  const [status, setStatus] = useState<string>('all');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    // Fetch the full set; status filter is applied client-side from `rows`.
    // The list caps at LIMIT 1000 server-side and the page already iterates
    // `rows` for tab counts — no benefit to round-tripping per tab.
    const r = await fetch('/api/admin/artworks');
    if (!r.ok) {
      setLoading(false);
      return;
    }
    const d = (await r.json()) as { rows: Row[] };
    setRows(d.rows);
    setLoading(false);
    setSel(new Set());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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

  async function surfaceError(r: Response, fallback: string) {
    const body = (await r.json().catch(() => null)) as { error?: string } | null;
    alert(body?.error ?? `${fallback} (HTTP ${r.status}).`);
  }

  const moveOne = useCallback(
    async (id: number, collectionId: number | null) => {
      const r = await fetch(`/api/admin/artworks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection_id: collectionId }),
      });
      if (!r.ok) {
        await surfaceError(r, 'Move failed');
        return;
      }
      void reload();
    },
    [reload],
  );

  const togglePublishOne = useCallback(
    async (row: Row) => {
      const next = row.status === 'published' ? 'retired' : 'published';
      const r = await fetch(`/api/admin/artworks/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!r.ok) {
        await surfaceError(r, 'Failed');
        return;
      }
      void reload();
    },
    [reload],
  );

  const deleteOne = useCallback(
    async (row: Row) => {
      if (!confirm(`Delete "${row.title}"?`)) return;
      const r = await fetch(`/api/admin/artworks/${row.id}`, { method: 'DELETE' });
      if (!r.ok) {
        await surfaceError(r, 'Delete failed');
        return;
      }
      void reload();
    },
    [reload],
  );

  async function bulk(action: string) {
    if (!sel.size) return;
    if (action === 'delete' && !confirm(`Delete ${sel.size} artworks?`)) return;
    const r = await fetch('/api/admin/artworks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...sel], action }),
    });
    if (!r.ok) {
      await surfaceError(r, `${action} failed`);
      return;
    }
    // The publish action silently filters out artworks missing a print
    // master (server-side gate). Surface the skip count so the admin
    // doesn't think every selected row was published.
    if (action === 'publish') {
      const body = (await r.json().catch(() => null)) as
        | { published?: number; skipped?: number }
        | null;
      if (body && (body.skipped ?? 0) > 0) {
        alert(
          `Published ${body.published ?? 0} of ${sel.size}. ` +
            `${body.skipped} skipped (no print master uploaded — see /admin/artworks/bulk-upload).`,
        );
      }
    }
    void reload();
  }

  const [batchRunning, setBatchRunning] = useState<null | 'draft' | 'variants'>(null);
  const [batchProgress, setBatchProgress] = useState<{
    done: number;
    total: number;
    failed: number;
  }>({ done: 0, total: 0, failed: 0 });

  const emptyVariants = useMemo(
    () => rows.filter((r) => r.total_variant_count === 0),
    [rows],
  );

  const visibleRows = useMemo(
    () => (status === 'all' ? rows : rows.filter((r) => r.status === status)),
    [rows, status],
  );

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
    const targets = rows.filter((r) => r.total_variant_count === 0);
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
  const counts: Record<string, number> = useMemo(
    () => ({
      all: rows.length,
      published: rows.filter((r) => r.status === 'published').length,
      draft: rows.filter((r) => r.status === 'draft').length,
      retired: rows.filter((r) => r.status === 'retired').length,
    }),
    [rows],
  );

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
          <Link href="/admin/collections" className="wl-adm-btn small">
            Collections
          </Link>
          <Link
            href="/admin/artworks/bulk-upload"
            className="wl-adm-btn small"
          >
            Bulk upload
          </Link>
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
          ) : visibleRows.length === 0 ? (
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
                {visibleRows.map((r) => (
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
                      <ResBadge a={r} />
                    </td>
                    <td className="right mono muted">{r.total_variant_count || '—'}</td>
                    <td className="right mono">
                      {fmtPrice(r.min_price_cents, r.max_price_cents)}
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {fmtRelative(r.updated_at)}
                    </td>
                    <td className="right" style={{ paddingRight: 8 }}>
                      <ArtworkRowMenu
                        status={r.status}
                        hasPrintMaster={!!r.image_print_url}
                        slug={r.slug}
                        collectionId={r.collection_id}
                        collections={collections}
                        onMove={(cid) => moveOne(r.id, cid)}
                        onTogglePublish={() => togglePublishOne(r)}
                        onDelete={() => deleteOne(r)}
                      />
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
