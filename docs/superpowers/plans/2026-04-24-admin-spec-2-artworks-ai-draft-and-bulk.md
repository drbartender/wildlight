# Admin Spec 2 — Artworks AI-draft + Bulk Actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the AI-draft endpoint + button and the two list-page bulk actions on the admin artworks screens.

**Architecture:** New `lib/exif.ts`, `lib/ai-draft.ts`, and a single `POST /api/admin/artworks/[id]/ai-draft` route. Two client-side UI additions re-using the existing PATCH paths for persistence.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, `exifr`, `@anthropic-ai/sdk`.

---

## Task 1: Add dependencies + env var

**Files:**
- Modify: `package.json`, `package-lock.json` (via npm install)
- Modify: `.env.example`

- [ ] **Step 1: Install deps**

```bash
npm install exifr @anthropic-ai/sdk
```

- [ ] **Step 2: Add env var to `.env.example`**

Append to `.env.example`:

```
ANTHROPIC_API_KEY=
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "admin: add exifr + @anthropic-ai/sdk deps for AI-draft"
```

---

## Task 2: `lib/exif.ts`

**Files:**
- Create: `lib/exif.ts`

- [ ] **Step 1: Create the helper**

```ts
import { parse as parseExif } from 'exifr';

export interface ExifSummary {
  year_shot: number | null;
  gps: { lat: number; lon: number } | null;
}

/**
 * Best-effort EXIF read from a JPEG/PNG buffer. Never throws — on any
 * parse error or missing tag, returns nulls.
 */
export async function readExifFromBuffer(buf: Buffer): Promise<ExifSummary> {
  try {
    const data = (await parseExif(buf, {
      pick: ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude'],
    })) as {
      DateTimeOriginal?: Date;
      CreateDate?: Date;
      latitude?: number;
      longitude?: number;
    } | null;
    if (!data) return { year_shot: null, gps: null };
    const when = data.DateTimeOriginal ?? data.CreateDate ?? null;
    const year_shot = when instanceof Date && !isNaN(+when) ? when.getUTCFullYear() : null;
    const gps =
      typeof data.latitude === 'number' && typeof data.longitude === 'number'
        ? { lat: data.latitude, lon: data.longitude }
        : null;
    return { year_shot, gps };
  } catch {
    return { year_shot: null, gps: null };
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add lib/exif.ts
git commit -m "lib: readExifFromBuffer — year + GPS from a JPEG/PNG buffer"
```

---

## Task 3: `lib/ai-draft.ts`

**Files:**
- Create: `lib/ai-draft.ts`

- [ ] **Step 1: Create the wrapper**

```ts
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-6';
const MAX_NOTE_CHARS = 180;

export interface DraftInput {
  imageBuf: Buffer;
  mime: 'image/jpeg' | 'image/png';
  title: string;
  collectionSlug: string | null;
  gps: { lat: number; lon: number } | null;
}

export interface DraftResult {
  location: string | null;
  artist_note: string;
  confidence: 'high' | 'low';
}

const SYSTEM = `You write the metadata line for a fine-art photograph.

Voice: first person, terse, sensory, a craftsman's aside. One or two short sentences.

Rules:
- Draw ONLY from what is visible in the frame. Do not invent biography or unverifiable claims.
- artist_note: at most 180 characters, 1-2 sentences, first-person narrator voice.
- location: "City, State" (US) or "City, Country" (non-US). Use null when genuinely ambiguous. If GPS coordinates are provided, the location must be consistent with them.
- confidence: "low" if you are guessing about location or the image is hard to read; otherwise "high".

