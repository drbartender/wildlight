'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Item {
  k: string;
  to: string;
  hint?: string;
}

const ITEMS: Item[] = [
  { k: 'Go to Overview', to: '/admin', hint: 'dashboard' },
  { k: 'Go to Artworks', to: '/admin/artworks' },
  { k: 'Go to Collections', to: '/admin/collections' },
  { k: 'Go to Journal', to: '/admin/journal', hint: 'chapters' },
  { k: 'Go to Studio', to: '/admin/studio', hint: 'draft generator' },
  { k: 'Go to Orders', to: '/admin/orders' },
  { k: 'Go to Subscribers', to: '/admin/subscribers' },
  { k: 'Go to Settings', to: '/admin/settings' },
  { k: 'New artwork', to: '/admin/artworks/new', hint: 'upload' },
  { k: 'New chapter', to: '/admin/journal/new', hint: 'journal' },
  { k: 'New broadcast', to: '/admin/subscribers?tab=broadcast' },
];

export function AdminCmdK() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      // Focus after the overlay paints.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Expose a global opener so the topbar's search button can trigger the
  // overlay without having to pass refs through props.
  useEffect(() => {
    (window as unknown as { __wlAdminOpenCmdk?: () => void }).__wlAdminOpenCmdk =
      () => setOpen(true);
    return () => {
      delete (window as unknown as { __wlAdminOpenCmdk?: () => void })
        .__wlAdminOpenCmdk;
    };
  }, []);

  const filtered = q
    ? ITEMS.filter((i) =>
        (i.k + ' ' + (i.hint || '')).toLowerCase().includes(q.toLowerCase()),
      )
    : ITEMS;

  function pick(i: Item) {
    setOpen(false);
    router.push(i.to);
  }

  if (!open) return null;

  return (
    <div
      className="wl-adm-cmdk-veil"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
    >
      <div className="wl-adm-cmdk" onClick={(e) => e.stopPropagation()}>
        <div className="input-row">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIdx((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter' && filtered[idx]) {
                e.preventDefault();
                pick(filtered[idx]);
              }
            }}
            placeholder="Search for anything…"
          />
          <kbd
            style={{
              fontFamily: 'var(--f-mono), monospace',
              fontSize: 10,
              padding: '2px 6px',
              border: '1px solid var(--adm-rule)',
              borderRadius: 3,
              color: 'var(--adm-muted)',
            }}
          >
            Esc
          </kbd>
        </div>
        <div className="wl-adm-cmdk-list">
          {filtered.length === 0 ? (
            <div
              style={{
                padding: '16px 18px',
                color: 'var(--adm-muted)',
                fontSize: 12,
              }}
            >
              No matches.
            </div>
          ) : (
            filtered.map((it, i) => (
              <button
                key={it.to + it.k}
                className={`wl-adm-cmdk-item ${i === idx ? 'active' : ''}`}
                onMouseEnter={() => setIdx(i)}
                onClick={() => pick(it)}
              >
                <span className="arr">→</span>
                <span style={{ flex: 1 }}>{it.k}</span>
                {it.hint && <span className="hint">{it.hint}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
