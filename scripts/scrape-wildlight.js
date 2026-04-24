/*
 * One-time archive scraper for wildlightimagery.com.
 * Walks /galleries/, discovers each sub-collection, downloads every image
 * at the largest available size, and writes a manifest.json with titles + alt text.
 *
 * Usage:
 *   npm install
 *   npm run scrape
 *
 * Output:
 *   ./scraped/<collection-slug>/<image-slug>.jpg
 *   ./scraped/manifest.json
 */

const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const BASE = 'https://wildlightimagery.com';
const START = `${BASE}/galleries/`;
const OUT_DIR = path.resolve(__dirname, '..', 'scraped');
const UA = 'wildlight-archive-migration/1.0 (personal use)';
const REQUEST_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 60000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function slugify(input) {
  return (input || '')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function getHtml(url) {
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': UA },
    timeout: REQUEST_TIMEOUT_MS,
    responseType: 'text',
    transformResponse: [(d) => d],
  });
  return data;
}

async function downloadBinary(url, destPath) {
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': UA },
    timeout: REQUEST_TIMEOUT_MS,
    responseType: 'arraybuffer',
  });
  await fs.writeFile(destPath, Buffer.from(data));
}

function abs(href) {
  try {
    return new URL(href, BASE).toString();
  } catch {
    return null;
  }
}

