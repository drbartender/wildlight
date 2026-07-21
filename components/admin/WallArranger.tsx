'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AdminTopBar } from './AdminTopBar';
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
  const [libMin, setLibMin] = useState(false);
  const [editPos, setEditPos] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const lastClickedRef = useRef<number | null>(null);
  const [bandH, setBandH] = useState<number | null>(null);
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null);
  const bandIntentRef = useRef<number | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const inFlight = busy || savingOrder;

  // Persisted band height (the resize handle). Read post-mount so SSR renders
  // the CSS default and there's no hydration mismatch.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem('wl-wall-bandh');
      if (v) {
        bandIntentRef.current = Number(v);
        setBandH(clampBand(Number(v)));
      }
      // Which panes were minimized last time. Persisted like the band height —
      // otherwise every same-tab "Edit ↗" round trip silently reopened all three.
      const m = window.localStorage.getItem('wl-wall-min');
      if (m) {
        const s = JSON.parse(m) as { wall?: boolean; shop?: boolean; lib?: boolean };
        setWallMin(!!s.wall);
        setShopMin(!!s.shop);
        setLibMin(!!s.lib);
      }
    } catch {
      /* ignore */
    }
  }, []);
  // MEASURE the real container instead of guessing the chrome. `.wl-adm-wall`
  // is flex:1 under the top bar AND the chip tray, so its clientHeight already
  // accounts for both — a chip appearing shrinks it and the band re-clamps.
  // (A hardcoded reserve was ~41px short even before the tray existed, and the
  // tray's ~37px pushed a maxed band into clipping the Library unreachably.)
  function clampBand(h: number): number {
    const HANDLE = 12; // resize handle
    const LIB_FLOOR = 220; // .wl-adm-ws-library min-height
    const wall = document.querySelector<HTMLElement>('.wl-adm-wall.ws-fixed');
    let max = window.innerHeight - 380; // fallback before mount
    if (wall) {
      const cs = getComputedStyle(wall);
      const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const gap = parseFloat(cs.rowGap) || 14;
      const errH = wall.querySelector('.wl-adm-wall-err')?.getBoundingClientRect().height ?? 0;
      // Column children: [error?] + band + handle + library.
      max = wall.clientHeight - pad - errH - HANDLE - LIB_FLOOR - gap * (errH ? 3 : 2);
    }
    return Math.round(Math.max(120, Math.min(Math.max(160, max), h)));
  }
  // Re-clamp a customised band height whenever the space available changes:
  // the window resizing, OR a pane minimizing/restoring (the tray mounting
  // steals height from the Library, making a previously-legal band illegal).
  // Always re-clamp the user's INTENDED height, not the currently-clamped one —
  // otherwise minimizing ratchets the band down and restoring never gives the
  // height back (the clamp is lossy in one direction).
  function reclamp() {
    setBandH((h) => {
      const intent = bandIntentRef.current ?? h;
      return intent == null ? null : clampBand(intent);
    });
  }
  useEffect(() => {
    reclamp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallMin, shopMin, libMin]);
  useEffect(() => {
    window.addEventListener('resize', reclamp);
    return () => window.removeEventListener('resize', reclamp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function onResizeDown(e: React.PointerEvent) {
    const band = document.querySelector<HTMLElement>('.wl-adm-ws-shelves');
    if (!band) return;
    resizeRef.current = { startY: e.clientY, startH: band.getBoundingClientRect().height };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onResizeMove(e: React.PointerEvent) {
    const s = resizeRef.current;
    if (!s) return;
    const h = clampBand(s.startH + (e.clientY - s.startY));
    bandIntentRef.current = h;
    setBandH(h);
  }
  function onResizeUp(e: React.PointerEvent) {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    // Persist the INTENDED height, not the measured one: the band is
    // content-sized under its max-height, so a short/minimized shelf renders
    // smaller than the preference and measuring would ratchet it down.
    const v = bandIntentRef.current;
    if (v == null) return;
    try {
      window.localStorage.setItem('wl-wall-bandh', String(v));
    } catch {
      /* ignore */
    }
  }
  function onResizeKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const band = document.querySelector<HTMLElement>('.wl-adm-ws-shelves');
    const cur = bandH ?? (band ? band.getBoundingClientRect().height : 260);
    const h = clampBand(cur + (e.key === 'ArrowDown' ? 24 : -24));
    bandIntentRef.current = h;
    setBandH(h);
    try {
      window.localStorage.setItem('wl-wall-bandh', String(h));
    } catch {
      /* ignore */
    }
  }

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
    focusLibraryFallback();
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

  // ── Selection (bulk) ─────────────────────────────────────────────────
  function toggleSelect(id: number, shift: boolean) {
    // Capture the anchor BEFORE overwriting the ref: the setSelected updater
    // runs later (during render), so reading lastClickedRef inside it would see
    // this very id and collapse the range to one tile.
    const anchor = lastClickedRef.current;
    lastClickedRef.current = id;
    setSelected((prev) => {
      const next = new Set(prev);
      const ids = libList.map((p) => p.id);
      const a = anchor == null ? -1 : ids.indexOf(anchor);
      const b = ids.indexOf(id);
      if (shift && a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (let i = lo; i <= hi; i++) next.add(ids[i]); // range select adds
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }
  function selectAllShown() {
    setSelected(new Set(libList.map((p) => p.id)));
  }
  function clearSelection() {
    setSelected(new Set());
    lastClickedRef.current = null;
  }

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

  // ── Bulk apply to the current selection ──────────────────────────────
  // Reuses the same gated PATCH the single-photo paths use, one photo at a
  // time (keeps the single-inFlight invariant + avoids a burst of concurrent
  // writes to the same rows). Skips no-ops (already placed) and, for shop-add,
  // non-hd photos; the wall order is re-persisted once at the end if membership
  // changed. Shop-add is the money path: one batch confirm, not N.
  type BulkAction = 'wallOn' | 'wallOff' | 'shopOn' | 'shopOff';
  async function bulkApply(action: BulkAction) {
    if (inFlight || selected.size === 0) return;
    const chosen = [...selected].map((id) => byId.get(id)).filter((p): p is LibraryPhoto => !!p);
    const targets = chosen.filter((p) =>
      action === 'wallOn' ? !p.on_wall
      : action === 'wallOff' ? p.on_wall
      : action === 'shopOn' ? p.hd && !isInShop(p)
      : isInShop(p),
    );
    const skippedNoHd = action === 'shopOn' ? chosen.filter((p) => !p.hd && !isInShop(p)).length : 0;
    if (targets.length === 0) {
      fail(
        action === 'shopOn' && skippedNoHd > 0
          ? `None of those can be sold yet — ${skippedNoHd} need a print file.`
          : 'Nothing to change for that action in the current selection.',
      );
      return;
    }
    const n = targets.length;
    const plural = n === 1 ? '' : 's';
    // Confirm the money action (publish) and the two bulk removals (a mis-click
    // on a big selection is worth a gate); bulk add-to-wall is additive and
    // reversible, so it stays confirm-free like the single-photo path.
    if (
      (action === 'shopOn' &&
        // eslint-disable-next-line no-alert
        !window.confirm(`Put ${n} photo${plural} up for sale in the shop?`)) ||
      (action === 'wallOff' &&
        // eslint-disable-next-line no-alert
        !window.confirm(`Take ${n} photo${plural} off the wall?`)) ||
      (action === 'shopOff' &&
        // eslint-disable-next-line no-alert
        !window.confirm(`Stop selling ${n} photo${plural}?`))
    ) {
      return;
    }
    setBusy(true);
    setActionErr(null);
    const touchesWall = action === 'wallOn' || action === 'wallOff';
    let done = 0;
    const failedTitles: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      const p = targets[i];
      setBulkProgress({ done: i, total: targets.length });
      const body =
        action === 'wallOn' ? { on_wall: true }
        : action === 'wallOff' ? { on_wall: false }
        : action === 'shopOn' ? { status: 'published' as const }
        : { status: 'retired' as const };
      const res = await patchArtwork(p.id, body);
      if (res.timedOut) {
        setBulkProgress(null);
        return reconcileAfterTimeout();
      }
      if (res.ok) {
        done++;
        if (action === 'wallOn') {
          setPhoto(p.id, { on_wall: true });
          setWall((cur) => (cur.includes(p.id) ? cur : [...cur, p.id]));
        } else if (action === 'wallOff') {
          setPhoto(p.id, { on_wall: false });
          setWall((cur) => cur.filter((x) => x !== p.id));
          savedWallIds.current = savedWallIds.current.filter((x) => x !== p.id);
        } else {
          setPhoto(p.id, { status: action === 'shopOn' ? 'published' : 'retired' });
        }
      } else if (res.status === 404) {
        dropStale(p.id, p.title);
      } else {
        failedTitles.push(p.title);
      }
    }
    // Rewrite 1..N once so the admin order matches the public wall.
    let orderFailed = false;
    if (touchesWall) {
      const ord = await persistOrder(wallIdsRef.current);
      if (ord.timedOut) {
        setBulkProgress(null);
        return reconcileAfterTimeout();
      }
      if (!ord.ok) {
        // The memberships persisted; only the order POST failed. Keep the saved
        // snapshot in lockstep with reality (else a later failed reorder rolls
        // back to a baseline missing these ids and silently drops them from the
        // shelf) and warn — mirrors the single-photo placeOnWall guard.
        savedWallIds.current = wallIdsRef.current.slice();
        orderFailed = true;
      }
    }
    setBulkProgress(null);
    setBusy(false);
    // Keep the selection if anything failed, so the user can retry (targets
    // re-filters to just the still-unchanged ones); clear on a clean run.
    if (!failedTitles.length) clearSelection();
    const parts: string[] = [`${done} updated`];
    if (skippedNoHd) parts.push(`${skippedNoHd} skipped (no print file)`);
    if (failedTitles.length) parts.push(`${failedTitles.length} failed`);
    announce(parts.join(', '));
    if (failedTitles.length) {
      fail(`Couldn't update ${failedTitles.length} photo${failedTitles.length === 1 ? '' : 's'}. Reload to see the current state.`);
    } else if (orderFailed) {
      fail("Photos added to the wall, but the new order couldn't be saved. Reload to see the current order.");
    } else if (skippedNoHd) {
      setActionErr(`${done} added to the shop. ${skippedNoHd} skipped — they need a print file first.`);
    }
    // The bulk bar unmounts when the selection clears; move focus somewhere sane.
    requestAnimationFrame(() => focusLibraryFallback());
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
  // Put focus back on the moved tile's position badge (it re-renders at the new
  // slot) so a keyboard user keeps their place across moves.
  function focusPos(id: number) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[data-pos-id="${id}"]`);
        if (el) el.focus({ preventScroll: true });
        else focusLibraryFallback();
      }),
    );
  }
  async function moveToPosition(id: number, pos1: number) {
    if (inFlight) return;
    const cur = wallIdsRef.current;
    const from = cur.indexOf(id);
    setEditPos(null);
    // Empty field → Number('') === 0; reject anything not a whole position >= 1
    // so a stray Enter can't jump the photo to the front.
    if (from === -1 || !Number.isInteger(pos1) || pos1 < 1) return focusPos(id);
    const to = Math.max(0, Math.min(cur.length - 1, pos1 - 1));
    if (to === from) return focusPos(id);
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
    focusPos(id);
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

  // ── Panes: minimize to a chip, restore from it ───────────────────────
  const bandShown = !wallMin || !shopMin;
  const anyMin = wallMin || shopMin || libMin;
  const setMin: Record<'wall' | 'shop' | 'lib', (v: boolean) => void> = {
    wall: setWallMin,
    shop: setShopMin,
    lib: setLibMin,
  };
  const headId = { wall: 'wl-wall-heading', shop: 'wl-shop-heading', lib: 'wl-library-heading' };
  // Focus moves post-commit: the chip mounts / the pane unmounts in the SAME
  // render as the click, so focus the target after it exists. On minimize →
  // the pane's chip; on restore → the pane's heading (never the chevron that
  // would just re-hide it).
  function setPaneMin(pane: 'wall' | 'shop' | 'lib', v: boolean) {
    const next = { wall: wallMin, shop: shopMin, lib: libMin, [pane]: v };
    setMin[pane](v);
    try {
      window.localStorage.setItem('wl-wall-min', JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
  function minimizePane(pane: 'wall' | 'shop' | 'lib') {
    setPaneMin(pane, true);
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`[data-chip="${pane}"]`)?.focus({ preventScroll: true }),
      ),
    );
  }
  function restorePane(pane: 'wall' | 'shop' | 'lib') {
    setPaneMin(pane, false);
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document.getElementById(headId[pane])?.focus({ preventScroll: true }),
      ),
    );
  }
  // `#wl-library-heading` is the focus fallback for reorder/remove/bulk, but it
  // unmounts when the Library is minimized — fall back to the Library chip.
  function focusLibraryFallback() {
    (document.getElementById('wl-library-heading') ??
      document.querySelector<HTMLElement>('[data-chip="lib"]'))?.focus({ preventScroll: true });
  }

  return (
    <>
      <AdminTopBar
        title="Wall & shop"
        subtitle={`${wall.length} on the wall · ${shop.length} in the shop`}
        actions={
          <>
            {/* Fixed-width status so the buttons don't slide on every mutation. */}
            <span className="wl-adm-ws-saving" role="status">
              {inFlight ? 'saving…' : ''}
            </span>
            <Link href="/admin/collections" className="wl-adm-btn small">
              Collections
            </Link>
            <Link
              href="/admin/artworks/bulk-upload"
              className="wl-adm-btn small"
            >
              Add photos
            </Link>
          </>
        }
      />

      {anyMin && (
        <div className="wl-adm-ws-tray" role="group" aria-label="Minimized panes">
          {wallMin && <PaneChip pane="wall" label="The Wall" count={wall.length} onRestore={restorePane} />}
          {shopMin && <PaneChip pane="shop" label="The Shop" count={shop.length} onRestore={restorePane} />}
          {libMin && (
            <PaneChip
              pane="lib"
              label="Library"
              count={counts.all}
              note={selected.size ? `${selected.size} selected` : undefined}
              onRestore={restorePane}
            />
          )}
        </div>
      )}

      <div className="wl-adm-wall ws-fixed">
        {actionErr && (
        <p className="wl-adm-wall-err" role="alert">
          {actionErr}
        </p>
      )}

      {bandShown && (
      <div
        className="wl-adm-ws-shelves"
        data-lib-min={libMin}
        style={{ ['--wl-band-h' as string]: bandH != null ? `${bandH}px` : undefined } as React.CSSProperties}
      >
        {/* THE WALL */}
        {!wallMin && (
        <section
          className={`wl-adm-ws-shelf wall ${dropTarget === 'wall' ? 'hot-ok' : ''}`}
          aria-label="The Wall"
          onDragOver={overShelf('wall')}
          onDragLeave={leaveShelf}
          onDrop={dropOnWall}
        >
          <div className={`wl-adm-ws-head ${wallMin ? '' : 'open'}`}>
            <button
              type="button"
              className="wl-adm-ws-min"
              aria-label="Minimize the Wall"
              title="Minimize the Wall"
              aria-expanded
              onClick={() => minimizePane('wall')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <h2 id="wl-wall-heading" tabIndex={-1}>The Wall</h2>
            <span className="wl-adm-ws-meta">homepage gallery · {wall.length}</span>
            <span style={{ flex: 1 }} />
            {savedFlash && <span className="wl-adm-ws-saved">order saved ✓</span>}
            {dropTarget === 'wall' && <span className="wl-adm-ws-saved">drop to add ↓</span>}
            {!wallMin && <span className="wl-adm-ws-note">Click a photo&apos;s number to move it. Drag to nudge.</span>}
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
                    draggable={!inFlight && editPos !== p.id}
                    onDragStart={(e) => {
                      if (inFlight || editPos === p.id) return;
                      setEditPos(null); // close any open position editor on another tile
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
                      <span className="wl-adm-ws-posedit">
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
                          onBlur={() => setEditPos((cur) => (cur === p.id ? null : cur))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void moveToPosition(p.id, Number((e.target as HTMLInputElement).value));
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              setEditPos(null);
                              focusPos(p.id);
                            }
                          }}
                        />
                        <span className="wl-adm-ws-poshint">of {wall.length} · Enter</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="wl-adm-ws-pos"
                        data-pos-id={p.id}
                        aria-label={`${p.title} is at position ${i + 1} of ${wall.length}. Activate to move it.`}
                        title="Click to move this photo to a position"
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
        )}

        {/* THE SHOP */}
        {!shopMin && (
        <section
          className={`wl-adm-ws-shelf shop ${shopHot ? 'hot-ok' : ''} ${shopBad ? 'hot-bad' : ''}`}
          aria-label="The Shop"
          onDragOver={overShelf('shop')}
          onDragLeave={leaveShelf}
          onDrop={dropOnShop}
        >
          <div className={`wl-adm-ws-head ${shopMin ? '' : 'open'}`}>
            <button
              type="button"
              className="wl-adm-ws-min"
              aria-label="Minimize the Shop"
              title="Minimize the Shop"
              aria-expanded
              onClick={() => minimizePane('shop')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <h2 id="wl-shop-heading" tabIndex={-1}>The Shop</h2>
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
                  <figure key={p.id} className="wl-adm-ws-tile" title={p.title}>
                    {!p.buyable && (
                      <div className="wl-adm-ws-badges">
                        <span className="wl-adm-ws-badge blocked">hidden · no sizes available</span>
                      </div>
                    )}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.image_web_url} alt={p.title} draggable={false} />
                    <figcaption className="wl-adm-ws-cap">
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
        )}
      </div>
      )}

      {bandShown && !libMin && (
      <div
        className="wl-adm-ws-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the shelves — drag, or use the up and down arrow keys"
        aria-valuenow={bandH != null ? Math.round(bandH) : undefined}
        aria-valuemin={120}
        tabIndex={0}
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        onKeyDown={onResizeKey}
      >
        <span className="grip" aria-hidden="true" />
      </div>
      )}

      {/* LIBRARY */}
      {!libMin && (
      <section className="wl-adm-ws-library" aria-label="Library">
        <div className="wl-adm-ws-head open" style={{ flexWrap: 'wrap' }}>
          <button
            type="button"
            className="wl-adm-ws-min"
            aria-label="Minimize the Library"
            title="Minimize the Library"
            aria-expanded
            onClick={() => minimizePane('lib')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </button>
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
        {selected.size > 0 && (
          <div className="wl-adm-ws-bulkbar" role="region" aria-label="Bulk actions">
            <span className="count">
              {bulkProgress
                ? `Working… ${bulkProgress.done} of ${bulkProgress.total}`
                : (() => {
                    const hidden = selected.size - libList.filter((p) => selected.has(p.id)).length;
                    return `${selected.size} selected${hidden > 0 ? ` · ${hidden} hidden by filter` : ''}`;
                  })()}
            </span>
            <button type="button" disabled={inFlight} onClick={() => void bulkApply('wallOn')}>Add to Wall</button>
            <button type="button" disabled={inFlight} onClick={() => void bulkApply('shopOn')}>Add to Shop</button>
            <button type="button" disabled={inFlight} onClick={() => void bulkApply('wallOff')}>Take off Wall</button>
            <button type="button" disabled={inFlight} onClick={() => void bulkApply('shopOff')}>Remove from Shop</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="ghost" disabled={inFlight} onClick={selectAllShown}>Select all {libList.length}</button>
            <button type="button" className="ghost" disabled={inFlight} onClick={clearSelection}>Clear</button>
          </div>
        )}
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
                <div key={p.id} className={`wl-adm-ws-libitem ${drag?.id === p.id && drag.from === 'lib' ? 'dragging' : ''} ${selected.has(p.id) ? 'selected' : ''}`}>
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
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={selected.has(p.id)}
                      aria-label={`Select ${p.title}`}
                      className={`wl-adm-ws-check ${selected.has(p.id) ? 'on' : ''}`}
                      disabled={inFlight}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(p.id, e.shiftKey);
                      }}
                    >
                      {selected.has(p.id) ? '✓' : ''}
                    </button>
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
      )}

      {!bandShown && libMin && (
        <div className="wl-adm-ws-void">All panes minimized — pick a chip above.</div>
      )}

      <div ref={liveRef} aria-live="polite" className="wl-adm-sr-only" />
      </div>
    </>
  );
}

// A minimized pane, shown as a restore chip in the top tray. Module scope.
function PaneChip({
  pane,
  label,
  count,
  note,
  onRestore,
}: {
  pane: 'wall' | 'shop' | 'lib';
  label: string;
  count: number;
  note?: string;
  onRestore: (pane: 'wall' | 'shop' | 'lib') => void;
}) {
  return (
    <button
      type="button"
      className="wl-adm-ws-chip"
      data-chip={pane}
      aria-label={`Restore ${label}${note ? `, ${note}` : ''}`}
      aria-expanded={false}
      onClick={() => onRestore(pane)}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      <span className="name">{label}</span>
      <span className="count">{count}</span>
      {note && <span className="count note">{note}</span>}
    </button>
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
