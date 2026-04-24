import './globals.css';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Wildlight Imagery — Fine art by Dan Raby',
  description:
    'A curated selection of fine art photography by Dan Raby. Archival prints, canvases, and framed pieces made to order.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://wildlightimagery.shop'),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
