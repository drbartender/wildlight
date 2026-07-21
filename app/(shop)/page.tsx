import Link from 'next/link';
import type { Metadata } from 'next';
import { pool } from '@/lib/db';
import { VintageWall, type WallItem } from '@/components/site/VintageWall';
import { EmailCaptureStrip } from '@/components/site/EmailCaptureStrip';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Wildlight Imagery — Dan Raby, Aurora, Colorado',
  description:
    'Unique and defining photography. The photographs of Dan Raby — a wall of fine-art, landscape, macro, and night work. Select pieces available as archival prints.',
};

interface WallRow {
  slug: string;
  title: string;
  image_web_url: string;
  year_shot: number | null;
  location: string | null;
  collection_title: string | null;
  available: boolean;
  // Required, because `items = res.rows` assigns WallRow[] into WallItem[].
  // This is the ONE of the five feeding queries where the compiler actually
  // enforces the column; the other four launder through pool.query<T>.
  plate_no: number;
}

export default async function MarketingHome() {
  // The wall is every piece flagged on_wall (Dan curates this in /admin/wall),
  // shown as look-only "vintage" examples intermixed with the few available
  // prints. on_wall is INDEPENDENT of shop status, so a piece can be on the
  // wall without being for sale, or for sale without being on the wall.
  // Ordered by wall_order (set by Dan in /admin/wall — separate from the
  // shop's display_order). Arranged rows lead, in order; un-arranged rows
  // (wall_order=0) shuffle to the END via md5(slug), so a fresh wall still
  // reads as intentional and newly-imported work doesn't jump to the top.
  // image_web_url <> '' drops any mid-upload reserved row (empty URL) from
  // this highest-traffic page; a dedicated 'vintage' status remains a spec
  // follow-up. LIMIT caps the wall well above today's ~100 so an import
  // spree can't bloat it.
  // Wrapped so a Neon cold-start blip renders the empty state, not a 500 on
  // the highest-traffic page.
  let items: WallItem[] = [];
  try {
    const res = await pool.query<WallRow>(
      `SELECT a.slug, a.title, a.image_web_url, a.year_shot, a.location, a.plate_no,
              -- "available" = genuinely buyable (published AND has a buyable
              -- variant), matching the resolution-gated shop so the wall dot +
              -- lightbox "See print options" link never point at a piece the
              -- shop has gated to a no-options page. A published-but-not-buyable
              -- piece shows on the wall as a look-only vintage example.
              (a.status = 'published'
                 AND EXISTS (SELECT 1 FROM artwork_variants v
                               WHERE v.artwork_id = a.id AND v.buyable)) AS available,
              c.title AS collection_title
       FROM artworks a
       LEFT JOIN collections c ON c.id = a.collection_id
       WHERE a.on_wall AND a.image_web_url <> ''
       ORDER BY (a.wall_order = 0), a.wall_order, md5(a.slug)
       LIMIT 300`,
    );
    items = res.rows;
  } catch (err) {
    console.error('[home] vintage wall query failed:', err);
  }
  const total = items.length;
  const forSale = items.filter((i) => i.available).length;

  return (
    <div className="wl-wallhome">
      <section className="wl-wallhome-hero">
        <span className="wl-eyebrow">Wildlight Imagery · Aurora, Colorado</span>
        <h1>
          Unique and defining photography.
        </h1>
        <div className="meta">
          <span>{String(total).padStart(3, '0')} frames on the wall</span>
          {forSale > 0 && (
            <Link href="/shop">{forSale} available as prints →</Link>
          )}
          <span>Est. 2017</span>
        </div>
      </section>

      {total > 0 ? (
        <VintageWall items={items} />
      ) : (
        <p
          style={{
            padding: '64px 56px',
            fontFamily: 'var(--f-serif)',
            color: 'var(--ink-3)',
          }}
        >
          The wall is being hung. Check back soon.
        </p>
      )}

      <div className="wl-wallhome-foot">
        <div className="wl-wallhome-cta">
          <p className="t">
            A few of these are available, <em>printed to order.</em>
          </p>
          <div className="actions">
            <Link className="wl-btn primary" href="/shop">
              Visit the shop →
            </Link>
            <Link className="wl-btn ghost" href="/services/events">
              Hire Dan for an event
            </Link>
          </div>
        </div>
        <section className="wlmh-news-section">
          <EmailCaptureStrip
            source="marketing-home"
            eyebrow="Notes from the field"
            headline="New work, in your inbox."
            body="A note when new prints go up or Dan's out shooting something worth seeing. Never more than once a month."
          />
        </section>
      </div>
    </div>
  );
}
