import { describe, it, expect } from 'vitest';
import { isUrlFetchError, isRetryableAnthropicError } from '@/lib/anthropic-image';

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
