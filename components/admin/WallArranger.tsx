'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { formatUSD } from '@/lib/money';
import {
  applyFilter,
  deriveWallIds,
  filterCounts,
  isInShop,
  orderChanged,
  reorder,
  type FilterKey,
  type LibraryPhoto,
} from '@/lib/wall-arrange';

// Every mutation runs behind `inFlight` (disables controls + dragging) so the
// interaction models can't interleave. A hung request would wedge the page, so
// abort at 30s (server worst case = 15s connect + 15s statement_timeout). A
// timed-out request MAY have committed, so callers reconcile by reload rather
// than rolling back (see reconcileAfterTimeout).
const mutationTimeout = () => AbortSignal.timeout?.(30_000);
function isTimeout(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === 'TimeoutError' || err.name === 'AbortError')
  );
}
type MutResult = { ok: boolean; status: number; error?: string };
async function patchArtwork(id: number, body: Record<string, unknown>): Promise<MutResult> {
  try {
    const r = await fetch(`/api/admin/artworks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: mutationTimeout(),
    });
    if (r.ok) return { ok: true, status: r.status };
    const data = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: false, status: r.status, error: data.error };
  } catch (err) {
    return { ok: false, status: 0, error: isTimeout(err) ? 'timeout' : 'network error' };
  }
}

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'wall', label: 'On wall' },
  { key: 'shop', label: 'In shop' },
  { key: 'unplaced', label: 'Unplaced' },
  { key: 'nohd', label: 'No print file' },
];

type ConfirmKind = 'wallRemove' | 'shopRemove' | 'del';
type Confirm = { kind: ConfirmKind; id: number } | null;
type Drag = { id: number; from: 'lib' | 'wall' } | null;

export function WallArranger({ photos: initial }: { photos: LibraryPhoto[] }) {
  const [photos, setPhotos] = useState<LibraryPhoto[]>(initial);
  const [wallIds, setWallIds] = useState<number[]>(() => deriveWallIds(initial));
  const savedWallIds = useRef<number[]>(deriveWallIds(initial));

  const [filter, setFilter] = useState<FilterKey>('all');
  const [drag, setDrag] = useState<Drag>(null);
  const [dropTarget, setDropTarget] = useState<'wall' | 'shop' | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [wallMin, setWallMin] = useState(false);
  const [shopMin, setShopMin] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const inFlight = busy || savingOrder;

  const liveRef = useRef<HTMLDivElement>(null);
  const announce = (msg: string) => {
    if (liveRef.current) liveRef.current.textContent = msg;
  };

  const byId = useMemo(() => {
    const m = new Map<number, LibraryPhoto>();
    for (const p of photos) m.set(p.id, p);
    return m;
  }, [photos]);
  const counts = filterCounts(photos);
  const wall = wallIds.map((id) => byId.get(id)).filter((p): p is LibraryPhoto => !!p);
  const shop = photos.filter(isInShop); // loader order (updated_at DESC)
  const libList = applyFilter(photos, filter);

  function setPhoto(id: number, patch: Partial<LibraryPhoto>) {
    setPhotos((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  // A stale row (deleted/retired elsewhere) returns 404: drop it everywhere and
  // announce, rather than showing a retry that would 404 again.
  function dropStale(id: number, title: string) {
    setPhotos((ps) => ps.filter((p) => p.id !== id));
    setWallIds((ids) => ids.filter((x) => x !== id));
    savedWallIds.current = savedWallIds.current.filter((x) => x !== id);
    setActionErr(`"${title}" was changed elsewhere and has been removed from this view.`);
  }
  function reconcileAfterTimeout() {
    setActionErr('That took too long to confirm — reloading to show the saved state…');
    announce('Request timed out; reloading');
    window.setTimeout(() => window.location.reload(), 1200);
  }

  // ── Wall placement (no confirm; reversible) ──────────────────────────
  async function placeOnWall(id: number) {
    if (inFlight) return;
    const p = byId.get(id);
    if (!p || p.on_wall) return; // no-op re-placement (never re-fires wall_order reset)
    setBusy(true);
    setActionErr(null);
    setPhoto(id, { on_wall: true });
    setWallIds((ids) => [...ids, id]);
    savedWallIds.current = [...savedWallIds.current, id];
    announce(`Put "${p.title}" on the wall`);
    const res = await patchArtwork(id, { on_wall: true });
    if (res.error === 'timeout') return reconcileAfterTimeout();
    if (!res.ok) {
      if (res.status === 404) dropStale(id, p.title);
      else {
        setPhoto(id, { on_wall: false });
        setWallIds((ids) => ids.filter((x) => x !== id));
        savedWallIds.current = savedWallIds.current.filter((x) => x !== id);
        setActionErr(`Couldn't put "${p.title}" on the wall — please try again.`);
      }
    }
    setBusy(false);
  }
  async function removeFromWall(id: number) {
    if (inFlight) return;
    const p = byId.get(id);
    if (!p || !p.on_wall) return;
    // Capture the original positions so a failed remove restores exactly, not
    // to the end (a post-failure reorder must diff against the true baseline).
    const idx = wallIds.indexOf(id);
    const savedIdx = savedWallIds.current.indexOf(id);
    setBusy(true);
    setActionErr(null);
    setConfirm(null);
    setPhoto(id, { on_wall: false });
    setWallIds((ids) => ids.filter((x) => x !== id));
    savedWallIds.current = savedWallIds.current.filter((x) => x !== id);
    announce(`Removed "${p.title}" from the wall`);
    const res = await patchArtwork(id, { on_wall: false });
    if (res.error === 'timeout') return reconcileAfterTimeout();
    if (!res.ok) {
      if (res.status === 404) dropStale(id, p.title);
      else {
        setPhoto(id, { on_wall: true });
        setWallIds((ids) => {
          if (ids.includes(id)) return ids;
          const next = ids.slice();
          next.splice(idx < 0 ? next.length : idx, 0, id);
          return next;
        });
        if (!savedWallIds.current.includes(id)) {
          const next = savedWallIds.current.slice();
          next.splice(savedIdx < 0 ? next.length : savedIdx, 0, id);
          savedWallIds.current = next;
        }
        setActionErr(`Couldn't take "${p.title}" off the wall — please try again.`);
      }
    }
    setBusy(false);
  }

  // ── Shop placement (always confirmed; hd-gated) ──────────────────────
  async function placeInShop(id: number) {
    if (inFlight) return;
    const p = byId.get(id);
    if (!p || isInShop(p)) return; // no-op re-placement
    if (!p.hd) {
      setActionErr(`"${p.title}" needs a print file before it can be sold.`);
      return;
    }
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Put "${p.title}" up for sale in the shop?`)) return;
    setBusy(true);
    setActionErr(null);
    setPhoto(id, { status: 'published' });
    announce(`Put "${p.title}" up for sale`);
    const res = await patchArtwork(id, { status: 'published' });
    if (res.error === 'timeout') return reconcileAfterTimeout();
    if (!res.ok) {
      setPhoto(id, { status: p.status });
      if (res.status === 404) dropStale(id, p.title);
      else
        setActionErr(
          res.status === 409
            ? res.error ?? `"${p.title}" needs a print file before it can be sold.`
            : `Couldn't put "${p.title}" up for sale — please try again.`,
        );
    }
    setBusy(false);
  }
  async function removeFromShop(id: number) {
    if (inFlight) return;
    const p = byId.get(id);
    if (!p || !isInShop(p)) return;
    setBusy(true);
    setActionErr(null);
    setConfirm(null);
    setPhoto(id, { status: 'retired' });
    announce(`Stopped selling "${p.title}"`);
    const res = await patchArtwork(id, { status: 'retired' });
    if (res.error === 'timeout') return reconcileAfterTimeout();
    if (!res.ok) {
      if (res.status === 404) dropStale(id, p.title);
      else {
        setPhoto(id, { status: p.status });
        setActionErr(`Couldn't stop selling "${p.title}" — please try again.`);
      }
    }
    setBusy(false);
  }

  // ── Library delete (permanent; two-step + native confirm) ────────────
  async function deletePhoto(id: number) {
    if (inFlight) return;
    const p = byId.get(id);
    if (!p) return;
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      `Last check — permanently delete "${p.title}"?\n\n` +
        `It will be removed from the Library, the Wall, and the Shop. This cannot be undone.`,
    );
    if (!ok) {
      setConfirm(null);
      return;
    }
    setBusy(true);
    setActionErr(null);
    setConfirm(null);
    let res: MutResult;
    try {
      const r = await fetch(`/api/admin/artworks/${id}`, {
        method: 'DELETE',
        signal: mutationTimeout(),
      });
      res = {
        ok: r.ok,
        status: r.status,
        error: r.ok ? undefined : ((await r.json().catch(() => ({}))) as { error?: string }).error,
      };
    } catch (err) {
      res = { ok: false, status: 0, error: isTimeout(err) ? 'timeout' : 'network error' };
    }
    if (res.error === 'timeout') return reconcileAfterTimeout();
    if (res.ok) {
      setPhotos((ps) => ps.filter((x) => x.id !== id));
      setWallIds((ids) => ids.filter((x) => x !== id));
      savedWallIds.current = savedWallIds.current.filter((x) => x !== id);
      announce(`Deleted "${p.title}"`);
    } else {
      setActionErr(
        res.error
          ? `Couldn't delete "${p.title}" — ${res.error}`
          : `Couldn't delete "${p.title}" — please try again.`,
      );
    }
    setBusy(false);
  }

  // ── Wall reorder (live on dragEnter, auto-save on dragEnd) ────────────
  function moveOver(overId: number) {
    if (!drag || drag.from !== 'wall') return;
    setWallIds((ids) => reorder(ids, drag.id, overId));
  }
  async function commitOrder() {
    if (inFlight) return; // matches the other mutators; guards any future non-drag caller
    if (!orderChanged(wallIds, savedWallIds.current)) return;
    setSavingOrder(true); // state (not a ref) so inFlight re-renders and disables controls
    const attempt = wallIds.slice(); // rebuild payload from current order, never a drag-start snapshot
    try {
      const r = await fetch('/api/admin/wall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: attempt }),
        signal: mutationTimeout(),
      });
      if (!r.ok) throw new Error(String(r.status));
      savedWallIds.current = attempt;
      setSavedFlash(true);
      announce('Wall order saved');
      window.setTimeout(() => setSavedFlash(false), 2200);
    } catch (err) {
      if (isTimeout(err)) return reconcileAfterTimeout(); // leave savingOrder true → controls stay disabled until reload
      setWallIds(savedWallIds.current); // revert to last-saved order
      setActionErr("Couldn't save the new wall order — please try again.");
    }
    setSavingOrder(false);
  }

  // ── Drag wiring ──────────────────────────────────────────────────────
  const overShelf = (which: 'wall' | 'shop') => (e: React.DragEvent) => {
    e.preventDefault();
    if (drag?.from === 'lib' && dropTarget !== which) setDropTarget(which);
  };
  const leaveShelf = (e: React.DragEvent) => {
    if (!(e.currentTarget as Node).contains(e.relatedTarget as Node)) setDropTarget(null);
  };
  const dropOnWall = (e: React.DragEvent) => {
    e.preventDefault();
    const d = drag;
    setDropTarget(null);
    setDrag(null);
    if (d?.from === 'lib') void placeOnWall(d.id);
  };
  const dropOnShop = (e: React.DragEvent) => {
    e.preventDefault();
    const d = drag;
    setDropTarget(null);
    setDrag(null);
    if (d?.from === 'lib') void placeInShop(d.id);
  };

  const shopHot = dropTarget === 'shop' && !!drag && byId.get(drag.id)?.hd;
  const shopBad = dropTarget === 'shop' && !!drag && !byId.get(drag.id)?.hd;

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="wl-adm-wall ws-fixed">
      <header className="wl-adm-wall-head">
        <div>
          <h1>Wall &amp; shop</h1>
        </div>
        <div className="actions">
          <a className="wl-adm-wall-add" href="/admin/artworks/bulk-upload">
            Add photos
          </a>
        </div>
      </header>

      {actionErr && <p className="wl-adm-wall-err">{actionErr}</p>}

      <div className={`wl-adm-ws-shelves ${wallMin || shopMin ? 'stacked' : ''}`}>
        {/* THE WALL */}
        <section
          className={`wl-adm-ws-shelf ${dropTarget === 'wall' ? 'hot-ok' : ''}`}
          aria-label="The Wall"
          onDragOver={overShelf('wall')}
          onDragLeave={leaveShelf}
          onDrop={dropOnWall}
        >
          <div className={`wl-adm-ws-head ${wallMin ? '' : 'open'}`}>
            <button
              type="button"
              className={`wl-adm-ws-min ${wallMin ? 'collapsed' : ''}`}
              aria-label={wallMin ? 'Expand the Wall' : 'Minimize the Wall'}
              onClick={() => setWallMin((v) => !v)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <h3>The Wall</h3>
            <span className="wl-adm-ws-meta">homepage gallery · {wall.length}</span>
            <span style={{ flex: 1 }} />
            {savedFlash && <span className="wl-adm-ws-saved">order saved ✓</span>}
            {!wallMin && <span className="wl-adm-ws-note">Drag to reorder — saves automatically</span>}
          </div>
          {!wallMin &&
            (wall.length === 0 ? (
              <div className="wl-adm-ws-empty">Drag photos here from the Library to hang them on the homepage.</div>
            ) : (
              <div className="wl-adm-ws-grid">
                {wall.map((p, i) => (
                  <figure
                    key={p.id}
                    className={`wl-adm-ws-tile grab ${drag?.id === p.id && drag.from === 'wall' ? 'dragging' : ''}`}
                    title={p.title}
                    draggable={!inFlight}
                    onDragStart={(e) => {
                      if (inFlight) return;
                      e.dataTransfer.setData('text/plain', String(p.id));
                      e.dataTransfer.effectAllowed = 'move';
                      setDrag({ id: p.id, from: 'wall' });
                    }}
                    onDragEnter={() => moveOver(p.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDragEnd={() => {
                      setDrag(null);
                      setDropTarget(null);
                      void commitOrder();
                    }}
                    onDrop={(e) => e.preventDefault()}
                  >
                    <span className="wl-adm-ws-pos">{i + 1}</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.image_web_url} alt={p.title} draggable={false} />
                    <figcaption className="wl-adm-ws-cap">
                      <span className="name">{p.title}</span>
                      <RemoveButton
                        confirming={confirm?.kind === 'wallRemove' && confirm.id === p.id}
                        disabled={inFlight}
                        label={`Remove ${p.title} from the wall`}
                        onClick={() =>
                          confirm?.kind === 'wallRemove' && confirm.id === p.id
                            ? void removeFromWall(p.id)
                            : setConfirm({ kind: 'wallRemove', id: p.id })
                        }
                      />
                    </figcaption>
                  </figure>
                ))}
              </div>
            ))}
        </section>

        {/* THE SHOP */}
        <section
          className={`wl-adm-ws-shelf ${shopHot ? 'hot-ok' : ''} ${shopBad ? 'hot-bad' : ''}`}
          aria-label="The Shop"
          onDragOver={overShelf('shop')}
          onDragLeave={leaveShelf}
          onDrop={dropOnShop}
        >
          <div className={`wl-adm-ws-head ${shopMin ? '' : 'open'}`}>
            <button
              type="button"
              className={`wl-adm-ws-min ${shopMin ? 'collapsed' : ''}`}
              aria-label={shopMin ? 'Expand the Shop' : 'Minimize the Shop'}
              onClick={() => setShopMin((v) => !v)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <h3>The Shop</h3>
            <span className="wl-adm-ws-meta">for sale · {shop.length}</span>
            <span style={{ flex: 1 }} />
            {!shopMin && <span className="wl-adm-ws-note">Exactly what customers can buy</span>}
          </div>
          {!shopMin &&
            (shop.length === 0 ? (
              <div className="wl-adm-ws-empty">Drag photos with a print file here to put them up for sale.</div>
            ) : (
              <div className="wl-adm-ws-grid">
                {shop.map((p) => (
                  <figure key={p.id} className="wl-adm-ws-tile" title={p.title}>
                    {isInShop(p) && !p.buyable && (
                      <div className="wl-adm-ws-badges">
                        <span className="wl-adm-ws-badge blocked">hidden — sizes blocked</span>
                      </div>
                    )}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.image_web_url} alt={p.title} draggable={false} />
                    <figcaption className="wl-adm-ws-cap">
                      <span className="name">{p.title}</span>
                      <span className="price">{p.price_from_cents != null ? formatUSD(p.price_from_cents) : '—'}</span>
                      <RemoveButton
                        confirming={confirm?.kind === 'shopRemove' && confirm.id === p.id}
                        disabled={inFlight}
                        label={`Remove ${p.title} from the shop`}
                        onClick={() =>
                          confirm?.kind === 'shopRemove' && confirm.id === p.id
                            ? void removeFromShop(p.id)
                            : setConfirm({ kind: 'shopRemove', id: p.id })
                        }
                      />
                    </figcaption>
                  </figure>
                ))}
              </div>
            ))}
        </section>
      </div>

      {/* LIBRARY */}
      <section className="wl-adm-ws-library" aria-label="Library">
        <div className="wl-adm-ws-head open" style={{ flexWrap: 'wrap' }}>
          <h3>Library</h3>
          <span className="wl-adm-ws-meta">every photo · {counts.all}</span>
          <span style={{ flex: 1 }} />
          <div className="wl-adm-seg">
            {FILTERS.map((f) => (
              <button key={f.key} className={filter === f.key ? 'on' : ''} onClick={() => setFilter(f.key)}>
                {f.label} <span className="sub">{counts[f.key]}</span>
              </button>
            ))}
          </div>
        </div>
        {libList.length === 0 ? (
          <div className="wl-adm-ws-empty">
            {counts.all === 0 ? 'No photos yet.' : 'No photos match this filter.'}
          </div>
        ) : (
          <div className="wl-adm-ws-grid">
            {libList.map((p) => {
              const onWall = p.on_wall;
              const inShop = isInShop(p);
              const delConfirming = confirm?.kind === 'del' && confirm.id === p.id;
              return (
                <div key={p.id} className={`wl-adm-ws-libitem ${drag?.id === p.id && drag.from === 'lib' ? 'dragging' : ''}`}>
                  <figure
                    className="wl-adm-ws-tile grab"
                    title={p.title}
                    draggable={!inFlight}
                    onDragStart={(e) => {
                      if (inFlight) return;
                      e.dataTransfer.setData('text/plain', String(p.id));
                      e.dataTransfer.effectAllowed = 'copy';
                      setDrag({ id: p.id, from: 'lib' });
                      setConfirm(null);
                    }}
                    onDragEnd={() => {
                      setDrag(null);
                      setDropTarget(null);
                    }}
                  >
                    <div className="wl-adm-ws-badges">
                      {p.hd ? (
                        <span className="wl-adm-ws-badge hd" title="Has a print file — can be sold">hd</span>
                      ) : (
                        <span className="wl-adm-ws-badge web" title="No print file yet — upload one to sell this photo">web only</span>
                      )}
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.image_web_url} alt={p.title} draggable={false} />
                    <button
                      type="button"
                      className={`wl-adm-ws-del ${delConfirming ? 'confirming' : ''}`}
                      aria-label={`Delete ${p.title} forever`}
                      disabled={inFlight}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (delConfirming) void deletePhoto(p.id);
                        else setConfirm({ kind: 'del', id: p.id });
                      }}
                    >
                      {delConfirming ? 'Delete forever?' : '✕'}
                    </button>
                  </figure>
                  <div className="wl-adm-ws-libctl">
                    <span className="name">{p.title}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={onWall}
                      className={`wl-adm-ws-pill ${onWall ? 'on-wall' : ''}`}
                      disabled={inFlight}
                      title={onWall ? 'On the wall — click to take it down' : 'Click to hang it on the homepage wall'}
                      onClick={() => (onWall ? void removeFromWall(p.id) : void placeOnWall(p.id))}
                    >
                      Wall
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={inShop}
                      className={`wl-adm-ws-pill ${inShop ? 'on-shop' : ''}`}
                      disabled={inFlight || !p.hd}
                      title={
                        !p.hd
                          ? 'Needs a print file before it can be sold'
                          : inShop
                            ? 'In the shop — click to stop selling it'
                            : 'Click to put it up for sale'
                      }
                      onClick={() => (inShop ? void removeFromShop(p.id) : void placeInShop(p.id))}
                    >
                      Shop
                    </button>
                    <Link className="wl-adm-ws-edit" href={`/admin/artworks/${p.id}`} title={`Edit ${p.title} details`}>
                      Edit ↗
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div ref={liveRef} aria-live="polite" className="wl-adm-sr-only" />
    </div>
  );
}

// Module scope (avoids react/no-unstable-nested-components). Props only.
function RemoveButton({
  confirming,
  disabled,
  label,
  onClick,
}: {
  confirming: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`wl-adm-ws-rm ${confirming ? 'confirming' : ''}`}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {confirming ? 'Sure — remove?' : 'Remove'}
    </button>
  );
}
