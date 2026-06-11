import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = 'C:/Users/dalla/wildlight/.playwright-mcp';
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const PAGES = [
  { name: 'home',           url: '/' },
  { name: 'portfolio',      url: '/portfolio' },
  { name: 'portfolio-land', url: '/portfolio/the-land' },
  { name: 'services',       url: '/services/portraits' },
  { name: 'about',          url: '/about' },
  { name: 'journal',        url: '/journal' },
  { name: 'shop',           url: '/shop' },
  { name: 'artwork',        url: '/shop/artwork/the-land-chicago-il-4' },
  { name: 'contact',        url: '/contact' },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet',  width: 768,  height: 1024 },
  { name: 'mobile',  width: 375,  height: 812 },
];

(async () => {
  const browser = await chromium.launch();
  const findings = {};

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`[${vp.name}] CONSOLE ERROR: ${msg.text()}`);
      }
    });
    page.on('pageerror', err => {
      console.log(`[${vp.name}] PAGE ERROR: ${err.message}`);
    });

    for (const p of PAGES) {
      const fname = `${p.name}-${vp.name}.png`;
      try {
        await page.goto('http://localhost:3000' + p.url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, fname), fullPage: true });
        console.log(`[OK] ${fname}`);
      } catch (e) {
        console.log(`[FAIL] ${fname}: ${e.message}`);
      }
    }
    await ctx.close();
  }

  await browser.close();
})();
