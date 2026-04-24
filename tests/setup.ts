import { config } from 'dotenv';
config({ path: '.env.local' });

process.env.JWT_SECRET ||= 'test-secret-dont-use-in-prod-abcd1234567890abcd';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET ||= 'whsec_dummy';
process.env.R2_PUBLIC_BASE_URL ||= 'https://images.wildlightimagery.shop';
