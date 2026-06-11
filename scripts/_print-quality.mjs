// Shared print-resolution helpers for the read-only audit scripts
// (check-print-res, check-offered-sizes, measure-unmeasured). Single source
// for the DPI grade ladder and the offered-size long-edge map so the audit
// reports can't silently disagree if Dan revises the thresholds or sizes.

// Largest print sizes Wildlight offers, long edge in inches, from
// lib/variant-templates.ts. 24x36 is the biggest paper/canvas/framed size.
export const OFFERED_SIZES = [
  ['8x10', 10],
  ['12x16', 16],
  ['16x20', 20], // metal
  ['18x24', 24],
  ['24x30', 30], // metal
  ['24x36', 36], // biggest paper/canvas/framed
];

export const BIGGEST_LONG_EDGE = 36;

// Long edge (inches) for a 'WxH' size label. Parses the label so a new size
// added to variant-templates.ts (e.g. '30x40') measures correctly instead of
// silently falling back to 0.
export function longEdgeForSize(size) {
  const m = String(size).match(/(\d+)\s*x\s*(\d+)/i);
  if (!m) return 0;
  return Math.max(Number(m[1]), Number(m[2]));
}

// DPI rating for wall art viewed at arm's length+ (rough industry consensus):
//   >=300 excellent · 240-299 great · 180-239 good · 150-179 ok · <150 soft
export function grade(dpi) {
  if (dpi == null) return '?';
  if (dpi >= 300) return 'EXCELLENT';
  if (dpi >= 240) return 'great';
  if (dpi >= 180) return 'good';
  if (dpi >= 150) return 'ok';
  return 'SOFT';
}
