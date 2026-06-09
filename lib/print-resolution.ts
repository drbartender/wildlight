// Largest catalog size (in inches) — drives the DPI calc. Fine-art print
// goes up to 24×36 and metal to 24×30, so the short edge of the print
// must cover 24" at the target DPI to look good at the maximum size.
const MAX_SHORT_EDGE_INCHES = 24;

// 240 DPI is the floor for a clean fine-art print at 24×36 (Printful's
// own guidance is 150 minimum, 300 ideal). Below 150 the result is
// visibly soft — flag those as too_low so they can't go out unchecked.
export const GOOD_DPI = 240;
export const MIN_DPI = 150;

export type PrintResolutionLevel = 'good' | 'low' | 'too_low';

export interface PrintResolution {
  width: number;
  height: number;
  /** Effective DPI when printed at the largest catalog size (24" short edge). */
  effectiveDpi: number;
  level: PrintResolutionLevel;
  /** Largest size at which this file still meets the GOOD threshold (inches). */
  maxGoodEdgeInches: number;
  message: string;
}

/**
 * Classify a print master's pixel dimensions against the largest size
 * Wildlight sells. `level` is the only hard signal; `effectiveDpi` and
 * `maxGoodEdgeInches` exist so the admin UI can show the operator
 * exactly why a file falls in a band.
 */
export function classifyPrintResolution(
  width: number,
  height: number,
): PrintResolution {
  const shortEdge = Math.min(width, height);
  const effectiveDpi = Math.round(shortEdge / MAX_SHORT_EDGE_INCHES);
  // Floor so a sub-240px edge would compute 0; clamp at 1" so the UI
  // shows `max 1"` instead of `max 0"` for absurdly small masters.
  const maxGoodEdgeInches = Math.max(1, Math.floor(shortEdge / GOOD_DPI));

  let level: PrintResolutionLevel;
  let message: string;
  if (effectiveDpi >= GOOD_DPI) {
    level = 'good';
    message = `${effectiveDpi} DPI at 24" — good for prints up to ${maxGoodEdgeInches}" short edge.`;
  } else if (effectiveDpi >= MIN_DPI) {
    level = 'low';
    message = `${effectiveDpi} DPI at 24" — usable but soft on the largest sizes (24×36 / 24×30). Best up to ${maxGoodEdgeInches}" short edge.`;
  } else {
    level = 'too_low';
    message = `${effectiveDpi} DPI at 24" — below the ${MIN_DPI}-DPI floor for catalog prints. Visible softness at most sizes.`;
  }

  return {
    width,
    height,
    effectiveDpi,
    level,
    maxGoodEdgeInches,
    message,
  };
}

// Sizes are catalog labels like "24x36"; the print is matched short-edge to
// short-edge, so the file's short edge governs. A label that is not WxH is a
// data error — callers treat that as "unmeasured", never a silent block.
const SIZE_RX = /^(\d+)x(\d+)$/;

export interface SizeResolution {
  size: string;
  shortInches: number;
  requiredShortPx: number;
  actualShortPx: number;
  effectiveDpi: number;
  ok: boolean;
  message: string;
}

export function shortEdgeInches(size: string): number | null {
  const m = SIZE_RX.exec(size.trim());
  if (!m) return null;
  return Math.min(Number(m[1]), Number(m[2]));
}

export function evaluateSizeResolution(
  width: number,
  height: number,
  size: string,
  floorDpi = MIN_DPI,
): SizeResolution {
  const shortInches = shortEdgeInches(size) ?? 0;
  const actualShortPx = width > 0 && height > 0 ? Math.min(width, height) : 0;
  const requiredShortPx = shortInches * floorDpi;
  const effectiveDpi =
    shortInches > 0 ? Math.round(actualShortPx / shortInches) : 0;
  const ok = shortInches > 0 && actualShortPx >= requiredShortPx;
  const message = ok
    ? `${effectiveDpi} DPI at ${size} — clears the ${floorDpi}-DPI floor.`
    : `${size} needs ${requiredShortPx}px short edge at ${floorDpi} DPI; file has ${actualShortPx}px (${effectiveDpi} DPI).`;
  return {
    size,
    shortInches,
    requiredShortPx,
    actualShortPx,
    effectiveDpi,
    ok,
    message,
  };
}

function sizeAreaInches(size: string): number | null {
  const m = SIZE_RX.exec(size.trim());
  if (!m) return null;
  return Number(m[1]) * Number(m[2]);
}

/**
 * Largest *physical* size in `sizes` that still clears the floor, else null.
 * Ranked by print area so that two sizes sharing a short edge (e.g. 24×30 and
 * 24×36, both 24" short) resolve to the bigger print (24×36).
 */
export function maxSupportedSize(
  width: number,
  height: number,
  sizes: string[],
  floorDpi = MIN_DPI,
): string | null {
  const cleared = sizes
    .map((s) => ({ s, area: sizeAreaInches(s) ?? 0 }))
    .filter(
      (x) => x.area > 0 && evaluateSizeResolution(width, height, x.s, floorDpi).ok,
    )
    .sort((a, b) => b.area - a.area);
  return cleared.length ? cleared[0].s : null;
}
