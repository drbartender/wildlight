import { describe, it, expect, beforeEach } from 'vitest';
import { checkHealth, _resetCacheForTests } from '@/lib/integration-health';

describe('integration-health cache', () => {
  beforeEach(() => {
    _resetCacheForTests();
    // Clear env so pings short-circuit to 'error' without touching networks.
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.PRINTFUL_API_KEY;
    delete process.env.RESEND_API_KEY;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET_PUBLIC;
    delete process.env.R2_BUCKET_PRIVATE;
    delete process.env.R2_ACCOUNT_ID;
  });

  it('caches for 60 seconds', async () => {
    const t0 = 1_000_000;
    const first = await checkHealth(() => t0);
    const second = await checkHealth(() => t0 + 30_000);
    expect(second).toBe(first);
  });

  it('refreshes after 60 seconds', async () => {
    const first = await checkHealth(() => 1_000_000);
    const second = await checkHealth(() => 1_000_000 + 60_001);
    expect(second).not.toBe(first);
  });

  it('returns error state when a required key is missing', async () => {
    const r = await checkHealth(() => Date.now());
    expect(r.stripe.state).toBe('error');
    expect(r.stripe.note).toContain('missing');
  });
});
