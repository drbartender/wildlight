import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = 'C:/Users/dalla/wildlight/.playwright-mcp';

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

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`CONSOLE ERROR: ${msg.text()}`);
  });
  page.on('pageerror', err => console.log(`PAGE ERROR: ${err.message}`));

  // First flip mood by visiting home and clicking the BLACK toggle
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 30000 });
  // Try to click Black mood
  const blackBtn = await page.$('button:has-text("BLACK"), button[aria-label*="black" i], [data-mood="black"], [data-mood="ink"]');
  if (blackBtn) {
    await blackBtn.click();
    await page.waitForTimeout(500);
    console.log('clicked black/ink toggle');
  } else {
    // Try setting via localStorage
    await page.evaluate(() => {
      try { localStorage.setItem('wl-mood', 'ink'); } catch(e){}
      try { document.documentElement.setAttribute('data-mood', 'ink'); } catch(e){}
      try { document.documentElement.setAttribute('data-theme', 'ink'); } catch(e){}
      try { document.documentElement.classList.add('mood-ink'); } catch(e){}
    });
    console.log('set ink via dom/storage');
  }
  
  for (const p of PAGES) {
    const fname = `${p.name}-ink-desktop.png`;
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
  await browser.close();
})();
