import { describe, it, expect } from 'vitest';
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
    const token = signAdminToken({ id: 1, email: 'dan@x.com' });
    const payload = verifyAdminToken(token);
    expect(payload.id).toBe(1);
    expect(payload.email).toBe('dan@x.com');
  });
  it('rejects tampered token', () => {
    const token = signAdminToken({ id: 1, email: 'dan@x.com' }) + 'x';
    expect(() => verifyAdminToken(token)).toThrow();
  });
  it('rejects garbage token', () => {
    expect(() => verifyAdminToken('nope')).toThrow();
  });
});
