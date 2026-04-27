# Foundation — Shop Migration to `/shop/*`

**Date:** 2026-04-27
**Status:** Ready for plan
**Sub-project of:** `2026-04-27-wildlight-com-rebuild-overview.md` (#1)

## Goal

Move the existing storefront URL surface from the bare root
(`/`, `/cart`, `/collections`, `/artwork/[slug]`, `/orders/[token]`)
under a `/shop/*` prefix, freeing the root for the marketing site that
sub-project #2 builds. Land working `wildlightimagery.shop` as the
canonical host. Preserve every existing customer-facing URL via 301
redirects. Verify the full purchase flow (cart → Stripe checkout →
Printful fulfillment → tracking email) still works end-to-end.

This is the foundation. Nothing else in the rebuild ships before this.

## Non-goals

- **No new design.** Print-room CSS untouched. Existing components stay
  functionally identical; only their `href` strings change.
- **No new admin UI.** Admin lives at `/admin/*` and is not touched.
- **No marketing pages.** `/` ships as a stub; sub-project #2 fills it
  in. `/about`, `/contact`, `/legal/*` keep their current shop content
  in place — they already serve a generic-enough purpose to act as the
  marketing versions until #2 enhances them.
- **No checkout / Stripe / Printful logic changes.** Only URL strings
  and the `success_url` / `cancel_url` paths change.
- **No `wildlightimagery.com` cutover.** That happens later when the
  nameservers move; this sub-project documents the runbook only.
- **No journal, no newsletter changes** (tracked in #3 and #4).

## Source of truth

- Architecture: `2026-04-27-wildlight-com-rebuild-overview.md`
- Existing routing: `app/(shop)/*` (route group at root)
- Canonical host helper: env var `NEXT_PUBLIC_APP_URL` (already used
  by `app/sitemap.ts`, `app/robots.ts`, `app/layout.tsx`,
  `app/api/checkout/route.ts`, `app/api/webhooks/stripe/route.ts`,
  `app/api/webhooks/printful/route.ts`, `app/api/subscribe/route.ts`).
  Default fallback `https://wildlightimagery.shop` already in code.
- Cart persistence: `localStorage` key `wl_cart_v1` in
  `components/shop/CartProvider.tsx`. Scoped to host — surviving the URL
  move requires no work since the host doesn't change.

## URL mapping

| Before | After | Notes |
|---|---|---|
| `/` (shop home) | `/shop` | Storefront home moves; new stub at `/` |
| `/cart` | `/shop/cart` | |
| `/checkout` | `/shop/checkout` | |
| `/collections` | `/shop/collections` | |
| `/collections/[slug]` | `/shop/collections/[slug]` | |
| `/artwork/[slug]` | `/shop/artwork/[slug]` | |
| `/orders/[token]` | `/shop/orders/[token]` | Token URLs in transactional emails |
| `/about` | `/about` | **Unchanged** — content is general-purpose, becomes the marketing about |
| `/contact` | `/contact` | **Unchanged** — same reasoning |
| `/legal/privacy` | `/legal/privacy` | **Unchanged** — site-wide |
| `/legal/terms` | `/legal/terms` | **Unchanged** — site-wide |
| `/legal/shipping-returns` | `/legal/shipping-returns` | **Unchanged** — accessed from both Footer and shop pages |
| `/admin/*` | `/admin/*` | **Unchanged** |
| `/api/*` | `/api/*` | **Unchanged** |
| `/wildlight-store/*` (legacy WP) | `/shop` | Catch-all 301 |
| `/shopping-cart/` (legacy WP) | `/shop/cart` | 301 |
| `/blog/*` (legacy WP) | `/` (placeholder, 307) | Sub-project #3 retargets to `/journal/*` when journal lands |

## Route group restructure

Current shape:

```
app/(shop)/
├── layout.tsx          → shared layout (CartProvider, Nav, Footer)
├── page.tsx            → /
├── cart/page.tsx       → /cart
├── checkout/page.tsx   → /checkout
├── collections/...     → /collections, /collections/[slug]
├── artwork/...         → /artwork/[slug]
├── orders/...          → /orders/[token]
├── about/page.tsx      → /about
├── contact/page.tsx    → /contact
└── legal/...           → /legal/*
```

Target shape:

```
app/(shop)/
├── layout.tsx          → unchanged; still wraps all descendants
├── page.tsx            → / (NEW STUB — marketing-home placeholder)
├── shop/
│   ├── page.tsx        → /shop  (was app/(shop)/page.tsx)
│   ├── cart/page.tsx   → /shop/cart
│   ├── checkout/page.tsx → /shop/checkout
│   ├── collections/... → /shop/collections, /shop/collections/[slug]
│   ├── artwork/...     → /shop/artwork/[slug]
│   └── orders/...      → /shop/orders/[token]
├── about/              → /about (unchanged)
├── contact/            → /contact (unchanged)
└── legal/              → /legal/* (unchanged)
```

The route group `(shop)` continues to provide the shared layout — it
wraps both shop pages (`/shop/*`) and the marketing-adjacent pages
(`/`, `/about`, `/contact`, `/legal/*`). CartProvider being available
on marketing pages is harmless — it's a context, not UI.

The route group's name (`(shop)`) is now a misnomer (it covers all
non-admin pages), but renaming it (e.g. to `(site)`) requires touching
no logic and adds churn — defer renaming until sub-project #2 promotes
shared components.

## Stub marketing home

`app/(shop)/page.tsx` (replacing the moved storefront home) gets a
minimal placeholder so the root URL doesn't 404:

- Wordmark + eyebrow ("Wildlight Imagery · Aurora, Colorado")
- Tagline (lifted verbatim from the existing storefront masthead:
  *"Exploring my light for as long as I can remember."*)
- Single primary CTA → `/shop` ("Visit the shop")
- Quiet footnote — *"Portfolio · journal · about — coming soon."*
- Uses existing Print-room CSS only — no new tokens, no new layout
  primitives. Sub-project #2 replaces this with the real home.

## Internal href updates

Every component and page that links to a moved URL needs its `href`
rewritten. From the audit (`grep -E 'href="/(cart|artwork|collections|orders)'`):

**Components**
- `components/shop/Nav.tsx` — `LINKS` array: `/collections` → `/shop/collections`. The `match` predicate also widens — paths now start with `/shop/collections` or `/shop/artwork`.
- `components/shop/Footer.tsx` — `/collections` → `/shop/collections`. `/legal/*` unchanged.
- `components/shop/CartCountBadge.tsx` — `/cart` → `/shop/cart`.
- `components/shop/PlateCard.tsx` — `/artwork/${slug}` → `/shop/artwork/${slug}`.

**Pages** (relative to their *new* location under `app/(shop)/shop/...`)
- `cart/page.tsx` — `/collections` → `/shop/collections`.
- `checkout/page.tsx` — three refs: `/collections`, `/cart` → `/shop/...`.
- `collections/[slug]/page.tsx` — `/collections` → `/shop/collections`.
- `artwork/[slug]/page.tsx` — `/collections` → `/shop/collections`.
- `orders/[token]/page.tsx` — `/collections` → `/shop/collections`.

**Marketing-adjacent pages** (still at root)
- `app/(shop)/about/page.tsx` — `/collections` → `/shop/collections`.

**API routes**
- `app/api/checkout/route.ts` — Stripe `success_url` already routes
  through `/api/orders/by-session/{id}` (an API redirect; unchanged).
  Stripe `cancel_url` is `${siteUrl}/cart` → `${siteUrl}/shop/cart`.
- `app/api/orders/by-session/[id]/route.ts` — line 31 builds
  `${origin}/orders/${token}` → `${origin}/shop/orders/${token}`.
  Line 22 fallback `redirect('/')` is fine (marketing home is a
  reasonable not-found target).

**Email templates** (`lib/email.ts`)
- Four `orderUrl` builds at lines 213, 250, 337, 435: append
  `/shop/orders/${token}` instead of `/orders/${token}`.

**Sitemap** (`app/sitemap.ts`)
- Emit shop URLs with the `/shop/` prefix. The `/about`, `/contact`,
  `/legal/*` entries (if any) stay at root.

**Scripts**
- `scripts/review-checkout.mjs` — Playwright dev test: `/cart` →
  `/shop/cart`.

## Redirects

Use Next.js `redirects()` in `next.config.ts` so 301s are emitted at
the platform layer (Vercel handles the redirect before the app boots).
Single config block:

```ts
async redirects() {
  return [
    // Storefront URLs that moved
    { source: '/cart',                  destination: '/shop/cart',                  permanent: true },
    { source: '/checkout',              destination: '/shop/checkout',              permanent: true },
    { source: '/collections',           destination: '/shop/collections',           permanent: true },
    { source: '/collections/:slug',     destination: '/shop/collections/:slug',     permanent: true },
    { source: '/artwork/:slug',         destination: '/shop/artwork/:slug',         permanent: true },
    { source: '/orders/:token',         destination: '/shop/orders/:token',         permanent: true },

    // Legacy WP shop URLs
    { source: '/wildlight-store',       destination: '/shop',                       permanent: true },
    { source: '/wildlight-store/:path*', destination: '/shop',                      permanent: true },
    { source: '/shopping-cart',         destination: '/shop/cart',                  permanent: true },

    // Legacy WP blog URL — placeholder until #3 wires the journal
    { source: '/blog',                  destination: '/',                           permanent: false },
    { source: '/blog/:path*',           destination: '/',                           permanent: false },
  ];
}
```

Notes:

- `permanent: true` emits 308 (preserves method) which is the modern
  equivalent of 301 for SEO. Search engines treat both as canonical.
- `/blog/*` is `permanent: false` (307) so we can repoint to
  `/journal/*` after sub-project #3 ships without re-indexing churn.
- Query strings carry forward by default in Next redirects — no
  per-redirect config needed.
- Trailing-slash variants are normalized by Next's default
  `trailingSlash: false` setting.

## Domain configuration

- `wildlightimagery.shop` is the canonical host for this phase. The
  R2 image base (`images.wildlightimagery.shop`) already uses this
  domain — DNS is presumably already configured for the apex.
- Add the apex `wildlightimagery.shop` (and `www` redirect to apex) as
  Vercel project domains if not already present. Set
  `wildlightimagery.shop` as the canonical primary; redirect any
  alternate hosts to it.
- Set `NEXT_PUBLIC_APP_URL=https://wildlightimagery.shop` and
  `APP_URL=https://wildlightimagery.shop` in the production
  environment (verify both Production and Preview).
- Confirm `wildlightimagery.com` is **not** routed to this project
  yet — it stays parked until the nameservers move. Once it's added,
  it becomes the canonical and `.shop` redirects to it (see runbook
  below).
- Confirm Stripe Dashboard webhook endpoint URL points at
  `https://wildlightimagery.shop/api/webhooks/stripe`.
- Confirm Printful webhook URL (registered in Printful dashboard with
  `?token=…` self-issued secret) points at
  `https://wildlightimagery.shop/api/webhooks/printful?token=…`.
  No code change needed — Printful continues hitting whatever URL
  is registered. The constant-time check in
  `app/api/webhooks/printful/route.ts` only compares the token, not
  the host.
- Confirm Resend `RESEND_FROM_EMAIL` and `RESEND_BROADCAST_FROM`
  resolve under the new domain (DNS DKIM/SPF must be configured for
  `wildlightimagery.shop` if not already).

## Verification (manual end-to-end)

Per the project's testing convention (Vitest unit tests don't cover
checkout / webhooks / email — manual verification required):

