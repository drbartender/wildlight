# Journal System

**Date:** 2026-04-28
**Status:** Ready for plan
**Sub-project of:** `2026-04-27-wildlight-com-rebuild-overview.md` (#3)
**Depends on:** SP#1 (foundation) and SP#2 (marketing surfaces) — already merged.

## Goal

Stand up a Postgres-backed journal at `/journal` and `/journal/[slug]`, plus an admin authoring surface at `/admin/journal/*`. Each entry has a cover image, an HTML body, a chapter number derived from publish order, and an inline newsletter signup at the end. Entries are written and published manually for v1; SP#5 (AI Studio) becomes the primary content source later.

The journal is what makes the marketing home's "From the studio" thread finally have somewhere to point. Once it's live, the marketing home can grow a "Latest from the journal" section (a small follow-up after this sub-project lands).

## Non-goals

- **No old-WP blog migration.** The legacy `/blog/*` had ~5 "Behind the Shot" posts last updated May 2021. They're stale, off-voice, and the AI Studio will produce better-fitting content. If Dallas later wants to import them, that's a one-shot script — not part of this sub-project.
- **No AI integration.** SP#5 owns AI authoring. SP#3 ships a vanilla manual editor.
- **No comments, no reactions, no social-sharing widgets, no tag/category system, no related-posts sidebar.** YAGNI.
- **No newsletter "start from journal entry" pre-fill.** SP#4 owns that wiring; SP#3 only emits a journal entry's data shape that SP#4 can consume.
- **No image proxy route** (DRB had one because its images were on a private bucket; Wildlight already uses a public R2 bucket for catalog images and matches that pattern here).
- **No rich-text WYSIWYG.** v1 is an HTML `<textarea>` with optional live preview. The AI Studio (SP#5) fills the field with formatted HTML; manual editing is the rare path.
- **No pagination beyond a simple `LIMIT/OFFSET`** (the journal grows slowly enough that 20-per-page is fine for years).

## Source of truth

- DRB blog system: `C:/Users/dalla/DRB_OS/os/server/db/schema.sql` (table) and `C:/Users/dalla/DRB_OS/os/server/routes/admin/blog.js` (admin handlers). The schema and chapter-number derivation port directly. The image proxy does **not** port (we use direct public R2 URLs).
- Existing admin patterns to mirror: `app/admin/artworks/[id]/page.tsx`, `app/api/admin/artworks/[id]/route.ts`. Same client-page + JSON API pattern.
- Existing R2 helper: `lib/r2.ts` `uploadPublic(key, body, contentType)` — used directly for cover and inline images. Returns the public CDN URL.
- Existing schema: `lib/schema.sql`. Append the `blog_posts` table (DRB-shape).
- Existing redirect: `next.config.ts` currently has `/blog` and `/blog/:path*` 307 → `/`. Becomes 308 → `/journal` and `/journal` respectively when SP#3 lands.

## Data model

Append to `lib/schema.sql`:

```sql
-- Journal entries (matches DRB blog_posts shape for portability)
CREATE TABLE IF NOT EXISTS blog_posts (
  id              SERIAL PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  excerpt         TEXT,
  body            TEXT NOT NULL,
  cover_image_url TEXT,
  published       BOOLEAN NOT NULL DEFAULT FALSE,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_published_at
  ON blog_posts(published_at DESC) WHERE published = TRUE;
```

Notes:

- Table name **`blog_posts`** matches DRB exactly. The user-facing word is "journal" but the DB shape is portable across both projects, which keeps the mental model shared.
- Column shapes match DRB so the import path is trivial if Dallas decides to bring old posts forward later.
- `body` stores HTML (same as DRB).
- `published_at` drives both the visible chapter number and the public sort order.
- `excerpt` is used in listing previews and as `<meta name="description">`. Optional; if null, listing falls back to the first ~160 chars of body stripped of tags.
- `updated_at` auto-bumps via the existing `update_updated_at_column()` trigger pattern (already in `lib/schema.sql` for other tables — check before adding the trigger; if no shared trigger exists, add `BEFORE UPDATE` row trigger that does `NEW.updated_at = NOW()`).

**No `chapter_number` column.** Derived at query time:

```sql
SELECT id, slug, title, ...
       ROW_NUMBER() OVER (ORDER BY published_at ASC) AS chapter_number
FROM blog_posts
WHERE published = TRUE
ORDER BY published_at DESC
LIMIT $1 OFFSET $2
```

This is DRB's pattern. Drawback: deleting an old entry renumbers later ones (one-time confusion). For a journal that grows ~12 entries/year max, the cost is acceptable.

## URL surface

```
/journal                          public listing, paginated (20/page)
/journal/[slug]                   public single entry
/journal?page=2                   listing pagination

/admin/journal                    admin listing (drafts + published, all order)
/admin/journal/new                admin: create new
/admin/journal/[id]               admin: edit existing

/api/admin/journal                GET (list), POST (create)
/api/admin/journal/[id]           GET (single), PATCH, DELETE
/api/admin/journal/[id]/publish   POST (toggle published; sets published_at)
/api/admin/journal/upload-image   POST (multipart) — cover or inline image
```

Public routes are server components (Next 16 RSC), `revalidate = 60`. Admin routes use the existing client-page + JSON API pattern from `app/admin/artworks/[id]`.

## Public pages

### `/journal` — listing

Header echoes the `/portfolio` listing's structure: eyebrow + h1 + lede + side meta block. Uses the existing `wl-cindex-head` and `wl-cindex-list` classes from globals.css for visual consistency with the portfolio.

Each row renders:
- Chapter number (`CH · 03`)
- Title
- Excerpt (or first sentence)
- Publish date (long form: "September 2025")
- Cover thumbnail

Footer has the inline newsletter strip and pagination links if `published` count exceeds 20.

Empty state: "No chapters published yet — the first one is on its way."

### `/journal/[slug]` — entry

Header eyebrow: `Chapter NN of MM · {publish month, year}`. Then the entry's title (h1), then excerpt as a lede paragraph (if present), then cover image (full bleed), then the body HTML rendered into a `<article className="wl-journal-body">` block.

Body uses serif typography matching the about-letter, with constrained max-width for readability (~680px). Inline images break out to a wider column (max ~960px) for visual emphasis.

Footer: `← Previous chapter` and `Next chapter →` nav (computed from publish order), then the inline newsletter strip with copy: "Want the next chapter in your inbox?"

Returns 404 for: unknown slug, slug exists but `published = FALSE` (drafts not visible to public).

`generateMetadata` emits `<title>` = entry title, `<meta name="description">` = excerpt or first ~160 body chars.

## Admin pages

### `/admin/journal` — list

A simple table:

| Status pill | Title | Slug | Chapter # | Published | Updated |
|---|---|---|---|---|---|

Filtering: top-of-page tabs (All · Published · Drafts). Sort defaults to `updated_at DESC`. "New chapter" button top-right → `/admin/journal/new`.

Status pills: `Published` (green) and `Draft` (neutral) — uses existing `AdminPill` component.

### `/admin/journal/new` and `/admin/journal/[id]` — editor

Single client-page form. Fields:

- **Title** (required) — text input. Auto-suggests slug on first keystroke; user can override.
- **Slug** (required) — text input, slug-cased. Must be unique.
- **Excerpt** (optional) — short textarea, ~3 lines visible. Plain text.
- **Cover image** — picker showing current image or upload affordance. POSTs file to `/api/admin/journal/upload-image`, gets back R2 public URL, stores in `cover_image_url`.
- **Body** — large `<textarea>` (HTML). Above it, an "Insert image" button that uploads via the same endpoint and inserts an `<img src="...">` snippet at the cursor. Below it, a "Preview" toggle that renders the body in a sandboxed iframe (or just a `<div dangerouslySetInnerHTML>` with the same body styling that the public page uses).
- **Published toggle** — switch. When flipped on for the first time, sets `published_at = NOW()`. When flipped off, leaves `published_at` in place (so re-publishing keeps the original chapter number / order).
- **Save button** — top-right; saves draft state without changing published.

Bottom of editor: "Delete entry" button (with confirmation modal). Deletes the row; deletes the cover and any tracked inline images? **No**, deleting images is best-effort; orphaned images sit in R2 indefinitely. (Cleanup is a separate concern, can be a periodic script later.)

The editor is a single page with all fields visible — no multi-step wizard.

## Image handling

Upload endpoint: `POST /api/admin/journal/upload-image` (admin-auth gated).

- Accepts `multipart/form-data` with a single `file` field.
- Validates: `Content-Type` starts with `image/`, size ≤ 10 MB, allowed types = `image/jpeg`, `image/png`, `image/webp`, `image/gif`.
- Generates a key like `journal/<crypto.randomUUID()>.<ext>` (extension from file name or content type).
- Uploads via `uploadPublic(key, buffer, contentType)`.
- Returns `{ url: 'https://images.wildlightimagery.shop/journal/<uuid>.<ext>' }`.

The admin editor inserts that URL directly into the body's `<img src="...">` or sets it as `cover_image_url`. No proxy, no signed URLs — the public R2 bucket handles caching at the CDN edge.

`next.config.ts` `images.remotePatterns` already allows `images.wildlightimagery.shop` (set during the catalog setup), so `<Image>` works out of the box for journal images.

## Sanitization

Body is HTML stored verbatim. **Public rendering uses `dangerouslySetInnerHTML`** — this is the same approach DRB uses, with the trust assumption that admin authors are not adversarial. Wildlight admin auth is multi-step (Auth.js + admin role check) so the threat surface is the same.

For defense in depth, the admin save endpoint runs the body through a one-pass sanitization at write time:

- Strip `<script>`, `<iframe>` (except whitelisted: none for v1), `<style>`, `<link>`, `<object>`, `<embed>` tags.
- Strip event-handler attributes (`onclick=`, `onerror=`, etc.) by removing any attribute starting with `on`.
- Allow `javascript:` URLs nowhere — `lib/url.ts` `safeHttpUrl` validates href/src.

Use `isomorphic-dompurify` (server-side DOMPurify) — small dep, well-tested. Add to `package.json`. Sanitize on save (PATCH/POST), not on read, so reads stay fast.

## Routes

```
/api/admin/journal                  GET    list (drafts + published)
                                    POST   create new (auto-generates slug if absent)
/api/admin/journal/[id]             GET    single (admin, returns full body)
                                    PATCH  update fields (title, slug, excerpt, body, cover_image_url)
                                    DELETE remove row
/api/admin/journal/[id]/publish     POST   { published: boolean } — toggles published flag,
                                            sets published_at on first publish, never clears it.
/api/admin/journal/upload-image     POST   multipart file → R2 public, returns { url }
```

All admin endpoints sit behind the existing admin-auth middleware (whatever `app/api/admin/artworks/[id]/route.ts` uses — match that pattern, do not invent new auth).

## Public listing pagination

Simple `?page=N` query param. Default page 1, fetch 20 per page. Render numbered pagination at the bottom (Previous · 1 2 3 · Next) for any page where total > 20.

Total count needs a second `SELECT COUNT(*) WHERE published = TRUE` query — cheap on this table.

## Sitemap

Append to `app/sitemap.ts`:

```ts
const journal = await pool.query<{ slug: string; updated_at: Date }>(
  `SELECT slug, updated_at FROM blog_posts WHERE published = TRUE`,
);
// ...
{ url: `${base}/journal`, lastModified: new Date() },
...journal.rows.map((j) => ({
  url: `${base}/journal/${j.slug}`,
  lastModified: j.updated_at,
})),
```

## /blog/* legacy redirect

Update `next.config.ts` `redirects()`:

```ts
// Replace these two entries:
// { source: '/blog',         destination: '/', permanent: false },
// { source: '/blog/:path*',  destination: '/', permanent: false },
// With:
{ source: '/blog',         destination: '/journal', permanent: true },
{ source: '/blog/:path*',  destination: '/journal', permanent: true },
```

The catch-all `/blog/:path*` redirects every legacy path to the journal root rather than trying to map old slugs (we're not migrating content, so a per-slug map would yield 404s anyway).

`permanent: true` (308) is appropriate now that we have a real destination.

## Marketing home follow-up (small, not in this sub-project)

Once the journal is live, a quick follow-up commit can add a "Latest from the journal" section to `/` between "From the studio" and the newsletter strip. That's a small edit to `app/(shop)/page.tsx`. Out of scope for SP#3 to keep this focused — flagged here so we don't forget.

## Verification (manual)

1. **Schema migrates** — `npm run migrate` adds `blog_posts` table and index without errors.
2. **Public listing** — `/journal` renders empty state with no entries published; renders chapter rows + pagination once entries exist.
3. **Admin create** — log into `/admin`, navigate to `/admin/journal/new`, fill in title (auto-slug works), excerpt, body (with one inline image upload), cover image upload. Save as draft. Toggle publish. Reload `/admin/journal` — entry visible with Published pill.
4. **Public entry** — `/journal/<slug>` renders title, cover, body HTML correctly, prev/next nav, inline newsletter signup.
5. **404 path** — `/journal/does-not-exist` and `/journal/<draft-slug>` both return 404.
6. **Sanitization** — saving a body containing `<script>alert(1)</script>` strips the script tag; saving `<a onclick="alert(1)">` strips the `onclick` attribute.
7. **Image upload** — uploaded image lands at `https://images.wildlightimagery.shop/journal/<uuid>.<ext>` and renders in the public entry.
8. **Sitemap** — `/sitemap.xml` includes `/journal` and each published entry's URL.
9. **/blog redirect** — `curl -I .../blog/anything` returns 308 → `/journal`.
10. **Edit + republish** — toggle published off, edit body, republish — chapter number stays the same (because `published_at` wasn't cleared).
11. **Delete** — delete an entry; later entries' chapter numbers shift down by 1 on next render. Confirm this is acceptable (it is — small set, low rate of deletion).

## Open questions resolved

- **Table name:** `blog_posts` (DRB-portable, even though user-facing word is "journal").
- **Image storage:** direct public R2 URL (matches existing artwork pattern, simpler than proxy).
- **Editor format:** HTML textarea + optional preview pane. Markdown / WYSIWYG deferred until SP#5 makes manual editing rare.
- **Old WP migration:** deferred entirely. AI Studio is the future content path.
- **Chapter number storage:** query-time derivation from `ROW_NUMBER() OVER (ORDER BY published_at ASC)`. No column.
- **Sanitization library:** `isomorphic-dompurify` server-side at write.
- **Pagination:** `?page=N` query param, 20 per page, simple numbered footer.

## Open questions for the implementation plan

- Confirm the existing admin auth middleware pattern (which file, what helper) so the plan can hand the engineer the right one-line guard.
- Confirm whether `update_updated_at_column()` trigger function already exists in the schema (look at `artworks` and other tables for the pattern).
- Decide editor preview rendering: sandboxed iframe vs. inline `dangerouslySetInnerHTML` in a styled div. The styled div is simpler and matches what the public page does.
- Slug uniqueness conflict: how does the create endpoint behave when the auto-generated slug already exists? (Append `-2`, `-3`, etc. — same approach as `lib/slug.ts` if it exists, otherwise add the helper.)
