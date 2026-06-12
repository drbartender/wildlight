import { describe, it, expect } from 'vitest';
import {
  partition,
  orderKey,
  removeFromGrid,
  toTray,
  toGrid,
  applyShop,
  type WallTile,
} from '@/lib/wall-arrange';

function tile(id: number, over: Partial<WallTile> = {}): WallTile {
  return {
    id,
    slug: `s${id}`,
    title: `T${id}`,
    image_web_url: `https://img/${id}.jpg`,
    status: 'draft',
    on_wall: true,
    wall_order: 0,
    canSell: false,
    available: false,
    updated_at: `2026-06-1${id}T00:00:00Z`,
    ...over,
  };
}

describe('partition', () => {
  it('splits on on_wall and preserves grid input order', () => {
    const rows = [
      tile(1, { on_wall: true }),
      tile(2, { on_wall: false }),
      tile(3, { on_wall: true }),
    ];
    const { grid, tray } = partition(rows);
    expect(grid.map((t) => t.id)).toEqual([1, 3]);
    expect(tray.map((t) => t.id)).toEqual([2]);
  });

  it('sorts the tray newest-first by updated_at', () => {
    const rows = [
      tile(2, { on_wall: false, updated_at: '2026-06-01T00:00:00Z' }),
      tile(4, { on_wall: false, updated_at: '2026-06-09T00:00:00Z' }),
    ];
    expect(partition(rows).tray.map((t) => t.id)).toEqual([4, 2]);
  });
});

describe('orderKey', () => {
  it('joins ids in order', () => {
    expect(orderKey([tile(3), tile(1), tile(2)])).toBe('3,1,2');
  });
});

describe('removeFromGrid', () => {
  it('drops ids from both live and saved arrays', () => {
    const grid = [tile(1), tile(2), tile(3)];
    const saved = [tile(1), tile(2), tile(3)];
    const r = removeFromGrid(grid, saved, new Set([2]));
    expect(r.grid.map((t) => t.id)).toEqual([1, 3]);
    expect(r.savedGrid.map((t) => t.id)).toEqual([1, 3]);
  });
});

describe('toTray', () => {
  it('moves a tile grid->tray, off both grid and saved, keeping order undirty', () => {
    const s = { grid: [tile(1), tile(2)], tray: [], savedGrid: [tile(1), tile(2)] };
    const n = toTray(s, 1);
    expect(n.grid.map((t) => t.id)).toEqual([2]);
    expect(n.savedGrid.map((t) => t.id)).toEqual([2]);
    expect(n.tray.map((t) => t.id)).toEqual([1]);
    expect(n.tray[0].on_wall).toBe(false);
    expect(orderKey(n.grid)).toBe(orderKey(n.savedGrid)); // not dirty
  });
});

describe('toGrid', () => {
  it('moves a tile tray->grid, appended to both, with on_wall=true wall_order=0', () => {
    const s = {
      grid: [tile(1)],
      tray: [tile(5, { on_wall: false, wall_order: 9 })],
      savedGrid: [tile(1)],
    };
    const n = toGrid(s, 5);
    expect(n.grid.map((t) => t.id)).toEqual([1, 5]);
    expect(n.savedGrid.map((t) => t.id)).toEqual([1, 5]);
    expect(n.tray).toEqual([]);
    expect(n.grid[1].on_wall).toBe(true);
    expect(n.grid[1].wall_order).toBe(0);
    expect(orderKey(n.grid)).toBe(orderKey(n.savedGrid)); // not dirty
  });
});

describe('applyShop', () => {
  it('publishing sets status=published; retiring sets retired + clears available', () => {
    const tiles = [tile(1, { status: 'published', available: true, canSell: true })];
    expect(applyShop(tiles, 1, false)[0]).toMatchObject({ status: 'retired', available: false });
    expect(applyShop(tiles, 1, true)[0]).toMatchObject({ status: 'published' });
  });
  it('leaves other tiles untouched', () => {
    const tiles = [tile(1), tile(2)];
    expect(applyShop(tiles, 1, true)[1]).toBe(tiles[1]);
  });
});
