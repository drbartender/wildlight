// Deterministic plate-number for an artwork slug.
//
// Same slug in, same plate number out — stable for the lifetime of the slug.
// If a slug is renamed, the plate number will change; since the slug is part
// of the URL, renames are rare and intentional.
//
// Range: WL–0100 through WL–9099 (4 digits, en-dash separator).

export function plateNumber(slug: string): string {
  let sum = 0;
  for (let i = 0; i < slug.length; i++) sum += slug.charCodeAt(i);
  const n = (sum % 9000) + 100;
  return `WL–${String(n).padStart(4, '0')}`;
}
