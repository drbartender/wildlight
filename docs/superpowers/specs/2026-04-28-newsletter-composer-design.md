# Newsletter Composer Enhancements (SP#4)

**Date:** 2026-04-28
**Status:** Ready for plan
**Sub-project of:** `2026-04-27-wildlight-com-rebuild-overview.md` (#4)
**Depends on:** SP#3 journal — needs `blog_posts` table.

## Goal

Add the journal-to-newsletter pre-fill workflow to the existing admin broadcast composer, plus belt-and-braces HTML sanitization on send. Almost all of the original SP#4 scope (subscribers table, public signup, double-opt-in, composer, send pipeline, broadcast log, EmailCaptureStrip placements) was already shipped in the Phase-1 monetization work. This spec is just the journal pre-fill seam plus a small hardening pass.

## What's already shipped (no work needed)

- `subscribers` + `broadcast_log` tables with active/confirmed/unsub status, sources, idempotency keys.
- `POST /api/subscribe` (rate-limited public signup) + `GET /api/subscribe/confirm` (double-opt-in).
- `POST /api/admin/subscribers/broadcast` (test + full send) and `GET /api/admin/subscribers/broadcasts` (history).
- `/admin/subscribers` page with three tabs: Subscribers list · New broadcast · History. The composer has subject, HTML body, test-to address, full-send-with-confirmation, idempotency key rotation.
- `EmailCaptureStrip` rendering at the marketing home, the about-tail, the journal index, every journal entry, and the unified footer (every page).
- Unsubscribe-token signing via `lib/unsubscribe-token.ts`.

## Non-goals

- **No MJML or layout system.** Body remains raw HTML in the composer. Templates / wrappers are deferred — Dan/Dallas can hand-author or use the AI Studio (SP#5).
- **No segmentation.** All sends go to the full active subscriber list. No tags, lists, or campaigns.
- **No analytics.** No open tracking, click tracking, or A/B tests.
- **No drip / sequenced campaigns.** One-shot broadcasts only.
- **No subscriber import/export UI.** Existing list management is sufficient.
- **No template gallery.** AI Studio (SP#5) is the future for assisted composition.
- **No new schema.**

## Source of truth

- Existing composer: `app/admin/subscribers/page.tsx` (lines 212-300+ are the broadcast composer).
- Existing send endpoint: `app/api/admin/subscribers/broadcast/route.ts`.
- Existing journal API: `app/api/admin/journal/route.ts` (GET returns all entries with `published` flag).
- Sanitizer: `lib/journal-html.ts` (built in SP#3 — same allowed-tags whitelist, no scripting, no event handlers, no `javascript:` URIs).

## Changes

### 1. "Start from journal entry" picker in the composer

Add a new button to the broadcast composer's tab body, positioned above the subject field:

> **Start from a journal entry →** *(small ghost button)*

Clicking opens an inline panel (not a modal — keeps the page state simple) that lists **published** journal entries with: chapter number, title, publish date, excerpt. Each row has a "Use this →" button. Clicking populates:

- **Subject** ← entry title (e.g., `"Stormlight, in October"` → subject `"Stormlight, in October"`).
- **Body HTML** ← a small newsletter-shaped wrapper:

  ```html
  <p>Friends —</p>
  <p>{excerpt or first paragraph of body, plain-text-extracted}</p>
  <p><a href="https://wildlightimagery.shop/journal/{slug}">Read the full chapter →</a></p>
  <p>— Dan</p>
  ```

  If the entry has a cover image, it's prepended as `<img src="{cover_image_url}" alt="{title}" style="max-width:100%;height:auto;" />`.

The pre-filled body is just a starting point — the editor can change everything before sending. The picker auto-collapses after a selection.

If there are zero published entries, the button shows a disabled tooltip: "Publish a chapter first to use this."

### 2. Sanitize broadcast HTML on send

In `app/api/admin/subscribers/broadcast/route.ts`, run the body through `sanitizeJournalHtml` before passing to the email sender. Strips any inadvertent `<script>` / `<iframe>` / event handlers / `javascript:` URIs that an admin might paste from an external source.

This is defense in depth — the admin is trusted, but an admin pasting marketing copy from a templating tool may get unexpected HTML. The sanitizer's whitelist is generous enough for prose newsletters but blocks the obvious threats.

### 3. Optional preview pane in the composer

Add a "Preview" toggle button next to the existing test/send row. When on, renders a sandboxed-ish preview of the body HTML below the textarea, using the same `dangerouslySetInnerHTML` approach the journal entry page uses. Identical to the journal editor's preview affordance built in SP#3.

### 4. Subscriber early-access placeholder column (Phase-2 hook for SP#6)

Add the schema column the overview spec earmarks for limited editions:

```sql
ALTER TABLE artwork_variants
  ADD COLUMN IF NOT EXISTS subscriber_early_access_until TIMESTAMPTZ;
```

No UI for it in SP#4. This drops the schema in place so SP#6 can wire the gating logic without another migration. Idempotent — no-op if already present.

## URL surface (no changes)

- `/admin/subscribers` — gains the picker UI.
- `POST /api/admin/subscribers/broadcast` — gains the sanitize step.
- `GET /api/admin/journal` — already returns published entries; the picker filters client-side via `entries.filter(e => e.published)`.

No new routes.

## Verification (manual)

1. **Schema migration runs cleanly** — `npm run migrate` adds `subscriber_early_access_until` (or no-ops if already there).
2. **Picker disabled when empty** — visit `/admin/subscribers?tab=broadcast` with zero published journal entries; the "Start from journal entry" button is disabled with the tooltip.
3. **Picker populates** — publish at least one journal entry, return to the composer, click the button. The published-only filtered list appears. Click "Use this →" — subject and body populate, picker collapses.
4. **Pre-filled HTML renders correctly** — toggle the preview pane; cover image, opener, excerpt, "Read the full chapter →" link, sign-off all visible.
5. **Sanitization on send** — paste `<script>alert(1)</script><p>copy</p>` into the body, send a test. Received email has only `<p>copy</p>` (script stripped).
6. **Existing flows unchanged** — Subscribers list, broadcast history, full sends, idempotency rotation all still work.
7. **EmailCaptureStrip submissions** — submit from `/`, `/about`, and a journal entry; each row in `subscribers` should land with `source` reflecting the placement (`marketing-home`, `about-tail`, `journal-entry`).

## Done criteria

- [ ] "Start from journal entry" picker rendered in the composer.
- [ ] Published-only filter on the picker list.
- [ ] Pre-fill populates subject + body and collapses the picker.
- [ ] `subscribeEarlyAccessUntil` column exists on `artwork_variants` (or a no-op if pre-existing).
- [ ] Broadcast HTML sanitized on send.
- [ ] Optional preview pane works.
- [ ] No regressions on test send / full send / idempotency / history list.
- [ ] `npm test` and `npm run typecheck` pass.

## Open questions resolved

- **No new newsletter table** — `broadcast_log` already serves the audit role.
- **No backend pre-fill API** — picker reads from existing `/api/admin/journal` (admin can already list).
- **Sanitizer choice** — reuse `lib/journal-html.ts` exactly. No second flavor.
- **Preview pane** — yes, it's a 5-minute add and matches the journal editor's UX.

## Open questions for the implementation plan

- Confirm the existing composer's React state shape so the pre-fill mutator can find `setSubject` and `setHtml` cleanly.
- Decide picker UI placement: inline above the subject field (chosen here) vs. a side rail. Inline matches the existing tab layout simplest.
