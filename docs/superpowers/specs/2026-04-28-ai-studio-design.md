# AI Studio (SP#5)

**Date:** 2026-04-28
**Status:** Ready for plan
**Sub-project of:** `2026-04-27-wildlight-com-rebuild-overview.md` (#5)
**Depends on:** SP#3 journal (drops drafts into `blog_posts`).

## Goal

Stand up an admin authoring tool at `/admin/studio` that produces journal-entry drafts from five input modes (image, title, SEO trend, combination, improve-draft) using Claude Sonnet 4.6 with vision and the `web_search` tool. Voice trained from existing artifacts (`/about` letter + sample artwork notes) loaded into a cached system prompt. Reminder cron emails Dallas quarterly with a one-click link to the studio.

This is the leverage point that turns the journal from "a place Dan could write" into "a place Dan publishes from regularly without writing." Generated drafts save with `published = FALSE` — Dallas reviews and clicks publish in the journal admin.

## Non-goals (v1 — pragmatic cuts)

- **No phrase-by-phrase diff UX for Improve-draft.** v1 is simple: paste a draft, optionally add feedback, get back a refined version. Replaces the body wholesale. The fancy diff/accept-reject UX is deferred.
- **No voice-samples admin UI.** v1 hardcodes the samples in `lib/studio-voice.ts`. Editing requires a code change. Spec'd as a future enhancement when Dan needs to evolve the voice.
- **No multi-image generation.** Single image per request for v1. Multi-image ("here are 4 frames from a session, write the chapter") deferred.
- **No configurable reminder cadence.** Quarterly only, hardcoded. Settings table for cadence (off/monthly/quarterly) deferred.
- **No DataForSEO or paid keyword volumes.** Anthropic's `web_search` tool only. Free, included with API.
- **No image upload to R2 from the studio.** v1 accepts an image URL or a file upload that becomes a base64 inline source for the API call (no persistence). Generated drafts can later have images uploaded via the journal editor's existing R2 flow.
- **No newsletter draft auto-create.** v1 outputs a journal draft only. Newsletter operators reuse the SP#4 picker ("Start from journal entry") to grab the published entry into a newsletter. The two-output mode from the overview spec is achievable but defers complexity.
- **No streaming UI.** v1 awaits the full response and renders. Streaming is a UX upgrade for v2.
- **No usage/cost tracking.** Anthropic dashboards already cover this.

The cuts are deliberate — they keep SP#5 a one-evening build instead of a one-week build, while landing the integration end-to-end.

## Source of truth

- Existing AI client pattern: `lib/ai-draft.ts` — Anthropic SDK, vision via `{type:'image', source:{type:'url', url}}`, tool use for structured output, prompt-caching on system prompt, retry on transient errors, prompt-injection guard via XML-tagged user payload.
- Anthropic SDK: `@anthropic-ai/sdk` already in `package.json`.
- Env var: `ANTHROPIC_API_KEY` already present (used by `ai-draft.ts`).
- Journal table: `blog_posts` (SP#3). Generated drafts INSERT directly with `published = FALSE`.
- About letter as voice corpus: `app/(shop)/about/page.tsx` — the verbatim `LETTER` array.
- Existing artwork notes as additional voice signal: `artworks.artist_note` column (already populated for many rows by `ai-draft.ts`).
- Vercel cron pattern: `vercel.json` `crons` array (or `vercel.ts` if/when adopted).

## Architecture

```
/admin/studio (client page)
   │
   ├── mode selector: Image · Title · SEO Trend · Combination · Improve Draft
   ├── input form (per mode)
   ├── "Generate" button
   │       ↓
   ▼
POST /api/admin/studio/generate
   │
   ├── parse mode + payload (zod)
   ├── lib/studio.ts → generate(mode, input)
   │      │
   │      ├── load voice samples (lib/studio-voice.ts)
   │      ├── build system prompt (cached)
   │      ├── build user message per mode
   │      ├── call Anthropic with tool: { name: "draft_journal", ... }
   │      ├── (SEO mode) include web_search tool
   │      └── return { title, slug, excerpt, body, cover_image_suggestion? }
   │
   └── return { draft } to client (NOT auto-saved)
   │
   ▼
Client renders draft preview
   │
   ├── "Save to journal as draft" button
   │       ↓
   │   POST /api/admin/journal (existing) → draft saved
   │   redirects to /admin/journal/[id] for review/edit/publish
   │
   └── "Discard" button → reset

POST /api/cron/studio-reminder (Vercel cron, quarterly)
   │
   ├── send email to ADMIN_ALERT_EMAIL with link to /admin/studio
   ├── (optional) include 3 SEO trend angles pre-researched
   └── log to a simple `studio_reminders` table for audit (just timestamps)
```

## Five modes

### Mode A · Image
Input: file upload OR URL of an existing artwork's `image_web_url`.
The `lib/studio.ts:generateFromImage(input)` path.
The image is sent to Claude with vision; the model writes a journal entry inspired by what's in the frame — light, color, mood, composition. Optional title hint can refine the angle.

### Mode B · Title
Input: text title or topic (e.g., "Patience and overcast skies").
The simplest path; no vision.

### Mode C · SEO Trend
Input: nothing required — just clicks "Research".
The endpoint kicks off a Claude call with `web_search` enabled. The model researches what fine-art / landscape photography topics are trending, returns 3-5 candidate angles with rationale + suggested keywords. Dallas picks one → it becomes the input for a Title-mode generation.
Two-step: research returns candidates, then a separate generate call uses the picked candidate as a title input.

### Mode D · Combination
Input: title + 1 image. Combines A and B — the image anchors visuals, the title anchors angle.

### Mode E · Improve Draft
Input: an existing HTML body (paste in or pull from the journal admin) + optional feedback ("make it more contemplative", "shorten by half"). Output: refined body. **Wholesale replacement** for v1 — no phrase-by-phrase diff.

## Output format

Every mode produces the same shape via Anthropic's tool use:

```ts
interface JournalDraft {
  title: string;            // 4-12 words, evocative
  slug: string;             // slug-cased version of title
  excerpt: string;          // 1-2 sentences, ≤500 chars
  body: string;             // HTML, 600-1200 words
}
```

The endpoint returns this shape; the client renders a preview; the user clicks "Save to journal as draft" which POSTs to the existing `/api/admin/journal` (built in SP#3). After save, redirect to `/admin/journal/[id]` for refinement.

## Voice training

`lib/studio-voice.ts` holds two arrays:

```ts
export const VOICE_LETTER = [
  // The 4 paragraphs from app/(shop)/about/page.tsx LETTER array.
];

export const VOICE_NOTE_SAMPLES = [
  // 5-8 representative artist_note + title pairs from artworks (curated).
];
```

The system prompt embeds these as few-shot examples wrapped in XML to mark them as data, not instructions. Same prompt-injection-resistance pattern that `ai-draft.ts` uses.

System prompt is `cache_control: { type: 'ephemeral' }` — the 5-minute Anthropic cache amortizes the cost when Dallas does multiple generations in one sitting.

## Reminder cron

Single Vercel cron: `0 9 1 */3 *` (9 AM on the 1st of every third month). Hits `POST /api/cron/studio-reminder`.

Endpoint:
1. Auth: header check for `vercel-cron` signature OR an env-var shared secret.
2. Fetches recent journal stats (count of drafts vs. published, last published_at).
3. Sends email to `ADMIN_ALERT_EMAIL` (env var, already used elsewhere) with subject "Quarterly Wildlight Studio nudge" and body:
   - "It's been ${days} since the last published chapter."
   - One-click link → `${NEXT_PUBLIC_APP_URL}/admin/studio`
   - 3 trending angles (optional — calls SEO mode internally and embeds the candidates).

The studio_reminders log row is a single timestamp + delivery status, for audit. Simple table:

```sql
CREATE TABLE IF NOT EXISTS studio_reminders (
  id          SERIAL PRIMARY KEY,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered   BOOLEAN NOT NULL DEFAULT FALSE,
  trend_angles JSONB
);
```

If the cron secret is unavailable in dev, the endpoint still runs but skips the actual email (logs instead). Production has the secret set.

## Routes

```
/admin/studio                       client page with mode selector + form
/api/admin/studio/generate          POST { mode, payload } → { draft }
/api/admin/studio/seo-research      POST → { angles: [{title, rationale, keywords}] }
/api/cron/studio-reminder           POST (cron-auth) → emails admin
```

The `/api/admin/studio/generate` endpoint receives all 5 modes. The mode field switches behavior internally. SEO research is split out because it's a separate two-step flow (research → pick → generate).

Image upload is multipart on the same `generate` endpoint when mode is `image` or `combination`. The image is sent to Anthropic as either:
- A `{type:'image', source:{type:'url', url}}` if the input was a URL (preferred — no upload).
- A `{type:'image', source:{type:'base64', data, media_type}}` if the input was a file upload (we accept up to 5 MB; bigger errors out).

We do not persist the uploaded image. If Dallas later wants the image to appear in the journal entry, the journal editor's existing image upload flow handles that on the saved draft.

## UI

### `/admin/studio` page

Single client page. Layout:

```
┌──────────────────────────────────────────────────┐
│ Studio                                            │
│ ─────────                                         │
│ ◯ Image  ◯ Title  ◯ SEO  ◯ Combo  ◯ Improve     │
│                                                    │
│ [Per-mode input form]                             │
│                                                    │
│ [Generate →]                                      │
└──────────────────────────────────────────────────┘

After generate completes:

┌──────────────────────────────────────────────────┐
│ Draft preview                                     │
│ ────                                              │
│ Title:    [editable input]                        │
│ Slug:     [editable input]                        │
│ Excerpt:  [editable textarea]                     │
│ Body:     [editable textarea, with preview pane]  │
│                                                    │
│ [Save to journal as draft]  [Discard]             │
└──────────────────────────────────────────────────┘
```

The mode forms:

- **Image**: file picker (single, 5 MB max) OR URL field. Optional title-hint field.
- **Title**: title/topic input.
- **SEO**: button "Research trending angles". After research returns, shows 3-5 cards with title + rationale + "Use this →" buttons. Clicking flips to Title mode with the picked title pre-filled.
- **Combo**: image picker + title input.
- **Improve**: paste-existing-body textarea + optional feedback field.

The output preview is the same JournalDraft shape — title/slug/excerpt/body — editable inline before Save.

## Cost and rate

Sonnet 4.6 + prompt caching:
- System prompt + voice samples ≈ 4-6K tokens (cached after first call within 5 min).
- User input ≈ 100-500 tokens (or one image, ~1K tokens equiv).
- Output ≈ 2-4K tokens for full journal entry.
- Per-call cost ≈ $0.05-$0.15 with Sonnet 4.6. With caching, repeat calls in one session are roughly halved.
- SEO mode adds web_search tool calls — Anthropic doesn't currently bill for tool calls separately; the cost is the input/output tokens of the research messages.

Manual rate limit: the studio page button is disabled while a request is in flight. No bucket tracking.

## Security

- Admin auth (`requireAdmin()`) on every endpoint.
- Image upload size limit: 5 MB.
- URL input validated via `lib/url.ts:safeHttpUrl` before passing to Anthropic.
- Body sanitization on Save: the studio's output body is run through `lib/journal-html.ts:sanitizeJournalHtml` before INSERT into `blog_posts` (defense in depth — model output should be safe but we don't trust).
- Cron endpoint protected by Vercel's `x-vercel-cron` header check (Vercel signs cron requests).
- Voice samples are checked into the repo — no PII leakage concern (they're already public on /about).

## Done criteria

- [ ] `/admin/studio` renders with mode selector.
- [ ] Title mode: type a topic, generate, see a journal draft preview.
- [ ] Image mode (URL): pick a published artwork URL, generate, see a draft inspired by the image.
- [ ] Image mode (upload): upload a file ≤5MB, same flow.
- [ ] SEO mode: click research, get 3+ angles back; click "Use this", input flips to Title mode pre-filled.
- [ ] Combination mode: image + title, generate, draft includes both anchors.
- [ ] Improve-draft mode: paste body, optional feedback, generate, get refined version.
- [ ] "Save to journal as draft" creates a `blog_posts` row with `published=false` and redirects to the journal editor.
- [ ] Cron endpoint works locally with mock-auth; production cron config in `vercel.json`.
- [ ] `studio_reminders` table created.
- [ ] Body sanitization runs on save (no `<script>` survives the round-trip).
- [ ] `npm run typecheck` and `npm test` pass.

## Open questions resolved

- **Phrase-by-phrase diff for Improve mode**: cut for v1. Wholesale replace.
- **Voice samples storage**: hardcoded in `lib/studio-voice.ts` for v1. Admin UI deferred.
- **Multi-image**: single image only for v1.
- **Reminder cadence config**: hardcoded quarterly for v1.
- **DataForSEO**: not used. Anthropic web_search only.
- **Streaming**: not used. Synchronous request/response.
- **Newsletter pipeline**: SP#4 picker handles "use a journal entry as newsletter starting point." SP#5 produces journal drafts only.
- **Image persistence**: not persisted by SP#5. Journal editor handles uploads at editing time.

## Open questions for the implementation plan

- Confirm `vercel.json` exists; if not, create it with the cron entry. Or use `vercel.ts` if the project's adopted that pattern.
- Decide URL pattern for the cron endpoint — must match what's registered in Vercel.
- The image-upload size limit: is 5 MB enough? (R2 image proxy uses 10 MB; Studio probably needs less since it's transient.)
- Confirm `ADMIN_ALERT_EMAIL` env var is set in production.