1. **Old URL 301s**
   - `curl -I https://wildlightimagery.shop/cart` → 308 → `/shop/cart`
   - `curl -I https://wildlightimagery.shop/artwork/aurora-ridge` → 308 → `/shop/artwork/aurora-ridge`
   - `curl -I https://wildlightimagery.shop/wildlight-store/foo` → 308 → `/shop`
2. **Marketing root** — `https://wildlightimagery.shop/` renders the
   stub home, not 404.
3. **Shop home** — `/shop` renders the storefront index.
4. **Cart roundtrip** — Add an item from `/shop/artwork/[slug]` → see
   it on `/shop/cart` with cart count badge updated → continue to
   `/shop/checkout`.
5. **Stripe checkout** (test mode) — Pay with `4242 4242 4242 4242` →
   land on `/shop/orders/[token]` (via the
   `/api/orders/by-session/[id]` API redirect) → see order details.
6. **Order email** — Confirmation email contains
   `https://wildlightimagery.shop/shop/orders/[token]`. Open it; page
   resolves correctly.
7. **Printful webhook** — Manually trigger a Printful test event from
   the Printful dashboard. `/api/webhooks/printful?token=…` accepts.
   Order status updates in admin. Tracking email links land on
   `/shop/orders/[token]`.
8. **Sitemap** — `https://wildlightimagery.shop/sitemap.xml` lists
   `/shop/...` URLs (not `/cart`, `/collections`, etc).
