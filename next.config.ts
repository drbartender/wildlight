import type { NextConfig } from 'next';

const publicBase = process.env.R2_PUBLIC_BASE_URL || 'https://images.wildlightimagery.shop';
const host = (() => { try { return new URL(publicBase).hostname; } catch { return 'images.wildlightimagery.shop'; } })();

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: host },
      { protocol: 'https', hostname: 'wildlightimagery.com' },
    ],
  },
  experimental: {
    serverActions: { bodySizeLimit: '25mb' },
  },
  async redirects() {
    return [
      // Storefront URLs that moved (308 — preserves method, modern 301)
      { source: '/cart',                  destination: '/shop/cart',                  permanent: true },
      { source: '/checkout',              destination: '/shop/checkout',              permanent: true },
      { source: '/collections',           destination: '/shop/collections',           permanent: true },
      { source: '/collections/:slug',     destination: '/shop/collections/:slug',     permanent: true },
      { source: '/artwork/:slug',         destination: '/shop/artwork/:slug',         permanent: true },
      { source: '/orders/:token',         destination: '/shop/orders/:token',         permanent: true },

      // Legacy WordPress shop URLs
      { source: '/wildlight-store',       destination: '/shop',                       permanent: true },
      { source: '/wildlight-store/:path*', destination: '/shop',                      permanent: true },
      { source: '/shopping-cart',         destination: '/shop/cart',                  permanent: true },

      // Legacy WordPress blog (sub-project #3 retargets to /journal/* later)
      { source: '/blog',                  destination: '/',                           permanent: false },
      { source: '/blog/:path*',           destination: '/',                           permanent: false },
    ];
  },
};

export default nextConfig;