Respond with a single strict JSON object and nothing else:
{"location": "City, State" | null, "artist_note": "...", "confidence": "high" | "low"}`;

function userPreamble(input: DraftInput): string {
  const parts = [
    `Title: ${input.title}`,
    input.collectionSlug ? `Collection: ${input.collectionSlug}` : null,
    input.gps ? `GPS hint: lat ${input.gps.lat.toFixed(4)}, lon ${input.gps.lon.toFixed(4)}` : null,
  ].filter(Boolean);
  return parts.join('\n');
}

function validate(raw: unknown): DraftResult {
  if (!raw || typeof raw !== 'object') throw new Error('non-object response');
  const r = raw as Record<string, unknown>;
  const loc = r.location;
  const note = r.artist_note;
  const conf = r.confidence;
  if (typeof note !== 'string' || !note.trim()) throw new Error('missing artist_note');
  if (note.length > MAX_NOTE_CHARS) throw new Error('artist_note too long');
  if (conf !== 'high' && conf !== 'low') throw new Error('bad confidence');
  const location = loc == null ? null : typeof loc === 'string' && loc.trim() ? loc : null;
  return { location, artist_note: note, confidence: conf };
}

export async function draftArtworkMetadata(input: DraftInput): Promise<DraftResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');
  const client = new Anthropic({ apiKey });
  const image = input.imageBuf.toString('base64');

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 512,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: input.mime, data: image },
              },
              { type: 'text', text: userPreamble(input) },
            ],
          },
        ],
      });
      const text = res.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      const firstBrace = text.indexOf('{');
      const lastBrace = text.lastIndexOf('}');
      if (firstBrace < 0 || lastBrace < firstBrace) throw new Error('no JSON in response');
      const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));
      return validate(parsed);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('ai-draft failed');
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add lib/ai-draft.ts
git commit -m "lib: draftArtworkMetadata — Claude Sonnet 4.6 vision call with strict JSON + retry"
```

---

## Task 4: `POST /api/admin/artworks/[id]/ai-draft`

**Files:**
- Create: `app/api/admin/artworks/[id]/ai-draft/route.ts`

- [ ] **Step 1: Create the route**

```ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { readExifFromBuffer } from '@/lib/exif';
import { draftArtworkMetadata } from '@/lib/ai-draft';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id } = await ctx.params;

  const { rows } = await pool.query<{
    title: string;
    image_web_url: string;
    collection_slug: string | null;
  }>(
    `SELECT a.title, a.image_web_url, c.slug AS collection_slug
     FROM artworks a LEFT JOIN collections c ON c.id = a.collection_id
     WHERE a.id = $1`,
    [id],
  );
  if (!rows.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const a = rows[0];

  let buf: Buffer;
  try {
    const r = await fetch(a.image_web_url);
    if (!r.ok) throw new Error(`image fetch ${r.status}`);
    buf = Buffer.from(await r.arrayBuffer());
  } catch (err) {
    return NextResponse.json(
      { error: 'image fetch failed', detail: String(err) },
      { status: 502 },
    );
  }

  const mime = a.image_web_url.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  const { year_shot, gps } = await readExifFromBuffer(buf);

  try {
    const draft = await draftArtworkMetadata({
      imageBuf: buf,
      mime,
      title: a.title,
      collectionSlug: a.collection_slug,
      gps,
    });
    return NextResponse.json({
      year_shot,
      location: draft.location,
      artist_note: draft.artist_note,
      confidence: draft.confidence,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'ai-draft failed', detail: String(err) },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/artworks/[id]/ai-draft/route.ts
git commit -m "api: POST /api/admin/artworks/[id]/ai-draft — fetch image, read EXIF, draft via Claude"
```

---

## Task 5: Extend list GET to return `artist_note`

**Files:**
- Modify: `app/api/admin/artworks/route.ts`

- [ ] **Step 1: Add `a.artist_note` to SELECT**

In `app/api/admin/artworks/route.ts`, find the SELECT around line 23-36 and add `a.artist_note` after `a.image_print_url`:

