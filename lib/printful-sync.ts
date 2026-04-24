/*
 * Creates a Printful `sync_product` for a given artwork and stamps
 * `artwork_variants.printful_sync_variant_id` back onto our rows.
 *
 * Requires Printful catalog variant IDs to be resolved and stored in
 * `artwork_variants.cost_cents` / variant-templates first. For Phase 1 these
 * are placeholder values; run once per batch after curating the
 * variant-templates.ts file with real Printful catalog IDs.
 */
import { pool } from './db';
import { printful } from './printful';
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
      `artwork ${artworkId} has no image_print_url — upload one before syncing`,
    );
  }

  const variants = await pool.query<{
    id: number;
    printful_catalog_variant_id: number | null;
    price_cents: number;
  }>(
    `SELECT id, price_cents,
            (SELECT CAST(0 AS INT)) AS printful_catalog_variant_id
     FROM artwork_variants
     WHERE artwork_id = $1 AND active = TRUE`,
    [artworkId],
  );
  if (!variants.rowCount) return { created: 0 };

  // Actual Printful create: pass sync_variants. The catalog variant_id per row
  // MUST be a real Printful ID; these come from the variant-templates definition.
  // (Placeholder logic: requires curation before first real sync.)
  const syncVariants = variants.rows.map((v) => ({
    variant_id: v.printful_catalog_variant_id ?? 0,
    retail_price: (v.price_cents / 100).toFixed(2),
    files: [{ url: a.rows[0].image_print_url! }],
  }));

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
