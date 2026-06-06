# Vintage Wall + Events — design (2026-06-06)

## Why
Dan Raby asked for the homepage to feel "more like the old wildlightimagery.com
— more pictures, smaller." The old site (WordPress + NextGEN) was a dense
contact-sheet gallery of his whole body of work. The current `.shop` homepage is
the opposite: a sparse, editorial "considered selection" of 6 large plates.

Dan also: refuses teaching / workshops; will do events + portraits "for the
right money, right circumstance"; wants the print shop to list only pieces he
has true hi-def masters for; and is fine showing his lower-res archive as
*examples* ("vintage" shots).

## The model — two tiers + services
- **The Wall (home `/`)** — Dan's body of work as a dense, *unsorted* wall of
  small photos (vintage examples, look-only). Click any frame → lightbox.
  Deliberately unlike the sorted shop. This is what "more like the old site"
  means.
- **The Shop (`/shop`, unchanged)** — sorted, by-collection, priced. Only
  `published` artworks (true prints). Untouched.
- **Work with Dan** — Events (new) + Portraits (existing), inquiry-only,
  premium. Teaching removed.

## Data (no schema change)
- `artworks.status` already gates everything; `/shop/artwork/[slug]` 404s
  anything not `published`.
- **Wall source:** `status IN ('draft','published')`, `title NOT ILIKE
  'untitled%'`, `ORDER BY md5(slug)` (stable shuffle = "unsorted wall").
  ~100 frames today.
- **`available` = `status='published'`** (8 today). These get a dot on the wall
  and a "See print options →" link in the lightbox. Non-available frames zoom
  only — they never link to a 404.
- Note: 74/101 rows have a real hi-def master (`print_width` set) — Dan can grow
  the shop to ~74 just by publishing. No new field needed now; a `'vintage'`
  status is a possible later refinement if junk drafts ever appear.

## Components
- `VintageWall` (client) — CSS multi-column masonry (`column-count` 2→6
  responsive), plain lazy `<img>` (no stored dims; vintage = low-res anyway),
  hover caption, available-dot.
- `Lightbox` (client) — dark scrim viewer, prev/next + arrow keys + esc, scroll
  lock (mirrors Nav's dialog), "See print options →" when available.
- Home `/` rewritten to: slim hero → wall → slim closing (shop + events CTA +
  newsletter).
- `/services/events` — new, mirrors `/services/portraits`. Leads with range
  (live music, sport, brand, celebrations); weddings present but one line, so
  the page pulls the non-wedding work Dan prefers.
- Contact form: add `events` + `portrait` reasons.
- Nav: Gallery · Shop · Events · Portraits · Journal · Studio.

## Out of scope (follow-ups)
- Thumbnail image tier (wall currently loads ~2000px web images, lazy-loaded).
- Backfill `image_width`/`image_height`.
- `/portfolio` (by-collection editorial index) left as-is.
- Curating which drafts are truly "wall-worthy" / promoting masters to the shop.
