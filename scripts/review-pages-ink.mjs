// Read-only: screenshot the marketing/shop pages in INK mood (desktop).
// Run (dev server must be up): node scripts/review-pages-ink.mjs
import { chromium } from 'playwright';
import path from 'node:path';
import { MARKETING_PAGES, setMood, reviewDir } from './_review-common.mjs';

const OUT = reviewDir('pages');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`CONSOLE ERROR: ${msg.text()}`);
  });
  page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err.message}`));

  // Flip to ink mood once on home; the app reads wl-mood from localStorage on
  // each subsequent navigation.
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 30000 });
  await setMood(page, 'ink');

  for (const p of MARKETING_PAGES) {
    const fname = `${p.name}-ink-desktop.png`;
    try {
      await page.goto('http://localhost:3000' + p.url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT, fname), fullPage: true });
      console.log(`[OK] ${fname}`);
    } catch (e) {
      console.log(`[FAIL] ${fname}: ${e.message}`);
    }
  }
  await ctx.close();
  await browser.close();
})();
