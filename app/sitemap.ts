import type { MetadataRoute } from 'next';
import { pool } from '@/lib/db';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://wildlightimagery.shop').replace(/\/$/, '');

  try {
    const [collections, artworks, journal] = await Promise.all([
      pool.query<{ slug: string; created_at: Date }>(
        'SELECT slug, created_at FROM collections',
      ),
      pool.query<{ slug: string; updated_at: Date }>(
        `SELECT slug, updated_at FROM artworks WHERE status='published'`,
      ),
      pool.query<{ slug: string; updated_at: Date }>(
        `SELECT slug, updated_at FROM blog_posts WHERE published = TRUE`,
      ),
    ]);
    return [
      // Marketing
      { url: `${base}/`, lastModified: new Date() },
      { url: `${base}/portfolio`, lastModified: new Date() },
      { url: `${base}/journal`, lastModified: new Date() },
      { url: `${base}/services/portraits`, lastModified: new Date() },
      { url: `${base}/about`, lastModified: new Date() },
      { url: `${base}/contact`, lastModified: new Date() },
      // Shop
      { url: `${base}/shop`, lastModified: new Date() },
      { url: `${base}/shop/collections`, lastModified: new Date() },
      // Per-collection portfolio + shop
      ...collections.rows.flatMap((c) => [
        { url: `${base}/portfolio/${c.slug}`, lastModified: c.created_at },
        { url: `${base}/shop/collections/${c.slug}`, lastModified: c.created_at },
      ]),
      // Per-artwork shop pages
      ...artworks.rows.map((a) => ({
        url: `${base}/shop/artwork/${a.slug}`,
        lastModified: a.updated_at,
      })),
      // Per-journal-entry pages
      ...journal.rows.map((j) => ({
        url: `${base}/journal/${j.slug}`,
        lastModified: j.updated_at,
      })),
    ];
  } catch {
    return [
      { url: `${base}/`, lastModified: new Date() },
      { url: `${base}/portfolio`, lastModified: new Date() },
      { url: `${base}/journal`, lastModified: new Date() },
      { url: `${base}/services/portraits`, lastModified: new Date() },
      { url: `${base}/about`, lastModified: new Date() },
      { url: `${base}/contact`, lastModified: new Date() },
      { url: `${base}/shop`, lastModified: new Date() },
      { url: `${base}/shop/collections`, lastModified: new Date() },
    ];
  }
}
