import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { pool } from '@/lib/db';
import { ArtworkGrid, type GridItem } from '@/components/site/ArtworkGrid';
import { EmailCaptureStrip } from '@/components/site/EmailCaptureStrip';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Wildlight Imagery — Aurora, Colorado',
  description:
    'Fine-art photography by Dan Raby. A small, considered selection of prints — added sparingly, printed to order, shipped archival.',
};

interface PlateRow extends GridItem {}

interface CountsRow {
  n: number;
  latest: string | null;
}

function seasonOf(date: Date): string {
  const m = date.getUTCMonth();
  const y = date.getUTCFullYear();
  const yy = `'${String(y).slice(2)}`;
  if (m === 11 || m <= 1)
    return `Winter ${m === 11 ? `'${String(y + 1).slice(2)}` : yy}`;
  if (m <= 4) return `Spring ${yy}`;
  if (m <= 7) return `Summer ${yy}`;
  return `Fall ${yy}`;
}

export default async function MarketingHome() {
  const [countsRes, platesRes] = await Promise.all([
    pool.query<CountsRow>(
      `SELECT COUNT(*)::int AS n, MAX(published_at)::text AS latest
       FROM artworks WHERE status='published'`,
    ),
    // Marketing home renders cards with showPrice={false}, so the
    // MIN(price_cents) subquery is unused — drop it. Saves 6 correlated
    // subqueries on every cache-miss render of the highest-traffic page.
    pool.query<PlateRow>(
      `SELECT a.slug,
              a.title,
              a.image_web_url,
              a.year_shot,
              a.location,
              c.title AS collection_title
       FROM artworks a
       LEFT JOIN collections c ON c.id = a.collection_id
       WHERE a.status = 'published'
       ORDER BY a.display_order, a.id
       LIMIT 6`,
    ),
  ]);

  const count = countsRes.rows[0]?.n ?? 0;
  const latestRaw = countsRes.rows[0]?.latest ?? null;
  const latestLabel = latestRaw ? seasonOf(new Date(latestRaw)) : '—';
  const plates = platesRes.rows;

  return (
    <div className="wl-mhome">
      {/* 1. Hero */}
      <section className="wl-masthead">
        <div className="wl-masthead-intro">
          <span className="wl-eyebrow">Wildlight Imagery · Aurora, Colorado</span>
          <h1>
            Exploring <em>my light</em>
            <br /> for as long as I<br /> can remember.
          </h1>
        </div>
        <div className="wl-masthead-side">
          <div>
            <b>Est.</b> 2004
          </div>
          <div>
            <b>Plates on file</b>{' '}
            <Link href="/portfolio" className="wlmh-meta-link">
              {String(count).padStart(3, '0')} →
            </Link>
          </div>
          <div>
            <b>Latest</b> {latestLabel}
          </div>
          <div style={{ marginTop: 8 }}>
            Printed to order ·<br />
            shipped archival
          </div>
        </div>
      </section>

      {/* 2. From the field */}
      <section className="wl-sheet wlmh-field">
        <header className="wl-sheet-h">
          <h2>
            From the field<em>.</em>
          </h2>
          <div className="wl-rule"></div>
          <span className="count">Recently added</span>
        </header>
        {plates.length > 0 ? (
          <ArtworkGrid
            items={plates}
            showPrice={false}
            linkBase="/shop/artwork"
            className="wl-plates wlmh-plates-6"
          />
        ) : (
          <p
            style={{
              color: 'var(--ink-3)',
              fontFamily: 'var(--f-serif)',
              fontSize: 17,
              padding: '40px 0',
            }}
          >
            No published works yet. Check back soon.
          </p>
        )}
        <div className="wlmh-field-cta">
          <Link className="wlmh-bigcta" href="/portfolio">
            Browse the full portfolio →
          </Link>
        </div>
      </section>

      {/* 3. From the studio */}
      <section className="wlmh-studio">
        <div className="wlmh-studio-portrait">
          <div style={{ position: 'relative', aspectRatio: '4/5' }}>
            <Image
              src="/dan-portrait.jpg"
              alt="Dan Raby in the studio"
              fill
              sizes="(max-width: 640px) 100vw, 40vw"
              style={{ objectFit: 'cover' }}
            />
          </div>
          <div className="cap">
            <span>Dan Raby, at the studio</span>
            <span>Aurora, CO</span>
          </div>
        </div>
        <div className="wlmh-studio-body">
          <span className="wl-eyebrow">From the studio</span>
          <h2>
            A note from <em>Dan</em>.
          </h2>
          <p>
            My father handed me a camera when I was a child and I never put it
            down. I&apos;m a photographic rebel — I take the rules I learned at
            the Colorado Institute of Art and then do something else. Let&apos;s
            try this and see what happens.
          </p>
          <p>
            I am always trying something different photographically — working
            beyond what I know, looking for the light in unusual places. But I
            can also use what I know and stay true to the customer&apos;s
            requirements. Working together to create the perfect shot.
          </p>
          <div className="wlmh-studio-actions">
            <Link className="wlmh-bigcta" href="/about">
              Read Dan&apos;s letter →
            </Link>
          </div>
        </div>
      </section>

      {/* 4. Newsletter */}
      <section className="wlmh-news-section">
        <EmailCaptureStrip
          source="marketing-home"
          eyebrow="Notes from the field"
          headline="Quarterly notes, in your inbox."
          body="New chapters, new prints, occasional limited editions. Sent quarterly — never more."
        />
      </section>

      {/* 5. Find a print */}
      <section className="wlmh-find">
        <div className="wlmh-find-inner">
          <span className="wl-eyebrow">The shop</span>
          <h2>
            Printed to order,
            <br /> <em>shipped archival.</em>
          </h2>
          <p>
            A small, considered selection of fine-art prints. Choose the size,
            paper, and frame that suits your wall — printed in Aurora, Colorado,
            and shipped worldwide.
          </p>
          <div className="wlmh-find-actions">
            <Link className="wl-btn primary" href="/shop">
              Visit the shop →
            </Link>
            <Link className="wl-btn ghost" href="/shop/collections">
              Browse collections
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
