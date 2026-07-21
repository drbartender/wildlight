'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { orderChanged, reorder, type LibraryPhoto } from '@/lib/wall-arrange';
import {
  belowCutIds,
  cutLineAfter,
  deriveShopIds,
  isArrangeable,
  parseScopeKey,
  scopeKey,
  shopScopeCounts,
  type ShopScope,
} from '@/lib/shop-arrange';
import { isTimeout, mutationTimeout } from '@/lib/admin-fetch';
import { ShopLimitField } from './ShopLimitField';
import { EditLink, RemoveButton } from './TileActions';

// The Shop shelf, extracted from WallArranger.
//
// Extracted BEFORE the ordering feature was built on it, deliberately. The Wall
// and the Shop are two near-identical arrangeable shelves, and the first draft
// of the plan had the Shop reusing the Wall's [data-pos-id] focus selector, its
// in-flight flag, its saved-flash and its saved-order snapshot ref. Every one of
// those was a bug: a photo on both shelves matched two focus targets, a Shop
// save disabled the Wall, and a Shop save flashed "order saved" in the Wall's
// head. A file boundary makes the sharing deliberate instead of accidental.
//
// The shelf owns its scope and its order. Every piece of that state has a Wall
// counterpart it must NOT share, listed above.

export interface ShopShelfProps {
  photos: LibraryPhoto[];
  /** Every chapter, including ones with nothing in the shop. */
  collections: { id: number; title: string }[];
  /** Seed for the /shop cap. Unused until the limit control lands. */
  initialLimit: number;
  /**
   * Parent-level mutations in flight (Library, Wall). Deliberately does NOT
   * include this shelf's own saving flag, or reporting busy upward would feed
   * straight back in as parentInFlight.
   */
  parentInFlight: boolean;
  /** Report this shelf's own in-flight state so the parent can gate its panes. */
  onBusyChange: (busy: boolean) => void;
  /** Parent-owned polite live region. */
  announce: (msg: string) => void;
  /** Parent-owned error line (role="alert"). */
  fail: (msg: string) => void;
  /** A timed-out mutation MAY have committed; the parent reconciles by reload. */
  onTimeout: () => void;
  minimized: boolean;
  onMinimize: () => void;
  /** Library drag state, for the drop-to-sell affordance. */
  dropTarget: 'wall' | 'shop' | null;
  dragHd: boolean | undefined;
  onShelfDragOver: (e: React.DragEvent) => void;
  onShelfDragLeave: (e: React.DragEvent) => void;
  onShelfDrop: (e: React.DragEvent) => void;
  /** Two-step remove confirm. Parent-owned, because Escape clears it globally. */
  confirmingId: number | null;
  onArmRemove: (id: number) => void;
  onRemoveFromShop: (id: number) => void;
  /**
   * Write saved positions back into the parent's `photos`. Declared now and
   * consumed once this shelf can reorder: without it, any later setPhoto in the
   * parent re-derives the shelf from stale positions and visibly snaps it back
   * to the pre-drag order.
   */
  onPositionsSaved: (
    updates: { id: number; display_order?: number; collection_order?: number }[],
  ) => void;
}

