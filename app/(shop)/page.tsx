import Link from 'next/link';
import type { Metadata } from 'next';
import { pool } from '@/lib/db';
import { VintageWall, type WallItem } from '@/components/site/VintageWall';
import { EmailCaptureStrip } from '@/components/site/EmailCaptureStrip';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Wildlight Imagery — Dan Raby, Aurora, Colorado',
  description:
    'Twenty years of looking. The photographs of Dan Raby — a wall of fine-art, landscape, macro, and night work. Select pieces available as archival prints.',
};

interface WallRow {
  slug: string;
  title: string;
  image_web_url: string;
  year_shot: number | null;
  location: string | null;
  collection_title: string | null;
  available: boolean;
}

export default async function MarketingHome() {
  // The wall is Dan's whole body of work shown as look-only "vintage"
  // examples (drafts) intermixed with the few available prints (published).
  // md5(slug) is a stable shuffle so it reads as an unsorted wall, not a
  // sorted catalog. 'untitled%' filters the lone placeholder import.
  const res = await pool.query<WallRow>(
    `SELECT a.slug, a.title, a.image_web_url, a.year_shot, a.location,
            (a.status = 'published') AS available,
            c.title AS collection_title
     FROM artworks a
     LEFT JOIN collections c ON c.id = a.collection_id
     WHERE a.status IN ('draft', 'published')
       AND a.title NOT ILIKE 'untitled%'
     ORDER BY md5(a.slug)`,
  );
  const items: WallItem[] = res.rows;
  const total = items.length;
  const forSale = items.filter((i) => i.available).length;

  return (
    <div className="wl-wallhome">
      <section className="wl-wallhome-hero">
        <span className="wl-eyebrow">Wildlight Imagery · Aurora, Colorado</span>
        <h1>
          Twenty years of <em>looking.</em>
        </h1>
        <div className="meta">
          <span>{String(total).padStart(3, '0')} frames on the wall</span>
          {forSale > 0 && (
            <Link href="/shop">{forSale} available as prints →</Link>
          )}
          <span>Est. 2004</span>
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
