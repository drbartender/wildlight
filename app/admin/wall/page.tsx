import { pool } from '@/lib/db';
import { WallArranger, type WallTile } from '@/components/admin/WallArranger';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Arrange the wall · Wildlight admin' };

// Auth is enforced by app/admin/layout.tsx (getAdminSession → /login).
export default async function AdminWallPage() {
  // Fail soft on a Neon cold-start blip (matches the homepage wall pattern):
  // render the empty arranger rather than a 500.
  let rows: WallTile[] = [];
  try {
    const res = await pool.query<WallTile>(
      `SELECT a.id, a.slug, a.title, a.image_web_url,
              (a.status = 'published') AS available
         FROM artworks a
        WHERE a.status IN ('draft', 'published')
        ORDER BY (a.wall_order = 0), a.wall_order, md5(a.slug)
        LIMIT 300`,
    );
    rows = res.rows;
  } catch (err) {
    console.error('[admin/wall] load failed:', err);
  }
  return <WallArranger initial={rows} />;
}
