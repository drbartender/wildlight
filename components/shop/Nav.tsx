'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Wordmark } from './Wordmark';
import { MoodSwitch } from './MoodSwitch';
import { CartCountBadge } from './CartCountBadge';

interface LinkSpec {
  href: string;
  label: string;
  match: (p: string) => boolean;
}

const LINKS: LinkSpec[] = [
  { href: '/', label: 'Index', match: (p) => p === '/' },
  {
    href: '/collections',
    label: 'Collections',
    match: (p) => p.startsWith('/collections') || p.startsWith('/artwork'),
  },
  { href: '/about', label: 'Studio', match: (p) => p.startsWith('/about') },
  {
    href: '/contact',
    label: 'Commission',
    match: (p) => p.startsWith('/contact'),
  },
];

function NavLink({ link, path }: { link: LinkSpec; path: string }) {
  return (
    <Link
      href={link.href}
      className={`nav-link ${link.match(path) ? 'active' : ''}`}
    >
      {link.label}
    </Link>
  );
}

export function Nav() {
  const path = usePathname() || '/';
  const [l1, l2, l3, l4] = LINKS;
  return (
    <header className="wl-nav">
      <div className="nav-left">
        <NavLink link={l1} path={path} />
        <NavLink link={l2} path={path} />
      </div>
      <Link href="/" className="nav-center" aria-label="Wildlight Imagery home">
        <Wordmark size={24} />
      </Link>
      <div className="nav-right">
        <NavLink link={l3} path={path} />
        <NavLink link={l4} path={path} />
        <MoodSwitch />
        <CartCountBadge />
      </div>
    </header>
  );
}
