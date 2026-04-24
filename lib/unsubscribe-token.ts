import crypto from 'node:crypto';

/**
 * Stateless, tamper-proof unsubscribe tokens. HMAC over (id + email) using
 * JWT_SECRET. No DB lookup needed to verify — the token itself is proof of
 * intent. Required for CAN-SPAM / GDPR one-click unsubscribe.
 */

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET required for unsubscribe tokens');
  return s;
}

export function makeUnsubToken(subscriberId: number, email: string): string {
  const payload = `unsub:${subscriberId}:${email.toLowerCase()}`;
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function verifyUnsubToken(
  subscriberId: number,
  email: string,
  token: string,
): boolean {
  const expected = makeUnsubToken(subscriberId, email);
  const given = Buffer.from(token, 'base64url');
  const want = Buffer.from(expected, 'base64url');
  if (given.length !== want.length) return false;
  try {
    return crypto.timingSafeEqual(given, want);
  } catch {
    return false;
  }
}

export function unsubUrl(subscriberId: number, email: string, baseUrl: string): string {
  const t = makeUnsubToken(subscriberId, email);
  const params = new URLSearchParams({
    id: String(subscriberId),
    e: email.toLowerCase(),
    t,
  });
  return `${baseUrl.replace(/\/$/, '')}/api/subscribe/unsubscribe?${params}`;
}
