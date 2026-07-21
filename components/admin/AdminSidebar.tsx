'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ApertureMark } from '@/components/brand/ApertureMark';

interface NavDef {
  id: string;
  label: string;
  href: string;
  icon: string;
  badge?: number;
  match: (path: string) => boolean;
}

// One flat list. Sections that hold a single destination don't earn a
// header, and the pages reached from a section's own top bar (Collections
// off Artworks/Wall, Voice training and Subscribers off Studio) keep their
// parent pill lit — so the lit pill is also the way back.
const NAV: NavDef[] = [
  {
    id: 'dashboard',
    label: 'Overview',
    href: '/admin',
    icon: 'M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 14h7v7H3z',
    match: (path) => path === '/admin',
  },
  {
    id: 'artworks',
    label: 'Artworks',
    href: '/admin/artworks',
    icon: 'M4 4h16v12H4zM4 18h10v2H4z',
    // Collections has no tab of its own — it's reached via header links on the
    // Artworks and Wall & shop pages — so keep this pill lit while editing them.
    match: (path) =>
      path.startsWith('/admin/artworks') || path.startsWith('/admin/collections'),
  },
  {
    id: 'wall',
    label: 'Wall & shop',
    href: '/admin/wall',
    icon: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    match: (path) => path.startsWith('/admin/wall'),
  },
  {
    id: 'orders',
    label: 'Orders',
    href: '/admin/orders',
    icon: 'M4 6h16l-2 12H6zM9 10v6M15 10v6',
    match: (path) => path.startsWith('/admin/orders'),
  },
  {
    id: 'studio',
    label: 'Studio',
    href: '/admin/studio',
    icon: 'M4 4h12l4 4v12H4zM4 4v6h12V4M8 14h8M8 17h6',
    // Journal and Newsletter are the same screen — the composer switches
    // between them with its own tabs, so the sidebar doesn't need to know
    // about `?kind=`. Voice training and Subscribers live on Studio's top
    // bar, so they light this pill too. /admin/journal/* needs no clause:
    // those routes are server-side redirects and the pathname never
    // settles there.
    match: (path) =>
      path.startsWith('/admin/studio') ||
      path.startsWith('/admin/voice-training') ||
      path.startsWith('/admin/subscribers'),
  },
  {
    id: 'settings',
    label: 'Settings',
    href: '/admin/settings',
    icon: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19.4 15a1.6 1.6 0 00.3 1.7l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.7-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.7.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.7 1.6 1.6 0 00-1.5-1H3a2 2 0 010-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.7l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.7.3h.1a1.6 1.6 0 001-1.5V3a2 2 0 014 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.7-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.7v.1a1.6 1.6 0 001.5 1H21a2 2 0 010 4h-.1a1.6 1.6 0 00-1.5 1z',
    match: (path) => path.startsWith('/admin/settings'),
  },
];

interface Props {
  needsReview: number;
  email: string;
}

interface HealthRow {
  key: string;
  state: 'ok' | 'warn' | 'error';
  note: string;
}

const HEALTH_KEYS: readonly ['stripe', 'printful', 'resend', 'r2', 'webhooks'] =
  ['stripe', 'printful', 'resend', 'r2', 'webhooks'] as const;

function Item({
  n,
  path,
  onNavigate,
}: {
  n: NavDef;
  path: string;
  onNavigate?: () => void;
}) {
  const active = n.match(path);
  return (
    <Link
      href={n.href}
      className={`wl-adm-nav-item ${active ? 'active' : ''}`}
      onClick={onNavigate}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={n.icon} />
      </svg>
      <span className="wl-adm-nav-item-label">{n.label}</span>
      {n.badge ? <span className="wl-adm-nav-badge">{n.badge}</span> : null}
    </Link>
  );
}

