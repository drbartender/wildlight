'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Wordmark } from './Wordmark';
import { MoodSwitch } from './MoodSwitch';
import { CartCountBadge } from '@/components/shop/CartCountBadge';

interface LinkSpec {
  href: string;
  label: string;
  match: (p: string) => boolean;
}

const LINKS: LinkSpec[] = [
  {
    href: '/portfolio',
    label: 'Portfolio',
    match: (p) => p.startsWith('/portfolio'),
  },
  {
    href: '/journal',
    label: 'Journal',
    match: (p) => p.startsWith('/journal'),
  },
  { href: '/about', label: 'Studio', match: (p) => p.startsWith('/about') },
  {
    href: '/shop',
    label: 'Shop',
    match: (p) => p.startsWith('/shop'),
  },
];

function NavLink({
  link,
  path,
  onClick,
}: {
  link: LinkSpec;
  path: string;
  onClick?: () => void;
}) {
  return (
    <Link
      href={link.href}
      className={`nav-link ${link.match(path) ? 'active' : ''}`}
      onClick={onClick}
    >
      {link.label}
    </Link>
  );
}

export function Nav() {
  const path = usePathname() || '/';
  const [open, setOpen] = useState(false);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [path]);

  useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current;
    const trigger = burgerRef.current;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sheet?.querySelector<HTMLAnchorElement>('a')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <header className="wl-nav">
        <Link href="/" className="nav-brand" aria-label="Wildlight Imagery home">
          <Wordmark size={28} />
        </Link>
        <div className="nav-right">
          {LINKS.map((link) => (
            <NavLink key={link.href} link={link} path={path} />
          ))}
          <MoodSwitch />
          <CartCountBadge />
          <button
            ref={burgerRef}
            type="button"
            className="wl-nav-burger"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="wl-nav-sheet"
            onClick={() => setOpen((v) => !v)}
          >
            <span
              className={`wl-nav-burger-icon ${open ? 'is-open' : ''}`}
              aria-hidden="true"
            >
              <span></span>
              <span></span>
              <span></span>
            </span>
          </button>
        </div>
      </header>

      <div
        id="wl-nav-sheet"
        ref={sheetRef}
        className={`wl-nav-sheet ${open ? 'is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Site navigation"
        inert={!open}
      >
        <div className="wl-nav-sheet-inner">
          <nav className="wl-nav-sheet-list">
            {LINKS.map((link) => (
              <NavLink
                key={link.href}
                link={link}
                path={path}
                onClick={() => setOpen(false)}
              />
            ))}
          </nav>
          <div className="wl-nav-sheet-foot">
            <span>Wildlight Imagery</span>
            <span>Aurora · Colorado</span>
          </div>
        </div>
      </div>
    </>
  );
}
