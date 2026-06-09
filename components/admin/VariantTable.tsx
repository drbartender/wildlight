'use client';

import { formatUSD } from '@/lib/money';

export interface VRow {
  id: number;
  type: string;
  size: string;
  finish: string | null;
  price_cents: number;
  cost_cents: number;
  active: boolean;
  printful_sync_variant_id: number | null;
  min_resolution_ok: boolean | null;
  resolution_override: boolean;
  buyable: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  fine_art: 'Fine art',
  canvas: 'Canvas',
  framed: 'Framed',
  metal: 'Metal',
};

function StatusBadge({ v }: { v: VRow }) {
  const s = { fontSize: 10 };
  if (!v.active) {
    return <span style={{ ...s, color: 'var(--adm-muted)' }}>— inactive</span>;
  }
  if (!v.buyable) {
    return <span style={{ ...s, color: 'var(--adm-red)' }}>⚠ low-res</span>;
  }
  if (v.resolution_override) {
    return <span style={{ ...s, color: 'var(--adm-amber, var(--adm-muted))' }}>↯ override</span>;
  }
  if (v.min_resolution_ok === null) {
    return <span style={{ ...s, color: 'var(--adm-muted)' }}>— unmeasured</span>;
  }
  return <span style={{ ...s, color: 'var(--adm-green)' }}>✓ sellable</span>;
}

export function VariantTable({ variants }: { variants: VRow[] }) {
  if (!variants.length) return null;
  return (
    <table className="wl-adm-table" style={{ fontSize: 12 }}>
      <thead>
        <tr>
          <th>Type</th>
          <th>Size</th>
          <th>Finish</th>
          <th>Cost</th>
          <th>Price</th>
          <th>Printful ID</th>
          <th style={{ textAlign: 'center' }}>Active</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {variants.map((v) => (
          <tr key={v.id}>
            <td>{TYPE_LABEL[v.type] ?? v.type}</td>
            <td className="mono">{v.size}</td>
            <td>{v.finish || '—'}</td>
            <td className="mono muted">{formatUSD(v.cost_cents)}</td>
            <td className="mono">{formatUSD(v.price_cents)}</td>
            <td className="mono muted">
              {v.printful_sync_variant_id || 'not synced'}
            </td>
            <td
              style={{
                textAlign: 'center',
                color: v.active
                  ? 'var(--adm-green)'
                  : 'var(--adm-muted)',
              }}
            >
              {v.active ? '✓' : '—'}
            </td>
            <td>
              <StatusBadge v={v} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
