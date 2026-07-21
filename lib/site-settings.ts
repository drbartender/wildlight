import { pool } from '@/lib/db';
import { parseShopIndexLimit, SHOP_INDEX_LIMIT_DEFAULT } from '@/lib/shop-limit';

/**
 * Read the limit for the public /shop grid. NEVER throws.
 *
 * SERVER ONLY: this imports `pool`, which creates a connection pool at module
 * scope. A 'use client' component importing this would pull `pg` into the client
 * bundle and fail at `next build`, after typecheck and tests have both passed.
 * Client code imports lib/shop-limit.ts instead.
 *
 * app/(shop)/shop/page.tsx has no try/catch of its own, and a missing
 * site_settings table (42P01, on a fresh, preview, or restored Neon branch) or a
 * cold-start blip would otherwise take the storefront index down.
 */
export async function getShopIndexLimit(): Promise<number> {
  try {
    const { rows } = await pool.query<{ value: string }>(
      `SELECT value FROM site_settings WHERE key = 'shop_index_limit'`,
    );
    if (!rows.length) return SHOP_INDEX_LIMIT_DEFAULT;
    return parseShopIndexLimit(rows[0].value);
  } catch {
    return SHOP_INDEX_LIMIT_DEFAULT;
  }
}
