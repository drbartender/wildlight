const COLORS: Record<string, string> = {
  draft: '#bbb',
  published: '#2a8a5c',
  retired: '#888',
  pending: '#bbb',
  paid: '#d89e3a',
  submitted: '#3a7aa8',
  needs_review: '#b33030',
  fulfilled: '#3a7aa8',
  shipped: '#2a8a5c',
  delivered: '#2a8a5c',
  canceled: '#777',
  refunded: '#b33030',
};

export function StatusPill({ status }: { status: string }) {
  const bg = COLORS[status] || '#999';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        background: bg,
        color: 'white',
        borderRadius: 10,
        fontSize: 11,
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
      }}
    >
      {status}
    </span>
  );
}
