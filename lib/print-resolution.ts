// Largest catalog size (in inches) — drives the DPI calc. Fine-art print
// goes up to 24×36 and metal to 24×30, so the short edge of the print
// must cover 24" at the target DPI to look good at the maximum size.
const MAX_SHORT_EDGE_INCHES = 24;

// 240 DPI is the floor for a clean fine-art print at 24×36 (Printful's
// own guidance is 150 minimum, 300 ideal). Below 150 the result is
// visibly soft — flag those as too_low so they can't go out unchecked.
const GOOD_DPI = 240;
const MIN_DPI = 150;

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
  const maxGoodEdgeInches = Math.floor(shortEdge / GOOD_DPI);

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
