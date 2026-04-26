import { pool } from '@/lib/db';
import { getStripe } from '@/lib/stripe';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';

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

// @security:admin-only — checkHealth caches provider-detail strings
// (Resend verified-domain, Printful store name) at module scope. All
// callers MUST be admin-gated; see app/api/admin/integrations/health/route.ts
// and app/admin/settings/page.tsx. Adding an unauthenticated caller
// would leak those notes.
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

/**
 * Promise.race-based timeout didn't actually cancel the wrapped work —
 * an in-flight fetch would keep its Authorization header alive past
 * the deadline. For fetch callers, prefer `abortSignalAfter` so the
 * underlying socket is torn down at timeout.
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const timer = new Promise<T>((_, rej) => {
    t = setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms);
  });
  return Promise.race([
    p.finally(() => t && clearTimeout(t)),
    timer,
  ]);
}

/** Returns an AbortSignal that fires after `ms` ms. */
function abortSignalAfter(ms: number): {
  signal: AbortSignal;
  cancel: () => void;
} {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(new Error(`timeout after ${ms}ms`)), ms);
  return { signal: ctl.signal, cancel: () => clearTimeout(t) };
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
  const key = process.env.PRINTFUL_API_KEY;
  if (!key) return ping('error', 'key missing');
  const { signal, cancel } = abortSignalAfter(PING_TIMEOUT_MS);
  try {
    const storeId = process.env.PRINTFUL_STORE_ID;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
    };
    if (storeId) headers['X-PF-Store-Id'] = storeId;
    const res = await fetch('https://api.printful.com/store', { headers, signal });
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
    // Never surface the raw err — err.message only, which won't include
    // Authorization header values from undici stack traces.
    return ping('warn', err instanceof Error ? err.message : 'unknown');
  } finally {
    cancel();
  }
}

async function pingResend(): Promise<HealthPing> {
  if (!process.env.RESEND_API_KEY) return ping('error', 'key missing');
  const { signal, cancel } = abortSignalAfter(PING_TIMEOUT_MS);
  try {
    const r = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      signal,
    });
    if (!r.ok) return ping('warn', `HTTP ${r.status}`);
    const body = (await r.json()) as {
      data?: { name: string; status: string }[];
    };
    const verified = (body.data ?? []).find((d) => d.status === 'verified');
    if (!verified) return ping('warn', 'no verified domain');
    return ping('ok', `${verified.name} verified`);
  } catch (err) {
    return ping('warn', err instanceof Error ? err.message : 'unknown');
  } finally {
    cancel();
  }
}

// Cache the S3Client at module scope. Cold-import cost (~80ms) used to
// hit the first ping on a fresh Lambda; constructing the client here means
// it's ready at first pingR2() call.
let r2Client: S3Client | null = null;
function getR2Client(): S3Client | null {
  if (
    !process.env.R2_ACCESS_KEY_ID ||
    !process.env.R2_SECRET_ACCESS_KEY ||
    !process.env.R2_ACCOUNT_ID
  ) {
    return null;
  }
  if (!r2Client) {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return r2Client;
}

async function pingR2(): Promise<HealthPing> {
  const pub = process.env.R2_BUCKET_PUBLIC;
  const priv = process.env.R2_BUCKET_PRIVATE;
  if (!pub || !priv) return ping('error', 'keys missing');
  const client = getR2Client();
  if (!client) return ping('error', 'keys missing');

  // Probe each bucket independently so a single broken bucket reports
  // its own name instead of being swallowed by Promise.all rejection.
  const probe = async (label: string, bucket: string): Promise<string | null> => {
    try {
      await withTimeout(
        client.send(new HeadBucketCommand({ Bucket: bucket })),
        PING_TIMEOUT_MS,
      );
      return null;
    } catch (err) {
      return `${label}: ${err instanceof Error ? err.message : 'unknown'}`;
    }
  };

  const [pubErr, privErr] = await Promise.all([
    probe('public', pub),
    probe('private', priv),
  ]);
  const failures = [pubErr, privErr].filter((x): x is string => x != null);
  if (!failures.length) return ping('ok', '2 buckets reachable');
  if (failures.length === 1) return ping('warn', failures[0]);
  return ping('error', failures.join('; '));
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
