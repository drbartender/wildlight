'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
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

// Every mutation runs behind `inFlight` so the interaction models can't
// interleave. A hung request would wedge the page, so abort at 30s (server
// worst case = 15s connect + 15s statement_timeout). A timed-out request MAY
// have committed, so callers reconcile by reload rather than rolling back.
// AbortSignal.timeout is optional-chained for very old engines; fall back to a
// real controller so the timeout guarantee is never silently dropped.
function mutationTimeout(): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(30_000);
  }
  if (typeof AbortController === 'undefined') return undefined;
  const c = new AbortController();
  setTimeout(() => c.abort(), 30_000);
  return c.signal;
}
function isTimeout(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === 'TimeoutError' || err.name === 'AbortError')
  );
}

// `timedOut` is a separate flag, not a magic string in `error` — a server body
// of {error:'timeout'} must not be mistaken for a client-side abort.
type MutResult = { ok: boolean; status: number; error?: string; timedOut?: boolean };

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
    if (isTimeout(err)) return { ok: false, status: 0, timedOut: true };
    return { ok: false, status: 0, error: 'network error' };
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
  // Mirror of wallIds. commitOrder fires from dragEnd (discrete priority) while
  // moveOver writes from dragEnter (continuous priority), so reading wallIds out
  // of the render closure could POST an order the admin never saw. The ref is
  // always current; ALWAYS write wall order through setWall().
  const wallIdsRef = useRef<number[]>(wallIds);
  const savedWallIds = useRef<number[]>(wallIds);

  // Derive from the ref and assign it SYNCHRONOUSLY at the call site. Writing
  // the ref inside the setState updater made it only as fresh as React's
  // eager-state path: React can skip an updater whose lane isn't in the current
  // render, so two dragEnter events in back-to-back tasks could leave the ref a
  // move behind and commitOrder would POST a stale order.
  function setWall(next: number[] | ((cur: number[]) => number[])) {
    const v = typeof next === 'function' ? next(wallIdsRef.current) : next;
    wallIdsRef.current = v;
    setWallIds(v);
  }

  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [drag, setDrag] = useState<Drag>(null);
  const [dropTarget, setDropTarget] = useState<'wall' | 'shop' | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [wallMin, setWallMin] = useState(false);
  const [shopMin, setShopMin] = useState(false);
  const [editPos, setEditPos] = useState<number | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const inFlight = busy || savingOrder;

  const liveRef = useRef<HTMLDivElement>(null);
  const announce = (msg: string) => {
    if (liveRef.current) liveRef.current.textContent = msg;
  };
  // The error <p> carries role="alert", which announces on its own — also
  // pushing it through the polite live region announced every failure twice.
  function fail(msg: string) {
    setActionErr(msg);
  }

  // Disabling the just-clicked control mid-flight blurs it, dumping focus to
  // <body>. Remember it and put focus back when the mutation settles.
  const refocus = useRef<HTMLElement | null>(null);
  const rememberFocus = () => {
    const el = document.activeElement as HTMLElement | null;
    // On the drag-drop path activeElement is <body>; "restoring" that is a
    // no-op that also suppressed the fallback. Treat it as "nothing focused".
    refocus.current = el && el !== document.body ? el : null;
  };
  const restoreFocus = () => {
    const el = refocus.current;
    refocus.current = null;
    if (!el) return; // nothing was focused (drag) — don't move focus at all
    if (el.isConnected && !(el as HTMLButtonElement).disabled) {
      el.focus({ preventScroll: true });
      if (document.activeElement === el) return;
    }
    document.getElementById('wl-library-heading')?.focus({ preventScroll: true });
  };
  function settle() {
    setBusy(false);
    // Two frames: setTimeout(0) could beat React's commit on a large grid, so
    // the element was still disabled when focused and focus fell to <body>.
    requestAnimationFrame(() => requestAnimationFrame(restoreFocus));
  }

  // Escape clears an armed confirm — otherwise an armed Remove/Delete stays
  // armed indefinitely and fires on the next click.
  useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirm(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirm]);

  const byId = useMemo(() => {
    const m = new Map<number, LibraryPhoto>();
    for (const p of photos) m.set(p.id, p);
    return m;
  }, [photos]);
  const counts = useMemo(() => filterCounts(photos), [photos]);
  const wall = useMemo(
    () => wallIds.map((id) => byId.get(id)).filter((p): p is LibraryPhoto => !!p),
    [wallIds, byId],
  );
  const shop = useMemo(() => photos.filter(isInShop), [photos]);
  const blockedCount = useMemo(() => shop.filter((p) => !p.buyable).length, [shop]);
  const libList = useMemo(() => {
    const base = applyFilter(photos, filter);
    const q = query.trim().toLowerCase();
    return q ? base.filter((p) => p.title.toLowerCase().includes(q) || p.slug.includes(q)) : base;
  }, [photos, filter, query]);

  function setPhoto(id: number, patch: Partial<LibraryPhoto>) {
    setPhotos((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  // A stale row (deleted/retired elsewhere) returns 404: drop it everywhere
  // rather than offering a retry that would 404 again.
  function dropStale(id: number, title: string) {
    setPhotos((ps) => ps.filter((p) => p.id !== id));
    setWall((ids) => ids.filter((x) => x !== id));
    savedWallIds.current = savedWallIds.current.filter((x) => x !== id);
    fail(`"${title}" was changed elsewhere and has been removed from this view.`);
  }
  function reconcileAfterTimeout() {
    fail('That took too long to confirm. Reloading to show the saved state…');
    window.setTimeout(() => window.location.reload(), 1200);
  }

  // Persist the wall sequence. The server resets wall_order=0 on any on_wall
  // toggle, and the public wall sorts all wall_order=0 rows by md5(slug) — so
  // after ANY placement the order must be rewritten explicitly or the admin's
  // displayed order is not what visitors see (and is lost on reload).
  async function persistOrder(ids: number[]): Promise<MutResult> {
    if (ids.length === 0) {
      savedWallIds.current = ids;
      return { ok: true, status: 200 };
    }
    try {
      const r = await fetch('/api/admin/wall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
        signal: mutationTimeout(),
      });
      if (!r.ok) return { ok: false, status: r.status };
      savedWallIds.current = ids;
      return { ok: true, status: r.status };
    } catch (err) {
      if (isTimeout(err)) return { ok: false, status: 0, timedOut: true };
      return { ok: false, status: 0, error: 'network error' };
    }
  }

  // ── Wall placement (no confirm; reversible) ──────────────────────────
  async function placeOnWall(id: number) {
    if (inFlight) return;
    const p = byId.get(id);
    if (!p || p.on_wall) return; // no-op re-placement: never re-fire the wall_order reset
    rememberFocus();
    setBusy(true);
    setActionErr(null);
    const next = [...wallIdsRef.current, id];
    setPhoto(id, { on_wall: true });
    setWall(next);
    const res = await patchArtwork(id, { on_wall: true });
    if (res.timedOut) return reconcileAfterTimeout();
    if (!res.ok) {
      if (res.status === 404) dropStale(id, p.title);
      else {
        setPhoto(id, { on_wall: false });
        setWall((ids) => ids.filter((x) => x !== id));
        fail(`Couldn't put "${p.title}" on the wall. Please try again.`);
      }
      return settle();
    }
    // Rewrite 1..N so the admin's order IS the public order.
    const ord = await persistOrder(next);
    if (ord.timedOut) return reconcileAfterTimeout();
    if (!ord.ok) {
      // The photo IS on the wall (the PATCH succeeded), so the saved snapshot
      // must include it even though its position didn't persist. Leaving it out
      // poisons the snapshot: a later failed reorder rolls back to a baseline
      // missing this id, silently dropping it from the shelf while it stays
      // on_wall in the DB and live on the homepage — unrecoverable without a
      // reload, because the Library pill then routes to "remove".
      savedWallIds.current = next;
      fail(`"${p.title}" is on the wall, but its position couldn't be saved.`);
    } else {
      announce(`Put "${p.title}" on the wall`);
    }
    settle();
  }

  async function removeFromWall(id: number) {
    if (inFlight) return;
    const p = byId.get(id);
    if (!p || !p.on_wall) return;
    const idx = wallIdsRef.current.indexOf(id);
    rememberFocus();
    setBusy(true);
    setActionErr(null);
    setConfirm(null);
    setPhoto(id, { on_wall: false });
    setWall((ids) => ids.filter((x) => x !== id));
    savedWallIds.current = savedWallIds.current.filter((x) => x !== id);
    const res = await patchArtwork(id, { on_wall: false });
    if (res.timedOut) return reconcileAfterTimeout();
    if (!res.ok) {
      if (res.status === 404) dropStale(id, p.title);
      else {
        // Restore to its original position, not the end.
        setPhoto(id, { on_wall: true });
        setWall((ids) => {
          if (ids.includes(id)) return ids;
          const nextIds = ids.slice();
          nextIds.splice(idx < 0 ? nextIds.length : idx, 0, id);
          return nextIds;
        });
        if (!savedWallIds.current.includes(id)) {
          const s = savedWallIds.current.slice();
          s.splice(idx < 0 ? s.length : idx, 0, id);
          savedWallIds.current = s;
        }
        fail(`Couldn't take "${p.title}" off the wall. Please try again.`);
      }
    } else {
      announce(`Removed "${p.title}" from the wall`);
    }
    settle();
  }

  // ── Shop placement (always confirmed; hd-gated) ──────────────────────
  async function placeInShop(id: number) {
    if (inFlight) return;
    const p = byId.get(id);
    if (!p || isInShop(p)) return; // no-op re-placement
    if (!p.hd) {
      fail(`"${p.title}" needs a print file before it can be sold. Add one from its Edit page.`);
      return;
    }
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Put "${p.title}" up for sale in the shop?`)) return;
    rememberFocus();
    setBusy(true);
    setActionErr(null);
    setPhoto(id, { status: 'published' });
    const res = await patchArtwork(id, { status: 'published' });
    if (res.timedOut) return reconcileAfterTimeout();
    if (!res.ok) {
      setPhoto(id, { status: p.status });
      if (res.status === 404) dropStale(id, p.title);
      else
        fail(
          res.status === 409
            ? res.error ?? `"${p.title}" needs a print file before it can be sold.`
            : `Couldn't put "${p.title}" up for sale. Please try again.`,
        );
    } else {
      announce(`Put "${p.title}" up for sale`);
    }
    settle();
  }

  async function removeFromShop(id: number) {
    if (inFlight) return;
    const p = byId.get(id);
    if (!p || !isInShop(p)) return;
    rememberFocus();
    setBusy(true);
    setActionErr(null);
    setConfirm(null);
    setPhoto(id, { status: 'retired' });
    const res = await patchArtwork(id, { status: 'retired' });
    if (res.timedOut) return reconcileAfterTimeout();
    if (!res.ok) {
      if (res.status === 404) dropStale(id, p.title);
      else {
        setPhoto(id, { status: p.status });
        fail(`Couldn't stop selling "${p.title}". Please try again.`);
      }
    } else {
      announce(`Stopped selling "${p.title}"`);
    }
    settle();
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
    rememberFocus();
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
      if (isTimeout(err)) res = { ok: false, status: 0, timedOut: true };
      else res = { ok: false, status: 0, error: 'network error' };
    }
    if (res.timedOut) return reconcileAfterTimeout();
    if (res.ok) {
      setPhotos((ps) => ps.filter((x) => x.id !== id));
      setWall((ids) => ids.filter((x) => x !== id));
      savedWallIds.current = savedWallIds.current.filter((x) => x !== id);
      announce(`Deleted "${p.title}"`);
    } else if (res.status === 404) {
      dropStale(id, p.title);
    } else {
      fail(
        res.error
          ? `Couldn't delete "${p.title}" — ${res.error}`
          : `Couldn't delete "${p.title}". Please try again.`,
      );
    }
    settle();
  }

  // ── Wall reorder (live on dragEnter, auto-save on dragEnd) ────────────
  function moveOver(overId: number) {
    if (!drag || drag.from !== 'wall') return;
    setWall((ids) => reorder(ids, drag.id, overId));
  }
  async function commitOrder() {
    if (inFlight) return;
    const attempt = wallIdsRef.current.slice(); // current, never a drag-start snapshot
    if (!orderChanged(attempt, savedWallIds.current)) return;
    setSavingOrder(true);
    const res = await persistOrder(attempt);
    if (res.timedOut) return reconcileAfterTimeout(); // leave disabled until reload
    if (!res.ok) {
      setWall(savedWallIds.current.slice());
      fail("Couldn't save the new wall order. Please try again.");
    } else {
      setSavedFlash(true);
      announce('Wall order saved');
      window.setTimeout(() => setSavedFlash(false), 2200);
    }
    setSavingOrder(false);
  }

  // Reorder without dragging. Drag only reaches tiles rendered inside the
  // capped shelf (dragEnter can't hit a clipped tile), so moving a photo more
  // than ~a row was impossible — and there was no keyboard path at all. Typing
  // a position is O(1) in wall length and keyboard-operable for free.
  async function moveToPosition(id: number, pos1: number) {
    if (inFlight) return;
    const cur = wallIdsRef.current;
    const from = cur.indexOf(id);
    setEditPos(null);
    if (from === -1 || !Number.isFinite(pos1)) return;
    const to = Math.max(0, Math.min(cur.length - 1, Math.round(pos1) - 1));
    if (to === from) return;
    const next = cur.slice();
    next.splice(from, 1);
    next.splice(to, 0, id);
    setWall(next);
    setSavingOrder(true);
    const res = await persistOrder(next);
    if (res.timedOut) return reconcileAfterTimeout();
    if (!res.ok) {
      setWall(savedWallIds.current.slice());
      fail("Couldn't save the new wall order. Please try again.");
    } else {
      setSavedFlash(true);
      announce(`Moved to position ${to + 1} of ${next.length}`);
      window.setTimeout(() => setSavedFlash(false), 2200);
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

  const dragHd = drag ? byId.get(drag.id)?.hd : undefined;
  const shopHot = dropTarget === 'shop' && !!drag && !!dragHd;
  const shopBad = dropTarget === 'shop' && !!drag && !dragHd;

  return (
    <div className="wl-adm-wall ws-fixed">
      <header className="wl-adm-wall-head">
        <div>
          <h1>Wall &amp; shop</h1>
        </div>
        <div className="actions">
          {/* Always rendered at a fixed width so "Add photos" doesn't slide
              sideways on every mutation. */}
          <span className="wl-adm-ws-saving" role="status">
            {inFlight ? 'saving…' : ''}
          </span>
          <a className="wl-adm-wall-add" href="/admin/artworks/bulk-upload">
            Add photos
          </a>
        </div>
      </header>

      {actionErr && (
        <p className="wl-adm-wall-err" role="alert">
          {actionErr}
        </p>
      )}

      <div className="wl-adm-ws-shelves">
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
              aria-expanded={!wallMin}
              onClick={() => setWallMin((v) => !v)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <h2>The Wall</h2>
            <span className="wl-adm-ws-meta">homepage gallery · {wall.length}</span>
            <span style={{ flex: 1 }} />
            {savedFlash && <span className="wl-adm-ws-saved">order saved ✓</span>}
            {dropTarget === 'wall' && <span className="wl-adm-ws-saved">drop to add ↓</span>}
            {!wallMin && <span className="wl-adm-ws-note">Drag to reorder, saves automatically</span>}
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
                    draggable={!inFlight && editPos !== p.id}
                    onDragStart={(e) => {
                      if (inFlight || editPos === p.id) return;
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
                    {editPos === p.id ? (
                      <input
                        className="wl-adm-ws-posinput"
                        type="number"
                        min={1}
                        max={wall.length}
                        defaultValue={i + 1}
                        autoFocus
                        draggable={false}
                        aria-label={`Move ${p.title} to position (1 to ${wall.length})`}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => setEditPos(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void moveToPosition(p.id, Number((e.target as HTMLInputElement).value));
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setEditPos(null);
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="wl-adm-ws-pos"
                        aria-label={`${p.title} is at position ${i + 1} of ${wall.length}. Activate to move it.`}
                        title="Click to move to a position"
                        disabled={inFlight}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditPos(p.id);
                        }}
                      >
                        {i + 1}
                      </button>
                    )}
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
              aria-expanded={!shopMin}
              onClick={() => setShopMin((v) => !v)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <h2>The Shop</h2>
            <span className="wl-adm-ws-meta">in shop · {shop.length}</span>
            <span style={{ flex: 1 }} />
            {shopHot && <span className="wl-adm-ws-saved">drop to sell ↓</span>}
            {shopBad && <span className="wl-adm-ws-blocked-note">needs a print file ✕</span>}
            {!shopMin && dropTarget !== 'shop' && (
              <span className="wl-adm-ws-note">
                {blockedCount > 0
                  ? `${shop.length - blockedCount} buyable, ${blockedCount} hidden`
                  : 'Exactly what customers can buy'}
              </span>
            )}
          </div>
          {!shopMin &&
            (shop.length === 0 ? (
              <div className="wl-adm-ws-empty">Drag photos with a print file here to put them up for sale.</div>
            ) : (
              <div className="wl-adm-ws-grid">
                {shop.map((p) => (
                  <figure key={p.id} className="wl-adm-ws-tile">
                    {!p.buyable && (
                      <div className="wl-adm-ws-badges">
                        <span className="wl-adm-ws-badge blocked">hidden · no sizes available</span>
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
          <h2 id="wl-library-heading" tabIndex={-1}>
            Library
          </h2>
          <span className="wl-adm-ws-meta">
            {libList.length === counts.all
              ? `every photo · ${counts.all}`
              : `showing ${libList.length} of ${counts.all}`}
          </span>
          <span className="wl-adm-ws-note">Removing from a shelf keeps the photo here. ✕ deletes it forever.</span>
          <span style={{ flex: 1 }} />
          <input
            className="wl-adm-ws-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search photos…"
            aria-label="Search the Library by title"
          />
          <div className="wl-adm-seg">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                className={filter === f.key ? 'on' : ''}
                onClick={() => setFilter(f.key)}
              >
                {f.label} <span className="sub">{counts[f.key]}</span>
              </button>
            ))}
          </div>
        </div>
        {libList.length === 0 ? (
          <div className="wl-adm-ws-empty">
            {counts.all === 0
              ? 'No photos yet.'
              : query.trim()
                ? `No photos match "${query.trim()}".`
                : 'No photos match this filter.'}
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
                        <span className="wl-adm-ws-badge hd">hd</span>
                      ) : (
                        <span className="wl-adm-ws-badge web">web only</span>
                      )}
                      {p.status === 'retired' && <span className="wl-adm-ws-badge web">retired</span>}
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
                    <span className="name" title={p.title}>
                      {p.title}
                    </span>
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
                    {/* aria-disabled, not disabled: a disabled button suppresses
                        its tooltip and drops out of the tab order, so the reason
                        it can't be sold became unreachable. Keep it focusable
                        and explain on click. */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={inShop}
                      aria-disabled={!p.hd || inFlight}
                      className={`wl-adm-ws-pill ${inShop ? 'on-shop' : ''} ${!p.hd ? 'nohd' : ''}`}
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
