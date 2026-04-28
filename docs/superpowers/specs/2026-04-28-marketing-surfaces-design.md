# Marketing Surfaces — Home, Portfolio, Polish

**Date:** 2026-04-28
**Status:** Ready for plan
**Sub-project of:** `2026-04-27-wildlight-com-rebuild-overview.md` (#2)
**Depends on:** Sub-project #1 (`2026-04-27-foundation-shop-migration-design.md`) — already merged.

## Goal

Replace the stub at `/` with a real marketing home. Add `/portfolio` (listing + collection detail) as the showcase surface. Add `/services/portraits` as the only standalone service page. Polish `/about` with marketing-context additions. Promote the Nav to a unified site Nav with shop + marketing surfaces side-by-side. Every surface uses the existing Print-room CSS and bone/ink moods — no new design system.

The funnel this produces: visitor lands at `/`, sees curated work + studio voice + a newsletter capture, clicks deeper into `/portfolio` for the full work, jumps to `/shop` to buy, or to `/contact?reason=…` to inquire. Same domain throughout (`wildlightimagery.shop` → `.com` later).

## Non-goals

- **No journal.** Sub-project #3 owns `/journal/*`. Home does not preview journal entries — that block lands when #3 ships.
- **No `/services/commissions` page.** Existing footer link `/contact?reason=commission` already routes commission inquiries through the contact form. A separate page would be redundant.
- **No `/services/licensing` page.** Same — existing `/contact?reason=license` routing is sufficient.
- **No photojournalism category.** The legacy gallery scrape skipped it; without content, an empty stub adds nothing. Defer until photojournalism artworks are populated.
- **No `contact_inquiries` table.** The existing `/api/contact` route relays via email (`sendContactMessage` in `lib/email.ts`) with rate-limit + honeypot protection. The overview spec over-specified this — no DB table is needed for #2.
- **No newsletter backend changes.** The existing `subscribers` table and `EmailCaptureStrip` component already handle signups. New placements use the existing component.
- **No new design tokens, fonts, or layout primitives.** All pages built from existing `app/globals.css` Print-room CSS.
- **No customer accounts, wishlists, reviews, international shipping** — same Phase-1 deferrals.

## Source of truth

- Architecture: `2026-04-27-wildlight-com-rebuild-overview.md`
- Design system: `app/globals.css` (`:root` + `[data-mood='ink']` blocks; `.wl-masthead`, `.wl-eyebrow`, `.wl-btn`, `.wl-plate-card`, `.wl-cindex-list` etc.)
- Existing Nav: `components/shop/Nav.tsx` — moves to `components/site/Nav.tsx` and adds Portfolio link
- Existing Footer: `components/shop/Footer.tsx` — moves to `components/site/Footer.tsx`; link cleanup
- Existing about-letter: `app/(shop)/about/page.tsx` — kept verbatim, minor additions at the tail
- Existing contact form: `app/(shop)/contact/page.tsx` — unchanged
- Existing API: `app/api/contact/route.ts` — unchanged
- Existing newsletter: `components/shop/EmailCaptureStrip.tsx` — moves to `components/site/EmailCaptureStrip.tsx`
- Existing artwork grid: `components/shop/ArtworkGrid.tsx` — extended with a `linkBase` prop so portfolio pages can route plate clicks through `/shop/artwork/[slug]` while keeping a `linkBase="/shop/artwork"` default for shop pages

## Information architecture additions

```
wildlightimagery.shop  (canonical for now)
├── /                          ← REAL home (replaces stub from #1)
├── /portfolio                 ← NEW listing
│   └── /portfolio/[slug]      ← NEW collection detail
├── /services
│   └── /portraits             ← NEW service info page
├── /about                     ← polished (existing letter + tail additions)
├── /contact                   ← unchanged
├── /shop/...                  ← unchanged (sub-project #1)
└── /admin/...                 ← unchanged
```

## Page designs

### `/` — Marketing home

A vertical sequence of five sections, each using the existing Print-room CSS. Top to bottom:

1. **Hero** — same construction as the shop's masthead (which moved to `/shop` in #1). Eyebrow "Wildlight Imagery · Aurora, Colorado", headline "Exploring *my light* / for as long as I / can remember." Right-side meta block (Est. 2004, Plates on file, Latest, "Printed to order · shipped archival"). One difference from `/shop`'s masthead: the "Plates on file" count links to `/portfolio`.

2. **From the field** — section header "From the field" with a `wl-rule` underline. 6 most recently published plates rendered through `<ArtworkGrid items={...} linkBase="/shop/artwork" showPrice={false} />`. Cards link to `/shop/artwork/[slug]` directly (see Decision 1 below). Prices hidden on the home — the home is the marketing surface, not the storefront. "Browse the full portfolio →" CTA at the bottom of the section, linking to `/portfolio`.

3. **From the studio** — two-column block. Left: Dan's portrait (existing `/dan-portrait.jpg`). Right: a 2-paragraph excerpt from the about-letter ("My father handed me a camera…" + "I am always trying something different…"). "Read Dan's letter →" CTA → `/about`.

4. **Newsletter** — full-width strip rendering `<EmailCaptureStrip />`. Subhead: "Quarterly notes from the field. New chapters, new prints, occasional limited editions." (No journal mention until #3.)

5. **Find a print** — closing block. Eyebrow "The shop". Headline "Printed to order, shipped archival." Body copy: "A small, considered selection of fine-art prints. Choose the size, paper, and frame that suits your wall." Primary CTA "Visit the shop →" → `/shop`. Secondary "Browse collections →" → `/shop/collections`.

The page is a server component (no client interactivity beyond what `EmailCaptureStrip` and `MoodSwitch` already provide). Queries: most-recent published artworks (LIMIT 6), counts/latest for the meta block (same query the shop home uses).

**Decision 1 — what does a plate card on the home link to?** Two options:
- (A) `/shop/artwork/[slug]` directly — visitor lands one click from purchase. Matches the shop's existing `PlateCard` behavior.
- (B) `/portfolio/[slug]` (the collection page) — visitor lands on the collection page first, sees siblings.

**My pick: A.** The home is the marketing front door; once a visitor has clicked a specific plate, they've signaled buying intent. Sending them to the shop directly shortens the funnel. The "Browse the full portfolio" CTA at the bottom of the section serves the visitor who wants to browse, not click.

### `/portfolio` — Listing

Visually mirrors `/shop/collections` — same `wl-cindex-list` styles, same chapter-numbering eyebrow ("CH · 01 · …"). One difference in copy: the page header is "The portfolio" (not "Index of plates") with subhead "Six chapters of light, ongoing." Rows render the same data: collection cover thumbnail, title, tagline, plate count, and a "→" affordance.

Each row links to `/portfolio/[slug]`.

**No `/portfolio/photojournalism`** — section ends at the six lyrical collections. A small footnote at the bottom: "Photojournalism work — coming back when the archive lands."

The page is a server component, identical query to `/shop/collections` (collections + counts), shorter result list (no photojournalism).

### `/portfolio/[slug]` — Collection detail

Same layout as `/shop/collections/[slug]` (which already exists at that URL after #1) — the header reads "Chapter NN · The Sun" or similar, with the collection's tagline below. Below the header, an `<ArtworkGrid items={...} linkBase="/shop/artwork" />` renders all published artworks in the collection.

Plate cards link to `/shop/artwork/[slug]` (the shop's artwork detail page where purchase happens). The portfolio page itself shows no prices, no "from $XX" — that's a shop concern, not a portfolio one.

**Decision 2 — Do we need a separate "no-price" variant of `PlateCard`?** Two options:
- (A) Add a `showPrice` prop to `PlateCard` defaulting to `true`, false on portfolio pages.
- (B) Strip price visually via an `.is-portfolio` class wrapper on the grid container, no prop change.

**My pick: A.** Cleaner — the prop is explicit at the call site; CSS-driven hiding is fragile when the data shape changes. The prop name pairs with `linkBase` (both control "presentation context") — easy to grep for callers.

### `/services/portraits` — Service info

Single short scrollable page. Three sections:

1. **Hero** — eyebrow "Services". Headline "Portrait photography by Dan Raby." Subhead: "Headshots, families, and editorial commissions. Studio + on-location, in Denver and Aurora."
2. **What we offer** — three short bullets (Studio Sessions · On-Location Sessions · Editorial / Commercial). Each bullet 2-3 sentences. Source copy from the about-letter ("staying true to the customer requirements", "Working together to create the perfect shot") woven into the descriptions.
3. **Inquire** — direct CTA: "Tell Dan what you have in mind →" → `/contact?reason=commission&topic=portraits`. Below the button, a phone + email row (same content as the contact page side-rail: `dan@wildlightimagery.shop`, `720.363.9430`, "By appointment only · Aurora, Colorado").

No sample photos — Dan's portrait corpus isn't in the database (the scrape was fine-art only). Adding a placeholder image set would mislead. The page is content-light by design; the lever is the contact CTA.

The footer's existing "Commissions" link is unchanged (`/contact?reason=commission`) — `/services/portraits` is the inquiry funnel for portraits specifically; commissions/licensing remain footer-driven.

### `/about` — Polish

Existing `app/(shop)/about/page.tsx` keeps the entire letter verbatim and the portrait/sidebar layout. Three small additions at the tail:

1. **Services callout strip** — single-row block: "Wildlight also offers portrait photography for headshots, families, and editorial commissions." with "Learn more →" → `/services/portraits`.
2. **Newsletter strip** — `<EmailCaptureStrip />` with subhead "Quarterly notes from the field."
3. **Refined CTA pair** — "Visit the shop →" (primary) + "Browse the portfolio →" (secondary) replacing the existing single "Browse the collections →" link.

The existing `Link` to `/shop/collections` from #1 is replaced with the portfolio link as primary affordance.

### `/contact` — Unchanged

Already serves the marketing role. Reason routing covers commission, corporate-gift, license, order, hello. The piece-prefill feature works cross-context (visitor on `/portfolio/[slug]` clicks a plate → `/shop/artwork/[slug]` → uses the existing "Inquire" link → `/contact?reason=…&piece=…`).

## Components

**New:**
- `components/site/PlateCard.tsx` — extension of existing `components/shop/PlateCard.tsx`. Adds `showPrice?: boolean` (default true) and `linkBase?: string` (default `/shop/artwork`). Used by the portfolio detail page (`showPrice={false}`) and the home (default props).
  - **Open Q:** rename the existing one and have a single canonical `PlateCard`, or keep both? **Pick:** rename the existing to `components/site/PlateCard.tsx` and update all callers. Two `PlateCard` files would drift.
- `components/site/PortfolioFooter.tsx`? **No.** The existing Footer (post-promotion to `components/site/Footer.tsx`) serves both contexts; the link list updates suffice.

**Promoted (renamed + relocated):**
- `components/shop/Nav.tsx` → `components/site/Nav.tsx`
- `components/shop/Footer.tsx` → `components/site/Footer.tsx`
- `components/shop/Wordmark.tsx` → `components/site/Wordmark.tsx`
- `components/shop/MoodSwitch.tsx` → `components/site/MoodSwitch.tsx`
- `components/shop/EmailCaptureStrip.tsx` → `components/site/EmailCaptureStrip.tsx`
- `components/shop/PlateCard.tsx` → `components/site/PlateCard.tsx` (with the new props)
- `components/shop/ArtworkGrid.tsx` → `components/site/ArtworkGrid.tsx` (passes the new props through to its `PlateCard` children)

**Stays in `components/shop/`:**
- `CartProvider.tsx`, `CartCountBadge.tsx`, `OrderCard.tsx`, `StatusBadge.tsx` — shop-specific data and UI.

`app/(shop)/layout.tsx` updates its imports to the new paths.

## Nav update

The Nav's `LINKS` array changes from:

| Slot | Before | After |
|---|---|---|
| nav-left[0] | Index → `/shop` | Portfolio → `/portfolio` |
| nav-left[1] | Collections → `/shop/collections` | Studio → `/about` |
| nav-right[0] | Studio → `/about` | Shop → `/shop` |
| nav-right[1] | Commission → `/contact` | *(removed — Cart + MoodSwitch only)* |

Two left links, one right link, plus `<MoodSwitch />` and `<CartCountBadge />`. Wordmark stays center → `/`.

The `Commission` nav link drops because the footer's "Commissions" entry already covers it; keeping it in the nav muddies the marketing-vs-shop split.

The mobile burger sheet shows the same four items: Portfolio · Studio · Shop. Plus "Visit the shop" CTA at the bottom of the sheet for emphasis.

## Data and queries

**No schema changes.** All pages query existing tables.

| Page | Query |
|---|---|
| `/` | `SELECT slug, title, image_web_url, year_shot, location, collection.title, min_price_cents FROM artworks WHERE status='published' ORDER BY display_order, id LIMIT 6` (same shape as shop home, fewer rows) + the counts/latest meta query |
| `/portfolio` | `SELECT slug, title, tagline, cover_image_url, display_order, COUNT(artworks) FROM collections LEFT JOIN artworks ... GROUP BY collections.id ORDER BY display_order` — same query the shop's `/shop/collections` uses |
| `/portfolio/[slug]` | `SELECT * FROM collections WHERE slug = $1` + `SELECT * FROM artworks WHERE collection_id = $coll AND status='published' ORDER BY display_order` |
| `/services/portraits` | static (no DB) |
| `/about` | static (existing) |

**Caching.** All pages use `export const revalidate = 60` (matches the existing shop home pattern). Featured-content drift after a publish takes up to 60s to surface — acceptable.

## SEO + sitemap

`app/sitemap.ts` (updated in #1) gets the new URLs added:

```ts
{ url: `${base}/portfolio`, lastModified: new Date() },
{ url: `${base}/services/portraits`, lastModified: new Date() },
...collections.rows.map((c) => ({
  url: `${base}/portfolio/${c.slug}`,
  lastModified: c.created_at,
})),
```

The `/shop/...` URLs from #1 stay. Marketing URLs (`/`, `/about`, `/contact`) already in sitemap. Net: 1 + 1 + N collections new entries.

`app/robots.ts` allows everything — no changes.

`app/layout.tsx` `metadataBase` already uses `NEXT_PUBLIC_APP_URL` — no change. Per-page `metadata` exports added on each new page (title + description for SEO).

## Mood + persistence

The new pages inherit the `[data-mood]` attribute from the same root the shop pages use. `localStorage` key `wl_mood` continues to drive the toggle. `<MoodSwitch />` is in the unified Nav, visible on every page.

The pre-paint script in `app/layout.tsx` already reads `wl_mood` before first paint and sets `data-mood` accordingly — works unchanged for marketing pages.

## Accessibility

- Each new page has a single `<h1>` and a logical heading hierarchy.
- All `<Link>` and `<button>` elements have visible text or `aria-label`.
- Plate cards on `/portfolio/[slug]` continue to use `<Image alt={...}>` with the artwork's `title` as alt — same as today.
- Newsletter strip already has accessible labels (existing component).
- Color contrast unchanged (using existing tokens).

## Manual verification

Per repo convention (no integration harness):

1. **Home** — `/` renders all five sections. "Plates on file" count links to `/portfolio`. "Browse the full portfolio →" links to `/portfolio`. "Read Dan's letter →" links to `/about`. Newsletter strip submits successfully. "Visit the shop →" links to `/shop`.
2. **Portfolio listing** — `/portfolio` renders six collection rows. Each links to `/portfolio/[slug]`. Photojournalism footnote present.
3. **Portfolio detail** — `/portfolio/the-night` (or whichever published collection) renders. Plates link to `/shop/artwork/[slug]`. No prices visible on cards.
4. **Services** — `/services/portraits` renders. "Tell Dan what you have in mind →" links to `/contact?reason=commission&topic=portraits` and the contact form pre-fills correctly.
5. **About** — `/about` renders the full existing letter plus the three new tail additions (services callout, newsletter, refined CTAs).
6. **Nav** — Portfolio, Studio, Shop appear in the header. Wordmark links home. Mobile burger sheet shows the same set.
7. **Mood switching** — flips between bone and ink on each new page. Refresh persists choice.
8. **Sitemap** — `/sitemap.xml` includes `/portfolio`, `/portfolio/{slug}` for each collection, `/services/portraits`.
9. **No regressions** — `/shop`, `/shop/cart`, `/shop/checkout`, `/shop/artwork/[slug]`, `/shop/collections`, `/shop/orders/[token]` all still render with the relocated Nav imports.

## Done criteria

- [ ] `/` is no longer a stub — shows hero + recent plates + studio excerpt + newsletter + shop CTA.
- [ ] `/portfolio` renders the listing.
- [ ] `/portfolio/[slug]` renders the collection detail with no prices and links to `/shop/artwork/[slug]`.
- [ ] `/services/portraits` renders with the inquire CTA.
- [ ] `/about` shows the polish additions.
- [ ] Nav has Portfolio, Studio, Shop. Commission link removed.
- [ ] All shop pages still resolve and look correct (no regressions from the component relocations).
- [ ] Sitemap reflects the new URLs.
- [ ] `npm run typecheck` and `npm test` pass.

## Open questions resolved here (with rationale)

- **Plate-card link target on home** → `/shop/artwork/[slug]` directly (Decision 1 above).
- **Price visibility on portfolio detail** → hidden via `showPrice={false}` prop on `PlateCard` (Decision 2 above).
- **Single canonical `PlateCard`** → rename to `components/site/PlateCard.tsx`, no two-file split.
- **Photojournalism subcategory** → deferred; small footnote on `/portfolio` only.
- **Featured collection on home** → no single "featured collection" block; "From the field" surfaces 6 recent plates instead. Curation can come later when there's a reason.
- **`/services/commissions`** → not built; existing `/contact?reason=commission` routing is sufficient.
- **`/services/licensing`** → not built; same rationale.
- **Newsletter signup placement** → 3 spots: existing Footer (every page), Home (section 4), `/about` tail (new). Inline-on-journal lands with #3.

## Open questions for the implementation plan

- **PR shape.** One PR for the whole sub-project, or split (component promotion first, then pages)? The component promotion touches every shop page's imports — making it atomic prevents a half-renamed state. Recommendation: one PR with multiple commits, similar to #1's structure.
- **Recent-plate query for home** — does the existing shop home already encapsulate this? If yes, can we extract it into `lib/queries/recent-plates.ts` to share?
- **`/portfolio/[slug]` query** — is the existing `/shop/collections/[slug]/page.tsx` query worth extracting to a shared loader? If so, where? `lib/queries/collection-detail.ts`. Defer if the duplication is small (1 query, ~10 lines).
- **`/services/portraits` copy** — final wording sourced from the about-letter; the implementation plan will name the exact paragraphs to lift.
