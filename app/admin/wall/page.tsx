import { pool } from '@/lib/db';
import { WallArranger } from '@/components/admin/WallArranger';
import type { LibraryPhoto } from '@/lib/wall-arrange';
import { SHOP_INDEX_LIMIT_DEFAULT } from '@/lib/shop-limit';
import { getShopIndexLimit } from '@/lib/site-settings';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Wall & shop · Wildlight admin' };

// Auth is enforced by app/admin/layout.tsx (getAdminSession → /login).
export default async function AdminWallPage() {
  // The Library shows EVERY photo (incl. retired and never-placed), so the old
  // (on_wall OR status<>'retired') filter is dropped — only reserved mid-upload
  // rows (empty web url) are excluded. wall_rank reproduces the homepage sort
  // ((wall_order=0), wall_order, md5(slug)) in SQL for on_wall rows, so the
  // admin wall order equals the public order with no client-side hashing. hd
  // gates the Shop; buyable drives the Shop tile's "no sizes available" badge.
  // Fail soft on a Neon cold-start blip: render an empty screen, not a 500.
  let photos: LibraryPhoto[] = [];
  let collections: { id: number; title: string }[] = [];
  let shopIndexLimit = SHOP_INDEX_LIMIT_DEFAULT;
  try {
    const [res, colRes, limit] = await Promise.all([
      pool.query<LibraryPhoto>(
      `SELECT a.id, a.slug, a.title, a.image_web_url, a.status, a.on_wall,
              a.updated_at::text AS updated_at,
              (a.image_print_url IS NOT NULL AND a.image_print_url <> '') AS hd,
              EXISTS (SELECT 1 FROM artwork_variants v
                        WHERE v.artwork_id = a.id AND v.buyable) AS buyable,
              CASE WHEN a.on_wall THEN (row_number() OVER (
                     PARTITION BY a.on_wall
                     ORDER BY (a.wall_order = 0), a.wall_order, md5(a.slug)
                   ))::int END AS wall_rank,
              a.collection_id,
              c.title AS collection_title,
              a.collection_order,
              a.display_order
         FROM artworks a
         LEFT JOIN collections c ON c.id = a.collection_id
        WHERE a.image_web_url <> ''
        ORDER BY a.updated_at DESC
        LIMIT 1000`,
      ),
      // Its own query, not derived from `photos`: the filter tray must show a
      // chapter even when nothing in it is currently in the shop, and it must
      // list them in Dan's arranged collection order.
      pool.query<{ id: number; title: string }>(
        'SELECT id, title FROM collections ORDER BY display_order, id',
      ),
      // Never throws; degrades to the default. See lib/site-settings.ts.
      getShopIndexLimit(),
    ]);
    photos = res.rows;
    collections = colRes.rows;
    shopIndexLimit = limit;
  } catch (err) {
    console.error('[admin/wall] load failed:', err);
  }
  return (
    <WallArranger
      photos={photos}
      collections={collections}
      shopIndexLimit={shopIndexLimit}
    />
  );
}
