import { pool } from '@/lib/db';
import { WallArranger, type WallTile } from '@/components/admin/WallArranger';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Arrange the wall · Wildlight admin' };

// Auth is enforced by app/admin/layout.tsx (getAdminSession → /login).
export default async function AdminWallPage() {
  const { rows } = await pool.query<WallTile>(
    `SELECT a.id, a.slug, a.title, a.image_web_url,
            (a.status = 'published') AS available
       FROM artworks a
      WHERE a.status IN ('draft', 'published')
      ORDER BY (a.wall_order = 0), a.wall_order, md5(a.slug)
      LIMIT 300`,
  );
  return <WallArranger initial={rows} />;
}
