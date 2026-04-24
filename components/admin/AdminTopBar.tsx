'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AdminThemeSwitch } from './AdminThemeSwitch';

interface Props {
  title: string;
  subtitle?: string;
  breadcrumb?: string[];
  actions?: ReactNode;
}

export function AdminTopBar({ title, subtitle, breadcrumb, actions }: Props) {
  const router = useRouter();

  function openCmdK() {
    const opener = (
      window as unknown as { __wlAdminOpenCmdk?: () => void }
    ).__wlAdminOpenCmdk;
    if (opener) opener();
  }

  async function signOut() {
    const r = await fetch('/api/auth/logout', { method: 'POST' });
    if (!r.ok) {
      // If the logout endpoint fails, stay put — sending the user to
      // /login while still holding a valid cookie is worse than
      // surfacing the error.
      console.error('sign-out failed', r.status);
      return;
    }
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="wl-adm-topbar">
      <div className="title-group">
        {subtitle && <div className="sub">{subtitle}</div>}
        <h1>{title}</h1>
      </div>
      <nav className="wl-adm-topbar-crumbs" aria-label="Breadcrumb">
        {(breadcrumb ?? [title]).map((b, i, arr) => (
          <span key={i} className={i === arr.length - 1 ? 'current' : ''}>
            {b}
            {i < arr.length - 1 && <span className="sep">/</span>}
          </span>
        ))}
      </nav>
      <button type="button" className="wl-adm-search" onClick={openCmdK}>
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </svg>
        <span className="placeholder">Search artworks, orders…</span>
        <kbd>⌘K</kbd>
      </button>
      <div className="right">
        {actions}
        <AdminThemeSwitch />
        <button
          type="button"
          className="wl-adm-topbar-signout"
          onClick={signOut}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
