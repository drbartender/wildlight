// Edition-status lookup for an artwork. Reads edition_size + signed
// from artworks, and counts non-canceled, non-refunded order_items
// referencing any variant of that artwork.

import { pool } from './db';

export interface EditionStatus {
  isLimited: boolean;
  editionSize: number | null;
  signed: boolean;
  soldCount: number;
  remaining: number | null;
  soldOut: boolean;
}

interface Row {
  edition_size: number | null;
  signed: boolean;
  sold: number;
}

export async function getEditionStatus(
  artworkId: number,
): Promise<EditionStatus> {
  const r = await pool.query<Row>(
    `SELECT a.edition_size,
            a.signed,
            COALESCE(
              (
                SELECT COUNT(oi.id)::int
                FROM order_items oi
                JOIN artwork_variants v ON v.id = oi.variant_id
                JOIN orders o ON o.id = oi.order_id
                WHERE v.artwork_id = a.id
                  AND o.status NOT IN ('canceled', 'refunded')
              ),
              0
            ) AS sold
     FROM artworks a
     WHERE a.id = $1`,
    [artworkId],
  );
  const row = r.rows[0];
  if (!row) {
    return {
      isLimited: false,
      editionSize: null,
      signed: false,
      soldCount: 0,
      remaining: null,
      soldOut: false,
    };
  }
  const isLimited = row.edition_size != null && row.edition_size > 0;
  const remaining = isLimited
    ? Math.max(0, (row.edition_size as number) - row.sold)
    : null;
  return {
    isLimited,
    editionSize: row.edition_size,
    signed: row.signed,
    soldCount: row.sold,
    remaining,
    soldOut: isLimited && row.sold >= (row.edition_size as number),
  };
}
