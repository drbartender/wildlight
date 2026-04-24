import { formatUSD } from '@/lib/money';

export type OrderEventType =
  | 'placed'
  | 'paid'
  | 'printful_submitted'
  | 'printful_flagged'
  | 'shipped'
  | 'delivered'
  | 'refund_initiated'
  | 'refunded'
  | 'resubmit_attempted'
  | 'canceled'
  | 'admin_note'
  | 'error';

export type OrderEventWho =
  | 'customer'
  | 'system'
  | 'admin'
  | 'stripe'
  | 'printful';

export interface OrderEvent {
  id: number;
  type: OrderEventType;
  who: OrderEventWho;
  payload: Record<string, unknown>;
  created_at: string;
}

export function renderEventText(e: OrderEvent): string {
  switch (e.type) {
    case 'placed':
      return 'Placed by customer';
    case 'paid': {
      const amount = Number(e.payload.amount_cents ?? 0);
      return `Paid · ${formatUSD(amount)}`;
    }
    case 'printful_submitted': {
      const id = e.payload.printful_order_id;
      return id != null
        ? `Submitted to Printful · #${id}`
        : 'Submitted to Printful';
    }
    case 'printful_flagged': {
      const reason =
        typeof e.payload.reason === 'string' ? e.payload.reason : 'unknown';
      return `Flagged — ${reason}`;
    }
    case 'shipped': {
      const num =
        typeof e.payload.tracking_number === 'string'
          ? e.payload.tracking_number
          : '';
      const carrier =
        typeof e.payload.carrier === 'string' ? e.payload.carrier : 'carrier';
      return num ? `Shipped via ${carrier} · ${num}` : 'Shipped';
    }
    case 'delivered':
      return 'Delivered';
    case 'refund_initiated':
      return `Refund initiated by ${e.who}`;
    case 'refunded': {
      const amount =
        typeof e.payload.amount_cents === 'number'
          ? e.payload.amount_cents
          : null;
      return amount != null ? `Refunded · ${formatUSD(amount)}` : 'Refunded';
    }
    case 'resubmit_attempted': {
      const outcome = e.payload.outcome;
      if (outcome === 'ok') return 'Resubmit succeeded';
      const reason =
        typeof e.payload.reason === 'string' ? e.payload.reason : 'unknown';
      return `Resubmit failed — ${reason}`;
    }
    case 'admin_note': {
      const text =
        typeof e.payload.text === 'string' ? e.payload.text : '';
      return `Note — ${text}`;
    }
    case 'canceled':
      return 'Canceled';
    case 'error': {
      const msg =
        typeof e.payload.message === 'string'
          ? e.payload.message
          : 'unknown error';
      return `Error — ${msg}`;
    }
  }
}
