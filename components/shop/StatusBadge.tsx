import type { ReactNode } from 'react';

export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'submitted'
  | 'fulfilled'
  | 'shipped'
  | 'delivered'
  | 'needs_review'
  | 'refunding'
  | 'refunded'
  | 'canceled'
  | 'resubmitting';

const LABELS: Record<OrderStatus, string> = {
  pending:      'Pending',
  paid:         'Paid',
  submitted:    'Submitted',
  fulfilled:    'Fulfilled',
  shipped:      'Shipped',
  delivered:    'Delivered',
  needs_review: 'Needs review',
  refunding:    'Refunding',
  refunded:     'Refunded',
  canceled:     'Canceled',
  resubmitting: 'Resubmitting',
};

export function StatusBadge({ status }: { status: string }): ReactNode {
  const label = (LABELS as Record<string, string>)[status] ?? status.replace('_', ' ');
  return (
    <span className="wl-status-badge" data-status={status}>
      {label}
    </span>
  );
}
