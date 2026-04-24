import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy — Wildlight Imagery' };

export default function Privacy() {
  return (
    <section className="container" style={{ padding: '40px 0', maxWidth: 720 }}>
      <h1>Privacy</h1>
      <p>
        We collect only what's needed to fulfill orders: your email, shipping address,
        and the payment confirmation returned by Stripe. We don't sell or share your data.
      </p>
      <p>
        Email subscribers receive occasional updates about new work. Unsubscribe any time
        via the link in every email.
      </p>
      <p>
        For privacy questions, email{' '}
        <a href="mailto:contact@wildlightimagery.shop">contact@wildlightimagery.shop</a>.
      </p>
    </section>
  );
}
