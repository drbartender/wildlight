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
}

const TYPE_LABEL: Record<string, string> = {
  fine_art: 'Fine art',
  canvas: 'Canvas',
  framed: 'Framed',
  metal: 'Metal',
};

export function VariantTable({ variants }: { variants: VRow[] }) {
  if (!variants.length) return null;
  return (
    <table className="wl-adm-table" style={{ fontSize: 12 }}>
      <thead>
        <tr>
          <th>Type</th>
          <th>Size</th>
          <th>Finish</th>
          <th className="right">Cost</th>
          <th className="right">Price</th>
          <th>Printful ID</th>
          <th style={{ textAlign: 'center' }}>Active</th>
        </tr>
      </thead>
      <tbody>
        {variants.map((v) => (
          <tr key={v.id}>
            <td>{TYPE_LABEL[v.type] ?? v.type}</td>
            <td className="mono">{v.size}</td>
            <td>{v.finish || '—'}</td>
            <td className="right mono muted">{formatUSD(v.cost_cents)}</td>
            <td className="right mono">{formatUSD(v.price_cents)}</td>
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
          </tr>
        ))}
      </tbody>
    </table>
  );
}
