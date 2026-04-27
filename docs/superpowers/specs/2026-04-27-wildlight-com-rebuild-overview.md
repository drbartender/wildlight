# Wildlight.com Rebuild — Overview & Decomposition

**Date:** 2026-04-27
**Status:** Roadmap approved, sub-project specs to follow
**Author:** Dallas (with Claude collaborative brainstorm)

## What this is

The existing `wildlightimagery.com` is a dormant 2021-era WordPress site
(Imagely theme + NextGEN gallery) that the storefront currently in this
repo replaces only at the `/wildlight-store/` corner. This project takes
the storefront from "the shop" to "the front door of Wildlight Imagery
on the open web": a modern artist-platform with the existing shop as one
of several surfaces.

The existing 2026-04-23 monetization spec covers Phase 1 of the shop
(catalog, checkout, fulfillment, basic admin). This document is a
sibling — Phase 1 of the *site*, building on the storefront foundation
and extending into content marketing, lead generation, and an AI-assisted
admin authoring tool.

The scope is too large for a single spec → plan → implementation cycle.
This document decomposes it into sub-projects with a defined order, and
each sub-project gets its own spec → plan → merge cycle.

## Source of truth for prior work

- `docs/superpowers/specs/2026-04-23-wildlight-monetization-design.md` —
  shop catalog, pricing, fulfillment, admin foundation. Already shipped.
  The *non-goals* in that doc were Phase-1 deferrals; several of them
  (limited editions, photojournalism, lead-gen pages) come back into
  scope here.
- `app/globals.css` — the "Print-room" design system with `bone` and
  `ink` moods. Carries forward unchanged.
- `app/(shop)/*` — current storefront. Migrates wholesale to
  `app/(shop)/shop/*` (or equivalent) under sub-project #1.
- `DRB_OS/os/server/db/schema.sql` and `DRB_OS/os/server/routes/blog.js`
  — the dr-bartender blog system. Schema and image-proxy pattern lift
  into this repo as the journal foundation under sub-project #3.

## Context

Dan Raby (Dallas's brother, professional photographer trained at
Colorado Institute of Art, based in Aurora CO) is unavailable as a
reviewer or author on this project. He only uploads hi-def files at sale
time. Dallas builds the site quietly using existing archival work,
drives it to first-sale traction, then hands Dan a working business at a
reveal moment.

That constraint shapes every design call:

