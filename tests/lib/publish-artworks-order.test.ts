import { describe, it, expect } from 'vitest';
import type { PoolClient } from 'pg';
import { publishArtworks } from '@/lib/publish-artworks';

/** Records every SQL string and param set, and replays canned SELECT results. */
function fakeClient(rows: { id: number; status: string }[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT id, status')) return { rows, rowCount: rows.length };
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;
  return { client, calls };
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('publishArtworks position assignment', () => {
  it('assigns positions with ROW_NUMBER, never MAX + 1', async () => {
    // MAX + 1 would hand an entire batch the identical position. This helper
    // takes an ids[], so the batch case is the normal case, not an edge case.
    const { client, calls } = fakeClient([
      { id: 1, status: 'draft' },
      { id: 2, status: 'draft' },
    ]);
    await publishArtworks(client, [1, 2]);
    const orderSql = calls.filter((c) => c.sql.includes('display_order'));
    expect(orderSql.length).toBeGreaterThan(0);
    expect(norm(orderSql[0].sql)).toContain('ROW_NUMBER() OVER (ORDER BY id)');
  });

  it('excludes the transitioning rows from the MAX it appends after', async () => {
    // The status UPDATE runs FIRST, so those rows are already status='published'
    // by the time the MAX is read. Without the exclusion the MAX reads their own
    // stale manifest indices back in and the batch lands mid-grid.
    const { client, calls } = fakeClient([{ id: 1, status: 'draft' }]);
    await publishArtworks(client, [1]);
    const maxSql = calls.find((c) => c.sql.includes('MAX(display_order)'));
    expect(maxSql).toBeDefined();
    expect(norm(maxSql!.sql)).toContain('id <> ALL($1::int[])');
    expect(norm(maxSql!.sql)).toContain("status = 'published'");
  });

  it('passes only the transitioning ids, not every eligible id', async () => {
    // Already-published rows must not be repositioned: re-publishing one would
    // otherwise kick it to the end of /shop.
    const { client, calls } = fakeClient([
      { id: 1, status: 'draft' },
      { id: 2, status: 'published' },
    ]);
    await publishArtworks(client, [1, 2]);
    const orderSql = calls.find((c) => c.sql.includes('display_order'));
    expect(orderSql!.params[0]).toEqual([1]);
  });

  it('does no position work when nothing is transitioning', async () => {
    const { client, calls } = fakeClient([{ id: 1, status: 'published' }]);
    await publishArtworks(client, [1]);
    expect(calls.some((c) => c.sql.includes('display_order'))).toBe(false);
  });
});
