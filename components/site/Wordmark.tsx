import type { CSSProperties } from 'react';
import { ApertureMark } from '@/components/brand/ApertureMark';

export function Wordmark({
  size = 22,
  markSize,
}: {
  size?: number;
  markSize?: number;
}) {
  const ms = markSize ?? Math.round(size * 1.35);
  // Sizes flow through CSS vars so media queries can override them — an inline
  // font-size here would win over the mobile breakpoint and lock the size.
  const vars = {
    '--wl-text-size': `${size}px`,
    '--wl-mark-size': `${ms}px`,
  } as CSSProperties;
  return (
    <span className="wl-mark" style={vars}>
      <ApertureMark size={ms} />
      <span className="wl-mark-text">
        <span className="w1">wildlight</span>
        <span className="w2">Imagery · Est. 2004</span>
      </span>
    </span>
  );
}