- All text content is written by Dallas (or AI-assisted by the studio
  tool we're building) without Dan's input.
- The voice training corpus for AI generation is Dan's pre-2021
  "Behind the Shot" blog posts plus the existing /about letter (already
  in the shop, kept verbatim).
- New sections (commissions form, portrait service page, journal entries)
  are written from public artifacts and the existing about-page letter,
  not from new conversations with Dan.

## Goals

- **Domain & front door.** Replace the dormant WP site at
  `wildlightimagery.com` with a modern artist-platform that funnels
  visitors toward print purchases, lead inquiries, and email signups.
- **Content engine.** Stand up a journal + newsletter + AI-assisted
  authoring tool that produces durable SEO content and converts visitors
  into repeat buyers without requiring Dan to write.
- **Continuity.** Buyers who arrive on the shop today continue to have a
  working store. Existing shop URLs gain a stable redirect path. The
  visual language buyers already see (Print-room, bone/ink) is the
  language of every new surface.
- **Phasable.** Each sub-project ships independently and adds value on
  its own. No "everything-or-nothing" launch.

## Non-goals

- **No new design system.** We extend the existing Print-room. No second
  brand language, no separate marketing-only fonts.
- **No daily-blog cadence.** The 2021 blog died because high-frequency
  posting is brittle. Journal cadence is monthly-or-quarterly, with the
  AI Studio reminder cron as the nudge.
- **No customer accounts** (still). Same as Phase-1 shop — orders are
  guest-only; subscribers get newsletter-only auth via signed link.
- **No portraits-for-hire booking system.** Portraits remains an
  informational service page with a contact-form CTA. No calendar, no
  scheduler, no payment up-front.
- **No graphic-design service intake.** GDP is fully retired; the legacy
  `/gdp/` URL gets a 410 (gone) or redirects to `/services` with a
  disclaimer.
- **No workshops.** Cut from scope. Can revisit if Dan picks up the work
  and wants to teach.
- **No platform migration.** Stays Next.js 16 App Router + Postgres + R2 +
  Stripe + Printful. No CMS layer (journal is a Postgres table).
- **No customer reviews / wishlists / international shipping** — same
  Phase-1 shop deferrals.

## Architecture decisions

### One Next.js app, shop moves to `/shop/*`

Single app in this repo. The existing route group `(shop)/...` (which
serves URLs at `/`) moves under `(shop)/shop/...` so URLs become
`/shop/`, `/shop/cart`, `/shop/artwork/[slug]`, etc. Marketing pages
live at the root: `/`, `/portfolio`, `/journal`, `/about`, `/contact`,
`/services/portraits`, `/commissions`.

**Why path-based** instead of subdomain or separate TLD:

- Strongest branding — `wildlightimagery.com` appears in every URL of
  the customer journey, from journal entry → print page → checkout →
  receipt → order tracking.
- One Vercel project, one deploy, shared CSS, shared brand tokens, no
  cross-domain cookie or analytics plumbing.
- Existing shop is fresh (days old) — minimal external SEO debt to
  break with the URL move.
- The shop's internal links (`/cart`, `/artwork/[slug]`, …) are easily
  rewritten in the same PR that moves the route group.

### Domain: launch on `wildlightimagery.shop`, swap to `.com` later

Dan registered `wildlightimagery.shop` previously. We launch on it as a
working domain while the `.com` nameserver transfer is pending, then
swap. No code change at swap-time — Vercel handles multi-domain
routing for the same deployment, and the canonical-host config flips
in env.

### Continue the Print-room design system, mood-switch preserved

The existing `app/globals.css` Print-room palette (paper/ink/spectrum)
and the `[data-mood='ink']` dark inversion already cover everything the
marketing site needs. Marketing pages add layout primitives (e.g.
`.wl-chapter`, `.wl-portfolio-grid`, `.wl-journal-eyebrow`), not new
color tokens.

The shop's `<MoodSwitch />` component (in `components/shop/MoodSwitch.tsx`)
moves up to a shared location (`components/site/`) and is rendered in
the unified Nav so the toggle is available on every surface, not just
the shop. localStorage persistence survives the route boundary because
the host is the same.

### Unified Nav and Footer

The current `components/shop/Nav.tsx` and `components/shop/Footer.tsx`
become `components/site/Nav.tsx` / `Footer.tsx` and serve both
marketing and shop surfaces. The Nav has two link groups — primary
(Portfolio · Journal · About · Contact) and secondary (Shop · Cart) —
visually distinct so the shop entry feels like a clear handoff into a
purchase context without leaving the brand.

## Information architecture

```
wildlightimagery.com (or .shop initially)
├── /                          Home — hero + featured collection + journal latest + newsletter CTA
├── /portfolio                 Portfolio listing — collections grid, photojournalism subcategory at end
│   └── /portfolio/[slug]      Collection detail — gallery view, links to artwork pages in shop
├── /journal                   Journal listing — chapters in reverse-chrono, paginated
│   └── /journal/[slug]        Journal entry — long-form, cover image, artwork mentions cross-link to /shop
├── /about                     Studio — Dan's letter (verbatim, carries from existing shop /about)
├── /contact                   Contact — form for general inquiries
├── /services
│   ├── /portraits             Portrait service page — informational, contact-form CTA
│   └── /commissions           Commissions — informational, contact-form CTA
├── /shop                      Existing storefront moves here
│   ├── /shop/cart
│   ├── /shop/collections
│   │   └── /shop/collections/[slug]
│   ├── /shop/artwork/[slug]
│   ├── /shop/orders/[token]
│   └── /shop/legal/...
└── /admin                     Unchanged — admin already lives at /admin
    └── /admin/studio          New — AI-assisted journal+newsletter author tool
```

Photojournalism becomes a subcategory of `/portfolio` (the existing
scrape skipped it as a sub-gallery; revisit during content migration).
It's listed below the lyrical collections in the portfolio grid, with a
brief framing note. The legacy `/galleries/photojournalism/` URL
redirects to `/portfolio/photojournalism`.

## Cross-cutting principles

### Voice & tone

Single voice across all surfaces — derived from the existing
`(shop)/about/page.tsx` letter (Dan's verbatim words, kept). No new
"marketing voice" layer. Journal entries written by AI use the same
letter as one of the few-shot examples driving the system prompt.

### Mood persistence

`bone` (light, default) and `ink` (dark) are user-selected and persist
in localStorage scoped to the host. The Nav's `<MoodSwitch />` is
visible on every page. No automatic switching based on time of day or
content type — the user controls the mood.

### Newsletter signup placement

A subscribe affordance appears in three places:

1. Footer (every page) — single email input, low-noise.
2. End of every journal entry — inline, more contextual ("Want the next
   chapter in your inbox?").
3. Optional inline strip on the Home page below the featured collection.

The existing `EmailCaptureStrip` and `subscribers` table already cover
the data plumbing. Sub-project #4 wires the new placements + a
consolidated `/subscribe` confirmation flow.

### Limited editions (deferred to Phase 4)

Schema columns for `edition_size`, `edition_number`, `signed`,
`subscriber_early_access_until` exist in the shop's `artwork_variants`
table or get added by sub-project #6. The UI for browsing limited
editions is a Phase-4 deliverable — when Dan has prints he wants to
release as numbered runs, this becomes the differentiator that drives
the highest-margin sales.

### AI Studio principles

- Vision-capable model (Claude Sonnet 4.6 default; configurable).
- Voice samples stored as admin-editable text (admin settings table or
  similar) and loaded into every system prompt. Prompt caching
  amortizes the cost.
- All AI output saves as `draft` — nothing publishes without Dan's
  (Dallas's) explicit click.
- Reminder cron is a Vercel cron job hitting an admin-only endpoint
  that mails a one-click link. Cadence is admin-configurable
  (`off` / `monthly` / `quarterly`). Default `quarterly`.
- "Improve draft" mode preserves Dan's words — diffs are presented
  phrase-by-phrase for accept/reject, not as wholesale replacement.

## Sub-project decomposition

Each sub-project below gets its own spec under
`docs/superpowers/specs/2026-XX-XX-<sub-project>-design.md` and an
implementation plan under `docs/superpowers/plans/`.

### Phase 1 — Foundation

**#1. Shop migration to `/shop/*`** *(blocks everything else)*

- Move `app/(shop)/*` route group structure so the storefront URLs gain
  a `/shop/` prefix (cart, collections, artwork, orders).
- Update every internal link in components, emails, and admin order
  views to the new paths.
- 301 redirects fall into three buckets, all wired in `next.config.js`
  `redirects()`:
  - **Legacy WP shop URLs** → new `/shop/*` paths
    (`/wildlight-store/*` → `/shop`, `/shopping-cart/` → `/shop/cart`).
  - **Prior shop-only URLs** → new `/shop/*` paths
    (`/cart` → `/shop/cart`, `/artwork/[slug]` → `/shop/artwork/[slug]`,
    `/collections` and `/collections/[slug]` → `/shop/collections/...`,
    `/orders/[token]` → `/shop/orders/[token]`).
  - **Pages becoming marketing surfaces** — `/`, `/about`, `/contact`
    do **not** redirect. They become the new marketing home / studio /
    contact pages, replacing the shop's content with marketing content
    at the same URL. The shop versions move under `/shop/about` and
    `/shop/contact` only if there's a reason to keep separate
    shop-context pages — otherwise they're deleted in favor of the
    unified marketing page.
- Move `<Nav />`, `<Footer />`, `<MoodSwitch />` to `components/site/`.
- Wire `wildlightimagery.shop` in Vercel; configure canonical-host env
  for SEO + email links. Document the swap-to-`.com` runbook.
- Verify all transactional emails, order links, Stripe success URLs,
  Printful webhook URLs still resolve correctly.

**#2. Marketing surfaces — minimum viable set**

- New `/` (Home) — hero + featured collection + latest journal entry
  preview (or placeholder if journal isn't live yet) + newsletter CTA.
- New `/about` — replaces the existing shop `/about`. Same letter,
  reframed as the studio about page.
- New `/contact` — replaces existing shop `/contact`. Generic inquiry
  form; routes to a `contact_inquiries` table + email-to-admin.
- New `/portfolio` listing page — grid of collections from the existing
  `collections` table.
- New `/portfolio/[slug]` — collection detail page; reuses the existing
  `ArtworkGrid` component with a non-shop variant that links to
  `/shop/artwork/[slug]` for purchase.
- New `/services/portraits` and `/services/commissions` —
  informational pages with contact-form CTA.
- All pages use the existing Print-room CSS and the unified Nav.

### Phase 2 — Content engine

**#3. Journal system**

- Postgres migration: `journal_entries` table (or `blog_posts`,
  matching DRB schema names).
- Public routes: `/journal` (paginated list with chapter numbers),
  `/journal/[slug]` (single entry).
- Image proxy route at `/api/journal/images/:filename` modeled on
  `DRB_OS/os/server/routes/blog.js` — proxies R2 signed URLs through
  the app to avoid CORS/mixed-content, with content-type and size
  guards.
- Admin routes at `/admin/journal/*` — list (drafts + published),
  edit/create form (HTML body), publish toggle, cover-image upload.
- One-time migration: import old WP "Behind the Shot" posts from
  `scraped/` (extend the existing scraper to walk `/blog/*` if not
  already done, dump JSON, import via admin endpoint).
- Inline newsletter signup at end of every journal entry.

**#4. Newsletter system**

- Public newsletter signup placements (Home, Footer, end-of-journal,
  end-of-collection optional).
- Admin composer at `/admin/broadcasts` (or extend existing if one
  exists) — independent compose surface with a "start from journal
  entry" pre-fill button that loads excerpt + cover image + link.
- Send pipeline using the existing email infrastructure
  (`lib/email.ts`, transactional email patterns).
- Subscriber early-access mechanism — a column on `artwork_variants`
  for `subscriber_early_access_until` (Phase 4 ties this to limited
  editions; Phase 2 just lays the data plumbing).
- Confirmation flow at `/subscribe/confirm` for double-opt-in.

### Phase 3 — AI Studio

**#5. AI Studio admin tool**

- New admin page at `/admin/studio`.
- Five input modes (Image, Title, SEO trend, Combination, Improve
  draft) gated by a top-of-page mode selector.
- Image input: drag-and-drop upload (multipart) **or** "pick from
  artworks" picker that selects rows from `artworks` and passes their
  `image_web_url` to the model.
- LLM integration: Anthropic SDK, Claude Sonnet 4.6 default, vision
  enabled, prompt caching on the system prompt + few-shot voice
  samples, streaming the body to the editor.
- SEO trend mode: uses Anthropic's `web_search` tool (no DataForSEO);
  research returns 5 candidate angles with rationale.
- Voice training: an admin-editable `voice_samples` config (settings
  row or dedicated table) holding 3–5 reference passages. System
  prompt loads these as few-shot examples.
- Output: choose journal-only, newsletter-only, or both. Saves to
  drafts in the respective tables. Newsletter draft pre-fills with the
  journal entry as source.
- Reminder cron: Vercel cron at `/api/cron/studio-reminder`,
  cadence-configured via admin settings. Mails Dallas with one-click
  link to the studio + 3 pre-researched angles.

### Phase 4 — Limited editions (deferred)

**#6. Limited editions UI + workflow**

- Shop schema additions: edition tracking on `artwork_variants` (or a
  separate `editions` table linked to artwork).
- Shop UI: edition badge ("1 of 25" · "signed by the artist"), sold-out
  state, edition counter on the artwork detail page.
- Admin: mark a variant as a limited edition + edition size + signed
  flag.
- Subscriber early-access window: when a new edition is released, the
  variant is gated to subscribers for N hours before public availability.
- Newsletter integration: the broadcast composer has a "feature this
  edition" block that auto-renders edition metadata + countdown.

### Threaded across phases

**#7. Content migration & legacy redirects**

- Extend `scripts/scrape-wildlight.js` to walk the entire site (not
  just `/galleries/`) — including `/blog/`, `/about/`, `/portraits/`,
  `/gdp/`, `/contact/`, `/wildlight-store/`. Dump structured JSON.
- Build a redirect map from legacy WP URLs to the new structure. Add
  to `next.config.js` `redirects()`.
- Migrate old "Behind the Shot" blog posts into the journal.
- Pull bio details, contact info, and any unique copy worth preserving
  into the new pages. (The existing about-letter is the canonical
  Dan-voice; everything else is reference-only.)
- This work threads alongside the relevant sub-project (e.g. blog
  migration is part of #3, redirect map is part of #1).

## Build order and dependencies

```
Phase 1 (blocks all):  #1 Shop migration ──→ #2 Marketing surfaces

Phase 2 (parallel):    #3 Journal ──┐
                       #4 Newsletter ┴──→ Phase 3 prerequisite

Phase 3:               #5 AI Studio (depends on #3 + #4 live)

Phase 4:               #6 Limited editions (can ship any time after #1)

Threaded:              #7 Content migration + legacy redirects
                          (carved into #1 / #3 / #6 as needed)
```

#1 must ship first. #2 follows immediately so the new domain has real
content. #3 and #4 are independent of each other and can ship in
either order, though landing #3 first is more useful (newsletter has
nothing to point at without journal entries).

## Open questions for sub-project specs

These do not block this overview but each sub-project must resolve
its corner:

- **#1 Shop migration** — should the redirect from old WP URLs handle
  query strings (analytics, gallery pagination)? What's the Vercel-side
  config for serving both `.shop` and `.com` from the same project?
  Does `/legal/*` stay at top-level (site-wide policies) or move under
  `/shop/legal/*` (consistent with the shop hierarchy)?
- **#2 Marketing surfaces** — final Home page hero copy (proposed:
  start from the shop's existing masthead "Exploring my light…"). Final
  Portrait/Commissions page copy (write from existing about-letter +
  the shop's existing inquiries pattern).
- **#3 Journal** — table name (`journal_entries` vs `blog_posts`),
  whether to keep DRB's `chapter_number` derivation as a query-time
  computation or persist it.
- **#4 Newsletter** — exact compose UX. Reuse any existing admin
  broadcast component or build new under `/admin/broadcasts`.
- **#5 AI Studio** — exact voice-sample storage shape, whether SEO
  trend research caches results, error handling when web_search
  rate-limits.
- **#6 Limited editions** — schema (column on variants vs separate
  table), early-access mechanism (token in email link vs subscriber
  cookie), edition number assignment (sequential at sale time vs
  pre-allocated).

## What this overview does NOT include

- Page-level wireframes — sub-project #2 owns those.
- Database schemas for new tables — owned by the sub-project that
  introduces the table.
- Email templates — owned by sub-projects #2 (contact form), #4
  (newsletter), #5 (studio reminder).
- Migration runbooks for the domain swap — owned by #1.
- The full legacy URL inventory — owned by #7 / threaded into #1.

Each sub-project spec follows the existing template conventions in
`docs/superpowers/specs/2026-04-23-wildlight-monetization-design.md`
and `docs/superpowers/specs/2026-04-24-admin-redesign-overview.md`.
