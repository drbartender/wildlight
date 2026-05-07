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
import sharp from 'sharp';
import { logger } from './logger';

// Anthropic's documented per-image cap for `source.type=base64` is 5 MB.
// We fetch up to MAX_FETCH_BYTES from R2 (since admin-uploaded web images
// can legitimately exceed 5 MB — PNGs of photo content, accidental
// originals from bulk-upload), then if the buffer is over RECOMPRESS_OVER
// we run it through sharp to land safely under the API limit. This is
// the second half of WILDLIGHT-7/8 — the duck-type fix made the fallback
// engage; this fix lets the fallback actually succeed against oversized
// web images (Sentry: WILDLIGHT-A).
const MAX_FETCH_BYTES = 25 * 1024 * 1024;
const RECOMPRESS_OVER = 4 * 1024 * 1024;
const RECOMPRESS_LONG_EDGE = 2000;
const RECOMPRESS_QUALITY = 82;
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

// Duck-type on shape rather than `err instanceof Anthropic.APIError`.
// The SDK class is imported by every Anthropic caller (studio, ai-draft,
// this file); production Turbopack chunks can give those imports separate
// class identities, in which case instanceof returns false against the
// very error the SDK threw — and the URL-fetch fallback never engages
// nor do transient retries fire. That was the silent failure behind
// WILDLIGHT-7/8 even after the base64 fallback shipped. The two helpers
// below stay in this file so the duck-typed contract has one home.
function readNumericStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const s = (err as { status?: unknown }).status;
  return typeof s === 'number' ? s : null;
}

export function isUrlFetchError(err: unknown): boolean {
  if (readNumericStatus(err) !== 400) return false;
  const msg = (err as { message?: unknown }).message;
  if (typeof msg !== 'string') return false;
  return /unable to download/i.test(msg) || /verify the URL/i.test(msg);
}

/**
 * Classify a thrown Anthropic SDK error as retryable. Transient upstream
 * failures (rate limits, 5xx, overload) are worth another shot; shape
 * violations from the model are not. Single source of truth for both
 * lib/ai-draft.ts and lib/studio.ts retry loops.
 */
export function isRetryableAnthropicError(err: unknown): boolean {
  const status = readNumericStatus(err);
  if (status === null) return false;
  return status === 429 || status === 529 || status >= 500;
}

/**
 * Recompress oversized buffers through sharp so the resulting base64 fits
 * under Anthropic's 5 MB per-image limit. Always emits JPEG — the SDK and
 * Anthropic both accept it, and JPEG of a 2000px photo at q82 lands well
 * under the limit even from a print-master input.
 */
export async function recompressForAnthropic(buf: Buffer): Promise<{
  data: Buffer;
  mediaType: Anthropic.Base64ImageSource['media_type'];
}> {
  const out = await sharp(buf)
    .rotate()
    .resize({
      width: RECOMPRESS_LONG_EDGE,
      height: RECOMPRESS_LONG_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .toColorspace('srgb')
    .jpeg({ quality: RECOMPRESS_QUALITY, mozjpeg: true })
    .toBuffer();
  return { data: out, mediaType: 'image/jpeg' };
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

  // Hard cap is the fetch-side DoS guard — sharp can decode large inputs
  // but we don't want a 1 GB body to land in memory. A buffer between
  // RECOMPRESS_OVER and MAX_FETCH_BYTES gets piped through sharp below.
  const declared = Number(r.headers.get('content-length') ?? '0');
  if (declared > MAX_FETCH_BYTES) {
    throw new Error(
      `image declared ${declared} bytes, over ${MAX_FETCH_BYTES} cap`,
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
  let mediaType = ctRaw as Anthropic.Base64ImageSource['media_type'];

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
    if (total > MAX_FETCH_BYTES) {
      await reader.cancel();
      throw new Error(`image exceeds ${MAX_FETCH_BYTES} bytes`);
    }
    chunks.push(value);
  }
  let buf: Buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)), total);

  if (buf.length > RECOMPRESS_OVER) {
    // Anthropic rejects > 5 MB base64; admin-side web images sometimes
    // come in as PNGs or unsized originals. Recompress in-place so the
    // generation actually succeeds rather than 400ing on size.
    const before = buf.length;
    const out = await recompressForAnthropic(buf);
    buf = out.data;
    mediaType = out.mediaType;
    logger.warn('anthropic image recompressed for size cap', {
      before,
      after: buf.length,
    });
  }
  return { data: buf.toString('base64'), mediaType };
}

export async function inlineUrlImagesAsBase64(
  messages: Anthropic.MessageParam[],
): Promise<Anthropic.MessageParam[]> {
  // Parallelise the per-image fetches — bounded to ≤4 by upstream
  // (lib/studio.ts caps `all` at 4) and 25 MB each, recompressed if
  // needed, so the burst is safe without a concurrency limiter.
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
