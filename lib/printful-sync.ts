/*
 * Creates a Printful `sync_product` for a given artwork and stamps
 * `artwork_variants.printful_sync_variant_id` back onto our rows.
 *
 * Preconditions:
 *  - Artwork has an `image_print_url` (R2 private object key)
 *  - `variant-templates.ts` has the artwork's {type, size, finish} tuple with
 *    a real, non-zero `printful_catalog_variant_id` (one-time lookup against
 *    the Printful Products API)
 */
import { pool } from './db';
import { printful } from './printful';
import { signedPrivateUrl } from './r2';
import { findVariantSpec, type VariantType } from './variant-templates';
import { ExternalServiceError } from './errors';

export async function syncArtworkProducts(artworkId: number): Promise<{ created: number }> {
  const a = await pool.query<{
    id: number;
    title: string;
    image_print_url: string | null;
  }>(`SELECT id, title, image_print_url FROM artworks WHERE id = $1`, [artworkId]);
  if (!a.rowCount) throw new ExternalServiceError('db', 'artwork_missing');
  if (!a.rows[0].image_print_url) {
    throw new ExternalServiceError(
      'db',
      'print_file_missing',
      `artwork ${artworkId} has no image_print_url — upload a print file first`,
    );
  }

  const variants = await pool.query<{
    id: number;
    type: string;
    size: string;
    finish: string | null;
    price_cents: number;
  }>(
    `SELECT id, type, size, finish, price_cents
     FROM artwork_variants
     WHERE artwork_id = $1 AND active = TRUE`,
    [artworkId],
  );
  if (!variants.rowCount) return { created: 0 };

  // Resolve each of our variant rows to a real Printful catalog variant id via
  // the shared variant-templates table. Bail loud if anything is missing —
  // Printful will reject a sync_product with variant_id: 0 anyway.
  const syncVariants: Array<{
    variant_id: number;
    retail_price: string;
    files: Array<{ url: string }>;
  }> = [];
  const missing: string[] = [];
  // Printful downloads the print file from the URL we provide, so sign the
  // private R2 object for long enough to outlive any Printful retry window.
  const signedUrl = await signedPrivateUrl(a.rows[0].image_print_url, 7 * 24 * 3600);
  for (const v of variants.rows) {
    const spec = findVariantSpec({
      type: v.type as VariantType,
      size: v.size,
      finish: v.finish,
    });
    if (!spec || !spec.printful_catalog_variant_id) {
      missing.push(`${v.type} ${v.size}${v.finish ? ` (${v.finish})` : ''}`);
      continue;
    }
    syncVariants.push({
      variant_id: spec.printful_catalog_variant_id,
      retail_price: (v.price_cents / 100).toFixed(2),
      files: [{ url: signedUrl }],
    });
  }
  if (missing.length) {
    throw new ExternalServiceError(
      'printful',
      'missing_catalog_variant_id',
      `variant-templates.ts is missing printful_catalog_variant_id for: ${missing.join(', ')}`,
    );
  }

  const result = await printful.createSyncProduct({
    sync_product: { name: a.rows[0].title, external_id: `art_${artworkId}` },
    sync_variants: syncVariants,
  });

  const returned = result.sync_variants || [];
  for (let i = 0; i < variants.rows.length && i < returned.length; i++) {
    await pool.query(
      `UPDATE artwork_variants SET printful_sync_variant_id = $1 WHERE id = $2`,
      [returned[i].id, variants.rows[i].id],
    );
  }
  return { created: returned.length };
}
