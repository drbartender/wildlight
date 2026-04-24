import Link from 'next/link';
import { EmailCaptureStrip } from './EmailCaptureStrip';

export function Footer() {
  return (
    <footer style={{ borderTop: '1px solid var(--rule)', marginTop: 80 }}>
      <div className="container" style={{ padding: '40px 0' }}>
        <EmailCaptureStrip />
        <div
          style={{
            display: 'flex',
            gap: 24,
            marginTop: 32,
            flexWrap: 'wrap',
            color: 'var(--muted)',
            fontSize: 13,
          }}
        >
          <span>© {new Date().getFullYear()} Wildlight Imagery — work by Dan Raby</span>
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/terms">Terms</Link>
          <Link href="/legal/shipping-returns">Shipping &amp; returns</Link>
        </div>
      </div>
    </footer>
  );
}
