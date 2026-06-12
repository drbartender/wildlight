'use client';

import { useRef, useState } from 'react';
import {
  orderKey,
  toTray,
  toGrid,
  applyShop,
  type WallTile,
} from '@/lib/wall-arrange';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

async function patchArtwork(
  id: number,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const r = await fetch(`/api/admin/artworks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) return { ok: true, status: r.status };
    const data = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: false, status: r.status, error: data.error };
  } catch {
    return { ok: false, status: 0, error: 'network error' };
  }
}

// Module scope so it isn't re-created every render (avoids
// react/no-unstable-nested-components). Uses only its props — no closure over
// component state.
function Switch({
  on,
  label,
  onClick,
  kind,
  disabled,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
  kind: 'wall' | 'shop';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`wl-adm-wall-switch ${kind} ${on ? 'on' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {kind === 'wall' ? 'Wall' : 'Shop'}
    </button>
  );
}

/**
 * Wall & shop curation. Three independent interaction models on one screen:
 *   1. Reorder  — drag, then explicit Save order (writes wall_order).
 *   2. Toggles  — Wall / Shop switches, optimistic + reversible (one PATCH each).
 *   3. Delete   — per-tile ✕, behind a confirm. Permanent; grid-only; not
 *                 offered on for-sale pieces (manage those in the catalog).
 *
 * The three are SERIALIZED via `inFlight`: while any single mutation is round-
 * tripping, every interactive control is disabled, so an optimistic rollback
 * can't be stomped by a concurrent edit. Order-dirtiness is tracked against
 * savedGrid; tiles leaving/entering the grid update savedGrid too so a toggle
 * or delete never looks like a reorder.
 */
export function WallArranger({
  initialGrid,
  initialTray,
}: {
  initialGrid: WallTile[];
  initialTray: WallTile[];
}) {
  const [grid, setGrid] = useState<WallTile[]>(initialGrid);
  const [tray, setTray] = useState<WallTile[]>(initialTray);
  const savedGrid = useRef<WallTile[]>(initialGrid);

  const [dragId, setDragId] = useState<number | null>(null);
  const [orderState, setOrderState] = useState<SaveState>('idle');
  const [actionErr, setActionErr] = useState<string | null>(null);
  // True while one optimistic mutation (toggle or delete) is round-tripping.
  // Disables every control so the interaction models can't interleave.
  const [busy, setBusy] = useState(false);

  const dirty = orderKey(grid) !== orderKey(savedGrid.current);
  const inFlight = busy || orderState === 'saving';

  const liveRef = useRef<HTMLDivElement>(null);
  const announce = (msg: string) => {
    if (liveRef.current) liveRef.current.textContent = msg;
  };

  // ── Reorder ──────────────────────────────────────────────────────────
  function moveOver(overId: number) {
    if (dragId === null || dragId === overId) return;
    setGrid((prev) => {
      const from = prev.findIndex((t) => t.id === dragId);
      const to = prev.findIndex((t) => t.id === overId);
      if (from === -1 || to === -1 || from === to) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function saveOrder() {
    if (inFlight) return;
    setOrderState('saving');
    try {
      const r = await fetch('/api/admin/wall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: grid.map((t) => t.id) }),
      });
      if (!r.ok) throw new Error(String(r.status));
      savedGrid.current = grid;
      setOrderState('saved');
    } catch {
      setOrderState('error');
    }
  }

  function resetOrder() {
    setGrid(savedGrid.current);
    setOrderState('idle');
  }

  // ── Wall toggle (optimistic, serialized via inFlight) ────────────────
  async function wallOff(id: number) {
    if (inFlight) return;
    setBusy(true);
    const prev = { grid, tray, saved: savedGrid.current };
    const next = toTray({ grid, tray, savedGrid: savedGrid.current }, id);
    setGrid(next.grid);
    setTray(next.tray);
    savedGrid.current = next.savedGrid;
    setActionErr(null);
    announce('Moved to the off-the-wall tray');
    const res = await patchArtwork(id, { on_wall: false });
    if (!res.ok) {
      setGrid(prev.grid);
      setTray(prev.tray);
      savedGrid.current = prev.saved;
      setActionErr("Couldn't take that off the wall — please try again.");
    }
    setBusy(false);
  }

  async function wallOn(id: number) {
    if (inFlight) return;
    setBusy(true);
    const prev = { grid, tray, saved: savedGrid.current };
    const next = toGrid({ grid, tray, savedGrid: savedGrid.current }, id);
    setGrid(next.grid);
    setTray(next.tray);
    savedGrid.current = next.savedGrid;
    setActionErr(null);
    announce('Put on the wall');
    const res = await patchArtwork(id, { on_wall: true });
    if (!res.ok) {
      setGrid(prev.grid);
      setTray(prev.tray);
      savedGrid.current = prev.saved;
      setActionErr("Couldn't put that on the wall — please try again.");
    }
    setBusy(false);
  }

  // ── Shop toggle (optimistic, serialized via inFlight) ────────────────
  async function toggleShop(id: number, on: boolean) {
    if (inFlight) return;
    setBusy(true);
    const prevGrid = grid;
    const prevTray = tray;
    setGrid((g) => applyShop(g, id, on));
    setTray((t) => applyShop(t, id, on));
    setActionErr(null);
    const res = await patchArtwork(id, { status: on ? 'published' : 'retired' });
    if (!res.ok) {
      setGrid(prevGrid);
      setTray(prevTray);
      setActionErr(
        res.status === 409
          ? res.error ?? 'Needs a print master before it can be sold.'
          : "Couldn't change the shop status — please try again.",
      );
    }
    setBusy(false);
  }

  // ── Delete (per-tile, confirmed, permanent) ──────────────────────────
  async function deleteOne(id: number, title: string) {
    if (inFlight) return;
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      `Permanently delete “${title}”?\n\nThis deletes the photo everywhere and can’t be undone. ` +
        `To just take it off the wall (and keep it), use the Wall switch instead.`,
    );
    if (!ok) return;
    setBusy(true);
    setActionErr(null);
    let res: { ok: boolean; status: number; error?: string };
    try {
      const r = await fetch(`/api/admin/artworks/${id}`, { method: 'DELETE' });
      res = {
        ok: r.ok,
        status: r.status,
        error: r.ok ? undefined : ((await r.json().catch(() => ({}))) as { error?: string }).error,
      };
    } catch {
      res = { ok: false, status: 0, error: 'network error' };
    }
    if (res.ok) {
      setGrid((g) => g.filter((t) => t.id !== id));
      savedGrid.current = savedGrid.current.filter((t) => t.id !== id);
      announce(`Deleted ${title}`);
    } else {
      setActionErr(
        res.error
          ? `Couldn’t delete “${title}” — ${res.error}`
          : `Couldn’t delete “${title}” — please try again.`,
      );
    }
    setBusy(false);
  }

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="wl-adm-wall">
      <header className="wl-adm-wall-head">
        <div>
          <h1>Wall &amp; shop</h1>
          <p>
            Drag to reorder the wall. Toggle each photo on or off the wall and in
            or out of the shop — they&apos;re independent. The ✕ permanently
            deletes a photo (for duplicates or junk); to just hide one, switch
            it off the wall instead.
          </p>
        </div>
        <div className="actions">
          <a className="wl-adm-wall-add" href="/admin/artworks/bulk-upload">
            Add photos
          </a>
          {dirty && (
            <button type="button" onClick={resetOrder} disabled={inFlight}>
              Reset
            </button>
          )}
          <button
            type="button"
            className="primary"
            onClick={saveOrder}
            disabled={!dirty || inFlight}
          >
            {orderState === 'saving'
              ? 'Saving…'
              : !dirty && orderState === 'saved'
                ? 'Saved ✓'
                : 'Save order'}
          </button>
        </div>
      </header>

      {orderState === 'error' && (
        <p className="wl-adm-wall-err">Couldn&apos;t save the order — please try again.</p>
      )}
      {actionErr && <p className="wl-adm-wall-err">{actionErr}</p>}

      <p className="wl-adm-wall-hint">
        {grid.length} on the wall · the green dot marks pieces for sale
      </p>

      <div className="wl-adm-wall-grid">
        {grid.map((t, i) => (
          <div
            key={t.id}
            className={`wl-adm-wall-tile ${dragId === t.id ? 'dragging' : ''}`}
            draggable={!inFlight}
            onDragStart={() => {
              if (inFlight) return;
              setDragId(t.id);
              if (orderState !== 'idle') setOrderState('idle');
            }}
            onDragEnter={() => moveOver(t.id)}
            onDragOver={(e) => e.preventDefault()}
            onDragEnd={() => setDragId(null)}
            onDrop={(e) => e.preventDefault()}
            title={t.title}
          >
            <span className="pos">{i + 1}</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={t.image_web_url} alt={t.title} loading="lazy" draggable={false} />
            {t.available && <span className="dot" aria-hidden="true" />}
            <div className="wl-adm-wall-ctl">
              <Switch
                kind="wall"
                on
                disabled={inFlight}
                label={`Take ${t.title} off the wall`}
                onClick={() => wallOff(t.id)}
              />
              {t.canSell && (
                <Switch
                  kind="shop"
                  on={t.status === 'published'}
                  disabled={inFlight}
                  label={`${t.status === 'published' ? 'Remove' : 'Put'} ${t.title} ${t.status === 'published' ? 'from' : 'in'} the shop`}
                  onClick={() => toggleShop(t.id, t.status !== 'published')}
                />
              )}
            </div>
            {!t.available && (
              <button
                type="button"
                className="wl-adm-wall-x"
                aria-label={`Delete ${t.title}`}
                disabled={inFlight}
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteOne(t.id, t.title);
                }}
              >
                ✕
              </button>
            )}
            <span className="cap">{t.title}</span>
          </div>
        ))}
      </div>

      {tray.length > 0 && (
        <section className="wl-adm-wall-tray">
          <p className="wl-adm-wall-hint">Off the wall · {tray.length}</p>
          <div className="wl-adm-wall-grid">
            {tray.map((t) => (
              <div key={t.id} className="wl-adm-wall-tile off" title={t.title}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={t.image_web_url} alt={t.title} loading="lazy" draggable={false} />
                {t.available && <span className="dot" aria-hidden="true" />}
                <div className="wl-adm-wall-ctl">
                  <button
                    type="button"
                    className="wl-adm-wall-add small"
                    onClick={() => wallOn(t.id)}
                    disabled={inFlight}
                    aria-label={`Put ${t.title} on the wall`}
                  >
                    Put on wall
                  </button>
                  {t.canSell && (
                    <Switch
                      kind="shop"
                      on={t.status === 'published'}
                      disabled={inFlight}
                      label={`${t.status === 'published' ? 'Remove' : 'Put'} ${t.title} ${t.status === 'published' ? 'from' : 'in'} the shop`}
                      onClick={() => toggleShop(t.id, t.status !== 'published')}
                    />
                  )}
                </div>
                <span className="cap">{t.title}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div ref={liveRef} aria-live="polite" className="wl-adm-sr-only" />
    </div>
  );
}
