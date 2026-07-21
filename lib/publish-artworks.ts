import type { PoolClient } from 'pg';

export interface PublishResult {
  /** Rows that ended at status='published' (transition + already-published). */
  published: number;
  /** Rows that did NOT publish — missing image_print_url, or id not found. */
  skipped: number;
}

/**
 * Publish-time invariant gate. Single chokepoint for "no master, no publish"
 * + first-publish published_at stamping. Used by the per-artwork PATCH, the
 * bulk POST, and scripts/publish-selections.ts so all three paths agree.
 *
 * - Only artworks with a non-empty image_print_url are published (matches the
 *   admin `hd` gate; an empty-string master must not publish).
 * - published_at = NOW() is stamped only on the transition from
 *   non-'published' to 'published'. Re-publishing a row already at
 *   'published' leaves published_at untouched (it's the first-publish
 *   timestamp, not a current-state flag).
 * - Rows TRANSITIONING into 'published' are assigned a fresh display_order (and
 *   collection_order, when filed) at the end of their scope. Stored positions
 *   are never trusted here; import-manifest historically wrote manifest indices
 *   into display_order, so duplicates are normal. The demote paths zero both
 *   columns, so a returning piece appends rather than resurfacing mid-grid.
 * - Caller owns the transaction. Pass a PoolClient mid-transaction so the
 *   surrounding writes (other field updates, variant template apply) can
 *   share atomicity.
 */
export async function publishArtworks(
  client: PoolClient,
  ids: number[],
): Promise<PublishResult> {
  if (!ids.length) return { published: 0, skipped: 0 };

  const rows = await client.query<{ id: number; status: string }>(
    `SELECT id, status
     FROM artworks
     WHERE id = ANY($1::int[])
       AND image_print_url IS NOT NULL AND image_print_url <> ''
     FOR UPDATE`,
    [ids],
  );
  const eligible = rows.rows.map((r) => r.id);
  const transitioning = rows.rows
    .filter((r) => r.status !== 'published')
    .map((r) => r.id);

  if (eligible.length) {
    await client.query(
      `UPDATE artworks
       SET status = 'published',
           updated_at = NOW(),
           published_at = CASE
             WHEN id = ANY($2::int[]) THEN NOW()
             ELSE published_at
           END
       WHERE id = ANY($1::int[])`,
      [eligible, transitioning],
    );
  }

  // Position assignment. A row entering the shop NEVER keeps its stored
  // position: production guarantees duplicate display_order values (
  // scripts/import-manifest.ts historically wrote per-collection manifest
  // indices into it), so any "is this position already taken" test would be
  // wrong on the first bulk publish. Assign unconditionally instead, and let
  // the demote paths zero the columns on the way out (Rule 1, in the per-artwork
  // PATCH and the bulk retire action).
  if (transitioning.length) {
    // MAX + ROW_NUMBER, never MAX + 1: this helper takes an ids[], so MAX + 1
    // would hand an entire batch of twenty drafts the identical position.
    //
    // The MAX excludes the transitioning rows themselves. The UPDATE above has
    // already flipped them to status='published', so an unqualified
    // MAX(display_order) WHERE status='published' would read their own stale
    // values back in.
    await client.query(
      `WITH m AS (
         SELECT COALESCE(MAX(display_order), 0) AS mx
           FROM artworks
          WHERE status = 'published' AND id <> ALL($1::int[])
       ),
       t AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
           FROM artworks WHERE id = ANY($1::int[])
       )
       UPDATE artworks a
          SET display_order = m.mx + t.rn
         FROM t, m
        WHERE a.id = t.id`,
      [transitioning],
    );

    // Same shape for collection_order, partitioned by collection. Rows with no
    // collection are skipped and stay at 0, which is correct: an unfiled piece
    // has no chapter to hold a position in.
    await client.query(
      `WITH t AS (
         SELECT id, collection_id,
                ROW_NUMBER() OVER (PARTITION BY collection_id ORDER BY id) AS rn
           FROM artworks
          WHERE id = ANY($1::int[]) AND collection_id IS NOT NULL
       ),
       m AS (
         SELECT collection_id, COALESCE(MAX(collection_order), 0) AS mx
           FROM artworks
          WHERE status = 'published'
            AND collection_id IS NOT NULL
            AND id <> ALL($1::int[])
          GROUP BY collection_id
       )
       UPDATE artworks a
          SET collection_order = COALESCE(m.mx, 0) + t.rn
         FROM t LEFT JOIN m ON m.collection_id = t.collection_id
        WHERE a.id = t.id`,
      [transitioning],
    );
  }

  return {
    published: eligible.length,
    skipped: ids.length - eligible.length,
  };
}