```
    `SELECT a.id, a.slug, a.title, a.status, a.image_web_url, a.image_print_url,
            a.artist_note,
            a.updated_at,
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/artworks/route.ts
git commit -m "api: include artist_note in admin artworks list for 'empty' counts"
```

---

## Task 6: "Draft with AI" button on artwork detail page

**Files:**
- Modify: `app/admin/artworks/[id]/page.tsx`
- Modify: `app/admin/admin.css` (small button state + confidence pill)

- [ ] **Step 1: Add draft state + handler**

In `app/admin/artworks/[id]/page.tsx`, find the `save` function (around lines 52-61). Immediately after it, add:

```tsx
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftConfidence, setDraftConfidence] = useState<'high' | 'low' | null>(null);

  async function draftWithAi() {
    setDrafting(true);
    setDraftError(null);
    setDraftConfidence(null);
    try {
      const r = await fetch(`/api/admin/artworks/${id}/ai-draft`, { method: 'POST' });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      const body = (await r.json()) as {
        year_shot: number | null;
        location: string | null;
        artist_note: string;
        confidence: 'high' | 'low';
      };
      const patch: Record<string, unknown> = {};
      if (body.year_shot != null && !data?.artwork.year_shot) patch.year_shot = body.year_shot;
      if (body.location && !data?.artwork.location) patch.location = body.location;
      if (body.artist_note && !data?.artwork.artist_note) patch.artist_note = body.artist_note;
      if (Object.keys(patch).length > 0) await save(patch);
      setDraftConfidence(body.confidence);
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : String(err));
    } finally {
      setDrafting(false);
    }
  }
```

- [ ] **Step 2: Render the button above the field grid**

Find the `<div style={{ marginTop: 20 }} className="wl-adm-field-grid">` block (around line 179-202). Immediately before it, insert:

```tsx
            <div className="wl-adm-ai-draft-row">
              <button
                type="button"
                className="wl-adm-btn small"
                onClick={draftWithAi}
                disabled={drafting}
              >
                {drafting ? 'Drafting…' : 'Draft with AI'}
              </button>
              {draftConfidence === 'low' && (
                <span className="wl-adm-ai-confidence-low">low confidence</span>
              )}
              {draftError && (
                <span className="wl-adm-ai-draft-err">{draftError}</span>
              )}
              <span className="wl-adm-ai-draft-hint">
                Fills any empty Location / Year / Artist note.
              </span>
            </div>
```

- [ ] **Step 3: Add CSS**

In `app/admin/admin.css`, append at the bottom of the file:

```css
/* ─────── ARTWORK DETAIL — AI-draft helper row ─────── */

