'use client';

import { useRef, useState } from 'react';

export interface WallTile {
  id: number;
  slug: string;
  title: string;
  image_web_url: string;
  /** status='published' — i.e. actually sellable. Shown as a dot. */
  available: boolean;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Drag-to-arrange grid for the homepage vintage wall. Reorders tiles live on
 * drag-over and persists the sequence to /api/admin/wall (which writes
 * wall_order). Desktop drag-and-drop; the live shop order is untouched.
 */
export function WallArranger({ initial }: { initial: WallTile[] }) {
  const [tiles, setTiles] = useState<WallTile[]>(initial);
  const [dragId, setDragId] = useState<number | null>(null);
  const [state, setState] = useState<SaveState>('idle');
  // The last-saved order, as a comparison key. Updated on a successful save.
  const savedKey = useRef(initial.map((t) => t.id).join(','));

  const currentKey = tiles.map((t) => t.id).join(',');
  const dirty = currentKey !== savedKey.current;

  function moveOver(overId: number) {
    if (dragId === null || dragId === overId) return;
    setTiles((prev) => {
      const from = prev.findIndex((t) => t.id === dragId);
      const to = prev.findIndex((t) => t.id === overId);
      if (from === -1 || to === -1 || from === to) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function save() {
    setState('saving');
    try {
      const r = await fetch('/api/admin/wall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: tiles.map((t) => t.id) }),
      });
      if (!r.ok) throw new Error(String(r.status));
      savedKey.current = tiles.map((t) => t.id).join(',');
      setState('saved');
    } catch {
      setState('error');
    }
  }

  function reset() {
    setTiles(initial);
    setState('idle');
  }

  return (
    <div className="wl-adm-wall">
      <header className="wl-adm-wall-head">
        <div>
          <h1>Arrange the wall</h1>
          <p>
            Drag photos into the order they should appear on the homepage. This
            is separate from the shop — reordering here doesn&apos;t change the
            shop&apos;s order.
          </p>
        </div>
        <div className="actions">
          {dirty && (
            <button type="button" onClick={reset}>
              Reset
            </button>
          )}
          <button
            type="button"
            className="primary"
            onClick={save}
            disabled={!dirty || state === 'saving'}
          >
            {state === 'saving'
              ? 'Saving…'
              : !dirty && state === 'saved'
                ? 'Saved ✓'
                : 'Save order'}
          </button>
        </div>
      </header>

      {state === 'error' && (
        <p className="wl-adm-wall-err">Couldn&apos;t save — please try again.</p>
      )}
      <p className="wl-adm-wall-hint">
        {tiles.length} frames · the green dot marks pieces that are for sale
      </p>

      <div className="wl-adm-wall-grid">
        {tiles.map((t, i) => (
          <div
            key={t.id}
            className={`wl-adm-wall-tile ${dragId === t.id ? 'dragging' : ''}`}
            draggable
            onDragStart={() => {
              setDragId(t.id);
              if (state === 'saved') setState('idle');
            }}
            onDragEnter={() => moveOver(t.id)}
            onDragOver={(e) => e.preventDefault()}
            onDragEnd={() => setDragId(null)}
            onDrop={(e) => e.preventDefault()}
            title={t.title}
          >
            <span className="pos">{i + 1}</span>
            {/* Admin-only thumbnail; plain img is fine here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={t.image_web_url}
              alt={t.title}
              loading="lazy"
              draggable={false}
            />
            {t.available && <span className="dot" aria-hidden="true" />}
            <span className="cap">{t.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
