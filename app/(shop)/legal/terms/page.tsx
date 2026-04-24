import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Terms — Wildlight Imagery' };

export default function Terms() {
  return (
    <section className="container" style={{ padding: '40px 0', maxWidth: 720 }}>
      <h1>Terms</h1>
      <p>
        All photographs are © Dan Raby. Purchase of a print grants you ownership of the
        physical print only; it does not transfer any copyright, licensing, or
        reproduction rights.
      </p>
      <p>
        For commercial licensing or reproduction, please{' '}
        <a href="/contact">contact us</a>.
      </p>
    </section>
  );
}
