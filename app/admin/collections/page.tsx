'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { AdminTopBar } from '@/components/admin/AdminTopBar';

interface Row {
  id: number;
  slug: string;
  title: string;
  tagline: string | null;
  display_order: number;
  cover_image_url: string | null;
  n?: number;
}

export default function AdminCollections() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  async function reload() {
    const r = await fetch('/api/admin/collections');
    const d = (await r.json()) as { rows: Row[] };
    // Stored sorted: array order IS display order, everywhere it renders.
    const sorted = d.rows
      .slice()
      .sort((a, b) => a.display_order - b.display_order || a.id - b.id);
    savedRows.current = sorted;
    setRows(sorted);
    setLoading(false);
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

  // ── Drag to reorder (darkroom table) ─────────────────────────────────
  // Same interaction model as the wall arranger: drag (by the ⋮⋮ grip, so
  // row text stays selectable) live-reorders LOCAL state only; an explicit
  // Save order button persists the full order atomically via PATCH { order }
  // (one statement server-side — no partial write), and Reset reverts a
  // mis-drag. Deliberately NOT persist-on-drop: Chromium does not deliver a
  // drop event when the drag source node was moved mid-drag (which a live
  // reorder always does) and Esc never reaches the page during a native
  // drag, so any commit/cancel logic keyed on drop signals silently breaks.
  const [dragId, setDragId] = useState<number | null>(null);
  const [orderState, setOrderState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // The last server-confirmed order, for the dirty check and Reset.
  const savedRows = useRef<Row[]>([]);
  const dirty =
    rows.map((r) => r.id).join(',') !== savedRows.current.map((r) => r.id).join(',');

  function moveOver(overId: number) {
    if (dragId === null || dragId === overId) return;
    setRows((prev) => {
      const from = prev.findIndex((r) => r.id === dragId);
      const to = prev.findIndex((r) => r.id === overId);
      if (from === -1 || to === -1 || from === to) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next.map((r, i) => ({ ...r, display_order: i + 1 }));
    });
  }

  async function saveOrder() {
    if (orderState === 'saving') return;
    setOrderState('saving');
    try {
      const r = await fetch('/api/admin/collections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: rows.map((row) => row.id) }),
        signal: AbortSignal.timeout?.(30_000),
      });
      if (!r.ok) throw new Error(String(r.status));
      savedRows.current = rows;
      setOrderState('saved');
    } catch (err) {
      // A timed-out request may have committed server-side — reload to the
      // persisted truth rather than guessing (mirrors the wall arranger).
      if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        setOrderState('error');
        window.setTimeout(() => window.location.reload(), 1200);
        return;
      }
      setOrderState('error');
    }
  }

  function resetOrder() {
    setRows(savedRows.current);
    setOrderState('idle');
  }

  return (
    <>
      <AdminTopBar
        title="Collections"
        subtitle={`${rows.length} arranged`}
      />

      <div className="wl-adm-page">
        {loading ? (
          <p style={{ color: 'var(--adm-muted)' }}>Loading…</p>
        ) : (
          <>
            {/* Atelier card grid */}
            <div className="wl-adm-col-grid">
              {rows.map((c) => (
                  <div key={c.id} className="wl-adm-col-card">
                    <div className="wl-adm-col-cover">
                      {c.cover_image_url && (
                        <Image
                          src={c.cover_image_url}
                          alt={c.title}
                          fill
                          sizes="(max-width: 900px) 100vw, 33vw"
                          style={{ objectFit: 'cover' }}
                        />
                      )}
                    </div>
                    <div className="wl-adm-col-body">
                      <div className="h">
                        <h3>{c.title}</h3>
                        <span className="ord">#{c.display_order}</span>
                      </div>
                      {c.tagline && <div className="tag">{c.tagline}</div>}
                      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                        <label className="wl-adm-field">
                          <span className="wl-adm-field-label">Title</span>
                          <input
                            className="wl-adm-field-input"
                            defaultValue={c.title}
                            onBlur={(e) => {
                              if (e.target.value !== c.title)
                                patch(c.id, { title: e.target.value });
                            }}
                          />
                        </label>
                        <label className="wl-adm-field">
                          <span className="wl-adm-field-label">Tagline</span>
                          <input
                            className="wl-adm-field-input"
                            defaultValue={c.tagline || ''}
                            onBlur={(e) => {
                              const next = e.target.value || null;
                              if (next !== c.tagline) patch(c.id, { tagline: next });
                            }}
                          />
                        </label>
                        <label className="wl-adm-field">
                          <span className="wl-adm-field-label">Display order</span>
                          <input
                            type="number"
                            className="wl-adm-field-input"
                            defaultValue={c.display_order}
                            onBlur={(e) => {
                              const next = Number(e.target.value);
                              if (next !== c.display_order)
                                patch(c.id, { display_order: next });
                            }}
                          />
                        </label>
                      </div>
                      <div className="meta">
                        <span className="slug">/{c.slug}</span>
                      </div>
                    </div>
                  </div>
                ))}
              <button className="wl-adm-col-new" onClick={create}>
                + New collection
              </button>
            </div>

            {/* Darkroom mono panel table */}
            <div className="wl-adm-panel wl-adm-col-darkroom">
              <div className="h">
                <span className="t">collections</span>
                <span className="c">[{rows.length}]</span>
                <span className="n">· drag to reorder</span>
                <button type="button" className="wl-adm-btn small primary" onClick={create}>
                  + new
                </button>
                {dirty && (
                  <button
                    type="button"
                    className="wl-adm-btn small"
                    onClick={resetOrder}
                    disabled={orderState === 'saving'}
                  >
                    reset
                  </button>
                )}
                <button
                  type="button"
                  className="wl-adm-btn small primary"
                  onClick={() => void saveOrder()}
                  disabled={!dirty || orderState === 'saving'}
                >
                  {orderState === 'saving'
                    ? 'saving…'
                    : !dirty && orderState === 'saved'
                      ? 'saved ✓'
                      : 'save order'}
                </button>
              </div>
              {orderState === 'error' && (
                <p className="wl-adm-col-err">
                  Couldn&apos;t save the order — it may not have gone through. Try again.
                </p>
              )}
              <table className="wl-adm-table mono">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>ord</th>
                    <th style={{ width: 60 }}>cover</th>
                    <th>title</th>
                    <th>tagline</th>
                    <th>slug</th>
                    <th className="right">artworks</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                      <tr
                        key={c.id}
                        className={dragId === c.id ? 'dragging' : ''}
                        onDragEnter={() => moveOver(c.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => e.preventDefault()}
                      >
                        <td
                          className="muted grip"
                          draggable={orderState !== 'saving'}
                          onDragStart={(e) => {
                            // Custom type: satisfies engines that abort
                            // dataless drags (FF ESR/iPadOS) without making
                            // text inputs valid drop targets — this table
                            // grows inline tagline editing later.
                            e.dataTransfer.setData(
                              'application/x-wildlight-reorder',
                              String(c.id),
                            );
                            e.dataTransfer.effectAllowed = 'move';
                            setDragId(c.id);
                            if (orderState !== 'idle') setOrderState('idle');
                          }}
                          onDragEnd={() => setDragId(null)}
                        >
                          ⋮⋮ {c.display_order}
                        </td>
                        <td>
                          {c.cover_image_url && (
                            <img
                              src={c.cover_image_url}
                              alt=""
                              style={{ width: 36, height: 24, objectFit: 'cover', borderRadius: 2 }}
                            />
                          )}
                        </td>
                        <td>{c.title}</td>
                        <td>
                          <input
                            readOnly
                            defaultValue={c.tagline || ''}
                            className="wl-adm-col-tagline-inline"
                          />
                        </td>
                        <td className="muted">/{c.slug}</td>
                        <td className="right" style={{ color: 'var(--adm-green)' }}>
                          {c.n ?? 0}
                        </td>
                        <td className="right muted">
                          <button
                            type="button"
                            className="wl-adm-btn small"
                            onClick={() =>
                              alert(
                                'Inline edit coming in a later pass — use the Atelier card editor for now.',
                              )
                            }
                          >
                            edit
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <div className="f">// inline-edit of tagline coming later</div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
