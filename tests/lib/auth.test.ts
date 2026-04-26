import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { hashPassword, verifyPassword, signAdminToken, verifyAdminToken } from '@/lib/auth';

describe('password hashing', () => {
  it('hashes and verifies', async () => {
    const hash = await hashPassword('secret12345');
    expect(hash).not.toBe('secret12345');
    expect(await verifyPassword('secret12345', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});

describe('admin jwt', () => {
  it('sign then verify returns payload', () => {
    const token = signAdminToken({ id: 1, email: 'dan@x.com', v: 1 });
    const payload = verifyAdminToken(token);
    expect(payload.id).toBe(1);
    expect(payload.email).toBe('dan@x.com');
    expect(payload.v).toBe(1);
  });
  it('rejects token without session version', () => {
    // Pre-versioning tokens (no `v` field) should not validate after the
    // session-revocation rollout — a stolen cookie from before this change
    // must lose access immediately.
    const stale = jwt.sign(
      { id: 1, email: 'dan@x.com' },
      process.env.JWT_SECRET!,
      { expiresIn: '30d' },
    );
    expect(() => verifyAdminToken(stale)).toThrow();
  });
  it('rejects tampered token', () => {
    const token = signAdminToken({ id: 1, email: 'dan@x.com', v: 1 }) + 'x';
    expect(() => verifyAdminToken(token)).toThrow();
  });
  it('rejects garbage token', () => {
    expect(() => verifyAdminToken('nope')).toThrow();
  });
});
