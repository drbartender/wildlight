const LABELS: Record<string, string> = {
  published: 'Published',
  draft: 'Draft',
  retired: 'Retired',
  pending: 'Pending',
  paid: 'Paid',
  submitted: 'Submitted',
  resubmitting: 'Resubmitting',
  needs_review: 'Needs review',
  fulfilled: 'Fulfilled',
  shipped: 'Shipped',
  delivered: 'Delivered',
  canceled: 'Canceled',
  refunded: 'Refunded',
  active: 'Active',
  unsub: 'Unsub',
};

export function AdminPill({ status }: { status: string }) {
  const label = LABELS[status] ?? status;
  return (
    <span className="wl-adm-pill" data-status={status}>
      <span className="dot" aria-hidden="true" />
      {label}
    </span>
  );
}
