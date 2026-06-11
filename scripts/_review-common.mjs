// Shared helpers for the local Playwright UI-review scripts (review-pages,
// review-pages-ink, review-vintage-wall). One source for the page list,
// viewports, mood toggle, and output directory so the helpers can't drift.
// Dev-only visual-QA tools — they screenshot the local dev server.
import fs from 'node:fs';
import path from 'node:path';

export const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

// Marketing + shop routes worth eyeballing after a copy/layout change.
export const MARKETING_PAGES = [
  { name: 'home', url: '/' },
  { name: 'portfolio', url: '/portfolio' },
  { name: 'portfolio-land', url: '/portfolio/the-land' },
  { name: 'services', url: '/services/portraits' },
  { name: 'about', url: '/about' },
  { name: 'journal', url: '/journal' },
  { name: 'shop', url: '/shop' },
  { name: 'artwork', url: '/shop/artwork/the-land-chicago-il-4' },
  { name: 'contact', url: '/contact' },
];

// Set the bone/ink mood via the same attribute + localStorage the app reads.
export async function setMood(page, mood) {
  await page.evaluate((m) => {
    document.documentElement.setAttribute('data-mood', m);
    try {
      localStorage.setItem('wl-mood', m);
    } catch {}
  }, mood);
  await page.waitForTimeout(150);
}

// Ensure and return the absolute output dir for a review scope, under the
// git-ignored .review/ root.
export function reviewDir(scope) {
  const dir = path.resolve('.review', scope);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
