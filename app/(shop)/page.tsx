import { pool } from '@/lib/db';
import { ArtworkGrid, type GridItem } from '@/components/shop/ArtworkGrid';

export const revalidate = 60;

interface PlateRow extends GridItem {}

interface CountsRow {
  n: number;
  latest: string | null;
}

function seasonOf(date: Date): string {
  const m = date.getUTCMonth(); // 0..11
  const y = date.getUTCFullYear();
  const yy = `'${String(y).slice(2)}`;
  if (m === 11 || m <= 1) return `Winter ${m === 11 ? `'${String((y + 1)).slice(2)}` : yy}`;
  if (m <= 4) return `Spring ${yy}`;
  if (m <= 7) return `Summer ${yy}`;
  return `Fall ${yy}`;
}

export default async function HomePage() {
  const [countsRes, platesRes] = await Promise.all([
    pool.query<CountsRow>(
      `SELECT COUNT(*)::int AS n, MAX(updated_at)::text AS latest
       FROM artworks WHERE status='published'`,
    ),
    pool.query<PlateRow>(
      `SELECT a.slug,
              a.title,
              a.image_web_url,
              a.year_shot,
              a.location,
              c.title AS collection_title,
              (SELECT MIN(price_cents) FROM artwork_variants v
                 WHERE v.artwork_id = a.id AND v.active = TRUE) AS min_price_cents
       FROM artworks a
       LEFT JOIN collections c ON c.id = a.collection_id
       WHERE a.status = 'published'
       ORDER BY a.display_order, a.id
       LIMIT 12`,
    ),
  ]);

  const count = countsRes.rows[0]?.n ?? 0;
  const latestRaw = countsRes.rows[0]?.latest ?? null;
  const latestLabel = latestRaw ? seasonOf(new Date(latestRaw)) : '—';
  const plates = platesRes.rows;

  return (
    <>
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
            <b>Plates on file</b> {String(count).padStart(3, '0')}
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

      <section className="wl-masthead-lede">
        <div>
          <div className="label">
            A note from
            <br />
            the studio
          </div>
        </div>
        <div>
          <p>
            My father handed me a camera when I was a child and I never put it
            down. I'm a photographic rebel — I take the rules I learned at the
            Colorado Institute of Art and then do something else. Let's try this
            and see what happens.
          </p>
          <p>
            Everything here has earned its way onto the site. A small,
            considered selection, added sparingly.
          </p>
          <div className="sig">— Dan</div>
        </div>
      </section>

      <section className="wl-sheet">
        <header className="wl-sheet-h">
          <h2>Index of plates</h2>
          <div className="wl-rule"></div>
          <span className="count">
            {String(count).padStart(2, '0')} works on file
          </span>
        </header>
        {plates.length > 0 ? (
          <ArtworkGrid items={plates} />
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
      </section>
    </>
  );
}
