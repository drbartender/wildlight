import { describe, it, expect, vi } from 'vitest';
import { refreshVariantResolution } from '@/lib/variant-resolution';

interface CapturedUpdate {
  id: number;
  ok: boolean | null;
  /** True if the UPDATE's SET clause includes resolution_override. */
  writesOverride: boolean;
  /** Value written to resolution_override, when present. */
  overrideValue: boolean | null;
}

// Minimal stub of the pg PoolClient surface refreshVariantResolution uses.
// Captures each UPDATE so tests can assert both the value AND which columns
// the SET clause touches — required to cover FIX 3 (override-clear on FALSE).
function stubClient(
  artworkRow:
    | {
        print_width: number | null;
        print_height: number | null;
        image_print_url: string | null;
      }
    | null,
  variantRows: Array<{ id: number; size: string }>,
) {
  const updates: CapturedUpdate[] = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/FROM artworks/.test(sql)) {
        return { rows: artworkRow ? [artworkRow] : [], rowCount: artworkRow ? 1 : 0 };
      }
      if (/FROM artwork_variants/.test(sql)) {
        return { rows: variantRows, rowCount: variantRows.length };
      }
      if (/UPDATE artwork_variants/.test(sql)) {
        // min_resolution_ok is the first param; the variant id is the last.
        const ok = params![0] as boolean | null;
        const id = params![params!.length - 1] as number;
        const writesOverride = /resolution_override/.test(sql);
        // The two SET shapes:
        //   SET min_resolution_ok = $1, resolution_override = $2  (no-master path)
        //   SET min_resolution_ok = $1, resolution_override = FALSE (low-DPI path)
        let overrideValue: boolean | null = null;
        if (writesOverride) {
          if (params!.length >= 3 && typeof params![1] === 'boolean') {
            overrideValue = params![1] as boolean;
          } else {
            // Literal FALSE in the SQL.
            overrideValue = false;
          }
        }
        updates.push({ id, ok, writesOverride, overrideValue });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  return { client, updates };
}

const MASTER = 'artworks-print/x.jpg';

