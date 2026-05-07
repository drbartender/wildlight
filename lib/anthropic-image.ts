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

import Anthropic from '@anthropic-ai/sdk';
import { logger } from './logger';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIMES: ReadonlySet<Anthropic.Base64ImageSource['media_type']> =
  new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

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
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`fetch ${url} failed (${r.status})`);
  const ctRaw =
    r.headers.get('content-type')?.toLowerCase().split(';')[0]?.trim() ?? '';
  const mediaType = (ALLOWED_MIMES.has(
    ctRaw as Anthropic.Base64ImageSource['media_type'],
  )
    ? ctRaw
    : 'image/jpeg') as Anthropic.Base64ImageSource['media_type'];
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error(
      `image at ${url} exceeds Anthropic's 5MB cap (${buf.length} bytes)`,
    );
  }
  return { data: buf.toString('base64'), mediaType };
}

export async function inlineUrlImagesAsBase64(
  messages: Anthropic.MessageParam[],
): Promise<Anthropic.MessageParam[]> {
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push(m);
      continue;
    }
    const newContent: typeof m.content = [];
    for (const block of m.content) {
      if (block.type === 'image' && block.source.type === 'url') {
        const b64 = await fetchImageAsBase64(block.source.url);
        newContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: b64.mediaType,
            data: b64.data,
          },
        });
      } else {
        newContent.push(block);
      }
    }
    out.push({ ...m, content: newContent });
  }
  return out;
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
