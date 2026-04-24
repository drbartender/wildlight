'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

interface NavDef {
  id: string;
  label: string;
  href: string;
  icon: string;
  badge?: number;
  match: (path: string) => boolean;
}

const CATALOG: NavDef[] = [
  {
    id: 'dashboard',
    label: 'Overview',
    href: '/admin',
    icon: 'M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 14h7v7H3z',
    match: (p) => p === '/admin',
  },
  {
    id: 'artworks',
    label: 'Artworks',
    href: '/admin/artworks',
    icon: 'M4 4h16v12H4zM4 18h10v2H4z',
    match: (p) => p.startsWith('/admin/artworks'),
  },
  {
    id: 'collections',
    label: 'Collections',
    href: '/admin/collections',
    icon: 'M3 5h6v6H3zM11 5h10v6H11zM3 13h10v8H3zM15 13h6v8h-6z',
    match: (p) => p.startsWith('/admin/collections'),
  },
];

const COMMERCE: NavDef[] = [
  {
    id: 'orders',
    label: 'Orders',
    href: '/admin/orders',
    icon: 'M4 6h16l-2 12H6zM9 10v6M15 10v6',
    match: (p) => p.startsWith('/admin/orders'),
  },
  {
    id: 'subscribers',
    label: 'Subscribers',
    href: '/admin/subscribers',
    icon: 'M3 20v-1a5 5 0 0110 0v1M8 12a4 4 0 110-8 4 4 0 010 8zM15 20v-1a4 4 0 018 0v1M19 12a3.5 3.5 0 110-7 3.5 3.5 0 010 7z',
    match: (p) => p.startsWith('/admin/subscribers'),
  },
];

const ACCOUNT: NavDef[] = [
  {
    id: 'settings',
    label: 'Settings',
    href: '/admin/settings',
    icon: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19.4 15a1.6 1.6 0 00.3 1.7l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.7-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.7.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.7 1.6 1.6 0 00-1.5-1H3a2 2 0 010-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.7l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.7.3h.1a1.6 1.6 0 001-1.5V3a2 2 0 014 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.7-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.7v.1a1.6 1.6 0 001.5 1H21a2 2 0 010 4h-.1a1.6 1.6 0 00-1.5 1z',
    match: (p) => p.startsWith('/admin/settings'),
  },
];

interface Props {
  needsReview: number;
  email: string;
}

function Item({ n, path }: { n: NavDef; path: string }) {
  const active = n.match(path);
  return (
    <Link
      href={n.href}
      className={`wl-adm-nav-item ${active ? 'active' : ''}`}
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
  const router = useRouter();
  const orders = COMMERCE.map((n) =>
    n.id === 'orders' && needsReview > 0 ? { ...n, badge: needsReview } : n,
  );
  const initials = email.slice(0, 2).toUpperCase();

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <aside className="wl-adm-sidebar">
      <div className="wl-adm-sidebar-head">
        <div className="atelier-head">
          <div className="wordmark">Wildlight</div>
          <div className="sub">Imagery · Studio</div>
        </div>
        <div className="darkroom-head">
          <div className="icon" aria-hidden="true">W</div>
          <div className="wordmark">wildlight</div>
          <div className="version">v2.4</div>
        </div>
      </div>

      <nav className="wl-adm-sidebar-nav">
        <div className="wl-adm-sidebar-group">Catalog</div>
        {CATALOG.map((n) => (
          <Item key={n.id} n={n} path={path} />
        ))}
        <div className="wl-adm-sidebar-group second">Commerce</div>
        {orders.map((n) => (
          <Item key={n.id} n={n} path={path} />
        ))}
        <div className="wl-adm-sidebar-group second">Account</div>
        {ACCOUNT.map((n) => (
          <Item key={n.id} n={n} path={path} />
        ))}
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
        <button type="button" className="wl-adm-signout" onClick={signOut}>
          sign out
        </button>
      </div>
    </aside>
  );
}
