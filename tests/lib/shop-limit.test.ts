import { describe, it, expect } from 'vitest';
import {
  parseShopIndexLimit,
  isValidShopIndexLimit,
  SHOP_INDEX_LIMIT_DEFAULT,
  SHOP_INDEX_LIMIT_MAX,
} from '@/lib/shop-limit';

describe('parseShopIndexLimit', () => {
  it('accepts a normal stored value', () => {
    expect(parseShopIndexLimit('12')).toBe(12);
  });

  it('accepts 0, which means no limit', () => {
    expect(parseShopIndexLimit('0')).toBe(0);
  });

  it('accepts the maximum', () => {
    expect(parseShopIndexLimit(String(SHOP_INDEX_LIMIT_MAX))).toBe(SHOP_INDEX_LIMIT_MAX);
  });

  // Number('') === 0, and 0 means "no limit" here, so without an explicit guard
  // a blank row would silently publish the entire catalogue to /shop.
  it('does NOT read an empty string as 0', () => {
    expect(parseShopIndexLimit('')).toBe(SHOP_INDEX_LIMIT_DEFAULT);
    expect(parseShopIndexLimit('   ')).toBe(SHOP_INDEX_LIMIT_DEFAULT);
  });

  it('falls back on junk, negatives, decimals and out-of-range values', () => {
    for (const bad of ['abc', '-1', '1.5', String(SHOP_INDEX_LIMIT_MAX + 1), null, undefined, {}]) {
      expect(parseShopIndexLimit(bad)).toBe(SHOP_INDEX_LIMIT_DEFAULT);
    }
  });
});

describe('isValidShopIndexLimit', () => {
  it('accepts integers in 0..MAX', () => {
    expect(isValidShopIndexLimit(0)).toBe(true);
    expect(isValidShopIndexLimit(12)).toBe(true);
    expect(isValidShopIndexLimit(SHOP_INDEX_LIMIT_MAX)).toBe(true);
  });

  it('rejects everything else', () => {
    for (const bad of [-1, 1.5, SHOP_INDEX_LIMIT_MAX + 1, '12', null, undefined, NaN]) {
      expect(isValidShopIndexLimit(bad)).toBe(false);
    }
  });
});
