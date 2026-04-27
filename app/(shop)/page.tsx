import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Wildlight Imagery — Aurora, Colorado',
  description:
    'Fine-art photography by Dan Raby. A small, considered selection, added sparingly.',
};

export default function HomePage() {
  return (
    <section className="wl-masthead">
      <div className="wl-masthead-intro">
        <span className="wl-eyebrow">Wildlight Imagery · Aurora, Colorado</span>
        <h1>
          Exploring <em>my light</em>
          <br /> for as long as I<br /> can remember.
        </h1>
        <p
          style={{
            marginTop: 32,
            maxWidth: 520,
            color: 'var(--ink-3)',
            fontFamily: 'var(--f-serif)',
            fontSize: 17,
            lineHeight: 1.6,
          }}
        >
          A small, considered selection of fine-art photography by Dan Raby.
          Printed to order, shipped archival.
        </p>
        <div style={{ marginTop: 32, display: 'flex', gap: 16 }}>
          <Link className="wl-btn" href="/shop">
            Visit the shop →
          </Link>
        </div>
        <p
          style={{
            marginTop: 56,
            color: 'var(--ink-4)',
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          Portfolio · Journal · Studio — coming soon.
        </p>
      </div>
    </section>
  );
}
