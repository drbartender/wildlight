'use client';

import { useEffect, useRef, useState } from 'react';

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
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    setView('main');
  }

  useEffect(() => {
    if (!open) return;
    const handleDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
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

  return (
    <div className="wl-adm-rowmenu" ref={ref}>
      <button
        ref={btnRef}
        type="button"
        className="wl-adm-rowmenu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Row actions"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
          setView('main');
        }}
      >
        ⋯
      </button>
      {open && (
        <div className="wl-adm-rowmenu-pop" role="menu">
          {view === 'main' ? (
            <>
              <button
                type="button"
                role="menuitem"
                className="wl-adm-rowmenu-item"
                onClick={() => setView('move')}
              >
                <span>Move to collection…</span>
                <span className="chev">›</span>
              </button>
              {isPublished && (
                <a
                  role="menuitem"
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
                  role="menuitem"
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
                  role="menuitem"
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
              <div className="wl-adm-rowmenu-sep" role="separator" />
              <button
                type="button"
                role="menuitem"
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
              <div className="wl-adm-rowmenu-sep" role="separator" />
              <button
                type="button"
                role="menuitem"
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
                  role="menuitem"
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
      )}
    </div>
  );
}
