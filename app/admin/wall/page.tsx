import { pool } from '@/lib/db';
import { WallArranger } from '@/components/admin/WallArranger';
import { partition, type WallTile } from '@/lib/wall-arrange';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Arrange the wall · Wildlight admin' };

// Auth is enforced by app/admin/layout.tsx (getAdminSession → /login).
export default async function AdminWallPage() {
  // ONE query, partitioned in memory — not two parallel queries. Two queries
  // on separate connections have no shared snapshot, so a concurrent on_wall
  // toggle between them could make a piece appear in both lists (React key
  // collision) or neither. Fail soft on a Neon cold-start blip: render the
  // empty arranger rather than a 500.
  //
  // WHERE (on_wall OR status<>'retired') keeps fully-dead pieces (retired AND
  // off-wall) out of the tray, while still surfacing a retired-but-on_wall
  // piece on the grid (the "on wall, not for sale" state). canSell is stricter
  // than the real publish gate (image_print_url IS NOT NULL) so a transient
  // reserved row (image_print_url='') gets no Shop switch. updated_at::text so
  // it string-sorts chronologically in partition().
  let rows: WallTile[] = [];
  try {
    const res = await pool.query<WallTile>(
      `SELECT a.id, a.slug, a.title, a.image_web_url, a.status, a.on_wall,
              a.wall_order, a.updated_at::text AS updated_at,
              (a.image_print_url IS NOT NULL AND a.image_print_url <> '') AS "canSell",
              (a.status = 'published'
                 AND EXISTS (SELECT 1 FROM artwork_variants v
                               WHERE v.artwork_id = a.id AND v.buyable)) AS available
         FROM artworks a
        WHERE (a.on_wall OR a.status <> 'retired')
          AND a.image_web_url <> ''
        ORDER BY (a.wall_order = 0), a.wall_order, md5(a.slug)
        LIMIT 600`,
    );
    rows = res.rows;
  } catch (err) {
    console.error('[admin/wall] load failed:', err);
  }
  const { grid, tray } = partition(rows);
  return <WallArranger initialGrid={grid} initialTray={tray} />;
}
