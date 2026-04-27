# Foundation Shop Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the storefront under `/shop/*`, add a stub marketing home at `/`, preserve every existing URL with 308 redirects, and verify the full purchase flow still works on `wildlightimagery.shop`.

**Architecture:** Storefront pages move from `app/(shop)/<page>` to `app/(shop)/shop/<page>` so URLs gain a `/shop/` prefix. The route group `(shop)` continues to provide the shared layout (CartProvider, Nav, Footer). Marketing-adjacent pages — `/about`, `/contact`, `/legal/*` — stay at root because their content already serves a generic-enough purpose. Internal `Link` hrefs and three URL-builders (the by-session redirect, transactional emails, sitemap) gain the `/shop/` prefix in lockstep with the route move.

**Tech Stack:** Next.js 16 App Router · TypeScript · Postgres (`pg`) · Vitest · Vercel deployment · `next.config.ts` redirects.

**Spec:** `docs/superpowers/specs/2026-04-27-foundation-shop-migration-design.md`

---

## File Structure

**Created:**
- `app/(shop)/page.tsx` — new stub marketing home (replaces moved storefront index)

**Moved (route relocation, no logic change):**
- `app/(shop)/page.tsx` → `app/(shop)/shop/page.tsx` (storefront index)
- `app/(shop)/cart/` → `app/(shop)/shop/cart/`
- `app/(shop)/checkout/` → `app/(shop)/shop/checkout/`
- `app/(shop)/collections/` → `app/(shop)/shop/collections/`
- `app/(shop)/artwork/` → `app/(shop)/shop/artwork/`
- `app/(shop)/orders/` → `app/(shop)/shop/orders/`

**Unchanged location:**
- `app/(shop)/about/page.tsx` — stays at `/about`
- `app/(shop)/contact/page.tsx` — stays at `/contact`
- `app/(shop)/legal/*` — stays at `/legal/*`
- `app/(shop)/layout.tsx` — same shared layout for all descendants
- `app/admin/*` — completely untouched
- `app/api/*` — only the URL strings inside `by-session/[id]/route.ts` change; route paths stay

**Modified (string changes only):**
- `next.config.ts` — add `redirects()` block
- `components/shop/Nav.tsx` — `LINKS` array hrefs and matchers
- `components/shop/Footer.tsx` — 2 hrefs
- `components/shop/CartCountBadge.tsx` — `/cart` → `/shop/cart`
- `components/shop/PlateCard.tsx` — `/artwork/...` → `/shop/artwork/...`
- `app/(shop)/shop/cart/page.tsx` — internal hrefs
- `app/(shop)/shop/checkout/page.tsx` — internal hrefs
- `app/(shop)/shop/collections/[slug]/page.tsx` — internal hrefs
- `app/(shop)/shop/artwork/[slug]/page.tsx` — internal hrefs
- `app/(shop)/shop/orders/[token]/page.tsx` — internal hrefs
- `app/(shop)/about/page.tsx` — internal href to `/collections`
- `app/api/orders/by-session/[id]/route.ts` — `/orders/:token` → `/shop/orders/:token`
- `lib/email.ts` — 4× `orderUrl` builds
- `app/sitemap.ts` — `/collections`, `/collections/:slug`, `/artwork/:slug` URL emissions
- `scripts/review-checkout.mjs` — Playwright nav target

---

## Task 1: Restructure routes — move storefront under `/shop`, stub marketing home, add redirects

This task is one atomic commit because all three pieces depend on each other: moving files alone breaks `/cart`, `/collections`, etc.; adding redirects alone leaves the route group with the storefront still at root; the stub home alone collides with the existing storefront page at `/`. They land together so `main` is always working.

**Files:**
- Move: `app/(shop)/{page.tsx,cart,checkout,collections,artwork,orders}` → `app/(shop)/shop/...`
- Create: `app/(shop)/page.tsx` (new stub)
- Modify: `next.config.ts`

