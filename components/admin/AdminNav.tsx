import Link from 'next/link';

export function AdminNav({ currentEmail }: { currentEmail: string }) {
  return (
    <nav
      style={{
        borderBottom: '1px solid #e5e5e5',
        padding: '12px 24px',
        display: 'flex',
        gap: 24,
        alignItems: 'center',
        fontSize: 14,
      }}
    >
      <strong style={{ letterSpacing: '0.06em' }}>WILDLIGHT · ADMIN</strong>
      <Link href="/admin">Dashboard</Link>
      <Link href="/admin/artworks">Artworks</Link>
      <Link href="/admin/collections">Collections</Link>
      <Link href="/admin/orders">Orders</Link>
      <Link href="/admin/subscribers">Subscribers</Link>
      <Link href="/admin/settings">Settings</Link>
      <span style={{ marginLeft: 'auto', color: '#777', fontSize: 12 }}>{currentEmail}</span>
      <form action="/api/auth/logout" method="post" style={{ display: 'inline', margin: 0 }}>
        <button
          type="submit"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#777',
            fontFamily: 'inherit',
            fontSize: 'inherit',
            padding: 0,
          }}
        >
          sign out
        </button>
      </form>
    </nav>
  );
}