describe('refreshVariantResolution', () => {
  it('marks each variant ok/blocked from the master short edge', async () => {
    const { client, updates } = stubClient(
      { print_width: 1050, print_height: 720, image_print_url: MASTER }, // short 720
      [
        { id: 1, size: '8x10' },
        { id: 2, size: '24x36' },
      ],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await refreshVariantResolution(client as any, 42);
    expect(updates.find((u) => u.id === 1)?.ok).toBe(false); // 720/8 = 90 < 150
    expect(updates.find((u) => u.id === 2)?.ok).toBe(false);
    expect(res.blocked).toBe(2);
    expect(res.ok).toBe(0);
    expect(res.hasMaster).toBe(true);
  });

  it('writes NULL when the artwork has a master but no measured dims', async () => {
    const { client, updates } = stubClient(
      { print_width: null, print_height: null, image_print_url: MASTER },
      [{ id: 7, size: '8x10' }],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await refreshVariantResolution(client as any, 42);
    expect(updates.find((u) => u.id === 7)?.ok).toBe(null);
    // NULL path must not touch resolution_override.
    expect(updates.find((u) => u.id === 7)?.writesOverride).toBe(false);
    expect(res.hasMaster).toBe(true);
  });

  it('fails CLOSED (writes FALSE) when the artwork has no master at all', async () => {
    const { client, updates } = stubClient(
      { print_width: null, print_height: null, image_print_url: null },
      [{ id: 5, size: '8x10' }],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await refreshVariantResolution(client as any, 42);
    const u = updates.find((x) => x.id === 5);
    expect(u?.ok).toBe(false);
    // No-master path must also clear any stale resolution_override.
    expect(u?.writesOverride).toBe(true);
    expect(u?.overrideValue).toBe(false);
    expect(res.blocked).toBe(1);
    expect(res.hasMaster).toBe(false);
  });

  it('reads the artwork via the passed client (in-transaction)', async () => {
    const { client } = stubClient(
      { print_width: 6016, print_height: 4016, image_print_url: MASTER },
      [],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await refreshVariantResolution(client as any, 42);
    expect(client.query).toHaveBeenCalled();
  });

  it('fails open (writes NULL) on an unparseable size label', async () => {
    const { client, updates } = stubClient(
      { print_width: 6016, print_height: 4016, image_print_url: MASTER },
      [{ id: 9, size: 'A3' }],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await refreshVariantResolution(client as any, 42);
    const u = updates.find((x) => x.id === 9);
    expect(u?.ok).toBe(null);
    // Unparseable → NULL → must not touch resolution_override.
    expect(u?.writesOverride).toBe(false);
  });

  // --- FIX 10: extended coverage ---

  it('lands exactly on the 150-DPI boundary for a 10" short edge', async () => {
    // 10" short edge × 150 DPI = 1500px required short edge.
    const { client: c1, updates: u1 } = stubClient(
      { print_width: 1500, print_height: 2000, image_print_url: MASTER },
      [{ id: 1, size: '10x20' }],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await refreshVariantResolution(c1 as any, 1);
    expect(u1.find((u) => u.id === 1)?.ok).toBe(true);

    // 1499px short edge → just under the floor.
    const { client: c2, updates: u2 } = stubClient(
      { print_width: 1499, print_height: 2000, image_print_url: MASTER },
      [{ id: 1, size: '10x20' }],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await refreshVariantResolution(c2 as any, 1);
    expect(u2.find((u) => u.id === 1)?.ok).toBe(false);
  });

  it('treats portrait and landscape symmetrically (1050x720 == 720x1050)', async () => {
    const variants = [{ id: 1, size: '8x10' }];
    const { client: cL, updates: uL } = stubClient(
      { print_width: 1050, print_height: 720, image_print_url: MASTER },
      variants,
    );
    const { client: cP, updates: uP } = stubClient(
      { print_width: 720, print_height: 1050, image_print_url: MASTER },
      variants,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await refreshVariantResolution(cL as any, 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await refreshVariantResolution(cP as any, 1);
    expect(uL.find((u) => u.id === 1)?.ok).toBe(uP.find((u) => u.id === 1)?.ok);
  });

  it('clears for the largest catalog size 24x36 at the boundary', async () => {
    // 24" short edge × 150 DPI = 3600px required.
    const { client: pass, updates: passU } = stubClient(
      { print_width: 3600, print_height: 5400, image_print_url: MASTER },
      [{ id: 1, size: '24x36' }],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await refreshVariantResolution(pass as any, 1);
    expect(passU.find((u) => u.id === 1)?.ok).toBe(true);

    const { client: fail, updates: failU } = stubClient(
      { print_width: 3599, print_height: 5400, image_print_url: MASTER },
      [{ id: 1, size: '24x36' }],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await refreshVariantResolution(fail as any, 1);
    expect(failU.find((u) => u.id === 1)?.ok).toBe(false);
  });

  it('handles a mixed-result artwork (some sizes pass, some fail)', async () => {
    // 1800px short edge → 1800/8 = 225 DPI (8" passes), 1800/16 = 112 DPI (16" fails).
    const { client, updates } = stubClient(
      { print_width: 1800, print_height: 2400, image_print_url: MASTER },
      [
        { id: 1, size: '8x10' },
        { id: 2, size: '16x20' },
        { id: 3, size: '24x36' },
      ],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await refreshVariantResolution(client as any, 1);
    expect(updates.find((u) => u.id === 1)?.ok).toBe(true);
    expect(updates.find((u) => u.id === 2)?.ok).toBe(false);
    expect(updates.find((u) => u.id === 3)?.ok).toBe(false);
    expect(res.ok).toBe(1);
    expect(res.blocked).toBe(2);
    // Failing rows in the measured path must also clear resolution_override
    // (FIX 3 — master swap to a smaller file must force conscious re-approval).
    expect(updates.find((u) => u.id === 2)?.writesOverride).toBe(true);
    expect(updates.find((u) => u.id === 2)?.overrideValue).toBe(false);
    expect(updates.find((u) => u.id === 3)?.writesOverride).toBe(true);
    expect(updates.find((u) => u.id === 3)?.overrideValue).toBe(false);
    // Passing row does not touch resolution_override.
    expect(updates.find((u) => u.id === 1)?.writesOverride).toBe(false);
  });

  it('FIX 3: flipping a variant to FALSE clears any pre-existing resolution_override', async () => {
    // Master swap to a smaller file — 720px short, 8x10 needs 1200px → FALSE.
    // refreshVariantResolution must write resolution_override = FALSE alongside
    // min_resolution_ok = FALSE so a stale override can't keep the variant buyable.
    const { client, updates } = stubClient(
      { print_width: 720, print_height: 1050, image_print_url: MASTER },
      [{ id: 11, size: '8x10' }],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await refreshVariantResolution(client as any, 42);
    const u = updates.find((x) => x.id === 11);
    expect(u?.ok).toBe(false);
    expect(u?.writesOverride).toBe(true);
    expect(u?.overrideValue).toBe(false);
  });

  it('reports hasMaster in the rollup so callers can distinguish blocked reasons', async () => {
    const { client, updates: _u } = stubClient(
      { print_width: null, print_height: null, image_print_url: null },
      [{ id: 1, size: '8x10' }],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await refreshVariantResolution(client as any, 1);
    expect(res.hasMaster).toBe(false);
    expect(res.blocked).toBe(1);
  });
});
