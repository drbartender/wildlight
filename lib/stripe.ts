import Stripe from 'stripe';

export interface StripeConfig {
  secret: string;
  publishable: string;
  webhookSecret: string;
  testMode: boolean;
}

// Set once per cold start the first time we observe testMode active in
// VERCEL_ENV=production. The downstream effect (Printful drafts +
// suppressed operator alerts) is silent by design, so an env-swap that
// lands a test key in prod would otherwise be invisible. The console.warn
// surfaces in Vercel runtime logs and is enough for an operator scanning
// for anomalies. Avoids importing logger here to dodge a cycle.
let _warnedTestModeInProd = false;

function pick(): StripeConfig {
  const until = process.env.STRIPE_TEST_MODE_UNTIL;
  const forceTest = until ? new Date(until) > new Date() : false;
  let cfg: StripeConfig;
  if (forceTest) {
    const secret = process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY || '';
    cfg = {
      secret,
      publishable:
        process.env.STRIPE_PUBLISHABLE_KEY_TEST || process.env.STRIPE_PUBLISHABLE_KEY || '',
      webhookSecret:
        process.env.STRIPE_WEBHOOK_SECRET_TEST || process.env.STRIPE_WEBHOOK_SECRET || '',
      testMode: true,
    };
  } else {
    // Also treat a plain `sk_test_…` secret as test mode, even without the
    // timed STRIPE_TEST_MODE_UNTIL window. This is what's in effect when
    // the operator just plugs test keys into the regular slots — downstream
    // code (Printful draft submission) can rely on `testMode` to gate side
    // effects.
    const secret = process.env.STRIPE_SECRET_KEY || '';
    cfg = {
      secret,
      publishable: process.env.STRIPE_PUBLISHABLE_KEY || '',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
      testMode: secret.startsWith('sk_test_'),
    };
  }
  if (cfg.testMode && !_warnedTestModeInProd && process.env.VERCEL_ENV === 'production') {
    _warnedTestModeInProd = true;
    console.warn(
      '[stripe] testMode active in VERCEL_ENV=production — Printful will draft (no fulfillment) and operator alerts are suppressed. Verify STRIPE_SECRET_KEY and STRIPE_TEST_MODE_UNTIL are set correctly.',
    );
  }
  return cfg;
}

export function getStripeConfig(): StripeConfig {
  return pick();
}

let _client: Stripe | null = null;
export function getStripe(): Stripe {
  const { secret } = pick();
  if (!secret) throw new Error('stripe secret key missing');
  if (!_client) _client = new Stripe(secret);
  return _client;
}
