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
};

export default nextConfig;
