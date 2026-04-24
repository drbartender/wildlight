import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'About — Wildlight Imagery' };

export default function AboutPage() {
  return (
    <section className="container" style={{ padding: '40px 0', maxWidth: 720 }}>
      <h1>Dan Raby</h1>
      <p>
        Dan is a photographer based in Aurora, Colorado. He studied at the Colorado Institute
        of Art and has been making photographs for more than two decades.
      </p>
      <p>
        His work spans portraiture, fine art, and documentary — often experimenting with
        technique: a different lens, an unusual light, a single detail held longer than the eye
        normally allows. Wildlight Imagery gathers his favorite photographs into six small
        collections.
      </p>
      <p>Every print is produced to order on archival materials.</p>
      <p style={{ color: 'var(--muted)', marginTop: 32 }}>
        For licensing, commissions, or corporate décor inquiries, please use the{' '}
        <a href="/contact">contact form</a>.
      </p>
    </section>
  );
}