export function AdminSidebar({ needsReview, email }: Props) {
  const path = usePathname() || '/admin';
  const items = NAV.map((n) =>
    n.id === 'orders' && needsReview > 0 ? { ...n, badge: needsReview } : n,
  );
  const initials = email.slice(0, 2).toUpperCase();

  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);

  // Expose a window-global toggle so AdminTopBar's hamburger can drive
  // the drawer without lifting state across the layout boundary —
  // mirrors the AdminCmdK opener convention.
  useEffect(() => {
    const w = window as unknown as { __wlAdminToggleSidebar?: () => void };
    w.__wlAdminToggleSidebar = () => setOpen((v) => !v);
    return () => {
      delete w.__wlAdminToggleSidebar;
    };
  }, []);

  // Track whether the drawer breakpoint is active. If the user resizes
  // from mobile to desktop with the drawer open, force-close it so the
  // body scroll-lock unwinds and inert clears.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    setIsMobile(mq.matches);
    function onChange(e: MediaQueryListEvent) {
      setIsMobile(e.matches);
      if (!e.matches) setOpen(false);
    }
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [path]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebarRef.current?.querySelector<HTMLAnchorElement>('a')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      // Burger lives in AdminTopBar (sibling tree) — query for it.
      document
        .querySelector<HTMLButtonElement>('.wl-adm-topbar-burger')
        ?.focus();
    };
  }, [open]);

  const [systemHealth, setSystemHealth] = useState<HealthRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const r = await fetch('/api/admin/integrations/health');
        if (!r.ok) return;
        const d = (await r.json()) as Record<
          string,
          { state: 'ok' | 'warn' | 'error'; note: string }
        >;
        if (cancelled) return;
        setSystemHealth(
          HEALTH_KEYS.map((key) => ({
            key,
            state: d[key]?.state ?? 'warn',
            note: d[key]?.note ?? '—',
          })),
        );
      } catch {
        /* quiet — keep prior state on transient failures */
      }
    }
    void refresh();
    const t = setInterval(refresh, 60_000);
    // Resume immediately when the admin tab becomes visible again after
    // a period of being hidden.
    const onVis = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return (
    <>
      <button
        type="button"
        className={`wl-adm-sidebar-backdrop ${open ? 'is-open' : ''}`}
        aria-label="Close navigation"
        tabIndex={open ? 0 : -1}
        onClick={() => setOpen(false)}
      />
      <aside
        ref={sidebarRef}
        className={`wl-adm-sidebar ${open ? 'is-open' : ''}`}
        aria-label="Admin navigation"
        inert={isMobile && !open}
      >
        <div className="wl-adm-sidebar-head">
          <Link
            href="/admin"
            className="wl-adm-sidebar-brand"
            aria-label="Wildlight admin home"
            onClick={() => setOpen(false)}
          >
            <div className="atelier-head">
              <ApertureMark size={26} />
              <div className="atelier-head-text">
                <div className="wordmark">Wildlight</div>
                <div className="sub">Imagery · Studio</div>
              </div>
            </div>
            <div className="darkroom-head">
              <ApertureMark size={20} />
              <div className="wordmark">wildlight</div>
              <div className="version">v2.4</div>
            </div>
          </Link>
        </div>

        <nav className="wl-adm-sidebar-nav">
          {items.map((n) => (
            <Item
              key={n.id}
              n={n}
              path={path}
              onNavigate={() => setOpen(false)}
            />
          ))}
          {systemHealth && systemHealth.length > 0 && (
            <>
              <div className="wl-adm-sidebar-group second wl-adm-system-health-label">
                System
              </div>
              <div className="wl-adm-system-health">
                {systemHealth.map((h) => (
                  <div key={h.key} className={`row state-${h.state}`}>
                    <span className="dot" aria-hidden="true" />
                    <span className="key">{h.key}</span>
                    <span className="note">{h.note}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </nav>

        <div className="wl-adm-sidebar-foot">
          <div className="avatar" aria-hidden="true">
            {initials}
          </div>
          <div className="who">
            <div className="who-name">Admin</div>
            <div className="who-email" title={email}>
              {email}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
