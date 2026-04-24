'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AdminThemeSwitch } from './AdminThemeSwitch';

interface Props {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function AdminTopBar({ title, subtitle, actions }: Props) {
  const router = useRouter();

  function openCmdK() {
    const opener = (
      window as unknown as { __wlAdminOpenCmdk?: () => void }
    ).__wlAdminOpenCmdk;
    if (opener) opener();
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="wl-adm-topbar">
      <div className="title-group">
        {subtitle && <div className="sub">{subtitle}</div>}
        <h1>{title}</h1>
      </div>
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
