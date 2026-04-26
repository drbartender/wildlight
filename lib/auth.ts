import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AppError } from './errors';

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  // Defer hard failure until something actually tries to sign/verify, so module
  // import during tests / build doesn't blow up when the env isn't set.
}

export interface AdminTokenPayload {
  id: number;
  email: string;
  /** Session version. Bumped on password change to invalidate prior tokens. */
  v: number;
}

function requireSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET env var required');
  return s;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signAdminToken(payload: AdminTokenPayload): string {
  return jwt.sign(payload, requireSecret(), { expiresIn: '30d' });
}

export function verifyAdminToken(token: string): AdminTokenPayload {
  try {
    const decoded = jwt.verify(token, requireSecret()) as Partial<AdminTokenPayload>;
    if (
      typeof decoded.id !== 'number' ||
      typeof decoded.email !== 'string' ||
      typeof decoded.v !== 'number'
    ) {
      throw new AppError('malformed token', 401, 'BAD_TOKEN');
    }
    return { id: decoded.id, email: decoded.email, v: decoded.v };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('invalid token', 401, 'BAD_TOKEN');
  }
}
