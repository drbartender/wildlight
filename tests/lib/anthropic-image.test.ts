import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  isUrlFetchError,
  isRetryableAnthropicError,
  recompressForAnthropic,
} from '@/lib/anthropic-image';

describe('isUrlFetchError', () => {
  // The shape Anthropic's SDK throws on a URL-fetch failure. Reproduced
  // verbatim from a captured Sentry payload (WILDLIGHT-7/8) so the
  // duck-typed check stays anchored to the real error, not a guess.
  function bareApiErrorShape(): unknown {
    const e: { name: string; status: number; type: string; message: string } = {
      name: 'BadRequestError',
      status: 400,
      type: 'invalid_request_error',
      message:
        '400 {"type":"error","error":{"type":"invalid_request_error","message":"Unable to download the file. Please verify the URL and try again."},"request_id":"req_x"}',
    };
    return e;
  }

  it('matches a plain object that has the SDK error shape', () => {
    // Critical case: the duck-typed check must succeed even when the
    // error is not an instance of Anthropic.APIError — that's the
    // production failure mode the helper exists to handle.
    expect(isUrlFetchError(bareApiErrorShape())).toBe(true);
  });

  it('matches the alternate "verify the URL" phrase', () => {
    expect(
      isUrlFetchError({
        status: 400,
        message: '400 ... please verify the URL and try again',
      }),
    ).toBe(true);
  });

  it('rejects non-400 statuses', () => {
    expect(
      isUrlFetchError({ status: 500, message: 'unable to download' }),
    ).toBe(false);
    expect(
      isUrlFetchError({ status: 429, message: 'unable to download' }),
    ).toBe(false);
  });

  it('rejects 400s with unrelated messages', () => {
    expect(isUrlFetchError({ status: 400, message: 'bad input' })).toBe(false);
  });

  it('rejects non-objects and missing fields', () => {
    expect(isUrlFetchError(null)).toBe(false);
    expect(isUrlFetchError(undefined)).toBe(false);
    expect(isUrlFetchError('error string')).toBe(false);
    expect(isUrlFetchError({})).toBe(false);
    expect(isUrlFetchError({ status: 400 })).toBe(false);
  });

  it('rejects a stringified status (regression: only numeric status counts)', () => {
    expect(
      isUrlFetchError({ status: '400', message: 'unable to download' }),
    ).toBe(false);
  });
});

describe('isRetryableAnthropicError', () => {
  it('matches transient Anthropic statuses', () => {
    expect(isRetryableAnthropicError({ status: 429 })).toBe(true);
    expect(isRetryableAnthropicError({ status: 529 })).toBe(true);
    expect(isRetryableAnthropicError({ status: 500 })).toBe(true);
    expect(isRetryableAnthropicError({ status: 503 })).toBe(true);
    expect(isRetryableAnthropicError({ status: 599 })).toBe(true);
  });

  it('rejects 4xx errors that are not 429', () => {
    expect(isRetryableAnthropicError({ status: 400 })).toBe(false);
    expect(isRetryableAnthropicError({ status: 401 })).toBe(false);
    expect(isRetryableAnthropicError({ status: 404 })).toBe(false);
    expect(isRetryableAnthropicError({ status: 422 })).toBe(false);
  });

  it('rejects non-numeric or missing status', () => {
    expect(isRetryableAnthropicError({ status: '500' })).toBe(false);
    expect(isRetryableAnthropicError({})).toBe(false);
    expect(isRetryableAnthropicError(null)).toBe(false);
    expect(isRetryableAnthropicError(undefined)).toBe(false);
    expect(isRetryableAnthropicError(new Error('plain'))).toBe(false);
  });
});

describe('recompressForAnthropic', () => {
  // Builds a PNG large enough to exceed Anthropic's 5 MB base64 cap. A
  // 4000x4000 random-noise PNG resists compression and lands ~30-50 MB —
  // plenty to reproduce the WILDLIGHT-A failure mode locally without
  // needing a fixture file.
  async function makeOversizedPng(): Promise<Buffer> {
    const size = 4000;
    const bytes = Buffer.alloc(size * size * 3);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 2654435761) & 0xff;
    return sharp(bytes, { raw: { width: size, height: size, channels: 3 } })
      .png({ compressionLevel: 0 })
      .toBuffer();
  }

  it('recompresses an oversized PNG to a sub-5MB JPEG', async () => {
    const big = await makeOversizedPng();
    expect(big.length).toBeGreaterThan(5 * 1024 * 1024);
    const out = await recompressForAnthropic(big);
    expect(out.mediaType).toBe('image/jpeg');
    expect(out.data.length).toBeLessThan(5 * 1024 * 1024);
    // Sanity: the recompressed buffer is a real JPEG (FF D8 FF magic bytes).
    expect(out.data[0]).toBe(0xff);
    expect(out.data[1]).toBe(0xd8);
    expect(out.data[2]).toBe(0xff);
  });

  it('caps long edge at 2000px regardless of input dimensions', async () => {
    const big = await makeOversizedPng();
    const out = await recompressForAnthropic(big);
    const meta = await sharp(out.data).metadata();
    expect(meta.width).toBeLessThanOrEqual(2000);
    expect(meta.height).toBeLessThanOrEqual(2000);
  });
});
