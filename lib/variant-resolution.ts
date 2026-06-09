import type { PoolClient } from 'pg';
import { evaluateSizeResolution, shortEdgeInches } from './print-resolution';
import { logger } from './logger';

export interface RefreshResult {
  updated: number;
  ok: number;
  blocked: number;
  unmeasured: number;
}

/**
 * Single writer of artwork_variants.min_resolution_ok. Caller owns the
 * transaction — pass a PoolClient so a dims write earlier in the same
 * transaction is visible (mirrors lib/publish-artworks.ts). `buyable`
 * re-derives automatically via the generated column.
 */
export async function refreshVariantResolution(
  client: PoolClient,
  artworkId: number,
): Promise<RefreshResult> {
  const a = await client.query<{
    print_width: number | null;
    print_height: number | null;
  }>(`SELECT print_width, print_height FROM artworks WHERE id = $1`, [artworkId]);
  const dims = a.rows[0];
  const w = dims?.print_width ?? null;
  const h = dims?.print_height ?? null;

  const variants = await client.query<{ id: number; size: string }>(
    `SELECT id, size FROM artwork_variants WHERE artwork_id = $1`,
    [artworkId],
  );

  const res: RefreshResult = { updated: 0, ok: 0, blocked: 0, unmeasured: 0 };
  for (const v of variants.rows) {
    let ok: boolean | null;
    if (w == null || h == null) {
      ok = null; // unmeasured → fail-open via `min_resolution_ok IS NOT FALSE`
      res.unmeasured++;
    } else if (shortEdgeInches(v.size) == null) {
      // Unparseable size label (e.g. "A3", "8.5x11") → fail-open, never
      // silently dark-list with a "0px" reason. Leave NULL for a human.
      ok = null;
      res.unmeasured++;
      logger.warn('variant-resolution: unparseable size label', {
        artworkId,
        variantId: v.id,
        size: v.size,
      });
    } else {
      ok = evaluateSizeResolution(w, h, v.size).ok;
      if (ok) res.ok++;
      else res.blocked++;
    }
    await client.query(
      `UPDATE artwork_variants SET min_resolution_ok = $1 WHERE id = $2`,
      [ok, v.id],
    );
    res.updated++;
  }
  logger.info('variant-resolution refresh', { artworkId, ...res });
  return res;
}
