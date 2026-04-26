# Print master as source of truth — design spec

**Date:** 2026-04-26
**Status:** Approved by user, awaiting implementation plan.
**Supersedes:** the "publish without print file" assumption baked into
[`2026-04-23-wildlight-monetization-design.md`](2026-04-23-wildlight-monetization-design.md)
(spec line 235 — "nullable until first order").

## Problem

The original spec allowed `artworks.image_print_url` to be `NULL` on
published artworks; the Stripe webhook would flag any order touching such
an artwork as `needs_review`. That model assumed Dan would deliver
masters in trickle, after publish.

Reality is different:

- Dan has lost an unknown subset of his masters to file corruption. Some
  currently-published artworks **have no master and never will**.
- For artworks that do have a master, Dan's local file naming is
  inconsistent (numbered camera files in folders that may or may not be
  named meaningfully). Filename-based or AI-vision matching is
  unnecessary complexity if the workflow forces a hi-res master to
  exist before the artwork can ship.

We previously scraped display-tier images from
`wildlightimagery.com` to seed the catalog. Those images are
representative but not always optimal, and they encourage the
"publish first, fulfill later" path that this spec closes.

## Architectural invariants (new)

These two rules are the load-bearing change.

1. **No `image_print_url` → cannot be `published`.** The PATCH route on
   `app/api/admin/artworks/[id]/route.ts` rejects a status transition to
   `published` when `image_print_url IS NULL`. The DB enforces nothing
   directly (a partial CHECK against a referenced column would be
   awkward), but every API path that writes status validates it. The
   admin UI greys out the "Publish" action and explains why.
2. **`image_web_url` is derived from `image_print_url` at upload time.**
   When a master is uploaded, the server reads it once and emits a
   2000px-on-the-long-edge sRGB JPEG (quality 85) into the public R2
   bucket. Both URLs are written together. Dan delivers one file per
   artwork; the display image is never separately uploaded again.

## Workflow change

| Before | After |
|---|---|
| Two-tier upload: `image_web` first, `image_print` later. | One delivery: master only. Web tier derived. |
| `published` allowed without master; webhook flags at order time. | `published` requires master at admin time; webhook stops being a fallback. |
| `/admin/artworks/new` requires `image_web`, optional `image_print`. | Required: `image_print`. `image_web` is generated. |
| Bulk catalog seeding via scraper + manual print uploads. | Bulk uploader does both: add masters to existing, or create new artworks from masters. |

## Schema & data migration

Schema is unchanged. The fix is **operational data hygiene**, not a
column change.

A one-shot script (`scripts/demote-orphan-publishes.ts`) lists every
artwork with `status='published' AND image_print_url IS NULL`, prints
their slugs + titles, and on `--apply` updates them to
`status='draft'`. Slug, plate number, AI-drafted metadata, and
collection assignment are preserved — Dan can find the file later and
re-publish without losing curation.

The bulk-uploader UI also exposes this as a one-click action (Section C
below) so it can be done from the admin without a shell.

## New surfaces

### `app/admin/artworks/bulk-upload/page.tsx`

Client component, three sections:

**Section A — Print masters needed.**
Lists every artwork with `image_print_url IS NULL` (any status). Each
row: thumbnail (web tier if present, placeholder otherwise), title,
status badge, slug, `[Choose file]` button, per-row progress and
state. Click `[Choose file]` → native file picker (one file at a
time) → uploads the chosen file to R2, derives the web image,
updates the artwork. Status messages per row: *idle / uploading
(with progress bar) / processing / ✓ done / ✗ failed (with retry)*.

Filter pill at the top of the section: *"Hide artworks already in
this batch"* so a long session doesn't accumulate visual noise.

**Section B — Add new artworks.**
A default-collection `<select>` (defaults to the most-populated
collection; user can change per session). Below that, a drop zone
plus a `[Browse]` button. Files dropped here become brand-new draft
artworks. The session shows a "Newly added" list with each file's
upload progress and the AI-drafted title that came back from the
server. Each list item links to the artwork detail page so Dan can
review and publish when ready.

Concurrency cap: **3 in-flight uploads** across both sections.

**Section C — Cleanup.**
Always-visible footer card. Shows the count of currently-published
artworks with no master. `[Demote N artworks to draft]` button runs
the same logic as the demotion script. Disabled when count is 0.

**Linked from** `app/admin/artworks/page.tsx` topbar — a "Bulk upload"
button next to the existing "+ New artwork" CTA. Both Atelier and
Darkroom themes inherit from the existing `wl-admin-surface` design
system; no new CSS tokens.

