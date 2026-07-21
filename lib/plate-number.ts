// Plate numbers. The number itself is `artworks.plate_no`, assigned once by a
// column default and never rewritten; this module only renders and validates.
//
// It used to be DERIVED here, as a char-code hash of the slug. That meant a
// rename changed a piece's number, and the number recorded nothing about the
// catalogue: it could not be looked up, referenced, or trusted to stay put.
// See docs/superpowers/specs/2026-07-21-plate-numbers-design.md.
//
// Range: WL–0100 through WL–9099 (4 digits, en-dash separator), enforced in the
// database by artworks_plate_no_chk rather than by convention.
//
// IMPORTS NOTHING, deliberately: reached from 'use client' components, and
// anything pulling in lib/db.ts drags `pg` into the client bundle, which fails
// only at `next build`.

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
