import { describe, it, expect } from 'vitest';
import { renderEventText, type OrderEvent } from '@/lib/order-event-text';

function ev(partial: Partial<OrderEvent>): OrderEvent {
  return {
    id: 1,
    type: 'placed',
    who: 'customer',
    payload: {},
    created_at: '2026-04-24T00:00:00Z',
    ...partial,
  };
}

describe('renderEventText', () => {
  it('renders placed', () => {
    expect(renderEventText(ev({ type: 'placed' }))).toBe('Placed by customer');
  });

  it('renders paid with USD-formatted amount', () => {
    expect(
      renderEventText(
        ev({ type: 'paid', who: 'stripe', payload: { amount_cents: 12800 } }),
      ),
    ).toBe('Paid · $128.00');
  });

  it('renders printful_submitted with printful order id', () => {
    expect(
      renderEventText(
        ev({
          type: 'printful_submitted',
          who: 'printful',
          payload: { printful_order_id: 'P-9001' },
        }),
      ),
    ).toBe('Submitted to Printful · #P-9001');
  });

  it('renders printful_flagged with reason', () => {
    expect(
      renderEventText(
        ev({
          type: 'printful_flagged',
          who: 'system',
          payload: { reason: 'missing sync variant' },
        }),
      ),
    ).toBe('Flagged — missing sync variant');
  });

  it('renders shipped with carrier + tracking number', () => {
    expect(
      renderEventText(
        ev({
          type: 'shipped',
          who: 'printful',
          payload: { tracking_number: '1Z999', carrier: 'UPS' },
        }),
      ),
    ).toBe('Shipped via UPS · 1Z999');
  });

  it('renders shipped without carrier as "carrier"', () => {
    expect(
      renderEventText(
        ev({
          type: 'shipped',
          who: 'printful',
          payload: { tracking_number: '1Z999' },
        }),
      ),
    ).toBe('Shipped via carrier · 1Z999');
  });

  it('renders delivered', () => {
    expect(renderEventText(ev({ type: 'delivered', who: 'printful' }))).toBe(
      'Delivered',
    );
  });

  it('renders refund_initiated with the initiating actor', () => {
    expect(
      renderEventText(ev({ type: 'refund_initiated', who: 'admin' })),
    ).toBe('Refund initiated by admin');
  });

  it('renders refunded with amount when present', () => {
    expect(
      renderEventText(
        ev({ type: 'refunded', who: 'admin', payload: { amount_cents: 12800 } }),
      ),
    ).toBe('Refunded · $128.00');
  });

  it('renders refunded without amount as just "Refunded"', () => {
    expect(renderEventText(ev({ type: 'refunded', who: 'admin' }))).toBe(
      'Refunded',
    );
  });

  it('renders resubmit_attempted ok as success', () => {
    expect(
      renderEventText(
        ev({
          type: 'resubmit_attempted',
          who: 'admin',
          payload: { outcome: 'ok' },
        }),
      ),
    ).toBe('Resubmit succeeded');
  });

  it('renders resubmit_attempted failed with reason', () => {
    expect(
      renderEventText(
        ev({
          type: 'resubmit_attempted',
          who: 'admin',
          payload: { outcome: 'failed', reason: 'timeout' },
        }),
      ),
    ).toBe('Resubmit failed — timeout');
  });

  it('renders admin_note with text', () => {
    expect(
      renderEventText(
        ev({
          type: 'admin_note',
          who: 'admin',
          payload: { text: 'called Dan; swapping print' },
        }),
      ),
    ).toBe('Note — called Dan; swapping print');
  });

  it('renders canceled', () => {
    expect(renderEventText(ev({ type: 'canceled', who: 'admin' }))).toBe(
      'Canceled',
    );
  });

  it('renders error with message', () => {
    expect(
      renderEventText(
        ev({ type: 'error', who: 'system', payload: { message: 'printful 502' } }),
      ),
    ).toBe('Error — printful 502');
  });
});