function looksLikeImageHref(href) {
  return /\.(jpe?g|png|webp)(\?|#|$)/i.test(href || '');
}

async function discoverCollections() {
  const html = await getHtml(START);
  const $ = cheerio.load(html);
  const seen = new Set();
  const collections = [];

  $('a').each((_, el) => {
    const rawHref = $(el).attr('href') || '';
    const href = abs(rawHref);
    if (!href) return;
    if (!href.startsWith(`${BASE}/galleries/`)) return;
    if (href.replace(/\/$/, '') === `${BASE}/galleries`) return;

    const title = ($(el).attr('title') || $(el).text() || '').trim();
    const key = href.replace(/\/$/, '');
    if (seen.has(key)) return;
    seen.add(key);

    const urlSlug = key.split('/').filter(Boolean).pop();
    collections.push({
      url: href,
      title: title || urlSlug,
      slug: slugify(title) || slugify(urlSlug),
    });
  });

  return collections;
}

function extractImages(html, $) {
  const seen = new Set();
  const imgs = [];

  // Primary strategy: regex the raw HTML for any /wp-content/gallery/<slug>/*.jpg URL.
  // Catches Tiled Gallery, NextGEN, single/double-quoted attrs, and inline JS configs.
  const urlRe = /https?:\/\/[^"'\s<>]*\/wp-content\/gallery\/[^"'\s<>]+\.(?:jpe?g|png|webp)/gi;
  const pathRe = /\/wp-content\/gallery\/[^"'\s<>]+\.(?:jpe?g|png|webp)/gi;
  const urlMatches = new Set([...(html.match(urlRe) || [])]);
  for (const m of (html.match(pathRe) || [])) urlMatches.add(abs(m));

  // Best-effort Cheerio metadata lookup: build a map of URL -> {title, alt} from img tags
  const metaByUrl = new Map();
  $('img').each((_, el) => {
    const src = abs($(el).attr('src') || '');
    if (src) {
      metaByUrl.set(src, {
        title: ($(el).attr('title') || $(el).attr('alt') || '').trim(),
        alt: ($(el).attr('alt') || '').trim(),
      });
    }
  });
  $('a').each((_, el) => {
    const href = abs($(el).attr('href') || '');
    if (!href || !looksLikeImageHref(href)) return;
    if (metaByUrl.has(href)) return;
    const img = $(el).find('img').first();
    metaByUrl.set(href, {
      title: (img.attr?.('title') || img.attr?.('alt') || $(el).attr('title') || '').trim(),
      alt: (img.attr?.('alt') || '').trim(),
    });
  });

  for (const full of urlMatches) {
    if (!full || seen.has(full)) continue;
    // skip thumbnail paths: NextGEN's /cache/ resized variants and any /thumbs/ subdirs.
    // The /cache/ files are auto-generated 480px versions of the original (e.g.
    // foo.jpg-nggid03490-ngg0dyn-480x316x100-...jpg) and would duplicate the full image.
    if (/\/thumbs?\//i.test(full)) continue;
    if (/\/cache\//i.test(full)) continue;
    seen.add(full);
    const meta = metaByUrl.get(full) || { title: '', alt: '' };
    imgs.push({ fullUrl: full, title: meta.title, alt: meta.alt });
  }

  // Legacy strategies (kept as fallback, in case a future collection page doesn't use /wp-content/gallery)
  if (imgs.length === 0) {
    $('a').each((_, el) => {
      const rawHref = $(el).attr('href') || '';
      if (!looksLikeImageHref(rawHref)) return;
      const full = abs(rawHref);
      if (!full || seen.has(full)) return;
      const img = $(el).find('img').first();
      const title = (img.attr?.('title') || img.attr?.('alt') || $(el).attr('title') || '').trim();
      const alt = (img.attr?.('alt') || '').trim();
      seen.add(full);
      imgs.push({ fullUrl: full, title, alt });
    });
    $('img').each((_, el) => {
      const src = abs($(el).attr('src') || '');
      if (!src || !looksLikeImageHref(src) || seen.has(src)) return;
      // skip obvious thumb paths
      if (/\/thumbs?\//i.test(src)) return;
      if (/\/cache\//i.test(src)) return;
      seen.add(src);
      imgs.push({
        fullUrl: src,
        title: ($(el).attr('title') || $(el).attr('alt') || '').trim(),
        alt: ($(el).attr('alt') || '').trim(),
      });
    });
  }

  return imgs;
}

function findMaxPage(html, $, baseUrl) {
  // NextGEN pagination uses /page/N/ suffixes off the collection URL.
  // Pull every page number we can see in pagination links and take the max.
  const baseNoSlash = baseUrl.replace(/\/$/, '');
  const escaped = baseNoSlash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const linkRe = new RegExp(`${escaped}/page/(\\d+)`, 'gi');
  let max = 1;
  for (const m of html.matchAll(linkRe)) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  $('a[href*="/page/"]').each((_, el) => {
    const href = abs($(el).attr('href') || '');
    if (!href || !href.startsWith(baseNoSlash + '/page/')) return;
    const m = href.match(/\/page\/(\d+)/);
    if (!m) return;
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  });
  return max;
}

async function collectAllImages(col) {
  const baseNoSlash = col.url.replace(/\/$/, '');
  const firstHtml = await getHtml(col.url);
  const $first = cheerio.load(firstHtml);
  const maxPage = findMaxPage(firstHtml, $first, baseNoSlash);

  const seenUrls = new Set();
  const all = [];
  const addFrom = (imgs) => {
    for (const img of imgs) {
      if (seenUrls.has(img.fullUrl)) continue;
      seenUrls.add(img.fullUrl);
      all.push(img);
    }
  };

  addFrom(extractImages(firstHtml, $first));
  if (maxPage > 1) console.log(`  pagination: ${maxPage} pages`);

  for (let p = 2; p <= maxPage; p++) {
    const pageUrl = `${baseNoSlash}/page/${p}/`;
    await sleep(REQUEST_DELAY_MS);
    try {
      const html = await getHtml(pageUrl);
      const $ = cheerio.load(html);
      const before = all.length;
      addFrom(extractImages(html, $));
      console.log(`  page ${p}: +${all.length - before} new images`);
    } catch (err) {
      console.warn(`  page ${p} FAIL ${pageUrl} -> ${err.message}`);
    }
  }

  return all;
}

async function scrapeCollection(col, index, total, contentHashes) {
  console.log(`\n[${index + 1}/${total}] ${col.title}  (${col.url})`);
  const imgs = await collectAllImages(col);
  console.log(`  discovered ${imgs.length} images`);

  const colDir = path.join(OUT_DIR, col.slug);
  await fs.mkdir(colDir, { recursive: true });

  const artworks = [];
  let dupSkipped = 0;
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    try {
      const ext = (path.extname(new URL(img.fullUrl).pathname) || '.jpg').toLowerCase();
      const baseName = slugify(img.title) || `untitled-${String(i + 1).padStart(3, '0')}`;
      // ensure uniqueness within collection
      let filename = `${baseName}${ext}`;
      let n = 1;
      while (artworks.find((a) => a.filename === filename)) {
        filename = `${baseName}-${n}${ext}`;
        n++;
      }
      const dest = path.join(colDir, filename);
      await downloadBinary(img.fullUrl, dest);
      // Content-hash dedup: the source site sometimes hosts the same image
      // under multiple URLs (e.g. foo.jpg and foo-1.jpg) or republishes it
      // across collections. Drop byte-identical duplicates after download.
      const buf = await fs.readFile(dest);
      const hash = crypto.createHash('sha1').update(buf).digest('hex');
      if (contentHashes.has(hash)) {
        await fs.unlink(dest);
        dupSkipped++;
        process.stdout.write('=');
      } else {
        contentHashes.set(hash, `${col.slug}/${filename}`);
        artworks.push({
          slug: baseName,
          filename,
          title: img.title || baseName,
          alt: img.alt,
          sourceUrl: img.fullUrl,
          bytes: buf.length,
        });
        process.stdout.write('.');
      }
    } catch (err) {
      console.warn(`\n  FAIL ${img.fullUrl} -> ${err.message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }
  if (artworks.length || dupSkipped) process.stdout.write('\n');
  if (dupSkipped) console.log(`  dedup: skipped ${dupSkipped} byte-identical duplicate(s)`);

  return { ...col, artworks };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  console.log(`Scraping ${BASE}`);
  console.log(`Output:   ${OUT_DIR}\n`);

  const collections = await discoverCollections();
  if (collections.length === 0) {
    console.error('No collections discovered. Bailing out.');
    process.exit(1);
  }

  console.log(`Collections discovered (${collections.length}):`);
  for (const c of collections) console.log(`  - ${c.title}  [${c.url}]`);

  const manifest = {
    scrapedAt: new Date().toISOString(),
    base: BASE,
    collections: [],
  };

  // Shared across collections so we can drop byte-identical republished images.
  const contentHashes = new Map();

  for (let i = 0; i < collections.length; i++) {
    try {
      const result = await scrapeCollection(collections[i], i, collections.length, contentHashes);
      manifest.collections.push(result);
    } catch (err) {
      console.warn(`\nCollection failed: ${collections[i].url} -> ${err.message}`);
      manifest.collections.push({ ...collections[i], artworks: [], error: err.message });
    }
  }

  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const totalImgs = manifest.collections.reduce((s, c) => s + (c.artworks?.length || 0), 0);
  const totalBytes = manifest.collections.reduce(
    (s, c) => s + (c.artworks || []).reduce((a, b) => a + (b.bytes || 0), 0),
    0
  );

  console.log('\nDone.');
  console.log(`  Manifest: ${manifestPath}`);
  console.log(`  Images:   ${totalImgs}`);
  console.log(`  Size:     ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
