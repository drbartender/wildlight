'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface CollectionOpt {
  id: number;
  title: string;
}

interface Props {
  status: string;
  hasPrintMaster: boolean;
  slug: string;
  collectionId: number | null;
  collections: CollectionOpt[];
  onMove: (collectionId: number | null) => Promise<void> | void;
  onTogglePublish: () => Promise<void> | void;
  onDelete: () => Promise<void> | void;
}

interface PopRect {
  top: number;
  left: number;
}

const POP_WIDTH = 220;
const POP_GAP = 4;

export function ArtworkRowMenu({
  status,
  hasPrintMaster,
  slug,
  collectionId,
  collections,
  onMove,
  onTogglePublish,
  onDelete,
}: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'main' | 'move'>('main');
  const [pos, setPos] = useState<PopRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  function close() {
    setOpen(false);
    setView('main');
  }

  function toggle() {
    if (open) {
      close();
    } else {
      setView('main');
      setOpen(true);
    }
  }

  // The artworks table card uses overflow: hidden, so an absolutely
  // positioned popover would clip on the bottom-most row. position: fixed
  // is positioned against the viewport and escapes ancestor overflow as
  // long as no ancestor sets transform/contain/will-change. The popover
  // stays in the DOM tree (inside .wl-admin-surface) so the admin theme
  // variables resolve correctly.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    function updatePos() {
      const btn = btnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const left = Math.max(8, r.right - POP_WIDTH);
      // Flip upward if there's not enough room below the trigger.
      const below = window.innerHeight - r.bottom;
      const popH = popRef.current?.offsetHeight ?? 240;
      const top =
        below < popH + POP_GAP && r.top > popH + POP_GAP
          ? r.top - popH - POP_GAP
          : r.bottom + POP_GAP;
      setPos({ top, left });
    }
    updatePos();
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open, view]);

  useEffect(() => {
    if (!open) return;
    const handleDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        btnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const isPublished = status === 'published';
  const canPublish = hasPrintMaster;

  const popover =
    open && pos ? (
      <div
        ref={popRef}
        className="wl-adm-rowmenu-pop"
        style={{ position: 'fixed', top: pos.top, left: pos.left, width: POP_WIDTH }}
      >
        {view === 'main' ? (
          <>
            <button
              type="button"
              className="wl-adm-rowmenu-item"
              onClick={() => setView('move')}
            >
              <span>Move to collection…</span>
              <span className="chev">›</span>
            </button>
            {isPublished && (
              <a
                className="wl-adm-rowmenu-item"
                href={`/shop/artwork/${slug}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => close()}
              >
                View on site ↗
              </a>
            )}
            {isPublished ? (
              <button
                type="button"
                className="wl-adm-rowmenu-item"
                onClick={async () => {
                  close();
                  await onTogglePublish();
                }}
              >
                Retire
              </button>
            ) : (
              <button
                type="button"
                className="wl-adm-rowmenu-item"
                disabled={!canPublish}
                title={canPublish ? undefined : 'Upload a print master before publishing.'}
                onClick={async () => {
                  close();
                  await onTogglePublish();
                }}
              >
                Publish
              </button>
            )}
            <div className="wl-adm-rowmenu-sep" />
            <button
              type="button"
              className="wl-adm-rowmenu-item danger"
              onClick={async () => {
                close();
                await onDelete();
              }}
            >
              Delete
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="wl-adm-rowmenu-back"
              onClick={() => setView('main')}
            >
              ‹ Back
            </button>
            <div className="wl-adm-rowmenu-sep" />
            <button
              type="button"
              className="wl-adm-rowmenu-item"
              onClick={async () => {
                close();
                await onMove(null);
              }}
            >
              <span>Uncategorized</span>
              {collectionId == null && <span className="check">✓</span>}
            </button>
            {collections.map((c) => (
              <button
                key={c.id}
                type="button"
                className="wl-adm-rowmenu-item"
                onClick={async () => {
                  close();
                  await onMove(c.id);
                }}
              >
                <span>{c.title}</span>
                {collectionId === c.id && <span className="check">✓</span>}
              </button>
            ))}
            {collections.length === 0 && (
              <div className="wl-adm-rowmenu-empty">No collections yet.</div>
            )}
          </>
        )}
      </div>
    ) : null;

  return (
    <div className="wl-adm-rowmenu">
      <button
        ref={btnRef}
        type="button"
        className="wl-adm-rowmenu-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Row actions"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          toggle();
        }}
      >
        ⋯
      </button>
      {popover}
    </div>
  );
}
