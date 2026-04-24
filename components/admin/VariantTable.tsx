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

export function VariantTable({ variants }: { variants: VRow[] }) {
  if (!variants.length) return null;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>
          <th style={{ padding: 8 }}>Type</th>
          <th style={{ padding: 8 }}>Size</th>
          <th style={{ padding: 8 }}>Finish</th>
          <th style={{ padding: 8 }}>Price</th>
          <th style={{ padding: 8 }}>Cost</th>
          <th style={{ padding: 8 }}>Printful</th>
          <th style={{ padding: 8 }}>Active</th>
        </tr>
      </thead>
      <tbody>
        {variants.map((v) => (
          <tr key={v.id} style={{ borderBottom: '1px solid #eee' }}>
            <td style={{ padding: 8, textTransform: 'capitalize' }}>{v.type}</td>
            <td style={{ padding: 8 }}>{v.size}</td>
            <td style={{ padding: 8 }}>{v.finish || '—'}</td>
            <td style={{ padding: 8 }}>{formatUSD(v.price_cents)}</td>
            <td style={{ padding: 8, color: '#777' }}>{formatUSD(v.cost_cents)}</td>
            <td style={{ padding: 8, color: '#777' }}>
              {v.printful_sync_variant_id || 'not synced'}
            </td>
            <td style={{ padding: 8 }}>{v.active ? '✓' : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