.wl-adm-ai-draft-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 20px;
  font-size: 12px;
  color: var(--adm-muted);
}
.wl-adm-ai-confidence-low {
  background: var(--adm-amber-soft);
  color: var(--adm-amber);
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 999px;
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.wl-adm-ai-draft-err {
  color: var(--adm-red);
  font-size: 12px;
}
.wl-adm-ai-draft-hint {
  margin-left: auto;
  font-size: 11px;
}
.wl-admin-surface[data-theme='dark'] .wl-adm-ai-confidence-low {
  border-radius: 3px;
}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add app/admin/artworks/\[id\]/page.tsx app/admin/admin.css
git commit -m "admin: Draft with AI button on artwork detail — fills empty metadata fields"
```

---

## Task 7: List-page bulk actions

**Files:**
- Modify: `app/admin/artworks/page.tsx`

Two new buttons in the subhead: "AI-draft N empty" and "Apply full template to N empty". Each counts rows client-side (using the `artist_note` and `variant_count` fields already loaded), iterates sequentially, and reloads at the end.

- [ ] **Step 1: Update `Row` interface and add state**

In `app/admin/artworks/page.tsx`, find the `interface Row` block (around lines 9-21). Add `artist_note: string | null` after `image_print_url`:

```tsx
interface Row {
  id: number;
  slug: string;
  title: string;
  status: string;
  image_web_url: string;
  image_print_url: string | null;
  artist_note: string | null;
  collection_title: string | null;
  variant_count: number;
  min_price_cents: number | null;
  max_price_cents: number | null;
  updated_at: string;
}
```

- [ ] **Step 2: Add batch-action state + handlers**

Inside `AdminArtworksPage`, after the `bulk` function (around line 74), add:

```tsx
  const [batchRunning, setBatchRunning] = useState<null | 'draft' | 'variants'>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number; failed: number }>({ done: 0, total: 0, failed: 0 });

  const emptyNote = rows.filter((r) => !r.artist_note);
  const emptyVariants = rows.filter((r) => r.variant_count === 0);

  async function batchAiDraft() {
    if (batchRunning) return;
    setBatchRunning('draft');
    setBatchProgress({ done: 0, total: emptyNote.length, failed: 0 });
    let done = 0;
    let failed = 0;
    for (const r of emptyNote) {
      try {
        const res = await fetch(`/api/admin/artworks/${r.id}/ai-draft`, { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as {
          year_shot: number | null;
          location: string | null;
          artist_note: string;
        };
        const patch: Record<string, unknown> = {};
        if (body.year_shot != null) patch.year_shot = body.year_shot;
        if (body.location) patch.location = body.location;
        if (body.artist_note) patch.artist_note = body.artist_note;
        if (Object.keys(patch).length) {
          await fetch(`/api/admin/artworks/${r.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          });
        }
      } catch {
        failed += 1;
      }
      done += 1;
      setBatchProgress({ done, total: emptyNote.length, failed });
    }
    setBatchRunning(null);
    await reload();
  }

  async function batchApplyFull() {
    if (batchRunning) return;
    setBatchRunning('variants');
    setBatchProgress({ done: 0, total: emptyVariants.length, failed: 0 });
    let done = 0;
    let failed = 0;
    for (const r of emptyVariants) {
      try {
        const res = await fetch(`/api/admin/artworks/${r.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ applyTemplate: 'full' }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        failed += 1;
      }
      done += 1;
      setBatchProgress({ done, total: emptyVariants.length, failed });
    }
    setBatchRunning(null);
    await reload();
  }
```

- [ ] **Step 3: Render the buttons in the subhead**

Find the `<Link href="/admin/artworks/new" ...>+ New artwork</Link>` (around lines 124-129). Immediately before it, insert:

```tsx
          <button
            type="button"
            className="wl-adm-btn small"
            onClick={batchAiDraft}
            disabled={batchRunning !== null || emptyNote.length === 0}
          >
            {batchRunning === 'draft'
              ? `Drafting ${batchProgress.done}/${batchProgress.total}…`
              : `AI-draft ${emptyNote.length} empty`}
          </button>
          <button
            type="button"
            className="wl-adm-btn small"
            onClick={batchApplyFull}
            disabled={batchRunning !== null || emptyVariants.length === 0}
          >
            {batchRunning === 'variants'
              ? `Applying ${batchProgress.done}/${batchProgress.total}…`
              : `Apply full template to ${emptyVariants.length} empty`}
          </button>
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add app/admin/artworks/page.tsx
git commit -m "admin: artworks list gains AI-draft + apply-full-template bulk actions"
```

---

## Task 8: Smoke verification

**Files:**
- None modified.

- [ ] **Step 1: Confirm env var is set**

If `ANTHROPIC_API_KEY` is not in `.env.local`, the ai-draft endpoint will return 502 with "ANTHROPIC_API_KEY missing". Set it before testing:

```bash
grep ANTHROPIC_API_KEY .env.local || echo "ANTHROPIC_API_KEY=<paste-key>" >> .env.local
```

- [ ] **Step 2: Start dev server + sign in**

```bash
npm run dev
```

Open `http://localhost:3000/admin/artworks`, sign in.

- [ ] **Step 3: Per-artwork AI-draft**

Open any artwork with empty `artist_note`. Click "Draft with AI". Expect:
- Button shows "Drafting…" briefly.
- Location / Year / Artist note fields populate.
- If model flagged low confidence, a pill appears next to the button.

- [ ] **Step 4: Bulk AI-draft**

Back on the list page, the "AI-draft N empty" button shows the empty count and becomes "Drafting X/N…" while running. At the end, the page reloads; the count decreases.

- [ ] **Step 5: Bulk apply template**

The "Apply full template to N empty" button shows artworks with zero variants. Click it; variant counts update after the reload. Re-clicking shows "0 empty" and is disabled.

- [ ] **Step 6: Failure path**

Pick an artwork, rename its `image_web_url` to an invalid value temporarily (or unset `ANTHROPIC_API_KEY`), click "Draft with AI". Confirm an error message appears inline and the UI recovers.

- [ ] **Step 7: Kill dev server + verify clean**

```bash
git status
```

Expected: clean tree. 7 new commits on top of Spec 1.

---

## Exit criteria

- `npm run typecheck` passes.
- Detail page "Draft with AI" button populates empty fields on happy path, shows error inline on failure, shows low-confidence pill when applicable.
- List page counts empty-metadata and empty-variant rows correctly, iterates over them on click, reloads at the end.
- 7 commits on the branch.
