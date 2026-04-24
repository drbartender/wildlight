import './globals.css';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import {
  Instrument_Serif,
  EB_Garamond,
  Inter,
  JetBrains_Mono,
  Caveat,
} from 'next/font/google';

const display = Instrument_Serif({
  subsets: ['latin'],
  weight: ['400'],
  style: ['normal', 'italic'],
  variable: '--f-display',
  display: 'swap',
});

const serif = EB_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--f-serif',
  display: 'swap',
});

const ui = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--f-ui',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--f-mono',
  display: 'swap',
});

const hand = Caveat({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--f-hand',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Wildlight Imagery — Fine art by Dan Raby',
  description:
    'A curated selection of fine art photography by Dan Raby. Archival prints, canvases, and framed pieces made to order.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://wildlightimagery.shop'),
};

// Runs synchronously before paint so a returning visitor's ink-mood preference
// is applied without a flash. Reading localStorage here is safe because the
// script is inlined in <head> and gated on try/catch.
const moodNoFlash = `(function(){try{var m=localStorage.getItem('wl_mood');if(m==='ink'||m==='bone'){document.documentElement.dataset.mood=m;}else{document.documentElement.dataset.mood='bone';}}catch(e){document.documentElement.dataset.mood='bone';}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  const fontClasses = [
    display.variable,
    serif.variable,
    ui.variable,
    mono.variable,
    hand.variable,
  ].join(' ');

  return (
    <html lang="en" className={fontClasses} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: moodNoFlash }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
