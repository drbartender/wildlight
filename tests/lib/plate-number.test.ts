import { describe, it, expect } from 'vitest';
import { formatPlate, parsePlateParam } from '@/lib/plate-number';

describe('formatPlate', () => {
  it('pads to four digits with the en-dash separator', () => {
    expect(formatPlate(100)).toBe('WL–0100');
    expect(formatPlate(4312)).toBe('WL–4312');
    expect(formatPlate(9099)).toBe('WL–9099');
  });

  // U+2013, not a hyphen. The old derived version used an en-dash and the
  // format is a non-goal of the change, so it must survive byte-identical.
  it('uses an en-dash, not a hyphen', () => {
    expect(formatPlate(100).charCodeAt(2)).toBe(0x2013);
  });
});

describe('parsePlateParam', () => {
  // The contact page reads this from a URL, so it is attacker-controllable.
  // Every rejection must return null so the caller can omit the plate entirely
  // rather than rendering a partial or "WL–NaN".
  it('accepts an in-range integer', () => {
    expect(parsePlateParam('100')).toBe(100);
    expect(parsePlateParam('4312')).toBe(4312);
    expect(parsePlateParam('9099')).toBe(9099);
  });

  it('rejects out-of-range values', () => {
    expect(parsePlateParam('99')).toBeNull();
    expect(parsePlateParam('9100')).toBeNull();
    expect(parsePlateParam('-4312')).toBeNull();
  });

  // Each of these is an integer in range once Number() is through with it, so
  // they are rejected only by the digit-shape check. This is the test that
  // fails if someone "simplifies" the implementation back to Number.isInteger.
  it('rejects numeric forms that are not plain digits', () => {
    for (const bad of ['4e3', '0x1F4', '+500', ' 4312 ']) {
      expect(parsePlateParam(bad)).toBeNull();
    }
  });

  it('rejects non-integers and junk', () => {
    for (const bad of ['abc', '43.5', '', '  ', null]) {
      expect(parsePlateParam(bad)).toBeNull();
    }
  });

  // Number('') is 0 and Number('  ') is 0, which would otherwise sail through
  // an integer check and then fail the range check by luck rather than design.
  it('rejects blank explicitly, not by accident of the range check', () => {
    expect(parsePlateParam('')).toBeNull();
  });
});

describe('the stored permutation', () => {
  // Documents the property the SQL column default relies on. It does NOT test
  // the default itself: no test in this repo can reach a Postgres expression.
  // (n * 2731) % 9000 + 100 is a permutation because 2731 is prime and shares
  // no factor with 9000 = 2^3 * 3^2 * 5^3.
  const draw = (n: number) => ((n * 2731) % 9000) + 100;

  it('gives 9000 distinct values over draws 1..9000, all in range', () => {
    const seen = new Set<number>();
    for (let n = 1; n <= 9000; n++) {
      const v = draw(n);
      expect(v).toBeGreaterThanOrEqual(100);
      expect(v).toBeLessThanOrEqual(9099);
      seen.add(v);
    }
    expect(seen.size).toBe(9000);
  });

  it('collides on draw 9001, which is the documented horizon', () => {
    expect(draw(9001)).toBe(draw(1));
  });
});
