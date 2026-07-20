import { pool } from '@/lib/db';
import { WallArranger } from '@/components/admin/WallArranger';
import type { LibraryPhoto } from '@/lib/wall-arrange';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Wall & shop · Wildlight admin' };

// Auth is enforced by app/admin/layout.tsx (getAdminSession → /login).
export default async function AdminWallPage() {
  // The Library shows EVERY photo (incl. retired and never-placed), so the old
  // (on_wall OR status<>'retired') filter is dropped — only reserved mid-upload
  // rows (empty web url) are excluded. wall_rank reproduces the homepage sort
  // ((wall_order=0), wall_order, md5(slug)) in SQL for on_wall rows, so the
  // admin wall order equals the public order with no client-side hashing. hd
  // gates the Shop; buyable + price_from_cents drive the Shop tile badge/price.
  // Fail soft on a Neon cold-start blip: render an empty screen, not a 500.
  let photos: LibraryPhoto[] = [];
  try {
    const res = await pool.query<LibraryPhoto>(
      `SELECT a.id, a.slug, a.title, a.image_web_url, a.status, a.on_wall,
              a.updated_at::text AS updated_at,
              (a.image_print_url IS NOT NULL AND a.image_print_url <> '') AS hd,
              EXISTS (SELECT 1 FROM artwork_variants v
                        WHERE v.artwork_id = a.id AND v.buyable) AS buyable,
              (SELECT MIN(v.price_cents) FROM artwork_variants v
                 WHERE v.artwork_id = a.id AND v.buyable) AS price_from_cents,
              CASE WHEN a.on_wall THEN (row_number() OVER (
                     PARTITION BY a.on_wall
                     ORDER BY (a.wall_order = 0), a.wall_order, md5(a.slug)
                   ))::int END AS wall_rank
         FROM artworks a
        WHERE a.image_web_url <> ''
        ORDER BY a.updated_at DESC
        LIMIT 1000`,
    );
    photos = res.rows;
  } catch (err) {
    console.error('[admin/wall] load failed:', err);
  }
  return <WallArranger photos={photos} />;
}