- [ ] **Step 1: Create the `shop/` subdirectory inside the route group**

```bash
mkdir -p "app/(shop)/shop"
```

- [ ] **Step 2: Move the six storefront paths into the new subdirectory**

```bash
git mv "app/(shop)/page.tsx"    "app/(shop)/shop/page.tsx"
git mv "app/(shop)/cart"        "app/(shop)/shop/cart"
git mv "app/(shop)/checkout"    "app/(shop)/shop/checkout"
git mv "app/(shop)/collections" "app/(shop)/shop/collections"
git mv "app/(shop)/artwork"     "app/(shop)/shop/artwork"
git mv "app/(shop)/orders"      "app/(shop)/shop/orders"
```

Verify `app/(shop)/about/`, `app/(shop)/contact/`, `app/(shop)/legal/`, `app/(shop)/layout.tsx` are still at the route-group root — they should be untouched.

- [ ] **Step 3: Create the stub marketing home at `app/(shop)/page.tsx`**

```tsx
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Wildlight Imagery — Aurora, Colorado',
  description:
    'Fine-art photography by Dan Raby. A small, considered selection, added sparingly.',
};

export default function HomePage() {
  return (
    <section className="wl-masthead">
      <div className="wl-masthead-intro">
        <span className="wl-eyebrow">Wildlight Imagery · Aurora, Colorado</span>
        <h1>
          Exploring <em>my light</em>
          <br /> for as long as I<br /> can remember.
        </h1>
        <p
          style={{
            marginTop: 32,
            maxWidth: 520,
            color: 'var(--ink-3)',
            fontFamily: 'var(--f-serif)',
            fontSize: 17,
            lineHeight: 1.6,
          }}
        >
          A small, considered selection of fine-art photography by Dan Raby.
          Printed to order, shipped archival.
        </p>
        <div style={{ marginTop: 32, display: 'flex', gap: 16 }}>
          <Link className="wl-btn" href="/shop">
            Visit the shop →
          </Link>
        </div>
        <p
          style={{
            marginTop: 56,
            color: 'var(--ink-4)',
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          Portfolio · Journal · Studio — coming soon.
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Add the `redirects()` block to `next.config.ts`**

Open `next.config.ts`. Add the `redirects` async function inside the `nextConfig` object:

```ts
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
  async redirects() {
    return [
      // Storefront URLs that moved (308 — preserves method, modern 301)
      { source: '/cart',                  destination: '/shop/cart',                  permanent: true },
      { source: '/checkout',              destination: '/shop/checkout',              permanent: true },
      { source: '/collections',           destination: '/shop/collections',           permanent: true },
      { source: '/collections/:slug',     destination: '/shop/collections/:slug',     permanent: true },
      { source: '/artwork/:slug',         destination: '/shop/artwork/:slug',         permanent: true },
      { source: '/orders/:token',         destination: '/shop/orders/:token',         permanent: true },

      // Legacy WordPress shop URLs
      { source: '/wildlight-store',       destination: '/shop',                       permanent: true },
      { source: '/wildlight-store/:path*', destination: '/shop',                      permanent: true },
      { source: '/shopping-cart',         destination: '/shop/cart',                  permanent: true },

      // Legacy WordPress blog (sub-project #3 retargets to /journal/* later)
      { source: '/blog',                  destination: '/',                           permanent: false },
      { source: '/blog/:path*',           destination: '/',                           permanent: false },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 5: Verify TypeScript still compiles**

Run: `npm run typecheck`
Expected: exit 0, no errors. The route move shouldn't break any imports because pages only import from `@/lib/...` and `@/components/...`, never from each other.

- [ ] **Step 6: Start the dev server**

Run: `npm run dev`
Expected: server starts on `http://localhost:3000`, no startup errors.

- [ ] **Step 7: Smoke-test the new structure**

In another terminal, run each curl in turn. Replace `<slug>` with a real published artwork slug from the database (e.g. `aurora-ridge` or whatever exists in your dev data — pull one with `psql $DATABASE_URL -c "SELECT slug FROM artworks WHERE status='published' LIMIT 1"`).

```bash
# 1. Stub home renders at /
curl -sI http://localhost:3000/ | head -1
# Expected: HTTP/1.1 200 OK

# 2. Storefront index renders at /shop
curl -sI http://localhost:3000/shop | head -1
# Expected: HTTP/1.1 200 OK

# 3. Storefront sub-pages render
curl -sI http://localhost:3000/shop/cart | head -1
# Expected: HTTP/1.1 200 OK

curl -sI http://localhost:3000/shop/collections | head -1
# Expected: HTTP/1.1 200 OK

# 4. Old shop URLs 308 to new locations
curl -sI http://localhost:3000/cart | head -2
# Expected:
#   HTTP/1.1 308 Permanent Redirect
#   Location: /shop/cart

curl -sI http://localhost:3000/collections | head -2
# Expected: HTTP/1.1 308 ... Location: /shop/collections

curl -sI "http://localhost:3000/artwork/<slug>" | head -2
# Expected: HTTP/1.1 308 ... Location: /shop/artwork/<slug>

# 5. Legacy WP URLs
curl -sI http://localhost:3000/wildlight-store/some-product | head -2
# Expected: HTTP/1.1 308 ... Location: /shop

curl -sI http://localhost:3000/shopping-cart | head -2
# Expected: HTTP/1.1 308 ... Location: /shop/cart

# 6. Marketing-adjacent pages still at root, no redirect
curl -sI http://localhost:3000/about | head -1
# Expected: HTTP/1.1 200 OK

curl -sI http://localhost:3000/legal/privacy | head -1
# Expected: HTTP/1.1 200 OK
```

If any of these fail, stop and debug before committing.

- [ ] **Step 8: Run the existing unit test suite**

Run: `npm test`
Expected: all tests pass. The route move shouldn't affect anything in `tests/lib/`.

- [ ] **Step 9: Commit**

```bash
git add "app/(shop)/" next.config.ts
git commit -m "feat: move storefront under /shop, add stub home, redirect legacy URLs

Storefront pages now live at /shop/* instead of the bare root. New
stub marketing home at / acts as a placeholder until sub-project #2
fills it in. All prior storefront URLs (/cart, /collections,
/artwork/[slug], /orders/[token]) plus legacy WP URLs (/wildlight-store/*,
/shopping-cart, /blog/*) emit 308/307 redirects to their new homes.

The (shop) route group keeps its layout responsibilities for all
descendants; only the URL paths shifted. Internal hrefs and URL builders
are updated in subsequent commits — redirects bridge the gap so every
intermediate state is working."
```

---

## Task 2: Update component-level `Link` hrefs

Now that redirects bridge old hrefs, internal `Link` components can be repointed at the new paths so users stop double-hopping (`<Link href="/cart">` → 308 → `/shop/cart`).

**Files:**
- Modify: `components/shop/Nav.tsx`
- Modify: `components/shop/Footer.tsx`
- Modify: `components/shop/CartCountBadge.tsx`
- Modify: `components/shop/PlateCard.tsx`

- [ ] **Step 1: Update `components/shop/Nav.tsx` — `LINKS` array**

Find the `LINKS` array (around line 16) and replace:

```tsx
const LINKS: LinkSpec[] = [
  { href: '/', label: 'Index', match: (p) => p === '/' },
  {
    href: '/collections',
    label: 'Collections',
    match: (p) => p.startsWith('/collections') || p.startsWith('/artwork'),
  },
  { href: '/about', label: 'Studio', match: (p) => p.startsWith('/about') },
  {
    href: '/contact',
    label: 'Commission',
    match: (p) => p.startsWith('/contact'),
  },
];
```

with:

```tsx
const LINKS: LinkSpec[] = [
  { href: '/shop', label: 'Index', match: (p) => p === '/shop' || p === '/' },
  {
    href: '/shop/collections',
    label: 'Collections',
    match: (p) => p.startsWith('/shop/collections') || p.startsWith('/shop/artwork'),
  },
  { href: '/about', label: 'Studio', match: (p) => p.startsWith('/about') },
  {
    href: '/contact',
    label: 'Commission',
    match: (p) => p.startsWith('/contact'),
  },
];
```

The `Index` `match` predicate accepts both `/shop` (the storefront index) and `/` (marketing home, stub) so the link looks active from either landing point. Sub-project #2 splits these into separate nav surfaces.

The `Wordmark` link (around line 87) currently points to `/`. Leave it as `/` — clicking the wordmark goes to the marketing home, which is the correct top-level "home" affordance.

- [ ] **Step 2: Update `components/shop/Footer.tsx`**

Two `href` strings change. The "Index of plates" link in the Shop column should point to `/shop` (the storefront index), not `/` (the marketing home).

Find:

```tsx
<Link className="link" href="/collections">
  Collections
</Link>
<Link className="link" href="/">
  Index of plates
</Link>
```

Replace with:

```tsx
<Link className="link" href="/shop/collections">
  Collections
</Link>
<Link className="link" href="/shop">
  Index of plates
</Link>
```

Leave the `/about`, `/contact?reason=...`, and `/legal/...` hrefs unchanged.

- [ ] **Step 3: Update `components/shop/CartCountBadge.tsx`**

Find (around line 14):

```tsx
<Link href="/cart" className={className}>
```

Replace with:

```tsx
<Link href="/shop/cart" className={className}>
```

- [ ] **Step 4: Update `components/shop/PlateCard.tsx`**

Find (around line 29):

```tsx
href={`/artwork/${item.slug}`}
```

Replace with:

```tsx
href={`/shop/artwork/${item.slug}`}
```

- [ ] **Step 5: Verify all four files compile**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Manual smoke check in dev**

If `npm run dev` is still running, refresh `http://localhost:3000/shop`. Click:
- The "Cart" link in the nav header → URL becomes `/shop/cart` directly (no 308 in browser devtools network tab).
- A plate card on the storefront index → URL becomes `/shop/artwork/<slug>` directly.
- Footer "Index of plates" link → `/shop`.

Open devtools Network tab; filter by "redirect". After this commit, internal navigation should show **zero 308s** (only legacy/external links would).

- [ ] **Step 7: Commit**

```bash
git add components/shop/Nav.tsx components/shop/Footer.tsx components/shop/CartCountBadge.tsx components/shop/PlateCard.tsx
git commit -m "refactor: shop component hrefs point at /shop/* directly

Nav, Footer, CartCountBadge, PlateCard now link to the new /shop/*
paths instead of relying on the redirect layer. Internal navigation
no longer triggers a 308 hop."
```

---

## Task 3: Update in-page `Link` hrefs

The pages themselves contain back-links (e.g. "Back to collections") that still point at the bare paths.

**Files:**
- Modify: `app/(shop)/shop/cart/page.tsx`
- Modify: `app/(shop)/shop/checkout/page.tsx`
- Modify: `app/(shop)/shop/collections/[slug]/page.tsx`
- Modify: `app/(shop)/shop/artwork/[slug]/page.tsx`
- Modify: `app/(shop)/shop/orders/[token]/page.tsx`
- Modify: `app/(shop)/about/page.tsx`

- [ ] **Step 1: Update `app/(shop)/shop/cart/page.tsx`**

Find each occurrence of `href="/collections"` (there are two — one inline in the empty-state copy at ~line 31, one as a button at ~line 121). Replace each with `href="/shop/collections"`.

- [ ] **Step 2: Update `app/(shop)/shop/checkout/page.tsx`**

Three occurrences:
- `href="/collections"` (back-to-collections at ~line 324) → `href="/shop/collections"`
- `href="/cart"` (~line 381) → `href="/shop/cart"`
- `href="/cart"` (~line 424) → `href="/shop/cart"`

- [ ] **Step 3: Update `app/(shop)/shop/collections/[slug]/page.tsx`**

One occurrence at ~line 64:
- `href="/collections"` → `href="/shop/collections"`

- [ ] **Step 4: Update `app/(shop)/shop/artwork/[slug]/page.tsx`**

One occurrence at ~line 102:
- `href="/collections"` → `href="/shop/collections"`

- [ ] **Step 5: Update `app/(shop)/shop/orders/[token]/page.tsx`**

One occurrence at ~line 85:
- `href="/collections"` → `href="/shop/collections"`

- [ ] **Step 6: Update `app/(shop)/about/page.tsx`**

This file stays at `/about` (marketing-adjacent). One occurrence at ~line 58:
- `href="/collections"` → `href="/shop/collections"`

- [ ] **Step 7: Verify nothing remains**

Run a grep — there should be **zero** matches inside `app/` and `components/` for hrefs to the moved bare paths:

```bash
git grep -nE 'href="\/(cart|checkout|collections|artwork|orders)([\/?\"]|$)' -- 'app/' 'components/'
```

Expected: no output. (If any matches surface, edit them too.)

- [ ] **Step 8: Run typecheck and existing tests**

Run: `npm run typecheck && npm test`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add "app/(shop)/" 
git commit -m "refactor: in-page Link hrefs use /shop/* directly

Cart, checkout, collection-detail, artwork, orders, and about pages
now link to the new /shop/* paths in their internal back-links."
```

---

## Task 4: Update API redirect URL builder

The `/api/orders/by-session/[id]/route.ts` endpoint redirects Stripe checkout returns to the public-token order page. The redirect target needs the new prefix.

**Files:**
- Modify: `app/api/orders/by-session/[id]/route.ts`

- [ ] **Step 1: Update the redirect target**

Find (around line 31):

```ts
if (r.rowCount) {
  const url = new URL(`/orders/${r.rows[0].public_token}`, req.url);
  url.searchParams.set('success', '1');
  return NextResponse.redirect(url);
}
```

Replace with:

```ts
if (r.rowCount) {
  const url = new URL(`/shop/orders/${r.rows[0].public_token}`, req.url);
  url.searchParams.set('success', '1');
  return NextResponse.redirect(url);
}
```

Leave the line-22 fallback (`return NextResponse.redirect(new URL('/', req.url));`) unchanged — `/` is the marketing home, a fine destination for the malformed-session-id case.

- [ ] **Step 2: Verify with a manual checkout simulation**

If you have Stripe test mode running:
1. With dev server up, place a test order through `/shop/cart` → checkout → pay with `4242 4242 4242 4242`.
2. After the Stripe form succeeds, watch the browser URL bar:
   - First lands at `/api/orders/by-session/cs_test_...` (the Stripe `return_url`)
   - That endpoint 302s to `/shop/orders/<token>?success=1`
   - The order detail page renders.
3. If the order webhook hasn't materialized the row yet, the inline processing-page HTML (lines 42-60) is shown and meta-refreshes every 3s — verify this still loads before the redirect kicks in.

If you don't have Stripe test mode set up locally, skip the live test and rely on the line-31 string change being mechanically obvious.

- [ ] **Step 3: Commit**

```bash
git add "app/api/orders/by-session/[id]/route.ts"
git commit -m "refactor: post-checkout redirect lands on /shop/orders/[token]

The API redirect after Stripe return_url now points at the new shop
order page path."
```

---

## Task 5: Update transactional email URL builds

Order confirmation, shipped, refunded, and cancelled emails all build a clickable order URL. Four sites in one file.

**Files:**
- Modify: `lib/email.ts`

- [ ] **Step 1: Update each `orderUrl` build**

There are four sites in `lib/email.ts` (lines 213, 250, 337, 435 — exact lines may shift but each is a single `orderUrl =` assignment). Each currently looks like:

```ts
const orderUrl = `${data.siteUrl.replace(/\/$/, '')}/orders/${data.orderToken}`;
```

Change each one to:

```ts
const orderUrl = `${data.siteUrl.replace(/\/$/, '')}/shop/orders/${data.orderToken}`;
```

Use a search-and-replace within the file (verify each match before accepting) since all four lines are identical text:

```bash
# A safe way to do all four at once with sed (review the diff before committing):
sed -i 's|/orders/${data.orderToken}|/shop/orders/${data.orderToken}|g' lib/email.ts
```

(If your editor has interactive find-replace, that's cleaner.)

- [ ] **Step 2: Verify the diff**

Run: `git diff lib/email.ts`
Expected: exactly four lines changed, each adding `/shop` before `/orders/${data.orderToken}`. If any other lines surface, revert and apply more carefully.

- [ ] **Step 3: Run typecheck and existing tests**

Run: `npm run typecheck && npm test`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add lib/email.ts
git commit -m "refactor: transactional emails link to /shop/orders/[token]

Order confirmation, shipped, refunded, and cancelled email templates
now build the customer-facing order URL with the /shop prefix."
```

---

## Task 6: Update sitemap

The sitemap currently emits storefront URLs without the `/shop` prefix. Search engines should index the canonical new paths.

**Files:**
- Modify: `app/sitemap.ts`

- [ ] **Step 1: Replace the entire `app/sitemap.ts` file**

```ts
import type { MetadataRoute } from 'next';
import { pool } from '@/lib/db';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://wildlightimagery.shop').replace(/\/$/, '');

  try {
    const [collections, artworks] = await Promise.all([
      pool.query<{ slug: string; created_at: Date }>(
        'SELECT slug, created_at FROM collections',
      ),
      pool.query<{ slug: string; updated_at: Date }>(
        `SELECT slug, updated_at FROM artworks WHERE status='published'`,
      ),
    ]);
    return [
      { url: `${base}/`, lastModified: new Date() },
      { url: `${base}/shop`, lastModified: new Date() },
      { url: `${base}/shop/collections`, lastModified: new Date() },
      { url: `${base}/about`, lastModified: new Date() },
      { url: `${base}/contact`, lastModified: new Date() },
      ...collections.rows.map((c) => ({
        url: `${base}/shop/collections/${c.slug}`,
        lastModified: c.created_at,
      })),
      ...artworks.rows.map((a) => ({
        url: `${base}/shop/artwork/${a.slug}`,
        lastModified: a.updated_at,
      })),
    ];
  } catch {
    // DB may not be reachable during build/preview — fall back to the static routes only.
    return [
      { url: `${base}/`, lastModified: new Date() },
      { url: `${base}/shop`, lastModified: new Date() },
      { url: `${base}/shop/collections`, lastModified: new Date() },
      { url: `${base}/about`, lastModified: new Date() },
      { url: `${base}/contact`, lastModified: new Date() },
    ];
  }
}
```

Three changes vs current:
- Added `${base}/shop` (storefront index).
- `/collections` → `/shop/collections` (both rows).
- `/artwork/${slug}` → `/shop/artwork/${slug}`.
- `/about` and `/contact` left untouched (still at root).

- [ ] **Step 2: Verify in dev**

If `npm run dev` is running, fetch the sitemap:

```bash
curl -s http://localhost:3000/sitemap.xml | head -40
```

Expected: XML output with URLs that include `/shop/collections/...` and `/shop/artwork/...` (one entry per published artwork). The `/`, `/about`, and `/contact` URLs are present without `/shop` prefix.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/sitemap.ts
git commit -m "refactor: sitemap reflects /shop/* URL structure

Storefront URLs in the sitemap now use the /shop prefix; storefront
index added as its own entry. Marketing-adjacent /about and /contact
stay at root."
```

---

## Task 7: Update Playwright dev fixture script

The local checkout-review script uses Playwright to navigate the dev server. Its hardcoded path needs updating so it doesn't 308-hop.

**Files:**
- Modify: `scripts/review-checkout.mjs`

- [ ] **Step 1: Update the cart navigation path**

Find (around line 82):

```js
await page.goto('http://localhost:3000/cart', { waitUntil: 'networkidle' });
```

Replace with:

```js
await page.goto('http://localhost:3000/shop/cart', { waitUntil: 'networkidle' });
```

Find the route reference around line 129:

```js
{
  route: '/cart',
  ...
}
```

Replace with:

```js
{
  route: '/shop/cart',
  ...
}
```

(Open the file and update any other `/cart` string literals you find — there's a `// First a baseline /cart` comment at line 124 you can update for accuracy too: `// First a baseline /shop/cart`.)

- [ ] **Step 2: Commit**

```bash
git add scripts/review-checkout.mjs
git commit -m "chore: review-checkout script hits /shop/cart"
```

---

## Task 8: Domain wiring + manual end-to-end verification

The migration is code-complete. This task is operational — verify the deployed environment serves traffic correctly on `wildlightimagery.shop` and document the `.com` swap runbook for later.

This task does **not** produce a commit on its own (unless the verification turns up a bug, in which case fix and commit the fix).

- [ ] **Step 1: Confirm Vercel domain configuration**

In the Vercel dashboard for this project:
- `wildlightimagery.shop` is added as a custom domain (apex).
- `www.wildlightimagery.shop` redirects to apex (or is added).
- DNS A/AAAA/CNAME records resolve correctly.
- HTTPS certificate is active.

If `wildlightimagery.shop` is not yet added, add it now and wait for SSL to provision (typically <2 min).

Confirm that `wildlightimagery.com` is **not** routed to this project — it should remain parked until nameservers move.

- [ ] **Step 2: Confirm environment variables on Production**

Verify in Vercel project settings → Environment Variables (Production):
- `NEXT_PUBLIC_APP_URL=https://wildlightimagery.shop`
- `APP_URL=https://wildlightimagery.shop`
- `R2_PUBLIC_BASE_URL=https://images.wildlightimagery.shop`
- `RESEND_FROM_EMAIL` resolves under a DKIM-configured `wildlightimagery.shop` sender.
- `RESEND_BROADCAST_FROM` same.

- [ ] **Step 3: Confirm Stripe webhook URL**

In Stripe Dashboard → Developers → Webhooks, the active endpoint URL is:
`https://wildlightimagery.shop/api/webhooks/stripe`

(If it's still pointing at a different host from a prior deploy, update it now.)

- [ ] **Step 4: Confirm Printful webhook URL**

In Printful Dashboard → Settings → Webhooks, the registered URL is:
`https://wildlightimagery.shop/api/webhooks/printful?token=<value-of-PRINTFUL_WEBHOOK_SECRET>`

(The token query param is required; the route does a constant-time comparison.)

- [ ] **Step 5: Deploy to production**

Push the branch with all preceding commits to your remote and let Vercel build + deploy. Watch the build log for any errors.

- [ ] **Step 6: Run the 11-step manual verification checklist**

On the deployed `wildlightimagery.shop`:

1. **Old URL 308s** — `curl -I https://wildlightimagery.shop/cart` returns 308 → `/shop/cart`. Repeat for `/collections`, `/artwork/<slug>`, `/orders/<token>`, `/wildlight-store/foo`, `/shopping-cart`, `/blog/anything`.
2. **Marketing root** — `https://wildlightimagery.shop/` renders the stub home with the masthead and "Visit the shop" CTA.
3. **Shop home** — `https://wildlightimagery.shop/shop` renders the storefront index (masthead + index of plates).
4. **Cart roundtrip** — From `/shop/artwork/<slug>`, add a variant to cart. Confirm the cart count badge updates. Click it; lands on `/shop/cart` with the line item visible. Click "Continue to checkout" — lands on `/shop/checkout`.
5. **Stripe checkout (test mode)** — Pay with `4242 4242 4242 4242` (any zip, any future expiry). After the Stripe widget succeeds, you're sent to `/api/orders/by-session/cs_test_...`, which redirects to `/shop/orders/<token>?success=1`. The order detail page renders.
6. **Order email — confirmation** — Within ~30 seconds, a confirmation email arrives. The "View your order" link (or equivalent) is `https://wildlightimagery.shop/shop/orders/<token>`. Click it; lands on the order page (no 308 hop in browser devtools).
7. **Printful webhook** — From the Printful dashboard, send a test webhook event for any order status. The webhook returns 200 in Printful's UI. Admin order detail page reflects the new status.
8. **Order email — shipped** — Trigger a shipped event (either via Printful test webhook or by manually advancing an order in admin). The shipped-email "Track your order" link is `https://wildlightimagery.shop/shop/orders/<token>`. Click; lands on the order page.
9. **Sitemap** — `https://wildlightimagery.shop/sitemap.xml` lists `/shop`, `/shop/collections`, `/shop/collections/<slug>` for each collection, and `/shop/artwork/<slug>` for each published artwork. Marketing URLs (`/about`, `/contact`) are at root.
10. **Robots** — `https://wildlightimagery.shop/robots.txt` references `https://wildlightimagery.shop/sitemap.xml` and allows all (or matches whatever `app/robots.ts` configures).
11. **Cart persistence** — On the deployed domain, add to cart, refresh the page, navigate around — the `wl_cart_v1` localStorage entry persists; cart still shows the item.

If any of #1–#11 fails, file a fix commit before declaring the migration done.

- [ ] **Step 7: Done**

The migration is complete. The next sub-project (#2 Marketing surfaces) can begin.

---

## Self-Review

**Spec coverage check:**

- ✓ Move storefront URLs under `/shop/*` — Tasks 1, 2, 3.
- ✓ Stub home at `/` — Task 1, Step 3.
- ✓ Update internal hrefs in components — Task 2.
- ✓ Update internal hrefs in pages — Task 3.
- ✓ Update API redirect URL — Task 4.
- ✓ Update transactional email URLs — Task 5.
- ✓ Update sitemap — Task 6.
- ✓ Update test fixture script — Task 7.
- ✓ Add 308 redirects for prior shop URLs — Task 1, Step 4.
- ✓ Add 308 redirects for legacy WP URLs — Task 1, Step 4.
- ✓ Add 307 redirect placeholder for `/blog/*` — Task 1, Step 4.
- ✓ Domain wiring confirmation — Task 8, Steps 1-4.
- ✓ Manual end-to-end verification — Task 8, Step 6.
- ✓ Done criteria checklist — Task 8, Step 6 covers all 11 items from the spec's Done section.

**Items NOT covered here (intentional, per spec non-goals):**
- Renaming the route group `(shop)` → `(site)` — deferred to sub-project #2.
- Building real marketing pages — sub-project #2.
- The `.com` cutover — runbook lives in the spec; no code change in this plan.
- Resend DKIM verification on `wildlightimagery.shop` — operational task pre-Task 8 Step 5; not a code change.

The spec's "Open questions for implementation plan" are addressed:
- **PR shape** — single branch, multiple commits per task; each commit leaves `main` working.
- **Vercel domain config** — Task 8 Step 1.
- **Resend DKIM** — surfaced in Task 8 Step 2.
- **Sitemap content** — Task 6 explicitly enumerates what's in/out.