### API endpoints

All under `app/api/admin/artworks/bulk-upload/`. All `requireAdmin()`.

- **`presign/route.ts` — `POST`.**
  Input: `{ filename: string, contentType: string, size: number }`.
  Validates: admin, contentType in `image/jpeg|image/png|image/tiff`,
  size ≤ 500 MB. Returns `{ key, url, expiresAt }`.
  The `key` is a transient staging key under `incoming/<uuid>.<ext>` —
  *not* the final `artworks-print/...` location. (Rationale: at presign
  time we don't yet know the artwork's slug for new uploads, and we
  don't want clients to dictate final keys.)

- **`finalize/route.ts` — `POST`.**
  Input: one of two shapes:
  - `{ mode: "update", artworkId: number, stagedKey: string }` — Section A.
  - `{ mode: "create", stagedKey: string, collectionId: number | null }` — Section B.

  Server steps for both modes:
  1. `requireAdmin()`.
  2. Validate `stagedKey` matches `incoming/[uuid].(jpg|jpeg|png|tif|tiff)$` regex (same hardening discipline as the existing `[id]/route.ts:49` check).
  3. Stream the staged object from R2 private → `sharp` → 2000px sRGB JPEG q85 → upload to R2 public as `artworks/<collection-folder>/<slug>.jpg`. The `<slug>` for **update** mode is the artwork's existing slug; for **create** mode, it's derived from the AI-drafted title (or a fallback like `untitled-<short-uuid>` if AI-draft fails).
  4. Move (server-side `CopyObject` + `DeleteObject`) the staged master to the canonical key `artworks-print/<collection-folder>/<slug>.<ext>`.
  5. For **update** mode: `UPDATE artworks SET image_print_url = $1, image_web_url = $2, updated_at = NOW() WHERE id = $3`.
     For **create** mode: call existing AI-draft helper to generate `title`, `artist_note`. `INSERT INTO artworks (collection_id, slug, title, artist_note, image_web_url, image_print_url, status) VALUES (..., 'draft')`.
  6. Return `{ artworkId, slug, image_web_url }`.

  Failure handling: any step 3–5 failure leaves the staged file in
  `incoming/` for inspection; a separate `cleanup-staged.ts` cron-able
  script reaps `incoming/*` older than 24h. The DB is only written on
  full success.

- **`cleanup-orphans/route.ts` — `POST`.**
  Demotes all `status='published' AND image_print_url IS NULL` artworks
  to `draft`. Returns `{ demoted: number, slugs: string[] }`.
  No input. Idempotent.

### Lib changes

- **`lib/r2.ts`** — add `signedPrivateUploadUrl(key, contentType, expiresInSec)` (presigned `PutObjectCommand`), and `copyAndDeletePrivate(srcKey, dstKey)` for the staging→canonical move.
- **`lib/image-derive.ts`** — new. Single function `deriveWebFromPrint(buf | stream): { buf: Buffer, contentType: 'image/jpeg' }` using `sharp`. Resizes to 2000px on long edge, sRGB, JPEG q85, strips ICC/EXIF except the orientation tag.
- **`lib/ai-draft.ts`** — already exists per commit `e082409`. The "create" finalize mode calls it inline; failures fall back to a placeholder title.

### Schema validation rule (admin UI + API)

`app/api/admin/artworks/[id]/route.ts` PATCH:

```ts
if (d.status === 'published') {
  const cur = await client.query<{ image_print_url: string | null }>(
    'SELECT image_print_url FROM artworks WHERE id = $1 FOR UPDATE',
    [id],
  );
  if (!cur.rows[0]?.image_print_url) {
    return NextResponse.json(
      { error: 'cannot publish: print master required' },
      { status: 409 },
    );
  }
}
```

Admin UI (`app/admin/artworks/[id]/page.tsx`) reads `image_print_url`
on load and disables the publish action with a tooltip when null.

## Data flow (per file)

```
[Browser]                          [Next.js API]               [R2]
  pick file (Section A row,
  or drop in Section B)
       │
       ▼
  POST /presign ─────────────► validates size + mime
                               returns staged URL + key
       ◄────────────────────────
       │
  PUT (file) ───────────────────────────────────────────► incoming/<uuid>.<ext>
       ◄──── 200 OK ───────────────────────────────────────
       │
  POST /finalize {mode, ...} ──► validates staged key
                               GET incoming/<uuid> from R2
                               sharp → 2000px JPEG
                               PUT artworks/<col>/<slug>.jpg (public)
                               COPY incoming/<uuid> →
                                    artworks-print/<col>/<slug>.<ext>
                               DELETE incoming/<uuid>
                               UPDATE or INSERT artwork row
                               (create mode: AI-draft title)
       ◄─── {artworkId, slug, image_web_url}
       │
  row marks ✓; "needs masters" count decrements
```

## Edge cases & error handling

- **Mid-upload tab close.** R2 keeps partial multipart writes only if
  multipart is used; for single PUTs the byte stream is just dropped.
  Staged keys with no finalize call are reaped by the 24h cleanup
  script.
- **Finalize succeeds at R2 step but fails at DB step.** The artwork
  row is the source of truth for "what exists." If the DB step fails,
  the orphaned R2 objects (`artworks-print/.../<slug>.<ext>` and the
  derived web image) get logged via Sentry; a manual cleanup is
  acceptable for this rare path.
- **TIFF that `sharp` can't decode** (exotic compression, layered).
  Finalize returns 415; the row shows "couldn't process this format —
  please export as JPEG or standard TIFF." The staged file is reaped.
- **`ANTHROPIC_API_KEY` missing or Claude 5xx during create-mode
  AI-draft.** Fallback: insert artwork with `title = "Untitled "
  + new Date().toISOString().slice(0, 10)`, `artist_note = NULL`. Dan
  edits in the admin afterward. Logged as warning, not an error.
- **Slug collision in create mode.** The same `uniqueSlug()` helper
  used by `app/api/admin/artworks/upload/route.ts:37-38` is reused —
  on collision, it appends `-2`, `-3`, etc.
- **File picker on Section A picks the wrong file.** Once finalize
  succeeds, the artwork's `image_web_url` and `image_print_url` are
  both updated. Recovery: pick the correct file again — old R2 objects
  become orphaned (the slugs match so the new web JPEG overwrites the
  old; the old print master at `artworks-print/...` is replaced when
  the same slug is uploaded again). For wholly-different filenames at
  the print tier, an orphan remains; acceptable trade-off given the
  expected once-per-artwork frequency.

## Out of scope

- **Multipart upload / chunked resume.** Single PUT covers files up to
  R2's 5 GB cap. We expect 50–500 MB. If reality differs, multipart is
  a follow-up; the staging-key indirection in `presign` makes it a
  drop-in change.
- **Filename normalization, AI vision matching, drag-from-folder
  inference.** Eliminated by the artwork-driven UI.
- **localStorage queue persistence.** The artworks index is the source
  of truth for "what's done"; closing and reopening the tab is fine.
- **Browser-side TIFF decode (utif.js).** Eliminated by deriving the
  web image server-side.
- **Cron job for `cleanup-staged`.** A manually-run script is
  sufficient at this scale; can be promoted to a cron later.
- **Migration of existing scraped display images.** They get overwritten
  whenever a master is uploaded. Artworks that never get a master keep
  their scraped web image but get demoted to draft (so they don't
  display publicly).

## Testing

- **Vitest unit** (`tests/lib/`):
  - `tests/lib/image-derive.test.ts` — feeds `sharp` a tiny TIFF/JPEG
    fixture, asserts the output is `image/jpeg`, ≤ 2000px on long edge,
    has no ICC profile.
- **Manual end-to-end** (per `CLAUDE.md`'s "Anything touching … R2
  signing needs manual end-to-end verification"):
  - Section A path: upload a master to an existing artwork; verify
    web image regenerates, both URLs in DB.
  - Section B path: upload a new file; verify draft artwork is
    created with AI-drafted title.
  - Section C path: with one published+no-master artwork, click
    Demote, verify status flips.
  - Try a bad TIFF, confirm 415 + clean staged-key reaping.

## Risks & open questions

- **`sharp` on Vercel.** Vercel supports `sharp` natively; no special
  build step. Memory headroom: 200 MB TIFF + sharp working set could
  push 600–800 MB on a 1 GB function. Streaming via `sharp.pipeline`
  keeps it tighter. If memory is a real problem, fallback is a
  `resize: { fit: 'inside', width: 2000 }` with `.toBuffer()` after a
  preliminary `metadata()` check that skips files we can't handle.
- **Display-image continuity.** Replacing scraped display images with
  master-derived ones changes the look of the catalog. Verify visually
  on the first upload before doing the batch — if the derived JPEG
  looks worse than the scrape (rare; usually it's the opposite), we
  can adjust quality/size before processing the rest.
- **R2 egress cost for staged file → finalize step.** Each finalize
  reads the master once from R2 (server-side, same region). R2 egress
  to Cloudflare workers/Vercel is free or near-free; budget impact
  trivial.
