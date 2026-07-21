'use client';

import { useEffect, useMemo, useState } from 'react';
import { type LibraryPhoto } from '@/lib/wall-arrange';
import {
  deriveShopIds,
  parseScopeKey,
  scopeKey,
  shopScopeCounts,
  type ShopScope,
} from '@/lib/shop-arrange';
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
// This component owns NOTHING yet. Scope/filter state arrives in the next task,
// order state in the one after. Today it renders exactly what it rendered inside
// WallArranger.

export interface ShopShelfProps {
  photos: LibraryPhoto[];
  /** Every chapter, including ones with nothing in the shop. Unused until the filter tray lands. */
  collections: { id: number; title: string }[];
  /** Seed for the /shop cap. Unused until the limit control lands. */
  initialLimit: number;
  /** Parent-level mutations in flight (Library, Wall). The shelf disables while true. */
  parentInFlight: boolean;
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
  parentInFlight,
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
  const shop = useMemo(
    () => shopIds.map((id) => byId.get(id)).filter((p): p is LibraryPhoto => !!p),
    [shopIds, byId],
  );
  const blockedCount = useMemo(() => shop.filter((p) => !p.buyable).length, [shop]);
  const inFlight = parentInFlight;

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
          ))}
        </div>
      )}
    </section>
  );
}
