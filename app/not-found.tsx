import Link from 'next/link';

export default function NotFound() {
  return (
    <section
      style={{
        maxWidth: 520,
        margin: '15vh auto',
        padding: 24,
        fontFamily: 'Georgia, serif',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontWeight: 400 }}>Not here.</h1>
      <p>This page doesn't exist or may have been retired.</p>
      <Link className="button" href="/" style={{ marginTop: 16 }}>
        Back to the collections
      </Link>
    </section>
  );
}
