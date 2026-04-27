import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getStripeConfig } from '@/lib/stripe';

const ENV_KEYS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_SECRET_KEY_TEST',
  'STRIPE_PUBLISHABLE_KEY_TEST',
  'STRIPE_WEBHOOK_SECRET_TEST',
  'STRIPE_TEST_MODE_UNTIL',
];

let snapshot: Record<string, string | undefined>;

beforeEach(() => {
  snapshot = {};
  for (const k of ENV_KEYS) {
    snapshot[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
});

describe('getStripeConfig.testMode', () => {
  it('is true when STRIPE_SECRET_KEY is sk_test_…', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc123';
    expect(getStripeConfig().testMode).toBe(true);
  });

  it('is false when STRIPE_SECRET_KEY is sk_live_…', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc123';
    expect(getStripeConfig().testMode).toBe(false);
  });

  it('is false when STRIPE_SECRET_KEY is missing', () => {
    expect(getStripeConfig().testMode).toBe(false);
  });

  it('is true when STRIPE_TEST_MODE_UNTIL is in the future, regardless of key prefix', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc123';
    process.env.STRIPE_TEST_MODE_UNTIL = new Date(Date.now() + 60_000).toISOString();
    expect(getStripeConfig().testMode).toBe(true);
  });

  it('is false when STRIPE_TEST_MODE_UNTIL is in the past', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc123';
    process.env.STRIPE_TEST_MODE_UNTIL = new Date(Date.now() - 60_000).toISOString();
    expect(getStripeConfig().testMode).toBe(false);
  });
});
