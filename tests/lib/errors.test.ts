import { describe, it, expect } from 'vitest';
import {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  PermissionError,
  ExternalServiceError,
} from '@/lib/errors';

describe('errors', () => {
  it('AppError preserves message, status, and code', () => {
    const e = new AppError('boom', 500, 'INTERNAL');
    expect(e.message).toBe('boom');
    expect(e.status).toBe(500);
    expect(e.code).toBe('INTERNAL');
    expect(e instanceof Error).toBe(true);
  });
  it('ValidationError defaults to 400', () => {
    expect(new ValidationError('bad').status).toBe(400);
  });
  it('NotFoundError defaults to 404', () => {
    expect(new NotFoundError('missing').status).toBe(404);
  });
  it('ConflictError defaults to 409', () => {
    expect(new ConflictError('taken').status).toBe(409);
  });
  it('PermissionError defaults to 403', () => {
    expect(new PermissionError('nope').status).toBe(403);
  });
  it('ExternalServiceError defaults to 502 and carries upstream code', () => {
    const e = new ExternalServiceError('stripe', 'card_declined');
    expect(e.status).toBe(502);
    expect(e.service).toBe('stripe');
    expect(e.upstreamCode).toBe('card_declined');
  });
});
