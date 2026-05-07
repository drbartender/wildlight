// Helpers for passing image inputs to Anthropic. The default path is
// a `{type:'url'}` image block — Anthropic's server fetches the URL.
// When that fetch fails (Cloudflare cache miss, regional access, etc),
// they return `400 invalid_request_error · Unable to download the file`
// and the whole generation fails. Sentry: WILDLIGHT-7 / WILDLIGHT-8.
//
// `inlineUrlImagesAsBase64` rewrites a messages[] array so every URL
// image block becomes a base64 block, fetched server-side from our
// Vercel function (which lives in the same Cloudflare-fronted cache
// scope and thus succeeds where Anthropic's region didn't). This trades
// extra bandwidth for determinism — we only pay it on the retry path.
//
// The fallback runs server-side `fetch()` from inside an admin-gated
// route. To prevent SSRF (admin-supplied imageUrls pointing at
// 169.254.169.254 or RFC1918 hosts), the helper hard-allowlists the
// configured R2_PUBLIC_BASE_URL hostname and disables redirect
// following — so an attacker can't 302 us into the metadata service.

import Anthropic from '@anthropic-ai/sdk';
import { logger } from './logger';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const ALLOWED_MIMES: ReadonlySet<Anthropic.Base64ImageSource['media_type']> =
  new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function allowedImageHost(): string {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (!base) throw new Error('R2_PUBLIC_BASE_URL missing');
  try {
    return new URL(base).hostname.toLowerCase();
  } catch {
    throw new Error('R2_PUBLIC_BASE_URL is not a valid URL');
  }
}

export function isUrlFetchError(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError)) return false;
  if (err.status !== 400) return false;
  const msg = err.message ?? '';
  return /unable to download/i.test(msg) || /verify the URL/i.test(msg);
}

async function fetchImageAsBase64(url: string): Promise<{
  data: string;
  mediaType: Anthropic.Base64ImageSource['media_type'];
}> {
  // SSRF guard #1: parse + scheme-check before anything else.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`invalid url: ${url}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`unsupported protocol: ${parsed.protocol}`);
  }
  // SSRF guard #2: hostname allowlist. Only the configured R2 public
  // host is fetchable — internal IPs, metadata services, and any other
  // domain are rejected before we open a socket.
  if (parsed.hostname.toLowerCase() !== allowedImageHost()) {
    throw new Error(`host not allowlisted: ${parsed.hostname}`);
  }

  // `redirect: 'error'` — a 302 to an internal host can't bypass the
  // allowlist. AbortSignal — never let a wedged fetch hang the route.
  const r = await fetch(parsed, {
    redirect: 'error',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`fetch ${url} failed (${r.status})`);

  // Trust Content-Length when present so we can fail fast — but still
  // streamcheck on read since the header can lie.
  const declared = Number(r.headers.get('content-length') ?? '0');
  if (declared > MAX_IMAGE_BYTES) {
    throw new Error(
      `image declared ${declared} bytes, over ${MAX_IMAGE_BYTES} cap`,
    );
  }

  // Strict content-type. No silent coercion to image/jpeg — a misshapen
  // PNG sent as JPEG would just trade Anthropic's "Unable to download"
  // for "unsupported image format", with worse diagnostics.
  const ctRaw =
    r.headers.get('content-type')?.toLowerCase().split(';')[0]?.trim() ?? '';
  if (
    !ALLOWED_MIMES.has(ctRaw as Anthropic.Base64ImageSource['media_type'])
  ) {
    throw new Error(`unsupported content-type: ${ctRaw || 'missing'}`);
  }
  const mediaType = ctRaw as Anthropic.Base64ImageSource['media_type'];

  // Stream-with-cap so a 1 GB body can't OOM the function before the
  // size check fires (the prior `Buffer.from(await arrayBuffer())`
  // shape buffered the entire response first).
  const reader = r.body?.getReader();
  if (!reader) throw new Error('no response body');
  const chunks: Uint8Array[] = [];
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error(`image exceeds ${MAX_IMAGE_BYTES} bytes`);
    }
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)), total);
  return { data: buf.toString('base64'), mediaType };
}

export async function inlineUrlImagesAsBase64(
  messages: Anthropic.MessageParam[],
): Promise<Anthropic.MessageParam[]> {
  // Parallelise the per-image fetches — bounded to ≤4 by upstream
  // (lib/studio.ts caps `all` at 4) and 5 MB each, so the burst is
  // safe without a concurrency limiter.
  return Promise.all(
    messages.map(async (m) => {
      if (typeof m.content === 'string') return m;
      const newContent = await Promise.all(
        m.content.map(async (block) => {
          if (block.type === 'image' && block.source.type === 'url') {
            const b64 = await fetchImageAsBase64(block.source.url);
            return {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: b64.mediaType,
                data: b64.data,
              },
            };
          }
          return block;
        }),
      );
      return { role: m.role, content: newContent };
    }),
  );
}

/**
 * Run `call(messages)` with the original messages. On a URL-fetch
 * failure from Anthropic (400 "Unable to download the file"), rewrite
 * URL image blocks as base64 by fetching them server-side and retry
 * once. Any other error (5xx, validation, etc) propagates so the
 * caller's normal retry/error paths still apply.
 */
export async function callWithBase64Fallback<T>(
  messages: Anthropic.MessageParam[],
  call: (messages: Anthropic.MessageParam[]) => Promise<T>,
): Promise<T> {
  try {
    return await call(messages);
  } catch (err) {
    if (!isUrlFetchError(err)) throw err;
    logger.warn(
      'anthropic url fetch failed; retrying with server-fetched base64',
    );
    const inlined = await inlineUrlImagesAsBase64(messages);
    return await call(inlined);
  }
}
