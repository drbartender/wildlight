import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { pool } from '@/lib/db';
import { OrderCard, type VariantOption } from '@/components/shop/OrderCard';
import { PlateCard, type PlateCardData } from '@/components/site/PlateCard';
import { plateNumber } from '@/lib/plate-number';
import type { EditionStatus } from '@/lib/editions';

export const revalidate = 60;

interface ArtworkRow {
  id: number;
  slug: string;
  title: string;
  artist_note: string | null;
  year_shot: number | null;
  location: string | null;
  image_web_url: string;
  image_width: number | null;
  image_height: number | null;
  collection_slug: string | null;
  collection_title: string | null;
  /** 1-based index among published artworks in the global catalog. */
  plate_idx: number;
  /** Total published artworks in the catalog. */
  plate_total: number;
  edition_size: number | null;
  signed: boolean;
  sold_count: number;
}

interface RelatedQueryResult {
  rows: PlateCardData[];
}

export default async function ArtworkPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Single gating query now also pulls edition_size, signed, and the
  // sold_count subquery — saves a separate getEditionStatus round-trip
  // on the shop's highest-intent page (cache-miss path).
  const arts = await pool.query<ArtworkRow>(
    `WITH published AS (
       SELECT a.id, a.slug, a.title, a.artist_note, a.year_shot, a.location,
              a.image_web_url, a.image_width, a.image_height,
              a.collection_id, a.edition_size, a.signed,
              ROW_NUMBER() OVER (ORDER BY a.display_order, a.id) AS plate_idx,
              COUNT(*) OVER () AS plate_total
       FROM artworks a
       WHERE a.status = 'published'
     )
     SELECT p.id, p.slug, p.title, p.artist_note, p.year_shot, p.location,
            p.image_web_url, p.image_width, p.image_height,
            p.plate_idx::int, p.plate_total::int,
            p.edition_size, p.signed,
            COALESCE((
              SELECT COUNT(oi.id)::int
              FROM order_items oi
              JOIN artwork_variants v ON v.id = oi.variant_id
              JOIN orders o ON o.id = oi.order_id
              WHERE v.artwork_id = p.id
                AND o.status NOT IN ('canceled', 'refunded')
            ), 0) AS sold_count,
            c.slug AS collection_slug, c.title AS collection_title
     FROM published p
     LEFT JOIN collections c ON c.id = p.collection_id
     WHERE p.slug = $1`,
    [slug],
  );
  if (!arts.rowCount) notFound();
  const art = arts.rows[0];

  // Build EditionStatus from the row data (no extra query).
  const isLimited = art.edition_size != null && art.edition_size > 0;
  const edition: EditionStatus = {
    isLimited,
    editionSize: art.edition_size,
    signed: art.signed,
    soldCount: art.sold_count,
    remaining: isLimited
      ? Math.max(0, (art.edition_size as number) - art.sold_count)
      : null,
    soldOut: isLimited && art.sold_count >= (art.edition_size as number),
  };

  // variants only need art.id; related only needs collection_slug + slug.
  // Fire both in parallel after the gating art lookup resolves — shaves a
  // round-trip off TTFB on every cache-miss of the shop's highest-intent
  // page.
  const [variantsRes, relatedRes] = await Promise.all([
    pool.query<VariantOption>(
      `SELECT id, type, size, finish, price_cents FROM artwork_variants
       WHERE artwork_id = $1 AND active = TRUE
       ORDER BY type, price_cents`,
      [art.id],
    ),
    art.collection_slug
      ? pool.query<PlateCardData>(
          `SELECT a.slug, a.title, a.image_web_url, a.year_shot, a.location,
                  (SELECT MIN(price_cents) FROM artwork_variants v
                     WHERE v.artwork_id = a.id AND v.active = TRUE) AS min_price_cents
           FROM artworks a
           JOIN collections c ON c.id = a.collection_id
           WHERE c.slug = $1 AND a.status = 'published' AND a.slug <> $2
           ORDER BY a.display_order, a.id
           LIMIT 4`,
          [art.collection_slug, art.slug],
        )
      : Promise.resolve<RelatedQueryResult>({ rows: [] }),
  ]);
  const variants = variantsRes.rows;
  const related = relatedRes;

  const plate = plateNumber(art.slug);
  const hasKnownDims =
    !!art.image_width &&
    !!art.image_height &&
    art.image_width > 0 &&
    art.image_height > 0;

  return (
    <div>
      <div className="wl-art-head">
        <span>
          {art.collection_slug && art.collection_title ? (
            <Link href={`/shop/collections/${art.collection_slug}`}>
              ← {art.collection_title}
            </Link>
          ) : (
            <Link href="/shop/collections">← Collections</Link>
          )}
        </span>
        <span>
          {plate} · Plate {String(art.plate_idx).padStart(3, '0')} of{' '}
          {String(art.plate_total).padStart(3, '0')}
        </span>
      </div>

      <section className="wl-art">
        <div className="wl-art-grid">
          <div className="wl-art-plate">
            <span className="plate-no">{plate}</span>
            <span className="plate-marks">Archival</span>
            <div className="plate-frame">
              {hasKnownDims ? (
                <Image
                  src={art.image_web_url}
                  alt={art.title}
                  width={art.image_width!}
                  height={art.image_height!}
                  priority
                  sizes="(max-width: 900px) 100vw, 58vw"
                  style={{
                    maxWidth: '100%',
                    maxHeight: 560,
                    width: 'auto',
                    height: 'auto',
                    objectFit: 'contain',
                  }}
                />
              ) : (
                // Fallback for artworks imported before width/height were
                // captured — still render, just without intrinsic sizing.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={art.image_web_url}
                  alt={art.title}
                  style={{
                    maxWidth: '100%',
                    maxHeight: 560,
                    width: 'auto',
                    height: 'auto',
                    objectFit: 'contain',
                  }}
                />
              )}
            </div>
            <div className="plate-cap">
              <span>{art.title}</span>
              <span>
                {art.location ? `${art.location} · ` : ''}
                {art.year_shot ?? ''}
              </span>
            </div>
          </div>

          <div className="wl-art-buy">
            {edition.isLimited && (
              <div className="wl-edition-badge">
                <span className="line-1">
                  Edition of {String(edition.editionSize).padStart(2, '0')}
                </span>
                {edition.signed && (
                  <span className="line-2">Signed by the artist</span>
                )}
                <span
                  className={`line-3 ${edition.soldOut ? 'sold-out' : ''}`}
                >
                  {edition.soldOut
                    ? 'Sold out'
                    : `${edition.remaining} remaining`}
                </span>
              </div>
            )}
            {edition.soldOut ? (
              <div className="wl-edition-soldout">
                <h3>Sold out — thank you.</h3>
                <p>
                  This edition has reached its run of {edition.editionSize}.
                  To know about future releases:
                </p>
                <Link className="wl-btn primary" href="/journal">
                  Subscribe via the journal →
                </Link>
              </div>
            ) : (
              <OrderCard
                artworkId={art.id}
                artworkSlug={art.slug}
                artworkTitle={art.title}
                imageUrl={art.image_web_url}
                plateNo={plate}
                chapterTitle={art.collection_title}
                yearShot={art.year_shot}
                note={art.artist_note}
                variants={variants}
              />
            )}
          </div>
        </div>

        {related.rows.length > 0 && art.collection_title && (
          <div className="wl-art-more">
            <h3>
              More from <em>{art.collection_title}</em>
            </h3>
            <div
              className="wl-plates"
              style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}
            >
              {related.rows.map((r) => (
                <PlateCard key={r.slug} item={r} />
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
