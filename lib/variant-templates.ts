import { roundPriceCents } from './money';

export type VariantType = 'print' | 'canvas' | 'framed' | 'metal';

export interface VariantSpec {
  type: VariantType;
  size: string;
  finish?: string;
  /** Printful catalog variant id — resolved per-Printful-account during sync. 0 = unresolved. */
  printful_catalog_variant_id: number;
  /** Printful base cost at creation time, in cents. Real cost is fetched at sync. */
  cost_cents: number;
}

// Cost placeholders are approximate Printful US base costs as of 2026-Q1.
// Real costs are fetched at Printful-sync time and overwrite these.
const FINE_ART: VariantSpec[] = [
  { type: 'print', size: '8x10', printful_catalog_variant_id: 0, cost_cents: 1250 },
  { type: 'print', size: '12x16', printful_catalog_variant_id: 0, cost_cents: 1850 },
  { type: 'print', size: '18x24', printful_catalog_variant_id: 0, cost_cents: 2900 },
  { type: 'print', size: '24x36', printful_catalog_variant_id: 0, cost_cents: 4200 },
];

const CANVAS: VariantSpec[] = [
  { type: 'canvas', size: '12x16', printful_catalog_variant_id: 0, cost_cents: 2800 },
  { type: 'canvas', size: '18x24', printful_catalog_variant_id: 0, cost_cents: 4200 },
  { type: 'canvas', size: '24x36', printful_catalog_variant_id: 0, cost_cents: 7500 },
];

const FRAMED: VariantSpec[] = [
  { type: 'framed', size: '12x16', finish: 'black', printful_catalog_variant_id: 0, cost_cents: 4100 },
  { type: 'framed', size: '18x24', finish: 'black', printful_catalog_variant_id: 0, cost_cents: 6500 },
  { type: 'framed', size: '12x16', finish: 'white', printful_catalog_variant_id: 0, cost_cents: 4100 },
  { type: 'framed', size: '18x24', finish: 'white', printful_catalog_variant_id: 0, cost_cents: 6500 },
];

const METAL: VariantSpec[] = [
  { type: 'metal', size: '16x20', printful_catalog_variant_id: 0, cost_cents: 5500 },
  { type: 'metal', size: '24x30', printful_catalog_variant_id: 0, cost_cents: 9500 },
];

export const TEMPLATES = {
  fine_art: FINE_ART,
  canvas: CANVAS,
  full: [...FINE_ART, ...CANVAS, ...FRAMED, ...METAL],
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

export interface VariantRow {
  type: VariantType;
  size: string;
  finish: string | null;
  printful_catalog_variant_id: number;
  price_cents: number;
  cost_cents: number;
}

/**
 * Apply a variant template to produce rows ready for insertion into
 * `artwork_variants`. Retail price = cost × 2.1, rounded UP to nearest $5 ending.
 */
export function applyTemplate(key: TemplateKey): VariantRow[] {
  return TEMPLATES[key].map((v) => ({
    type: v.type,
    size: v.size,
    finish: v.finish ?? null,
    printful_catalog_variant_id: v.printful_catalog_variant_id,
    cost_cents: v.cost_cents,
    price_cents: roundPriceCents(Math.ceil(v.cost_cents * 2.1)),
  }));
}
