import { describe, it, expect } from 'vitest';
import { formatUSD, centsToDollars, dollarsToCents, roundPriceCents } from '@/lib/money';

describe('money', () => {
  it('formats cents as $X.YZ', () => {
    expect(formatUSD(3000)).toBe('$30.00');
    expect(formatUSD(12599)).toBe('$125.99');
    expect(formatUSD(0)).toBe('$0.00');
  });
  it('converts between cents and dollars', () => {
    expect(centsToDollars(12345)).toBe(123.45);
    expect(dollarsToCents(123.45)).toBe(12345);
    expect(dollarsToCents(0.01)).toBe(1);
  });
  it('rounds up to nearest $5 ending (multiples of 500 cents)', () => {
    expect(roundPriceCents(2799)).toBe(3000);
    expect(roundPriceCents(3000)).toBe(3000);
    expect(roundPriceCents(3050)).toBe(3500);
    expect(roundPriceCents(14900)).toBe(15000); // $149.00 rounds up to $150.00
    expect(roundPriceCents(15000)).toBe(15000);
    expect(roundPriceCents(1)).toBe(500);
  });
});
