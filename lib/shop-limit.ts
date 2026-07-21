// Limit constants and validators for the /shop cap.
//
// THIS MODULE IMPORTS NOTHING, ON PURPOSE. It is imported by a 'use client'
// component (ShopLimitField), and lib/db.ts calls createPool() at module scope,
// so anything reaching lib/db.ts from a client component drags `pg` into the
// client bundle. That failure appears only at `next build`, after typecheck and
// tests have both passed. The DB-backed reader lives in lib/site-settings.ts.

/** Upper bound. A typo must not ask the storefront index for 50,000 rows. */
export const SHOP_INDEX_LIMIT_MAX = 500;
/** The previous hardcoded /shop cap. Seeded into site_settings, and the fallback. */
export const SHOP_INDEX_LIMIT_DEFAULT = 12;

/**
 * Is this an acceptable admin input? The SAME predicate runs on the client
 * (inline validation) and the server (Zod refinement), from this one function,
 * so the two cannot drift.
 */
export function isValidShopIndexLimit(n: unknown): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= SHOP_INDEX_LIMIT_MAX;
}

/**
 * Coerce a stored value into a usable limit. 0 means "no limit". Anything
 * unusable returns the default rather than throwing: this value gates the
 * storefront index, so a bad row must never blank or 500 the page.
 */
export function parseShopIndexLimit(raw: unknown): number {
  if (typeof raw === 'string' && raw.trim() === '') return SHOP_INDEX_LIMIT_DEFAULT;
  if (typeof raw !== 'string' && typeof raw !== 'number') return SHOP_INDEX_LIMIT_DEFAULT;
  const n = Number(raw);
  return isValidShopIndexLimit(n) ? n : SHOP_INDEX_LIMIT_DEFAULT;
}
