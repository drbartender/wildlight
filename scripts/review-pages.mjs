// Read-only: screenshot the marketing/shop pages across viewports.
// Run (dev server must be up): node scripts/review-pages.mjs
import { chromium } from 'playwright';
import path from 'node:path';
import { VIEWPORTS, MARKETING_PAGES, reviewDir } from './_review-common.mjs';

const OUT = reviewDir('pages');

(async () => {
  const browser = await chromium.launch();

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
    });
    const page = await ctx.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`[${vp.name}] CONSOLE ERROR: ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      console.log(`[${vp.name}] PAGE ERROR: ${err.message}`);
    });

    for (const p of MARKETING_PAGES) {
      const fname = `${p.name}-${vp.name}.png`;
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
  }

  await browser.close();
})();
