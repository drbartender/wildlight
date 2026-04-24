import { pool } from '@/lib/db';
import { getStripe } from '@/lib/stripe';

export interface HealthPing {
  state: 'ok' | 'warn' | 'error';
  note: string;
  checked_at: string;
}

export interface HealthReport {
  stripe: HealthPing;
  printful: HealthPing;
  resend: HealthPing;
  r2: HealthPing;
  webhooks: HealthPing;
}

let cache: { at: number; value: HealthReport } | null = null;
const TTL_MS = 60_000;
const PING_TIMEOUT_MS = 3_000;

/** For tests only — reset the module cache. */
export function _resetCacheForTests() {
  cache = null;
}

export async function checkHealth(
  now: () => number = Date.now,
): Promise<HealthReport> {
  if (cache && now() - cache.at < TTL_MS) return cache.value;

  const [stripe, printful_, resend, r2, webhooks] = await Promise.all([
    pingStripe(),
    pingPrintful(),
    pingResend(),
    pingR2(),
    pingWebhooks(),
  ]);
  const value: HealthReport = {
    stripe,
    printful: printful_,
    resend,
    r2,
    webhooks,
  };
  cache = { at: now(), value };
  return value;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms),
    ),
  ]);
}

function ping(state: 'ok' | 'warn' | 'error', note: string): HealthPing {
  return { state, note, checked_at: new Date().toISOString() };
}

async function pingStripe(): Promise<HealthPing> {
  try {
    if (!process.env.STRIPE_SECRET_KEY) return ping('error', 'key missing');
    const stripe = getStripe();
    await withTimeout(stripe.customers.list({ limit: 1 }), PING_TIMEOUT_MS);
    return ping('ok', 'live');
  } catch (err) {
    return ping('warn', err instanceof Error ? err.message : 'unknown');
  }
}

async function pingPrintful(): Promise<HealthPing> {
  try {
    const key = process.env.PRINTFUL_API_KEY;
    if (!key) return ping('error', 'key missing');
    const storeId = process.env.PRINTFUL_STORE_ID;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
    };
    if (storeId) headers['X-PF-Store-Id'] = storeId;
    const res = await withTimeout(
      fetch('https://api.printful.com/store', { headers }),
      PING_TIMEOUT_MS,
    );
    if (!res.ok) return ping('warn', `HTTP ${res.status}`);
    const body = (await res.json()) as {
      result?: { id?: number; name?: string };
    };
    const id = body.result?.id;
    const name = body.result?.name;
    return ping(
      'ok',
      name ? `store ${name}` : id != null ? `store #${id}` : 'reachable',
    );
  } catch (err) {
    return ping('warn', err instanceof Error ? err.message : 'unknown');
  }
}

async function pingResend(): Promise<HealthPing> {
  try {
    if (!process.env.RESEND_API_KEY) return ping('error', 'key missing');
    const r = await withTimeout(
      fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      }),
      PING_TIMEOUT_MS,
    );
    if (!r.ok) return ping('warn', `HTTP ${r.status}`);
    const body = (await r.json()) as {
      data?: { name: string; status: string }[];
    };
    const verified = (body.data ?? []).find((d) => d.status === 'verified');
    if (!verified) return ping('warn', 'no verified domain');
    return ping('ok', `${verified.name} verified`);
  } catch (err) {
    return ping('warn', err instanceof Error ? err.message : 'unknown');
  }
}

async function pingR2(): Promise<HealthPing> {
  try {
    if (
      !process.env.R2_ACCESS_KEY_ID ||
      !process.env.R2_SECRET_ACCESS_KEY ||
      !process.env.R2_BUCKET_WEB ||
      !process.env.R2_ACCOUNT_ID
    ) {
      return ping('error', 'keys missing');
    }
    const { S3Client, HeadBucketCommand } = await import(
      '@aws-sdk/client-s3'
    );
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
    await withTimeout(
      client.send(new HeadBucketCommand({ Bucket: process.env.R2_BUCKET_WEB })),
      PING_TIMEOUT_MS,
    );
    return ping('ok', '2 buckets reachable');
  } catch (err) {
    return ping('warn', err instanceof Error ? err.message : 'unknown');
  }
}

async function pingWebhooks(): Promise<HealthPing> {
  try {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM webhook_events
       WHERE error IS NOT NULL AND created_at >= NOW() - INTERVAL '24 hours'`,
    );
    const n = rows[0]?.n ?? 0;
    if (n === 0) return ping('ok', 'no recent failures');
    if (n <= 5) return ping('warn', `${n} failing`);
    return ping('error', `${n} failing in 24h`);
  } catch (err) {
    return ping('warn', err instanceof Error ? err.message : 'unknown');
  }
}
