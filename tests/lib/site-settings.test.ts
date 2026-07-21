import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SHOP_INDEX_LIMIT_DEFAULT } from '@/lib/shop-limit';

const query = vi.fn();
vi.mock('@/lib/db', () => ({ pool: { query: (...a: unknown[]) => query(...a) } }));

const { getShopIndexLimit } = await import('@/lib/site-settings');

// BRACED, not a concise arrow. `mockReset()` returns the MockInstance, and
// Vitest treats a value returned from a hook as a per-test teardown callback,
// so `beforeEach(() => query.mockReset())` calls the mock after every test. On
// the rejecting test below that teardown returns a rejected promise and fails
// the test even though getShopIndexLimit() resolved correctly.
beforeEach(() => {
  query.mockReset();
});

describe('getShopIndexLimit', () => {
  it('returns the stored value', async () => {
    query.mockResolvedValue({ rows: [{ value: '25' }] });
    expect(await getShopIndexLimit()).toBe(25);
  });

  it('returns 0 for an explicit no-limit', async () => {
    query.mockResolvedValue({ rows: [{ value: '0' }] });
    expect(await getShopIndexLimit()).toBe(0);
  });

  it('falls back when the row is absent', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await getShopIndexLimit()).toBe(SHOP_INDEX_LIMIT_DEFAULT);
  });

  it('falls back when the value is unparseable or out of range', async () => {
    for (const v of ['abc', '', '-3', '99999']) {
      query.mockResolvedValue({ rows: [{ value: v }] });
      expect(await getShopIndexLimit()).toBe(SHOP_INDEX_LIMIT_DEFAULT);
    }
  });

  // The realistic case: a fresh, preview, or restored Neon branch with no
  // site_settings table (42P01). app/(shop)/shop/page.tsx has no try/catch of
  // its own, so a throw here takes the storefront index down.
  it('NEVER throws, even when the query rejects', async () => {
    query.mockRejectedValue(
      Object.assign(new Error('relation does not exist'), { code: '42P01' }),
    );
    await expect(getShopIndexLimit()).resolves.toBe(SHOP_INDEX_LIMIT_DEFAULT);
  });
});
