import { describe, it, expect } from 'vitest';
import {
  classifyPrintResolution,
  evaluateSizeResolution,
  maxSupportedSize,
  MIN_DPI,
} from '@/lib/print-resolution';

describe('classifyPrintResolution', () => {
  it('classifies a typical 50MP master as good', () => {
    // 8688x5792 — Sony A7R IV-ish, comfortably above 240 DPI at 24"
    const r = classifyPrintResolution(8688, 5792);
    expect(r.level).toBe('good');
    expect(r.effectiveDpi).toBeGreaterThanOrEqual(240);
  });

  it('classifies a portrait master using the short edge', () => {
    // 5792x8688 — same camera, portrait orientation
    const r = classifyPrintResolution(5792, 8688);
    expect(r.level).toBe('good');
    expect(r.width).toBe(5792);
    expect(r.height).toBe(8688);
  });

  it('flags borderline (~24MP, 4000x6000) as low', () => {
    const r = classifyPrintResolution(6000, 4000);
    // 4000 / 24" = 166 DPI → between 150 and 240 → 'low'
    expect(r.level).toBe('low');
    expect(r.effectiveDpi).toBe(167);
  });

  it('flags a small master as too_low', () => {
    // 3000 / 24" = 125 DPI — below the 150 floor
    const r = classifyPrintResolution(3000, 2000);
    expect(r.level).toBe('too_low');
    expect(r.effectiveDpi).toBeLessThan(150);
  });

  it('reports the largest size that still meets the good threshold', () => {
    // 4800 / 240 DPI = 20" max good short edge
    const r = classifyPrintResolution(7200, 4800);
    expect(r.maxGoodEdgeInches).toBe(20);
    expect(r.level).toBe('low');
  });

  it('puts a 240-DPI-at-24" master exactly at the good threshold', () => {
    // 5760 / 24 = 240 DPI exactly
    const r = classifyPrintResolution(8640, 5760);
    expect(r.level).toBe('good');
    expect(r.effectiveDpi).toBe(240);
  });
});

describe('evaluateSizeResolution', () => {
  it('blocks a 0.8MP file at every size (Gulls case)', () => {
    // 1050x720 → short edge 720px
    const r = evaluateSizeResolution(1050, 720, '24x36');
    expect(r.shortInches).toBe(24);
    expect(r.requiredShortPx).toBe(24 * MIN_DPI); // 3600
    expect(r.actualShortPx).toBe(720);
    expect(r.effectiveDpi).toBe(30); // 720 / 24
    expect(r.ok).toBe(false);
    expect(r.message).toContain('needs 3600px');
    expect(r.message).toContain('720px');
  });

  it('passes 8x10 but blocks 12x16 for a 4.2MP file (Cake Alley case)', () => {
    // 2578x1627 → short edge 1627px
    expect(evaluateSizeResolution(2578, 1627, '8x10').ok).toBe(true); // 1627/8 = 203
    expect(evaluateSizeResolution(2578, 1627, '12x16').ok).toBe(false); // 1627/12 = 136
  });

  it('uses the short edge regardless of orientation', () => {
    const landscape = evaluateSizeResolution(6016, 4016, '24x36');
    const portrait = evaluateSizeResolution(4016, 6016, '24x36');
    expect(landscape.actualShortPx).toBe(4016);
    expect(portrait.actualShortPx).toBe(4016);
    expect(landscape.ok).toBe(true); // 4016/24 = 167 ≥ 150
    expect(portrait.ok).toBe(true);
  });

  it('treats exactly the floor as ok (boundary)', () => {
    // short edge exactly 8 * 150 = 1200 at 8x10
    expect(evaluateSizeResolution(1600, 1200, '8x10').ok).toBe(true);
    expect(evaluateSizeResolution(1600, 1199, '8x10').ok).toBe(false);
  });

  it('returns an unmeasured result for non-positive dims', () => {
    const r = evaluateSizeResolution(0, 0, '24x36');
    expect(r.ok).toBe(false);
    expect(r.actualShortPx).toBe(0);
  });

  it('returns ok=false (shortInches 0) for an unparseable label', () => {
    const r = evaluateSizeResolution(6016, 4016, 'A3');
    expect(r.shortInches).toBe(0);
    expect(r.ok).toBe(false);
  });
});

describe('maxSupportedSize', () => {
  const SIZES = ['8x10', '12x16', '16x20', '18x24', '24x30', '24x36'];
  it('returns the largest size whose short edge clears the floor', () => {
    expect(maxSupportedSize(6016, 4016, SIZES)).toBe('24x36'); // all clear
    expect(maxSupportedSize(3324, 2160, SIZES)).toBe('12x16'); // 2160/16=135<150 at 16x20
    expect(maxSupportedSize(1050, 720, SIZES)).toBe(null); // nothing clears
  });
});
