# Admin Redesign — Sub-project 2: Artworks AI-draft + Bulk Actions

**Date:** 2026-04-24
**Status:** Spec
**Parent:** `2026-04-24-admin-redesign-overview.md`

## Target

Fill the two outstanding admin gaps on the artwork screens:

1. **Per-artwork "Draft with AI" button** on `app/admin/artworks/[id]/page.tsx`.
   Reads EXIF from the source image, sends the image to Claude Sonnet 4.6
   with vision, returns `{year_shot, location, artist_note}` to pre-fill
   the editable fields. Does not save — caller reviews + commits through
   the existing per-field save path.
2. **List-page bulk actions** on `app/admin/artworks/page.tsx`:
   - "AI-draft N empty" — runs the new endpoint for each artwork where
     `artist_note IS NULL`, then PATCHes the results. Sequential, with
     per-row status.
   - "Apply full template to N empty" — applies `applyTemplate: 'full'`
     via the existing PATCH route to each artwork with zero variants.

Visual parity of the artworks list and detail pages against the Atelier
and Darkroom mockups (`AArtworksList` / `AArtworkDetail` /
`DArtworksList` / `DArtworkDetail`) is assumed substantially done by the
shipped print-room redesign (commit `d836bbd`). This sub-project adds
functionality, not polish.

## Non-goals

- No schema changes.
- No shipping changes to the variant PATCH (`applyTemplate` behavior
  stays as-is — applies the template and deactivates existing variants
  atomically). The bulk action avoids calling it on artworks that have
  any variants to prevent unwanted overwrites.
- No admin UI for editing metadata in bulk beyond the two above.
- No scraped-originals fallback for EXIF. If R2-public images have
  stripped EXIF, `year_shot` comes back null and the admin fills it by
  hand. Backfilling `artworks.exif` from scraped originals is a follow-up.

## Architecture

### New files

- `lib/exif.ts` — pure helper. One export:

  ```ts
  export function readExifFromBuffer(buf: Buffer):
    { year_shot: number | null; gps: { lat: number; lon: number } | null }
  ```

  Uses `exifr`. Never throws — returns `{null, null}` when EXIF is
  missing or unparseable.

- `lib/ai-draft.ts` — Anthropic SDK wrapper. One export:

  ```ts
  export async function draftArtworkMetadata(input: {
    imageBuf: Buffer;
    mime: 'image/jpeg' | 'image/png';
    title: string;
    collectionSlug: string | null;
    gps: { lat: number; lon: number } | null;
  }): Promise<{
    location: string | null;
    artist_note: string;
    confidence: 'high' | 'low';
  }>
  ```

  Sends one message to Claude Sonnet 4.6 with the image and structured
  context, enforces strict JSON response, validates shape (artist_note
  ≤ 180 chars, confidence in enum). Retries once on malformed output,
  then throws.

- `app/api/admin/artworks/[id]/ai-draft/route.ts` — new POST endpoint.

  - Auth via `requireAdmin()`.
  - Loads artwork row (title, image_web_url, collection_id).
  - Fetches `image_web_url` (R2 public), reads EXIF, calls
    `draftArtworkMetadata`.
  - Returns `{year_shot, location, artist_note, confidence}` JSON.
    Does not write to DB.
  - 502 on network/LLM failures after one retry.

### Modified files

- `package.json` — add `exifr` and `@anthropic-ai/sdk` runtime deps.
- `.env.example` — add `ANTHROPIC_API_KEY=`.
- `app/admin/artworks/[id]/page.tsx` — add "Draft with AI" button above
  the field grid; on click, call the endpoint and PATCH each non-null
  field returned. Simple loading + error state.
- `app/admin/artworks/page.tsx` — add two bulk-action buttons above the
  table:
  - "AI-draft N empty" — disabled when `rows.filter(r => !r.artist_note).length === 0`. On click, iterates sequentially calling the ai-draft endpoint then PATCHing, reloading at the end.
  - "Apply full template to N empty" — disabled when `rows.filter(r => r.variant_count === 0).length === 0`. On click, iterates sequentially calling PATCH `applyTemplate: 'full'`, reloading at the end.
- `app/api/admin/artworks/route.ts` — extend GET SELECT to include
  `a.artist_note` so the list page can compute the "N empty" count
  client-side.

### Prompt contract (reference)

System prompt anchors voice (terse, sensory, first-person narrator;
draw only from what is visible in the frame; no invented biography;
≤180 chars). User message includes the image, title, collection slug,
and GPS hint if present. Claude returns strict JSON:

```json
{ "location": "City, State" | null,
  "artist_note": "≤180 chars",
  "confidence": "high" | "low" }
```

Model: `claude-sonnet-4-6`.

Year comes from EXIF, never from the model. If EXIF lacks
`DateTimeOriginal`, `year_shot` stays null.

## Testing

Unit test for `lib/exif.ts` against a fixture JPEG with known
`DateTimeOriginal`. No integration test for the LLM call.

Manual verification:
- Load `/admin/artworks/<id>` for a published artwork with empty
  artist_note. Click "Draft with AI". Expect fields populated in a few
  seconds, artist_note sounds evocative, year_shot matches file's
  capture year if EXIF present.
- On `/admin/artworks`, verify the two bulk-action buttons show correct
  counts. Clicking walks through artworks; rows refresh after.

## Open questions

None. Design is pre-approved from the overview.
