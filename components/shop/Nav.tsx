import Link from 'next/link';

export function Nav() {
  return (
    <header style={{ borderBottom: '1px solid var(--rule)' }}>
      <div
        className="container"
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '20px 0',
          gap: 24,
        }}
      >
        <Link
          href="/"
          style={{ textDecoration: 'none', letterSpacing: '0.08em', fontSize: 14 }}
        >
          <strong>WILDLIGHT</strong>{' '}
          <span style={{ color: 'var(--muted)' }}>IMAGERY</span>
        </Link>
        <nav style={{ marginLeft: 'auto', display: 'flex', gap: 24, fontSize: 14 }}>
          <Link href="/collections">Collections</Link>
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/cart">Cart</Link>
        </nav>
      </div>
    </header>
  );
}
