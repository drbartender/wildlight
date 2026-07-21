// Deterministic plate-number for an artwork slug.
//
// Same slug in, same plate number out — stable for the lifetime of the slug.
// If a slug is renamed, the plate number will change; since the slug is part
// of the URL, renames are rare and intentional.
//
// Range: WL–0100 through WL–9099 (4 digits, en-dash separator).

/**
 * Render a stored plate number. The number itself lives in
 * `artworks.plate_no`, assigned once at insert by a column default and never
 * rewritten.
 *
 * This module must keep importing NOTHING: it is reached from 'use client'
 * components, and anything that pulls in lib/db.ts drags `pg` into the client
 * bundle, which fails only at `next build`.
 */
export function formatPlate(n: number): string {
  return `WL–${String(n).padStart(4, '0')}`;
}

/**
 * Read a plate number off a URL param. Returns null for anything unusable, so
 * the caller can omit the plate entirely rather than render a partial.
 *
 * The contact page takes this from a query string, so it is
 * attacker-controllable via a crafted link. Without validation, `?plate=abc`
 * would render "WL–NaN" in the ref pill, the seeded message and the email
 * subject.
 *
 * This checks SHAPE AND RANGE ONLY, never existence: `?plate=4312` for a
 * number belonging to no artwork, or to a different one, passes every check
 * here. Resolving that would need a database round trip on a contact form,
 * which is not worth it for a reference label.
 *
 * Digit-shape FIRST, before Number(). `Number.isInteger(Number(x))` is not a
 * digit check: Number('4e3') is 4000, Number('0x1F4') is 500, Number('+500')
 * is 500 and Number(' 4312 ') is 4312, all integers, all in range. Every one
 * of those would otherwise render a plate number from a URL that does not look
 * like one.
 */
export function parsePlateParam(raw: string | null): number | null {
  if (raw == null || !/^\d{1,4}$/.test(raw)) return null;
  const n = Number(raw);
  if (n < 100 || n > 9099) return null;
  return n;
}

/**
 * DEPRECATED. Derived from the slug, so it changes when a slug is renamed and
 * carries no record of when a piece entered the catalogue. Being replaced by
 * the stored `artworks.plate_no`; call sites migrate one at a time and this is
 * deleted once nothing imports it.
 */
export function plateNumber(slug: string): string {
  let sum = 0;
  for (let i = 0; i < slug.length; i++) sum += slug.charCodeAt(i);
  const n = (sum % 9000) + 100;
  return `WL–${String(n).padStart(4, '0')}`;
}
