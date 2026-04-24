import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Shipping & Returns — Wildlight Imagery' };

export default function Shipping() {
  return (
    <section className="container" style={{ padding: '40px 0', maxWidth: 720 }}>
      <h1>Shipping &amp; Returns</h1>
      <p>
        <strong>Made to order.</strong> Every print is produced when you order it.
        Standard production + shipping is 7–14 business days within the US.
      </p>
      <p>
        <strong>Returns.</strong> Because prints are made to order, we only accept
        returns for manufacturing defects or damage in transit. Email us within 14 days
        with a photo of the issue and we'll replace or refund it.
      </p>
      <p>
        <strong>International.</strong> Limited to US and Canada at launch. More regions as we grow.
      </p>
    </section>
  );
}