9. **robots** — `https://wildlightimagery.shop/robots.txt` references
   the correct sitemap URL.
10. **Email link from shipped notification** — same check as #6 for
    the shipped-status email template.
11. **Cart persistence** — Add to cart on the deployed `.shop` domain,
    refresh the page, navigate around — `wl_cart_v1` localStorage
    persists, cart still shows the item.

## Rollback plan

The migration is reversible by reverting the single PR. Concerns:

- **In-flight orders.** If a customer received a confirmation email
  during a brief window where the email had `/shop/orders/[token]`
  but the routes still served at `/orders/[token]`, the link would
  301 the customer back to the new path. This is fine. The reverse
  case (email has `/orders/[token]`, deploy now serves `/shop/...`)
  is also fine because the 301s catch it.
- **Stripe sessions in flight at deploy time.** The
  `success_url` is set when the session is *created* (not at
  redirect time). A session created pre-deploy with old success_url
  will redirect to `/api/orders/by-session/{id}`, which always builds
  its redirect target from the current code — the post-deploy code
  builds `/shop/orders/[token]`. Fine.
- **No DB migration**, no Stripe / Printful schema changes. Code-only
  revert.

## Swap-to-`.com` runbook (later)

Triggered when nameservers for `wildlightimagery.com` are pointed at
Vercel (out of scope for this sub-project; documented here for the
future operation):

