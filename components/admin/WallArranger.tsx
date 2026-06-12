'use client';

import { useRef, useState } from 'react';
import {
  orderKey,
  removeFromGrid,
  toTray,
  toGrid,
  applyShop,
  type WallTile,
} from '@/lib/wall-arrange';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
// No 'error' state: a partial-failure delete keeps the failed tiles staged
// (pending stays non-empty) and surfaces reasons via removeErrs, so the bar
// returns to its "Remove N" affordance for retry — identical render to idle.
type RemoveState = 'idle' | 'confirming' | 'removing';
interface RemoveErr {
  id: number;
  title: string;
  reason: string;
}

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
}: {
  on: boolean;
  label: string;
  onClick: () => void;
  kind: 'wall' | 'shop';
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
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
 *   3. Delete   — staged batch behind one confirm (destructive, grid only).
 * Order-dirtiness is tracked against savedGrid; tiles leaving/entering the grid
 * update savedGrid too so a toggle never looks like a reorder.
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

  const [pending, setPending] = useState<Set<number>>(new Set());
  const [removeState, setRemoveState] = useState<RemoveState>('idle');
  const [removeErrs, setRemoveErrs] = useState<RemoveErr[]>([]);
  const [toggleErr, setToggleErr] = useState<string | null>(null);

  const liveRef = useRef<HTMLDivElement>(null);
  const announce = (msg: string) => {
    if (liveRef.current) liveRef.current.textContent = msg;
  };

  const dirty = orderKey(grid) !== orderKey(savedGrid.current);

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

  // ── Wall toggle (optimistic) ─────────────────────────────────────────
  async function wallOff(id: number) {
    const prev = { grid, tray, saved: savedGrid.current };
    const next = toTray({ grid, tray, savedGrid: savedGrid.current }, id);
    setGrid(next.grid);
    setTray(next.tray);
    savedGrid.current = next.savedGrid;
    setToggleErr(null);
    announce('Moved to the off-the-wall tray');
    const res = await patchArtwork(id, { on_wall: false });
    if (!res.ok) {
      setGrid(prev.grid);
      setTray(prev.tray);
      savedGrid.current = prev.saved;
      setToggleErr("Couldn't take that off the wall — please try again.");
    }
  }

  async function wallOn(id: number) {
    const prev = { grid, tray, saved: savedGrid.current };
    const next = toGrid({ grid, tray, savedGrid: savedGrid.current }, id);
    setGrid(next.grid);
    setTray(next.tray);
    savedGrid.current = next.savedGrid;
    setToggleErr(null);
    announce('Put on the wall');
    const res = await patchArtwork(id, { on_wall: true });
    if (!res.ok) {
      setGrid(prev.grid);
      setTray(prev.tray);
      savedGrid.current = prev.saved;
      setToggleErr("Couldn't put that on the wall — please try again.");
    }
  }

  // ── Shop toggle (optimistic) ─────────────────────────────────────────
  async function toggleShop(id: number, on: boolean) {
    const prevGrid = grid;
    const prevTray = tray;
    setGrid((g) => applyShop(g, id, on));
    setTray((t) => applyShop(t, id, on));
    setToggleErr(null);
    const res = await patchArtwork(id, { status: on ? 'published' : 'retired' });
    if (!res.ok) {
      setGrid(prevGrid);
      setTray(prevTray);
      setToggleErr(
        res.status === 409
          ? res.error ?? 'Needs a print master before it can be sold.'
          : "Couldn't change the shop status — please try again.",
      );
    }
  }

  // ── Staged delete ────────────────────────────────────────────────────
  function stage(id: number) {
    setPending((p) => new Set(p).add(id));
    if (removeState !== 'idle') setRemoveState('idle');
  }
  function unstage(id: number) {
    setPending((p) => {
      const n = new Set(p);
      n.delete(id);
      return n;
    });
  }

  async function commitRemoval() {
    setRemoveState('removing');
    const ids = [...pending];
    const settled = await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/admin/artworks/${id}`, { method: 'DELETE' }).then(async (r) => ({
          ok: r.ok,
          status: r.status,
          error: r.ok ? undefined : ((await r.json().catch(() => ({}))) as { error?: string }).error,
        })),
      ),
    );
    const ok = new Set<number>();
    const errs: RemoveErr[] = [];
    settled.forEach((res, i) => {
      const id = ids[i];
      if (res.status === 'fulfilled' && res.value.ok) {
        ok.add(id);
      } else {
        const title = grid.find((t) => t.id === id)?.title ?? `#${id}`;
        const reason =
          res.status === 'fulfilled'
            ? res.value.error ?? `HTTP ${res.value.status}`
            : 'network error';
        errs.push({ id, title, reason });
      }
    });
    if (ok.size) {
      const r = removeFromGrid(grid, savedGrid.current, ok);
      setGrid(r.grid);
      savedGrid.current = r.savedGrid;
    }
    setPending(new Set(errs.map((e) => e.id)));
    setRemoveErrs(errs);
    setRemoveState('idle');
  }

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="wl-adm-wall">
      <header className="wl-adm-wall-head">
        <div>
          <h1>Wall &amp; shop</h1>
          <p>
            Drag to reorder the wall. Toggle each photo on or off the wall and in
            or out of the shop — they&apos;re independent. Deleting is permanent and
            only for duplicates or junk.
          </p>
        </div>
        <div className="actions">
          <a className="wl-adm-wall-add" href="/admin/artworks/bulk-upload">
            Add photos
          </a>
          {dirty && (
            <button type="button" onClick={resetOrder}>
              Reset
            </button>
          )}
          <button
            type="button"
            className="primary"
            onClick={saveOrder}
            disabled={!dirty || orderState === 'saving'}
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
      {toggleErr && <p className="wl-adm-wall-err">{toggleErr}</p>}

      <p className="wl-adm-wall-hint">
        {grid.length} on the wall · the green dot marks pieces for sale
      </p>

      <div className="wl-adm-wall-grid">
        {grid.map((t, i) => {
          const staged = pending.has(t.id);
          return (
            <div
              key={t.id}
              className={`wl-adm-wall-tile ${dragId === t.id ? 'dragging' : ''} ${staged ? 'staged' : ''}`}
              draggable={!staged}
              onDragStart={() => {
                if (staged) return;
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
                  label={`Take ${t.title} off the wall`}
                  onClick={() => wallOff(t.id)}
                />
                {t.canSell && (
                  <Switch
                    kind="shop"
                    on={t.status === 'published'}
                    label={`${t.status === 'published' ? 'Remove' : 'Put'} ${t.title} ${t.status === 'published' ? 'from' : 'in'} the shop`}
                    onClick={() => toggleShop(t.id, t.status !== 'published')}
                  />
                )}
              </div>
              {!t.available &&
                (staged ? (
                  <button
                    type="button"
                    className="wl-adm-wall-undo"
                    onClick={(e) => {
                      e.stopPropagation();
                      unstage(t.id);
                    }}
                  >
                    Undo
                  </button>
                ) : (
                  <button
                    type="button"
                    className="wl-adm-wall-x"
                    aria-label={`Remove ${t.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      stage(t.id);
                    }}
                  >
                    ✕
                  </button>
                ))}
              <span className="cap">{t.title}</span>
            </div>
          );
        })}
      </div>

      {pending.size > 0 && (
        <div className="wl-adm-wall-removebar">
          {removeState === 'confirming' || removeState === 'removing' ? (
            <>
              <span>
                Permanently delete {pending.size} photo{pending.size > 1 ? 's' : ''}? This
                can&apos;t be undone.
              </span>
              <button
                type="button"
                className="danger"
                onClick={commitRemoval}
                disabled={removeState === 'removing'}
              >
                {removeState === 'removing' ? 'Removing…' : 'Delete'}
              </button>
              <button
                type="button"
                onClick={() => setRemoveState('idle')}
                disabled={removeState === 'removing'}
              >
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="danger" onClick={() => setRemoveState('confirming')}>
              Remove {pending.size} photo{pending.size > 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}

      {removeErrs.length > 0 && (
        <ul className="wl-adm-wall-removeerrs">
          {removeErrs.map((e) => (
            <li key={e.id}>
              Couldn&apos;t remove “{e.title}” — {e.reason}
            </li>
          ))}
        </ul>
      )}

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
                    aria-label={`Put ${t.title} on the wall`}
                  >
                    Put on wall
                  </button>
                  {t.canSell && (
                    <Switch
                      kind="shop"
                      on={t.status === 'published'}
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
