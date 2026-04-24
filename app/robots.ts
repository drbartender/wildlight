import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://wildlightimagery.shop').replace(/\/$/, '');
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/login', '/api', '/orders'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
