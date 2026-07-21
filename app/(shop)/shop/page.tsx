import Link from 'next/link';
import { pool } from '@/lib/db';
import { getShopIndexLimit } from '@/lib/site-settings';
import { ArtworkGrid, type GridItem } from '@/components/site/ArtworkGrid';

export const revalidate = 60;

interface PlateRow extends GridItem {}

interface ChapterRow {
  slug: string;
  title: string;
  n: number;
}

export default async function HomePage() {
  const [limit, chaptersRes] = await Promise.all([
    getShopIndexLimit(),
    // Counts BUYABLE published works, not merely published, and the inner join
    // drops zero-count chapters. /shop/collections counts status='published'
    // and LEFT JOINs, so reusing it verbatim would advertise "5 plates" on the
    // storefront's busiest index and land on a visibly empty page.
    pool.query<ChapterRow>(
      `SELECT c.slug, c.title, COUNT(a.id)::int AS n
         FROM collections c
         JOIN artworks a ON a.collection_id = c.id
          AND a.status = 'published'
          AND EXISTS (SELECT 1 FROM artwork_variants v
                        WHERE v.artwork_id = a.id AND v.buyable)
        GROUP BY c.id
        ORDER BY c.display_order, c.id`,
    ),
  ]);
  const chapters = chaptersRes.rows;

  // Serial by necessity: the limit has to be known before this query runs.
  // Folding it in as a LIMIT (SELECT ...) subquery would avoid the extra hop
  // but put the settings read inside the grid query, so one throw would take
  // the grid down with it. getShopIndexLimit never throws, and this shape is
  // what preserves that.
  //
  // NULLIF is load-bearing: in Postgres LIMIT 0 returns ZERO ROWS, and 0 means
  // "no limit" here. LIMIT NULL is the unlimited form.
  const platesRes = await pool.query<PlateRow>(
      `SELECT a.slug,
              a.title,
              a.image_web_url,
              a.year_shot,
              a.location,
              a.plate_no,
              c.title AS collection_title,
              (SELECT MIN(price_cents) FROM artwork_variants v
                 WHERE v.artwork_id = a.id AND v.buyable) AS min_price_cents
       FROM artworks a
       LEFT JOIN collections c ON c.id = a.collection_id
       WHERE a.status = 'published'
         AND EXISTS (SELECT 1 FROM artwork_variants v
                       WHERE v.artwork_id = a.id AND v.buyable)
       ORDER BY a.display_order, a.id
       LIMIT NULLIF($1::int, 0)`,
      [limit],
  );

  const plates = platesRes.rows;

  return (
    <>
      {/* One band, not two. The headline and Dan's note used to be stacked
          sections, which put the first photograph 939px down — a whole
          viewport of type before any picture on a /shop landing. The stats
          column that sat here (Est. / Plates on file / Latest) is gone: the
          header lockup already reads "Est. 2017" two inches away, and the
          note is the thing worth the space. */}
      <section className="wl-masthead">
        <div className="wl-masthead-intro">
          <span className="wl-eyebrow">Wildlight Imagery · Aurora, Colorado</span>
          <h1>
            Exploring <em>my light</em>
            <br /> for as long as I can remember.
          </h1>
        </div>
        <aside className="wl-masthead-note">
          <div className="label">A note from the studio</div>
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
        </aside>
      </section>

      <section className="wl-sheet">
        <header className="wl-sheet-h">
          <h2>Selected works</h2>
          <div className="wl-rule"></div>
          {/* Was "12 shown", which answered a question nobody asked — the
              plates are right there to be counted. This slot is the last
              thing read before the grid, so it holds the one fact a buyer
              actually needs at that moment. */}
          <span className="count">Printed to order · shipped archival</span>
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

      {/* BELOW the grid, deliberately: the curated selection is the thing Dan
          arranged and it should lead. This band is the way deeper, and it is
          the only entry point to collections from /shop. Before it, every
          inbound link to a chapter was downstream of already finding a photo
          (cart empty state, checkout, order page, artwork breadcrumb) or was
          in the footer.

          No CH · NN marker: that numbering comes from the array index on
          /shop/collections, and omitting zero-count chapters here would make it
          disagree with "Chapter 03 of 06" on the chapter and portfolio pages,
          which ROW_NUMBER() over ALL collections. */}
      {chapters.length > 0 && (
        <section className="wl-sheet wl-browse-band">
          <header className="wl-sheet-h">
            <h2>Browse by collection</h2>
            <div className="wl-rule"></div>
            <span className="count">
              {String(chapters.length).padStart(2, '0')} chapters
            </span>
          </header>
          <div className="wl-cindex-list">
            {chapters.map((c) => (
              <Link
                key={c.slug}
                href={`/shop/collections/${c.slug}`}
                className="wl-cindex-row"
              >
                <span className="title">{c.title.replace(/^The /, '')}</span>
                <span className="count">
                  {c.n} {c.n === 1 ? 'plate' : 'plates'}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
