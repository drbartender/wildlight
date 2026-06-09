import { describe, it, expect, vi } from 'vitest';
import { refreshVariantResolution } from '@/lib/variant-resolution';

// Minimal stub of the pg PoolClient surface refreshVariantResolution uses.
function stubClient(
  artworkRow: { print_width: number | null; print_height: number | null } | null,
  variantRows: Array<{ id: number; size: string }>,
) {
  const updates: Array<{ id: number; ok: boolean | null }> = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/FROM artworks/.test(sql)) {
        return { rows: artworkRow ? [artworkRow] : [], rowCount: artworkRow ? 1 : 0 };
      }
      if (/FROM artwork_variants/.test(sql)) {
        return { rows: variantRows, rowCount: variantRows.length };
      }
      if (/UPDATE artwork_variants/.test(sql)) {
        // params: [min_resolution_ok, variantId]
        updates.push({ ok: params![0] as boolean | null, id: params![1] as number });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  return { client, updates };
}

describe('refreshVariantResolution', () => {
  it('marks each variant ok/blocked from the master short edge', async () => {
    const { client, updates } = stubClient(
      { print_width: 1050, print_height: 720 }, // short 720
      [
        { id: 1, size: '8x10' },
        { id: 2, size: '24x36' },
      ],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await refreshVariantResolution(client as any, 42);
    expect(updates).toContainEqual({ id: 1, ok: false }); // 720/8 = 90 < 150
    expect(updates).toContainEqual({ id: 2, ok: false });
    expect(res.blocked).toBe(2);
    expect(res.ok).toBe(0);
  });

  it('writes NULL min_resolution_ok when the artwork has no dims', async () => {
    const { client, updates } = stubClient(
      { print_width: null, print_height: null },
      [{ id: 7, size: '8x10' }],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await refreshVariantResolution(client as any, 42);
    expect(updates).toContainEqual({ id: 7, ok: null });
  });

  it('reads the artwork via the passed client (in-transaction)', async () => {
    const { client } = stubClient({ print_width: 6016, print_height: 4016 }, []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await refreshVariantResolution(client as any, 42);
    expect(client.query).toHaveBeenCalled();
  });

  it('fails open (writes NULL) on an unparseable size label', async () => {
    const { client, updates } = stubClient({ print_width: 6016, print_height: 4016 }, [
      { id: 9, size: 'A3' },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await refreshVariantResolution(client as any, 42);
    expect(updates).toContainEqual({ id: 9, ok: null });
  });
});
