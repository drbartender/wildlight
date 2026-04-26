import { ExternalServiceError } from './errors';
import type { PrintfulOrderInput, PrintfulOrder } from '@/types/printful';

const BASE = 'https://api.printful.com';

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const apiKey = process.env.PRINTFUL_API_KEY;
  const storeId = process.env.PRINTFUL_STORE_ID;
  if (!apiKey) throw new Error('PRINTFUL_API_KEY missing');

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${apiKey}`);
  headers.set('Content-Type', 'application/json');
  if (storeId) headers.set('X-PF-Store-Id', storeId);

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}) as Record<string, unknown>);
  if (!res.ok) {
    const msg =
      (body as { result?: string; error?: { message?: string } })?.result ||
      (body as { error?: { message?: string } })?.error?.message ||
      `printful ${res.status}`;
    throw new ExternalServiceError('printful', String(res.status), msg);
  }
  return (body as { result: T }).result;
}

export const printful = {
  createOrder: (input: PrintfulOrderInput) =>
    call<PrintfulOrder>('/orders', { method: 'POST', body: JSON.stringify(input) }),
  getOrder: (id: number | string) => call<PrintfulOrder>(`/orders/${id}`),
  confirmOrder: (id: number) =>
    call<PrintfulOrder>(`/orders/${id}/confirm`, { method: 'POST' }),
  cancelOrder: (id: number) =>
    call<PrintfulOrder>(`/orders/${id}`, { method: 'DELETE' }),
  listSyncProducts: () => call<unknown[]>('/store/products'),
  createSyncProduct: (body: unknown) =>
    call<{ sync_variants?: Array<{ id: number; external_id?: string }> }>(
      '/store/products',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  getSyncProduct: (id: number) => call<unknown>(`/store/products/${id}`),
};
