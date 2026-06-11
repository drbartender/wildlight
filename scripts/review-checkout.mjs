import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

const OUT_DIR = path.resolve('.review-checkout');
fs.mkdirSync(OUT_DIR, { recursive: true });

const EXEC_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

const executablePath = EXEC_CANDIDATES.find((p) => fs.existsSync(p));
if (!executablePath) {
  console.error('No Chrome/Edge executable found');
  process.exit(1);
}
console.log('Using browser at:', executablePath);

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};

// Seed cart in localStorage by visiting cart helper API path doesn't exist —
// we'll programmatically inject cart state via window.localStorage.
// CartProvider key: try common ones
const CART_LINES = [
  {
    variantId: 'TEST-VARIANT-1',
    artworkSlug: 'orcas-island-veil',
    artworkTitle: 'Orcas Island Veil',
    imageUrl: '/api/placeholder/400/300',
    type: 'Print',
    size: '12x18"',
    finish: 'Matte',
    quantity: 1,
    priceCents: 12500,
  },
  {
    variantId: 'TEST-VARIANT-2',
    artworkSlug: 'lopez-bluff-storm',
    artworkTitle: 'Lopez Bluff Storm',
    imageUrl: '/api/placeholder/400/300',
    type: 'Print',
    size: '16x24"',
    finish: 'Glossy',
    quantity: 1,
    priceCents: 22500,
  },
];

const browser = await chromium.launch({
  headless: true,
  executablePath,
  channel: 'chrome',
});

async function fullPageScreenshot(page, name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log('saved', file);
}

async function visit({ device, theme, route, label }) {
  const context = await browser.newContext({
    viewport: VIEWPORTS[device],
    deviceScaleFactor: 1,
    isMobile: device === 'mobile',
    hasTouch: device === 'mobile',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${label}] pageerror:`, e.message));
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type()))
      console.log(`[${label}] ${msg.type()}:`, msg.text());
  });

  // First visit cart so localStorage has known origin context
  await page.goto('http://localhost:3000/shop/cart', { waitUntil: 'networkidle' });

  // Look at how CartProvider stores cart
  // We'll inspect localStorage keys
  const lsBefore = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out[k] = localStorage.getItem(k);
    }
    return out;
  });
  console.log(`[${label}] cart localStorage keys:`, Object.keys(lsBefore));

  // Set theme via the toggle if needed: shop uses bone/ink — stored where?
  if (theme) {
    await page.evaluate((t) => {
      // Common patterns
      try { localStorage.setItem('wl-mood', t); } catch {}
      try { localStorage.setItem('wl-theme', t); } catch {}
      try { localStorage.setItem('mood', t); } catch {}
    }, theme);
  }

  // Inject cart with the right key — try a few likely keys
  await page.evaluate((lines) => {
    const payload = JSON.stringify({ lines });
    const candidates = ['wl-cart', 'cart', 'wl_cart', 'wildlight-cart'];
    for (const k of candidates) localStorage.setItem(k, payload);
  }, CART_LINES);

  // Navigate to target route
  await page.goto(`http://localhost:3000${route}`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(2500); // give Stripe iframe a moment

  await fullPageScreenshot(page, label);
  await context.close();
}

async function main() {
  // First a baseline /shop/cart
  for (const device of Object.keys(VIEWPORTS)) {
    await visit({
      device,
      theme: null,
      route: '/shop/cart',
      label: `cart-${device}`,
    });
  }

  for (const device of Object.keys(VIEWPORTS)) {
    await visit({
      device,
      theme: null,
      route: '/shop/checkout',
      label: `checkout-${device}-bone`,
    });
  }

  for (const device of Object.keys(VIEWPORTS)) {
    await visit({
      device,
      theme: 'ink',
      route: '/shop/checkout',
      label: `checkout-${device}-ink`,
    });
  }

  await browser.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
