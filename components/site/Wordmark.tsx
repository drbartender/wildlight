import { ApertureMark } from '@/components/brand/ApertureMark';

export function Wordmark({
  size = 22,
  markSize,
}: {
  size?: number;
  markSize?: number;
}) {
  const ms = markSize ?? Math.round(size * 1.35);
  return (
    <span className="wl-mark">
      <ApertureMark size={ms} />
      <span className="wl-mark-text">
        <span className="w1" style={{ fontSize: size }}>
          wildlight
        </span>
        <span className="w2">Imagery · Est. 2004</span>
      </span>
    </span>
  );
}