1. Add `wildlightimagery.com` and `www.wildlightimagery.com` to the
   Vercel project's domains. Verify SSL certificates issue.
2. Set the `.com` apex as the project's **primary** domain. Configure
   `wildlightimagery.shop` to 308-redirect to the matching path on
   `.com` (Vercel domain settings handles this).
3. Update environment variables:
   - `NEXT_PUBLIC_APP_URL` → `https://wildlightimagery.com`
   - `APP_URL` → `https://wildlightimagery.com`
   - `RESEND_FROM_EMAIL` → `orders@wildlightimagery.com`
     (or keep `.shop` if DKIM stays on the `.shop` domain — choose
     based on which has clean DNS reputation)
   - `RESEND_BROADCAST_FROM` → same logic
4. Update Stripe Dashboard webhook URL to
   `https://wildlightimagery.com/api/webhooks/stripe`. Re-issue webhook
   signing secret if needed.
5. Update Printful Dashboard webhook URL to
   `https://wildlightimagery.com/api/webhooks/printful?token=…`
   (token unchanged).
6. Update R2 image domain — the bucket public URL is currently
   `images.wildlightimagery.shop`. Either keep it (it's a valid
   subdomain regardless of the marketing TLD) or add a parallel CNAME
   `images.wildlightimagery.com`. Decision deferred to the runbook
   execution.
7. Update `next.config.ts` `images.remotePatterns` to add the `.com`
   image host if a new R2 CNAME was created. The existing
   `wildlightimagery.com` entry stays.
8. Re-run all verification steps from this spec on the `.com` host.
9. Update `app/robots.ts` and `app/sitemap.ts` defaults if the
   fallback should change from `.shop` to `.com` (env var override
   makes this cosmetic; falls back only when env unset).
10. Submit the new `.com` site to Google Search Console; submit the
    new sitemap. The `.shop` → `.com` 308s preserve link equity.

## Open questions resolved here

- **Stub home vs redirect-to-/shop at `/`** — stub home (option A from
  brainstorm). Reasoning: visitors typing `wildlightimagery.shop` into
  a browser shouldn't be redirected to a different path; the `.shop`
  domain *is* the marketing site, just not yet built. Stub holds the
  spot.
- **`/about` and `/contact`** — unchanged location; the existing
  content already serves the marketing role acceptably until #2
  enhances. Avoids creating both `/shop/about` and `/about` for
  near-identical content.
- **`/legal/*`** — site-wide policies stay at root. Linked from the
  unified Footer. No `/shop/legal/*`.
- **Route group rename `(shop)` → `(site)`** — deferred to #2. Not
  worth the churn in this sub-project.

## Open questions for implementation plan

- **PR shape.** One large PR (route move + hrefs + redirects + email
  templates + verification) or split (move first, then per-component
  href updates)? Recommendation: one PR to keep the moment-of-cutover
  atomic; split if the diff grows unmanageable.
- **Vercel domain config.** Confirm with Vercel project: is
  `wildlightimagery.shop` already added as a custom domain, or only
  the `images.` subdomain? Document the exact steps before merging.
- **Resend DKIM / sender domain status.** Confirm the From-domains
  resolve correctly on `wildlightimagery.shop` before email URLs go
  live with the new path — a broken DKIM during cutover would land
  order confirmations in spam.
- **Sitemap content** — the sitemap currently emits each artwork's
  URL. Confirm what other URLs (collection pages, marketing pages
  once #2 ships) belong in the sitemap and where they're sourced.

## Done criteria

- [ ] All shop pages live at `/shop/*` and resolve.
- [ ] Stub home renders at `/` with no 404.
- [ ] All 301/308 redirects in the table emit correctly.
- [ ] Full purchase flow verified end-to-end on `wildlightimagery.shop`
      (cart → checkout → success → confirmation email → order page).
- [ ] Stripe webhook posts arrive correctly (test event).
- [ ] Printful webhook accepts a test event.
- [ ] Sitemap and robots both reflect the new structure.
- [ ] Tracking-email link from a real test order opens the order page.
- [ ] No remaining hard-coded `/cart`, `/collections`, `/artwork/`,
      `/orders/[token]` href strings in components or pages
      (grep clean).
