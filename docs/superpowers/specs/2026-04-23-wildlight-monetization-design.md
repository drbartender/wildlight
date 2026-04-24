# Wildlight Imagery — Artist Storefront Design Spec

**Date:** 2026-04-23
**Author:** Dallas (with Claude collaborative brainstorm)
**Status:** Approved — ready for implementation plan

---

## Context

Dan Raby (Dallas's brother) is a professional photographer trained at Colorado Institute
of Art, based in Aurora, CO. His site wildlightimagery.com has been dormant for ~10 years
(WordPress + Imagely theme + NextGEN gallery). Dan has been unemployed for some time. His
portfolio is significantly larger than what's visible — he's a perfectionist who under-shows.
His work leans experimental: wildlife shot with unusual technique, abstract/fine art/macro,
Denver urban scenes. He shoots occasionally now; with motivation he would shoot more.

This project monetizes his existing portfolio as a way to show him what's possible with
concrete effort. Dallas builds it quietly using archival work, drives it to first-sale
traction, then hands Dan a working business at a reveal moment. Success = Dan buys in
and restarts the work.

## Goals

- **Phase 1 (Dallas-led):** Build a ready-to-use storefront on the existing portfolio.
  First sale within 6 weeks of launch.
- **Phase 2 (Dan-led, if he accepts the hand-off):** Active growth with new work, email
  marketing, paid acquisition, possibly commissions and limited editions.

## Non-goals (for Phase 1)

- No Fine Art America or other marketplace listings (Dan wants something that is *his*)
- No portraits-for-hire booking system
- No graphic design service intake flow
- No photojournalism section at launch (politically charged, different buyer, add later if wanted)
- No customer accounts / wishlists / reviews
- No international shipping configuration
- No signed / numbered editions (column exists, UI deferred)
- No email campaigns or drip sequences (`subscribers` table at launch; send broadcasts only)

## Brand & Positioning

**Wildlight Imagery by Dan Raby** — a small, curated fine-art photography studio.

- Tone: understated, artist-first, curated. Lyrical collection names preserved from current
  site. Every piece has a short artist note (where/why/technique) — fine-art context that
  differentiates from stock photo shops.
- Audience (primary): interior-design and home-decor buyers who want distinctive work.
  Denver/Colorado regional lean, nationwide reachable. Secondary: corporate décor (venues,
  Airbnbs, offices) — prime target for Dr. Bartender client cross-pollination.
- Scarcity-forward framing that matches Dan's perfectionism: *"A small, considered
  selection, added sparingly"* rather than *"Shop 500+ prints."*

## Catalog Architecture

**One photo = one `artwork`**, which ships as multiple physical SKUs (print type × size ×
finish). Example: *"Lime Fruit"* (from The Macro):

| Type | Sizes | Price range | Printful product |
|---|---|---|---|
| Fine art print (archival matte) | 8×10, 12×16, 18×24, 24×36 | $30–$120 | Enhanced Matte Paper Poster |
| Canvas wrap | 12×16, 18×24, 24×36 | $55–$165 | Premium Canvas |
| Framed poster | 12×16, 18×24 | $85–$180 | Framed Poster (black/white/oak) |
| Metal print (premium) | 16×20, 24×30 | $140–$260 | Premium Metal Print |

Target margin: ~50–60% after Printful cost + Stripe fee + shipping passthrough.

### Collections (preserved from current site)

Six named collections, top-level browse hierarchy:

1. **The Sun** — golden hour / natural light
2. **The Night** — nighttime / low-light / astro
3. **The Land** — landscape & terrain
4. **The Macro** — close-up / detail work
5. **Flowers** — botanical
6. **The Unique** — experimental / conceptual

Optional "Photojournalism" as a 7th collection in Phase 2 if Dan wants it. Not launching
with it (politically-themed subject matter, different buyer).

## Site Pages

### Public pages

| Route | Purpose |
|---|---|
| `/` | Hero (rotating featured artwork) + six collection cards + "About Dan" teaser + email capture |
| `/collections` | All six collections, hero image each |
| `/collections/[slug]` | Single collection — grid of artworks in that chapter |
| `/artwork/[slug]` | Single artwork — hero image, artist note, variant picker, Add to Cart |
| `/about` | Dan's story — Colorado Institute of Art, philosophy, contact |
| `/journal` | Optional blog (Phase 2 unless day-one value warrants) |
| `/journal/[slug]` | Individual post |
| `/contact` | Commission inquiries, licensing, corporate décor, press |
| `/cart` | Cart review |
| `/checkout` | Stripe Checkout Session (hosted) |
| `/orders/[token]` | Token-gated order status + tracking (guest checkout, no account) |
| `/legal/privacy` | Required |
| `/legal/terms` | Required |
| `/legal/shipping-returns` | Printful-aligned policy |

### Admin pages (single admin role — Dan and Dallas both full access)

| Route | Purpose |
|---|---|
| `/admin` | Dashboard — revenue, orders, top sellers, subscribers, traffic |
| `/admin/artworks` | Artwork list + bulk actions + manifest import |
| `/admin/artworks/new` | Upload flow with EXIF auto-extract + variant template |
| `/admin/artworks/[id]` | Edit detail + variants + print-res upload + sales history |
| `/admin/collections` | Reorder, rename, edit tagline, upload cover |
| `/admin/orders` | Order list + detail + refund + resubmit to Printful |
| `/admin/subscribers` | List + broadcast email (Resend batch) |
| `/admin/settings` | Profile / password / pricing templates / email template copy |

API keys (Stripe, Printful, Resend) live in Vercel env vars. Not editable from the admin UI.

### Customer journey (happy path)

1. Land on `/` → six collection cards → click *The Macro*
2. `/collections/the-macro` → scroll grid → click *Lime Fruit*
3. `/artwork/lime-fruit` → read artist note → pick Canvas 18×24 → Add to cart
4. `/cart` → review → Checkout
5. Stripe Checkout Session (hosted) → pay
6. Success redirect → `/orders/{token}` shows confirmation + tracking placeholder
7. Stripe webhook `checkout.session.completed` → create Printful order → save
   `printful_order_id` → send confirmation email via Resend
8. Printful webhook on status change → update order row → trigger shipped-email
   with tracking

### UX calls worth flagging

- **No customer account required to buy.** Guest checkout, email for order status only.
  Same pattern as Dr. Bartender's token-gated proposals.
- **One-click "Notify when available"** on retired / sold-out editions — captures email intent.
- **Persistent email capture strip in footer** + a single exit-intent modal.
  No aggressive popups.
- **Every artwork page has a "License this image" secondary CTA** — sends a contact-form
  inquiry. Corporate buyers self-identify.
- **No search, no reviews, no wishlists** at launch. Navigation beats search at this
  catalog size; reviews confuse fine-art buyers.

## Image Pipeline & Hosting

### Two image tiers per artwork

- `image_web_url` — R2 public, 1600–2000px max, 85% JPEG quality. Used for catalog,
  collection, and artwork pages. Served through Vercel's `next/image` with automatic
  responsive srcset + WebP/AVIF.
- `image_print_url` — R2 private (signed URL), full-resolution TIFF or max-quality JPEG.
  Nullable at launch; populated lazily before fulfillment (see below).

### Populate pipeline

1. **Scrape (week 0):** `scripts/scrape-wildlight.js` crawls current site's six collections,
   downloads every image, writes `scraped/manifest.json` with titles + alt text.
2. **Import (week 1):** `scripts/import-manifest.js` reads the manifest, uploads every
   image to R2 as `image_web_url`, creates draft `artworks` rows grouped by collection.
3. **Curate (week 1):** Dallas filters `/admin/artworks?status=draft` and flips ~50
   strongest to `published`.
4. **Print-res on demand:** `image_print_url` stays null until first order. When a sale
   lands, Dan (or Dallas) uploads the full-res via `/admin/artworks/[id]` → Printful
   order resubmits with the proper print file. Framed to customer as *"made-to-order,
   ships within a week"* — expected for fine art.

### Hosting + domain

- Temporary domain: **wildlightimagery.shop** (already registered) → Cloudflare DNS →
  Vercel. Decouples build from Dan's existing `wildlightimagery.com` hosting.
- Long-term: either repoint `wildlightimagery.com` to the new stack once Dan hands over
  DNS, or leave the legacy portfolio site alone and let the shop live at the `.shop`
  domain permanently — valid fine-art-world pattern.

## Tech Stack

Zero unnecessary subscriptions; pay for tools that earn their keep.

| Concern | Choice | Monthly cost |
|---|---|---|
| Framework | Next.js 15 App Router, TypeScript | — |
| Hosting | Vercel Pro | $20 |
| Database | Neon Postgres (new project, free tier) | $0 |
| Storage | Cloudflare R2, new `wildlight-images` bucket (existing account) | ~$0.05 |
| Image optimization | `next/image` with R2 remote pattern | — |
| Payments | Stripe Checkout Sessions | per-txn fee only |
| Tax | Stripe Tax | $0.05/txn |
| POD | Printful (free account) | per-order cost only |
| Email | Resend (free 3K/mo, same account as Dr. Bartender) | $0 |
| Errors | Sentry free tier | $0 |
| Analytics | Vercel Web Analytics (included in Pro) | $0 |
| DNS | Cloudflare (existing account) | $0 |
| Auth | JWT + bcryptjs, 2 admin users seeded | — |

**Fixed monthly: $20.** Variable: Stripe fees + Stripe Tax + Printful costs + Resend if
past 3K/mo emails.

### Reuse-from-Dr-Bartender patterns

Lifted / adapted, not rewritten:

- `lib/errors.ts` — AppError hierarchy (ValidationError, ConflictError, NotFoundError,
  PermissionError, ExternalServiceError)
- `lib/r2.ts` — upload + signed URL helpers
- `lib/email.ts` — Resend wrapper + template structure
- `lib/stripe.ts` — client factory with test-mode toggle (fail-closed)
- Webhook signature verification discipline (Stripe + Printful + Resend)
- Idempotent `schema.sql` pattern (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`)
- Token-gated public pages (order status)
- Money stored as integer cents, always

## Data Model

All tables in raw SQL via `pg`, no ORM, idempotent DDL.

```sql
CREATE TABLE IF NOT EXISTS collections (
  id              SERIAL PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  tagline         TEXT,
  cover_image_url TEXT,
  display_order   INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS artworks (
  id              SERIAL PRIMARY KEY,
  collection_id   INT REFERENCES collections(id) ON DELETE SET NULL,
  slug            TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  artist_note     TEXT,
  year_shot       INT,
  location        TEXT,
  image_web_url   TEXT NOT NULL,       -- R2 public
  image_print_url TEXT,                -- R2 private (signed URL), nullable until first order
  image_width     INT,
  image_height    INT,
  exif            JSONB,                -- capture date, camera, lens, focal length (optional display)
  status          TEXT NOT NULL DEFAULT 'draft',  -- draft | published | retired
  display_order   INT NOT NULL DEFAULT 0,
  edition_size    INT,                  -- null = open edition (Phase 2 lever)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_artworks_collection_published
  ON artworks(collection_id) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_artworks_status ON artworks(status);

CREATE TABLE IF NOT EXISTS artwork_variants (
  id                        SERIAL PRIMARY KEY,
  artwork_id                INT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  printful_sync_variant_id  BIGINT,    -- null until pushed to Printful
  type                      TEXT NOT NULL,  -- print | canvas | framed | metal
  size                      TEXT NOT NULL,  -- e.g. "18x24"
  finish                    TEXT,           -- e.g. "black frame", "matte"
  price_cents               INT NOT NULL,
  cost_cents                INT NOT NULL,   -- Printful cost snapshot at create time
  active                    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_variants_artwork_active
  ON artwork_variants(artwork_id) WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS orders (
  id                SERIAL PRIMARY KEY,
  public_token      UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  stripe_session_id TEXT UNIQUE,
  stripe_payment_id TEXT,
  customer_email    TEXT NOT NULL,
  customer_name     TEXT,
  shipping_address  JSONB,
  subtotal_cents    INT NOT NULL,
  shipping_cents    INT NOT NULL DEFAULT 0,
  tax_cents         INT NOT NULL DEFAULT 0,
  total_cents       INT NOT NULL,
  printful_order_id BIGINT,
  tracking_url      TEXT,
  tracking_number   TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  -- pending | paid | submitted | needs_review | fulfilled | shipped | delivered | canceled | refunded
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_stripe ON orders(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_orders_printful ON orders(printful_order_id);

CREATE TABLE IF NOT EXISTS order_items (
  id                   SERIAL PRIMARY KEY,
  order_id             INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id           INT REFERENCES artwork_variants(id) ON DELETE SET NULL,
  artwork_snapshot     JSONB NOT NULL,  -- {title, slug, collection_title, image_web_url}
  variant_snapshot     JSONB NOT NULL,  -- {type, size, finish}
  price_cents_snapshot INT NOT NULL,
  cost_cents_snapshot  INT NOT NULL,
  quantity             INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS subscribers (
  id              SERIAL PRIMARY KEY,
  email           TEXT UNIQUE NOT NULL,
  confirmed_at    TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  source          TEXT,  -- homepage | artwork_page | checkout | manual
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id           SERIAL PRIMARY KEY,
  source       TEXT NOT NULL,     -- stripe | printful
  event_id     TEXT UNIQUE,        -- dedupe key
  payload      JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Snapshot fields** (`artwork_snapshot`, `variant_snapshot`, `price_cents_snapshot`,
`cost_cents_snapshot` on `order_items`): preserve historical correctness if Dan retires a
piece or changes prices. Historical orders render with the data that was true at purchase time.

## Repo Structure

```
wildlight/
├── app/
│   ├── (shop)/
│   │   ├── page.tsx
│   │   ├── collections/page.tsx
│   │   ├── collections/[slug]/page.tsx
│   │   ├── artwork/[slug]/page.tsx
│   │   ├── cart/page.tsx
│   │   ├── about/page.tsx
│   │   └── contact/page.tsx
│   ├── orders/[token]/page.tsx
│   ├── admin/
│   │   ├── layout.tsx                     # Admin auth wrapper
│   │   ├── page.tsx                       # Dashboard
│   │   ├── artworks/page.tsx
│   │   ├── artworks/new/page.tsx
│   │   ├── artworks/[id]/page.tsx
│   │   ├── collections/page.tsx
│   │   ├── orders/page.tsx
│   │   ├── subscribers/page.tsx
│   │   └── settings/page.tsx
│   ├── api/
│   │   ├── checkout/route.ts              # Creates Stripe Checkout Session
│   │   ├── webhooks/stripe/route.ts       # Stripe → create Printful order
│   │   ├── webhooks/printful/route.ts     # Shipping updates
│   │   └── admin/…                        # Admin API endpoints
│   ├── layout.tsx
│   └── globals.css
├── lib/
│   ├── db.ts                              # pg Pool singleton
│   ├── schema.sql
│   ├── stripe.ts
│   ├── printful.ts                        # Printful API wrapper
│   ├── r2.ts
│   ├── email.ts
│   ├── errors.ts
│   ├── auth.ts                            # JWT admin auth
│   ├── pricing.ts                         # Pure pricing functions
│   └── printful-sync.ts                   # Product creation + variant mapping
├── components/
│   ├── ArtworkCard.tsx
│   ├── VariantPicker.tsx
│   ├── CollectionHero.tsx
│   ├── CartDrawer.tsx
│   ├── EmailCaptureStrip.tsx
│   └── admin/…
├── scripts/
│   ├── scrape-wildlight.js                # (written already)
│   ├── import-manifest.js                 # Reads manifest, uploads to R2, seeds DB
│   └── sync-printful-products.js          # Creates Printful sync_products per artwork
├── types/index.ts
├── .env.example
├── package.json
├── tsconfig.json
└── next.config.ts
```

## Printful Integration

### Product lifecycle

1. Admin uploads artwork (high-res image_web).
2. Admin picks variant template (Fine Art 4-sizes / Canvas 3-sizes / Full 14-SKU).
3. Server calls `POST /store/products` on Printful → creates sync_product + sync_variants.
4. Printful returns `sync_variant_id` per variant; saved to `artwork_variants`.
5. Artwork flipped to published → visible in shop.

### Order lifecycle (fail-closed)

```
Customer → Stripe Checkout (hosted) → pays
  ↓
Stripe webhook: checkout.session.completed (signature verified)
  ↓
Server (idempotent by session id):
  1. BEGIN transaction
  2. Mark order PAID
  3. Call Printful POST /orders with:
       recipient: Stripe shipping address
       items: [{sync_variant_id, quantity, files: [{url: image_print_url}]}]
       retail_costs: for Printful accounting
       confirm: true
     (idempotency-key = "order_<our_id>")
  4. Save printful_order_id, set status SUBMITTED
  5. COMMIT
  ↓
Resend confirmation email (template lifted from Dr. Bartender pattern)
  ↓
Printful webhook package_shipped → update order + shipped email with tracking
Printful webhook order_refunded / order_canceled → update order + trigger Stripe refund
```

### Fail-closed specifics

- If Printful submission throws, order stays PAID with status `needs_review`. Admin
  alerted via email. Customer gets polite "we'll be in touch within 24h" email. Never
  left in limbo, never double-charged.
- Idempotency key on Printful order = `order_<id>` so retries don't duplicate shipments.
- Stripe webhook signature verification mandatory.
- Printful webhook signature verification via shared secret header.
- All money as integer cents.
- `webhook_events` table stores every incoming webhook by `event_id` for dedupe + replay
  debugging.

### Pricing defaults (Phase 1)

- Retail = Printful cost × 2.1, rounded up to nearest $5 ending. (2.1× markup ≈ 52% margin before Stripe + shipping.)
- Shipping = Printful passthrough (no markup).
- Tax = Stripe Tax automated.
- Free shipping = absorbed by us when order subtotal (pre-tax, pre-shipping) ≥ $150.

## Admin Experience

Single admin role. Dan and Dallas both have full UI access. API key rotation + env vars
+ deploys live outside the UI (Vercel / Neon / GitHub) — Dallas only.

### Screen behavior (summary)

- **`/admin`** — revenue (7/30/all), orders needing review, top sellers, subscriber count, Vercel Analytics chart.
- **`/admin/artworks`** — filterable list, bulk publish/retire/delete/move-collection, "Import from manifest" button.
- **`/admin/artworks/new`** — drag-drop upload, EXIF auto-extract, collection picker, artist note markdown-lite, variant template dropdown, status=draft by default.
- **`/admin/artworks/[id]`** — edit all fields, variant table inline-editable, "Generate print-res" upload, status transitions, sales history panel.
- **`/admin/collections`** — drag-to-reorder, rename, edit tagline, cover image upload.
- **`/admin/orders`** — status chips, filters, detail view with resubmit / refund / manual-fulfill actions, internal note thread.
- **`/admin/subscribers`** — list + CSV export + new broadcast (subject, body markdown, test-send, send to all confirmed via Resend batch).
- **`/admin/settings`** — profile / password / pricing defaults / email template copy. No API keys visible.

### Curation flow at launch

1. Scraper writes `scraped/manifest.json` with ~400 artworks grouped by collection.
2. `npm run import:manifest` uploads to R2 + creates draft artwork rows.
3. Dallas filters `/admin/artworks?status=draft` and flips ~50 strongest to published.
4. Each published artwork gets a variant template applied → Printful products created.
5. Dallas arranges collection order + adjusts taglines.
6. Soft launch: share URL with close network.
7. First order triggers Dan's print-res upload or Dallas covers if Dan unavailable.

## Launch Plan

### Milestones

| Milestone | Timing | Deliverable |
|---|---|---|
| M0 Scrape + curate | Week 0–1 | Manifest done, ~50 artworks chosen |
| M1 Build complete | Week 2–4 | Site live, test order through, admin seeded |
| M2 Soft launch | Week 4–5 | Warm network outreach, 3–5 organic sales target |
| M3 The reveal | Week 5–6 | Dinner + canvas + admin handover |
| M4 Dan-led growth | Post-hand-off | New uploads, Phase 2 features as requested |

### Marketing (M2, free + cheap only)

- Dr. Bartender client list — one email blast (event venues, hosts, corporate decorators)
- Instagram reactivation — ~15 curated posts weekly with regional hashtags
- Pinterest business board — pin every artwork with product URL
- Local Denver art communities — Westword, Colorado Artists Guild, museum newsletters
- Printful product feed — auto-listed on Printful discovery
- Google Merchant Center + Shopping free listings

**Skip for launch:** paid Meta/Google ads, influencer seeding, press, marketplace
cross-listings. All Phase 2 levers.

### Dr. Bartender cross-pollination (day-one plays)

1. **Corporate gifting angle** — offer bundled prints as add-ons in Dr. Bartender
   proposals / invoices. DB owns the sales channel; Dan's work; zero friction.
2. **Email cross-promotion** — single "Art by Dan Raby — wildlightimagery.shop"
   footer line with one rotating image on DB transactional emails (proposal, reminder,
   thank-you). UTM-tagged for measurement.

Both reversible if they don't land.

### The hand-off moment (M3)

- Print a canvas of Dan's work and wrap it.
- Dinner + laptop + canvas + real sales data + subscriber list.
- Offer admin credentials + printed runbook.
- Ask: *"What would you want to add next?"*
- Goal: Dan sees proof that tech isn't the barrier. Decision is his.

## Phase 2 Levers (parked)

- Signed / numbered limited editions (needs manual fulfillment via WHCC / Bay Photo).
- Commission inquiries workflow (contact form sufficient at launch).
- Email sequences (welcome series, abandoned cart) — copy DB's
  `emailSequenceScheduler.js` patterns.
- Licensing storefront for inbound deals.
- Workshop / print-sale events (Colorado-local, Dan-dependent).
- International shipping.
- Paid acquisition on Pinterest / Meta.
- Photojournalism collection.

## Open Questions / Risks

- **EXIF preservation.** Some of Dan's older work may have been stripped of EXIF during
  WordPress ingest. Import script should handle missing EXIF gracefully.
- **Image resolution audit.** Scraper pulls what's on the current site (web-optimized).
  Print-res populates lazily from Dan's archive on first sale. If the first few sales
  happen while Dan is unavailable, Dallas fulfills from whatever hi-res Dallas can
  get from him in advance.
- **Trademark / business registration.** "Wildlight Imagery" likely not registered as a
  business. Dan may need to file a Colorado DBA or LLC before revenue exceeds IRS
  reporting thresholds. Out of scope for this build; flag at hand-off.
- **Sales tax nexus.** Stripe Tax handles multi-state once nexus triggers. Dan / Dallas
  responsible for remitting. Flag at hand-off.
- **Dan's reaction.** Biggest unknown. The entire design assumes he accepts the
  hand-off. Contingency if he doesn't: Dallas keeps running it himself or shuts it down
  gracefully. Printful free account + no subscriptions means low ongoing cost either way.

## Success Criteria

Phase 1 considered successful if, at the end of the 6-week build window:

- Site is live on wildlightimagery.shop with the full admin UI.
- At least one real paid order has been placed, fulfilled by Printful, and shipped.
- At least one email subscriber has signed up organically.
- Dan has been handed admin credentials and a runbook.

Beyond that, success is Dan's to define.
