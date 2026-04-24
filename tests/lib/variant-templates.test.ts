import { describe, it, expect } from 'vitest';
import { TEMPLATES, applyTemplate } from '@/lib/variant-templates';

describe('variant templates', () => {
  it('exposes fine_art, canvas, full', () => {
    expect(TEMPLATES.fine_art.length).toBe(4);
    expect(TEMPLATES.canvas.length).toBe(3);
    // FINE_ART(4) + CANVAS(3) + FRAMED(4) + METAL(2) = 13
    expect(TEMPLATES.full.length).toBe(13);
  });
  it('applyTemplate computes retail = cost*2.1 rounded up to $5 ending', () => {
    const variants = applyTemplate('fine_art');
    for (const v of variants) {
      expect(v.price_cents).toBeGreaterThanOrEqual(Math.ceil(v.cost_cents * 2.1));
      expect(v.price_cents % 500).toBe(0);
      expect(v.cost_cents).toBeGreaterThan(0);
    }
  });
  it('full template mixes types', () => {
    const variants = applyTemplate('full');
    const types = new Set(variants.map((v) => v.type));
    expect(types).toEqual(new Set(['print', 'canvas', 'framed', 'metal']));
  });
});