export function ShopShelf({
  photos,
  collections,
  initialLimit,
  parentInFlight,
  onBusyChange,
  announce,
  fail,
  onTimeout,
  onPositionsSaved,
  minimized,
  onMinimize,
  dropTarget,
  dragHd,
  onShelfDragOver,
  onShelfDragLeave,
  onShelfDrop,
  confirmingId,
  onArmRemove,
  onRemoveFromShop,
}: ShopShelfProps) {
  const [shopScope, setShopScope] = useState<ShopScope>({ kind: 'all' });

  // Read post-mount, exactly as WallArranger reads wl-wall-min, so SSR renders
  // All and there is no hydration mismatch. Reading during render would flash
  // the All view before switching.
  useEffect(() => {
    try {
      const s = window.localStorage.getItem('wl-shop-scope');
      if (!s) return;
      const parsed = parseScopeKey(s);
      // A persisted scope naming a since-deleted chapter falls back to All,
      // rather than rendering an empty shelf with no matching chip.
      if (parsed.kind !== 'collection' || collections.some((c) => c.id === parsed.id)) {
        setShopScope(parsed);
      }
    } catch {
      /* ignore */
    }
  }, [collections]);

  function selectShopScope(next: ShopScope) {
    setShopScope(next);
    try {
      window.localStorage.setItem('wl-shop-scope', scopeKey(next));
    } catch {
      /* ignore */
    }
  }

  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  // Counts come from client `photos` state, never a server query, or they go
  // stale the instant placeInShop / removeFromShop / bulkApply runs.
  const counts = useMemo(() => shopScopeCounts(photos), [photos]);
  const shopIds = useMemo(() => deriveShopIds(photos, shopScope), [photos, shopScope]);
  // ── Order state. Every one of these has a Wall counterpart it must not share.
  const [savingShop, setSavingShop] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [shopOrder, setShopOrder] = useState<number[]>(shopIds);
  const shopOrderRef = useRef<number[]>(shopIds);
  const savedShopIds = useRef<number[]>(shopIds);
  const [editPos, setEditPos] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const inFlight = parentInFlight || savingShop;
  const arrangeable = isArrangeable(shopScope);

  useEffect(() => onBusyChange(savingShop), [savingShop, onBusyChange]);

  // Re-seed whenever the derived list changes: a scope switch, or a mutation
  // that changes membership. The parent's onPositionsSaved writeback is what
  // makes this safe. Without it, this effect re-derives from stale positions
  // after any later setPhoto and visibly snaps the shelf back to the pre-drag
  // order.
  useEffect(() => {
    shopOrderRef.current = shopIds;
    setShopOrder(shopIds);
    savedShopIds.current = shopIds;
  }, [shopIds]);

  const shop = useMemo(
    () => shopOrder.map((id) => byId.get(id)).filter((p): p is LibraryPhoto => !!p),
    [shopOrder, byId],
  );
  const blockedCount = useMemo(() => shop.filter((p) => !p.buyable).length, [shop]);
  const buyableCount = useMemo(() => shop.filter((p) => p.buyable).length, [shop]);

  const [shopLimit, setShopLimit] = useState(initialLimit);
  // All view only: the cut governs /shop, and a chapter view has no cut.
  const cutAfter = useMemo(
    () => (shopScope.kind === 'all' ? cutLineAfter(shop, shopLimit) : null),
    [shopScope, shop, shopLimit],
  );
  // Readable from ANY scope, always computed from the full All order, because
  // the cut is a property of /shop and a filtered view is not that sequence.
  // Used by Unfiled to flag a piece reachable from nowhere but the sitemap.
  const belowCut = useMemo(() => belowCutIds(photos, shopLimit), [photos, shopLimit]);

  // ALWAYS write the order through this: the ref is what commitShopOrder reads,
  // and reading React state out of the render closure could POST an order the
  // admin never saw (the Wall learned this the hard way).
  function setShopIds(next: number[] | ((cur: number[]) => number[])) {
    const v = typeof next === 'function' ? next(shopOrderRef.current) : next;
    shopOrderRef.current = v;
    setShopOrder(v);
  }

  async function commitShopOrder() {
    if (inFlight || !arrangeable) return;
    const attempt = shopOrderRef.current.slice();
    if (!orderChanged(attempt, savedShopIds.current)) return;
    // Tag the request with the scope it was built against. If the admin switches
    // filters mid-flight, rolling back into the NEW scope would be nonsense.
    const sentScope = shopScope;
    setSavingShop(true);
    let res: { ok: boolean; status: number; timedOut?: boolean };
    try {
      const r = await fetch('/api/admin/shop/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          sentScope.kind === 'collection'
            ? { scope: 'collection', collectionId: sentScope.id, ids: attempt }
            : { scope: 'all', ids: attempt },
        ),
        signal: mutationTimeout(),
      });
      res = { ok: r.ok, status: r.status };
    } catch (err) {
      res = { ok: false, status: 0, timedOut: isTimeout(err) };
    }
    setSavingShop(false);

    if (res.timedOut) return onTimeout();
    if (scopeKey(sentScope) !== scopeKey(shopScope)) {
      if (!res.ok) fail("Couldn't save the previous filter's order. Reload to see the saved order.");
      return;
    }
    if (res.status === 409) {
      // The server rolled back, so nothing was written. The pending arrangement
      // is genuinely lost, and that is correct: it was built against a
      // membership that no longer exists.
      setShopIds(savedShopIds.current.slice());
      fail('The shop changed in another window. Reloading to show the saved state.');
      window.setTimeout(() => window.location.reload(), 1200);
      return;
    }
    if (!res.ok) {
      setShopIds(savedShopIds.current.slice());
      fail("Couldn't save the new shop order. Please try again.");
      return;
    }
    savedShopIds.current = attempt;
    // Fold the saved positions back into the parent's photos, or the next
    // membership change re-derives from stale values and snaps the shelf back.
    onPositionsSaved(
      attempt.map((id, i) =>
        sentScope.kind === 'collection'
          ? { id, collection_order: i + 1 }
          : { id, display_order: i + 1 },
      ),
    );
    setSavedFlash(true);
    announce(sentScope.kind === 'collection' ? 'Chapter order saved' : 'Shop order saved');
    window.setTimeout(() => setSavedFlash(false), 2200);
  }

  // Its OWN attribute, not the Wall's [data-pos-id]: a photo that is both on the
  // wall and in the shop would match two elements and focus the wrong tile.
  function focusPos(id: number) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(`[data-shop-pos-id="${id}"]`)
          ?.focus({ preventScroll: true });
      }),
    );
  }

  async function moveToPosition(id: number, pos1: number) {
    if (inFlight) return;
    const cur = shopOrderRef.current;
    const from = cur.indexOf(id);
    setEditPos(null);
    // Empty field gives Number('') === 0; reject anything not a whole position
    // >= 1 so a stray Enter cannot jump the photo to the front.
    if (from === -1 || !Number.isInteger(pos1) || pos1 < 1) return focusPos(id);
    const to = Math.max(0, Math.min(cur.length - 1, pos1 - 1));
    if (to === from) return focusPos(id);
    const next = cur.slice();
    next.splice(from, 1);
    next.splice(to, 0, id);
    setShopIds(next);
    // Announce the move itself, not just the save: the badge exists to give the
    // keyboard path a way to reorder, and without this that path is silent.
    announce(`Moved to position ${to + 1} of ${next.length}`);
    await commitShopOrder();
    focusPos(id);
  }

  // The pre-extraction markup also tested `!!drag`, which is not a prop here.
  // Dropping it is safe but not unconditionally redundant, so: the parent
  // derives `dragHd` as `drag ? byId.get(drag.id)?.hd : undefined`, and `hd` is
  // a non-null boolean from SQL, so `dragHd` is undefined exactly when there is
  // no drag. That makes shopHot exactly equivalent.
  //
  // shopBad differs in ONE case: drag live but the dragged row missing from
  // `byId` (undefined hd). The old code showed "needs a print file"; this shows
  // nothing, which is the better answer for an unknown. Unreachable anyway,
  // because `photos` only shrinks inside a mutation and library tiles are not
  // draggable while one is in flight.
  const shopHot = dropTarget === 'shop' && !!dragHd;
  const shopBad = dropTarget === 'shop' && dragHd === false;

  function renderTile(p: LibraryPhoto, i: number) {
    return (
      <figure
        key={p.id}
        // below-cut is what dims everything the storefront will not show. The
        // class has styling but no meaning unless it is applied HERE.
        className={`wl-adm-ws-tile ${arrangeable ? 'grab' : ''} ${
          drag === p.id ? 'dragging' : ''
        } ${belowCut.has(p.id) ? 'below-cut' : ''}`}
        title={p.title}
        draggable={arrangeable && !inFlight && editPos !== p.id}
        onDragStart={(e) => {
          if (!arrangeable || inFlight || editPos === p.id) return;
          setEditPos(null);
          e.dataTransfer.setData('text/plain', String(p.id));
          e.dataTransfer.effectAllowed = 'move';
          setDrag(p.id);
        }}
        onDragEnter={() => {
          if (drag == null) return;
          setShopIds((ids) => reorder(ids, drag, p.id));
        }}
        onDragOver={(e) => e.preventDefault()}
        // Commit on dragEnd, NEVER drop. Chromium does not deliver a drop event
        // when the drag source node was moved mid-drag, which a live reorder
        // always does.
        onDragEnd={() => {
          setDrag(null);
          void commitShopOrder();
        }}
        // preventDefault only, no stopPropagation, matching the Wall. The
        // section's onDrop ignores anything not dragged from the Library, so it
        // is inert for an intra-shelf drop. Do not relax that guard.
        onDrop={(e) => e.preventDefault()}
      >
        {arrangeable &&
          (editPos === p.id ? (
            <span className="wl-adm-ws-posedit">
              <input
                className="wl-adm-ws-posinput"
                type="number"
                min={1}
                max={shop.length}
                defaultValue={i + 1}
                autoFocus
                draggable={false}
                aria-label={`Move ${p.title} to position (1 to ${shop.length})`}
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
              <span className="wl-adm-ws-poshint">of {shop.length} · Enter</span>
            </span>
          ) : (
            // Not garnish: this shelf sits in a height-capped band, and
            // dragEnter can never fire on a tile clipped out of view, so
            // without this a photo cannot move more than about a row and there
            // is no keyboard path at all.
            <button
              type="button"
              className="wl-adm-ws-pos"
              data-shop-pos-id={p.id}
              aria-label={`${p.title} is at position ${i + 1} of ${shop.length}. Activate to move it.`}
              title="Click to move this photo to a position"
              disabled={inFlight}
              onClick={(e) => {
                e.stopPropagation();
                setEditPos(p.id);
              }}
            >
              {i + 1}
            </button>
          ))}
        <div className="wl-adm-ws-badges">
          {!p.buyable && (
            <span className="wl-adm-ws-badge blocked">hidden · no sizes available</span>
          )}
          {/* Read-only chapter label, All view only. Assignment stays on the
              Edit page; this is so the chapter mix is visible while arranging
              the front page without flipping filters. */}
          {shopScope.kind === 'all' && (
            <span className="wl-adm-ws-badge chapter">{p.collection_title ?? 'unfiled'}</span>
          )}
          {/* Unfiled AND below the cut means reachable from nowhere on the site
              except the sitemap. Uses belowCut, not cutAfter: cutAfter is null
              by construction outside the All view, and a filtered view's index
              is not the All position. */}
          {shopScope.kind === 'unfiled' && belowCut.has(p.id) && (
            <span className="wl-adm-ws-badge blocked">unreachable</span>
          )}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.image_web_url} alt={p.title} draggable={false} />
        <figcaption className="wl-adm-ws-cap">
          <EditLink id={p.id} title={p.title} />
          <RemoveButton
            confirming={confirmingId === p.id}
            disabled={inFlight}
            label={`Remove ${p.title} from the shop`}
            onClick={() =>
              confirmingId === p.id ? onRemoveFromShop(p.id) : onArmRemove(p.id)
            }
          />
        </figcaption>
      </figure>
    );
  }

  if (minimized) return null;

  return (
    <section
      className={`wl-adm-ws-shelf shop ${shopHot ? 'hot-ok' : ''} ${shopBad ? 'hot-bad' : ''}`}
      aria-label="The Shop"
      onDragOver={onShelfDragOver}
      onDragLeave={onShelfDragLeave}
      onDrop={onShelfDrop}
    >
      <div className="wl-adm-ws-head open">
        <button
          type="button"
          className="wl-adm-ws-min"
          aria-label="Minimize the Shop"
          title="Minimize the Shop"
          aria-expanded
          onClick={onMinimize}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <h2 id="wl-shop-heading" tabIndex={-1}>The Shop</h2>
        <span className="wl-adm-ws-meta">in shop · {shop.length}</span>
        <span style={{ flex: 1 }} />
        {shopHot && <span className="wl-adm-ws-saved">drop to sell ↓</span>}
        {shopBad && <span className="wl-adm-ws-blocked-note">needs a print file ✕</span>}
        {/* The public pages are revalidate = 60 and there is no revalidatePath
            anywhere in this repo, so a saved change takes up to a minute to
            appear. Say so, or the delay reads as "the save did not work" and
            invites a second save. */}
        {savedFlash && (
          <span className="wl-adm-ws-saved">order saved ✓ live within a minute</span>
        )}
        {dropTarget !== 'shop' && (
          <span className="wl-adm-ws-note">
            {blockedCount > 0
              ? `${shop.length - blockedCount} buyable, ${blockedCount} hidden`
              : 'Exactly what customers can buy'}
          </span>
        )}
        <div
          className="wl-adm-seg wrap"
          role="group"
          aria-label="Filter the shop by collection"
        >
          <button
            type="button"
            aria-pressed={shopScope.kind === 'all'}
            className={shopScope.kind === 'all' ? 'on' : ''}
            onClick={() => selectShopScope({ kind: 'all' })}
          >
            All <span className="sub">{counts.all}</span>
          </button>
          {collections.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={shopScope.kind === 'collection' && shopScope.id === c.id}
              className={
                shopScope.kind === 'collection' && shopScope.id === c.id ? 'on' : ''
              }
              onClick={() => selectShopScope({ kind: 'collection', id: c.id })}
            >
              {c.title} <span className="sub">{counts.byCollection.get(c.id) ?? 0}</span>
            </button>
          ))}
          <button
            type="button"
            aria-pressed={shopScope.kind === 'unfiled'}
            className={shopScope.kind === 'unfiled' ? 'on' : ''}
            onClick={() => selectShopScope({ kind: 'unfiled' })}
          >
            Unfiled <span className="sub">{counts.unfiled}</span>
          </button>
        </div>
        {shopScope.kind === 'all' && (
          <ShopLimitField
            value={shopLimit}
            buyableCount={buyableCount}
            disabled={inFlight}
            onSaved={setShopLimit}
            onError={fail}
          />
        )}
      </div>
      {shop.length === 0 ? (
        <div className="wl-adm-ws-empty">
          {/* The All-scoped invitation must not show under a chapter filter,
              where it reads as wrong: you cannot drag into a chapter. */}
          {shopScope.kind === 'all'
            ? 'Drag photos with a print file here to put them up for sale.'
            : shopScope.kind === 'unfiled'
              ? 'Every photo in the shop belongs to a chapter.'
              : 'Nothing in this chapter is in the shop yet.'}
        </div>
      ) : (
        // Two grids with the divider BETWEEN them, not one grid with the divider
        // inside it: .wl-adm-ws-grid sets grid-auto-rows: 104px, so a full-width
        // separator would occupy a whole tile-height row. The wrapper keeps the
        // shelf to exactly one scroll region inside the capped band.
        <div className="wl-adm-ws-scroll">
          <div className="wl-adm-ws-grid">
            {shop.slice(0, cutAfter == null ? shop.length : cutAfter + 1).map(renderTile)}
          </div>
          {cutAfter != null && (
            <>
              <div
                className="wl-adm-ws-cut"
                role="separator"
                aria-label="Cut line: photos below this do not appear on the shop page"
              >
                <span>below this does not appear on /shop</span>
              </div>
              <div className="wl-adm-ws-grid">
                {/* The index offset is what keeps the position numbers
                    continuous across the divider. */}
                {shop.slice(cutAfter + 1).map((p, i) => renderTile(p, cutAfter + 1 + i))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
