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
 * - Only artworks with image_print_url IS NOT NULL are published.
 * - published_at = NOW() is stamped only on the transition from
 *   non-'published' to 'published'. Re-publishing a row already at
 *   'published' leaves published_at untouched (it's the first-publish
 *   timestamp, not a current-state flag).
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
     WHERE id = ANY($1::int[]) AND image_print_url IS NOT NULL
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

  return {
    published: eligible.length,
    skipped: ids.length - eligible.length,
  };
}
