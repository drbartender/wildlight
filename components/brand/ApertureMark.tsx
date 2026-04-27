// Aperture mark — five colored petals sweeping around a center, a modernized
// swirl of the Wildlight logo. Pure SVG, no client JS.

export function ApertureMark({ size = 28 }: { size?: number }) {
  const petals = [
    { color: '#d94335', rot: 0 }, // red — top
    { color: '#e6892a', rot: 72 }, // orange
    { color: '#e4bb22', rot: 144 }, // yellow
    { color: '#6eaa35', rot: 216 }, // green
    { color: '#2a73b3', rot: 288 }, // blue
  ];
  const petalPath =
    'M50 50 C 54 34, 58 22, 54 10 C 46 8, 40 18, 42 30 C 44 40, 47 46, 50 50 Z';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ display: 'block', flexShrink: 0 }}
      aria-hidden="true"
    >
      {petals.map((p, i) => (
        <path
          key={i}
          d={petalPath}
          fill={p.color}
          transform={`rotate(${p.rot} 50 50)`}
        />
      ))}
    </svg>
  );
}
