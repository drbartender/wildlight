import { describe, it, expect } from 'vitest';
import { classifyPrintResolution } from '@/lib/print-resolution';

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
