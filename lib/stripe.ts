import Stripe from 'stripe';

export interface StripeConfig {
  secret: string;
  publishable: string;
  webhookSecret: string;
  testMode: boolean;
}

function pick(): StripeConfig {
  const until = process.env.STRIPE_TEST_MODE_UNTIL;
  const forceTest = until ? new Date(until) > new Date() : false;
  if (forceTest) {
    return {
      secret: process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY || '',
      publishable:
        process.env.STRIPE_PUBLISHABLE_KEY_TEST || process.env.STRIPE_PUBLISHABLE_KEY || '',
      webhookSecret:
        process.env.STRIPE_WEBHOOK_SECRET_TEST || process.env.STRIPE_WEBHOOK_SECRET || '',
      testMode: true,
    };
  }
  return {
    secret: process.env.STRIPE_SECRET_KEY || '',
    publishable: process.env.STRIPE_PUBLISHABLE_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    testMode: false,
  };
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
