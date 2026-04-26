# Print Master As Source of Truth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a bulk uploader at `/admin/artworks/bulk-upload` that adds print masters to existing artworks, creates new draft artworks from masters, and demotes any currently-published-but-missing-master artworks. Enforce the invariant that `published` requires `image_print_url`. Derive the web display image from the print master at upload time.

**Architecture:** Browser presigns to a transient `incoming/<uuid>` key in R2 private; PUTs directly to R2 (file bytes never traverse Vercel). A finalize endpoint then streams the staged file from R2 through `sharp` to emit a 2000px sRGB JPEG into R2 public, copies the master to its canonical `artworks-print/<col>/<slug>.<ext>` key, deletes the staging blob, and writes both URLs to the artwork row. For new uploads the same finalize call inserts the artwork row and runs `lib/ai-draft.ts` (existing pipeline) to fill title and artist_note before commit.

**Tech Stack:** Next.js 16 App Router, TypeScript, Postgres via `pg`, R2 via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, `sharp` for image derivation (new dep), `@anthropic-ai/sdk` (already installed) for AI-draft, Vitest for unit tests.

**Spec:** [`docs/superpowers/specs/2026-04-26-print-master-required-design.md`](../specs/2026-04-26-print-master-required-design.md)

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| **Create** | `lib/image-derive.ts` | Stream a buffer/stream through `sharp` to produce a 2000px sRGB JPEG. Pure I/O-free function modulo sharp. |
| **Modify** | `lib/r2.ts` | Add `signedPrivateUploadUrl` (presigned PUT) and `copyAndDeletePrivate` (staging→canonical move). |
| **Create** | `app/api/admin/artworks/bulk-upload/presign/route.ts` | POST: validate, generate `incoming/<uuid>` key, return presigned PUT URL. |
| **Create** | `app/api/admin/artworks/bulk-upload/finalize/route.ts` | POST: stream from R2, derive web JPEG, copy master to canonical key, write artwork row (update or insert + AI-draft). |
| **Create** | `app/api/admin/artworks/bulk-upload/cleanup-orphans/route.ts` | POST: demote published artworks with no master to draft. |
| **Modify** | `app/api/admin/artworks/[id]/route.ts` | PATCH: reject status=published when image_print_url is null. |
| **Modify** | `app/admin/artworks/[id]/page.tsx` | Disable Publish action with explanatory tooltip when no master. |
| **Create** | `app/admin/artworks/bulk-upload/page.tsx` | Three-section client component (existing artworks, new artworks, cleanup). |
| **Modify** | `app/admin/artworks/page.tsx` | Add "Bulk upload" topbar action linking to the new page. |
| **Modify** | `app/admin/admin.css` | Add layout styles for the new page (drop zone, row states). |
| **Create** | `scripts/demote-orphan-publishes.ts` | CLI mirror of cleanup-orphans for shell use. |
| **Create** | `scripts/cleanup-staged.ts` | CLI: reap `incoming/*` older than 24h. |
| **Create** | `tests/lib/image-derive.test.ts` | Vitest unit tests for image derivation. |
| **Modify** | `package.json` | Add `sharp` dependency. |

---

## Task 1: Add sharp dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install sharp**

```bash
npm install sharp
```

Expected: `package.json` and `package-lock.json` updated. `sharp` appears under `dependencies`.

- [ ] **Step 2: Verify install**

```bash
npm run typecheck
```

Expected: PASS (no output means success — `tsc --noEmit` is silent on success).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add sharp for server-side image derivation"
```

---

## Task 2: Build lib/image-derive.ts with TDD

**Files:**
- Create: `tests/lib/image-derive.test.ts`
- Create: `lib/image-derive.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/image-derive.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { deriveWebFromPrint } from '@/lib/image-derive';

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 64, g: 96, b: 32 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe('deriveWebFromPrint', () => {
  it('resizes to 2000px on long edge for landscape input', async () => {
    const input = await makeJpeg(4000, 3000);
    const out = await deriveWebFromPrint(input);
    expect(out.contentType).toBe('image/jpeg');
    const meta = await sharp(out.buf).metadata();
    expect(meta.width).toBe(2000);
    expect(meta.height).toBe(1500);
  });

  it('resizes to 2000px on long edge for portrait input', async () => {
    const input = await makeJpeg(3000, 4000);
    const out = await deriveWebFromPrint(input);
    const meta = await sharp(out.buf).metadata();
    expect(meta.width).toBe(1500);
    expect(meta.height).toBe(2000);
  });

  it('does not upscale a small input', async () => {
    const input = await makeJpeg(800, 600);
    const out = await deriveWebFromPrint(input);
    const meta = await sharp(out.buf).metadata();
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
  });

  it('strips ICC profile and arbitrary EXIF', async () => {
    const input = await sharp({
      create: { width: 1000, height: 1000, channels: 3, background: '#888' },
    })
      .withMetadata({ icc: 'sRGB' })
      .jpeg()
      .toBuffer();
    const out = await deriveWebFromPrint(input);
    const meta = await sharp(out.buf).metadata();
    // No ICC profile means sharp returns no `icc` field.
    expect(meta.icc).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/lib/image-derive.test.ts
```

Expected: FAIL with `Cannot find module '@/lib/image-derive'` or similar.

- [ ] **Step 3: Implement deriveWebFromPrint**

Create `lib/image-derive.ts`:

```ts
import sharp from 'sharp';

export interface DerivedImage {
  buf: Buffer;
  contentType: 'image/jpeg';
}

const MAX_LONG_EDGE = 2000;
const JPEG_QUALITY = 85;

/**
 * Resize a print master to a web-tier JPEG. The long edge is capped at
 * MAX_LONG_EDGE without upscaling smaller inputs. ICC and arbitrary EXIF
 * are stripped; sRGB is forced. Sharp auto-rotates per the orientation tag
 * before stripping.
 */
export async function deriveWebFromPrint(
  source: Buffer | NodeJS.ReadableStream,
): Promise<DerivedImage> {
  const buf = await sharp(source)
    .rotate() // auto-orient based on EXIF orientation, then strip
    .resize({
      width: MAX_LONG_EDGE,
      height: MAX_LONG_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .toColorspace('srgb')
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  return { buf, contentType: 'image/jpeg' };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/lib/image-derive.test.ts
```

Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/image-derive.ts tests/lib/image-derive.test.ts
git commit -m "feat: lib/image-derive — sharp-based 2000px sRGB JPEG derivation"
```

---

## Task 3: Add R2 helpers (presigned PUT + copy-and-delete)

**Files:**
- Modify: `lib/r2.ts:1-78`

- [ ] **Step 1: Add imports for new commands**

In `lib/r2.ts`, change line 1 from:

```ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
```

to:

```ts
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
```

- [ ] **Step 2: Add the new helpers**

In `lib/r2.ts`, also update the imports to add `ListObjectsV2Command`:

```ts
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
```

Append to `lib/r2.ts` (after the existing `signedPrivateUrl` function):

```ts
export async function signedPrivateUploadUrl(
  key: string,
  contentType: string,
  expiresInSec = 900,
): Promise<string> {
  const c = client();
  return getSignedUrl(
    c,
    new PutObjectCommand({
      Bucket: privateBucket(),
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: expiresInSec },
  );
}

export async function copyAndDeletePrivate(
  srcKey: string,
  dstKey: string,
): Promise<void> {
  const c = client();
  const bucket = privateBucket();
  await c.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: dstKey,
      CopySource: `${bucket}/${encodeURIComponent(srcKey)}`,
    }),
  );
  await c.send(new DeleteObjectCommand({ Bucket: bucket, Key: srcKey }));
}

export async function getPrivateBuffer(key: string): Promise<Buffer> {
  const c = client();
  const res = await c.send(
    new GetObjectCommand({ Bucket: privateBucket(), Key: key }),
  );
  if (!res.Body) throw new Error(`r2 get: empty body for ${key}`);
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function deletePrivate(key: string): Promise<void> {
  const c = client();
  await c.send(new DeleteObjectCommand({ Bucket: privateBucket(), Key: key }));
}

export async function deletePublic(key: string): Promise<void> {
  const c = client();
  await c.send(new DeleteObjectCommand({ Bucket: publicBucket(), Key: key }));
}

export async function listPrivatePrefix(
  prefix: string,
): Promise<Array<{ key: string; lastModified: Date | null; size: number }>> {
  const c = client();
  const out: Array<{ key: string; lastModified: Date | null; size: number }> = [];
  let continuationToken: string | undefined;
  do {
    const res = await c.send(
      new ListObjectsV2Command({
        Bucket: privateBucket(),
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (!obj.Key) continue;
      out.push({
        key: obj.Key,
        lastModified: obj.LastModified ?? null,
        size: obj.Size ?? 0,
      });
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);
  return out;
}
```

- [ ] **Step 3: Verify it compiles**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/r2.ts
git commit -m "feat: lib/r2 — presigned PUT, copy-and-delete, deletes, list-prefix"
```

---

## Task 4: Build the presign endpoint

**Files:**
- Create: `app/api/admin/artworks/bulk-upload/presign/route.ts`

- [ ] **Step 1: Create the file**

```ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { requireAdmin } from '@/lib/session';
import { signedPrivateUploadUrl } from '@/lib/r2';

const MAX_SIZE = 500 * 1024 * 1024; // 500 MB

const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/tiff': 'tif',
};

const Body = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(64),
  size: z.number().int().positive(),
});

export async function POST(req: Request) {
  await requireAdmin();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const { contentType, size } = parsed.data;
  const ext = ALLOWED_MIME[contentType];
  if (!ext) {
    return NextResponse.json(
      { error: 'unsupported content type (jpeg/png/tiff only)' },
      { status: 415 },
    );
  }
  if (size > MAX_SIZE) {
    return NextResponse.json(
      { error: `file too large (max ${Math.floor(MAX_SIZE / 1024 / 1024)}MB)` },
      { status: 413 },
    );
  }

  // Server-generated key — client never dictates the staging path.
  const key = `incoming/${uuidv4()}.${ext}`;
  const url = await signedPrivateUploadUrl(key, contentType, 900);
  return NextResponse.json({
    key,
    url,
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
  });
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/artworks/bulk-upload/presign/route.ts
git commit -m "feat: bulk-upload/presign — issue presigned PUT for incoming/<uuid>"
```

---

## Task 5: Build the finalize endpoint

**Files:**
- Create: `app/api/admin/artworks/bulk-upload/finalize/route.ts`

- [ ] **Step 1: Create the file**

```ts
export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fileTypeFromBuffer } from 'file-type';
import { pool, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import {
  getPrivateBuffer,
  uploadPublic,
  copyAndDeletePrivate,
  deletePrivate,
  deletePublic,
} from '@/lib/r2';
import { deriveWebFromPrint } from '@/lib/image-derive';
import { slugify, uniqueSlug } from '@/lib/slug';
import { draftArtworkMetadata } from '@/lib/ai-draft';
import { readExifFromBuffer } from '@/lib/exif';
import { logger } from '@/lib/logger';

const STAGED_RX = /^incoming\/[0-9a-f-]{36}\.(jpg|jpeg|png|tif|tiff)$/i;
const PRINT_ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/tiff']);

const Body = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('update'),
    artworkId: z.number().int().positive(),
    stagedKey: z.string().regex(STAGED_RX),
  }),
  z.object({
    mode: z.literal('create'),
    stagedKey: z.string().regex(STAGED_RX),
    collectionId: z.number().int().positive().nullable(),
  }),
]);

interface ArtworkRow {
  id: number;
  slug: string;
  collection_id: number | null;
  collection_slug: string | null;
}

async function loadArtwork(id: number): Promise<ArtworkRow | null> {
  const r = await pool.query<ArtworkRow>(
    `SELECT a.id, a.slug, a.collection_id, c.slug AS collection_slug
     FROM artworks a LEFT JOIN collections c ON c.id = a.collection_id
     WHERE a.id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

async function loadCollection(id: number | null): Promise<string | null> {
  if (id == null) return null;
  const r = await pool.query<{ slug: string }>(
    'SELECT slug FROM collections WHERE id = $1',
    [id],
  );
  return r.rows[0]?.slug ?? null;
}

function printExtFromMime(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/tiff') return 'tif';
  return 'jpg';
}

export async function POST(req: Request) {
  await requireAdmin();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const input = parsed.data;

  // 1. Read the staged file from R2 once.
  let masterBuf: Buffer;
  try {
    masterBuf = await getPrivateBuffer(input.stagedKey);
  } catch (err) {
    logger.error('finalize: staged file unreadable', err, {
      stagedKey: input.stagedKey,
    });
    return NextResponse.json(
      { error: 'staged file not found or unreadable' },
      { status: 404 },
    );
  }

  // 2. Sniff the actual mime — never trust the contentType from presign.
  const sniff = await fileTypeFromBuffer(masterBuf);
  if (!sniff || !PRINT_ALLOWED_MIMES.has(sniff.mime)) {
    await deletePrivate(input.stagedKey).catch(() => {});
    return NextResponse.json(
      { error: 'unsupported file format (jpeg/png/tiff only)' },
      { status: 415 },
    );
  }
  const printExt = printExtFromMime(sniff.mime);

  // 3. Derive the web image. Failures here are unrecoverable for this file.
  let derived;
  try {
    derived = await deriveWebFromPrint(masterBuf);
  } catch (err) {
    logger.error('finalize: derive failed', err, {
      stagedKey: input.stagedKey,
      mime: sniff.mime,
    });
    await deletePrivate(input.stagedKey).catch(() => {});
    return NextResponse.json(
      {
        error:
          "couldn't process this format — please export as standard JPEG or TIFF",
      },
      { status: 415 },
    );
  }

  // 4. Resolve target slug + collection folder for the canonical keys.
  let artworkId: number;
  let slug: string;
  let collectionFolder: string;

  if (input.mode === 'update') {
    const a = await loadArtwork(input.artworkId);
    if (!a) {
      await deletePrivate(input.stagedKey).catch(() => {});
      return NextResponse.json({ error: 'artwork not found' }, { status: 404 });
    }
    artworkId = a.id;
    slug = a.slug;
    collectionFolder = a.collection_slug || (a.collection_id ? String(a.collection_id) : 'misc');
  } else {
    // CREATE: AI-draft a title first; we need the slug before we can store
    // either file at its canonical key. AI-draft requires a public URL;
    // upload the web tier to a temporary public key keyed by the staging
    // uuid so it's reachable, then move/overwrite once we have the slug.
    const stagedUuid = input.stagedKey.split('/')[1].split('.')[0];
    const tempWebKey = `incoming/${stagedUuid}.jpg`;
    const tempWebUrl = await uploadPublic(tempWebKey, derived.buf, derived.contentType);

    const collectionSlug = await loadCollection(input.collectionId);
    let title = `Untitled ${new Date().toISOString().slice(0, 10)}`;
    let artistNote: string | null = null;
    let location: string | null = null;
    let yearShot: number | null = null;
    try {
      const exif = await readExifFromBuffer(masterBuf);
      yearShot = exif.year_shot;
      const draft = await draftArtworkMetadata({
        imageUrl: tempWebUrl,
        collectionSlug,
        gps: exif.gps,
      });
      title = draft.title;
      artistNote = draft.artist_note;
      location = draft.location;
    } catch (err) {
      // Log but proceed with the placeholder title — the user can edit later.
      logger.warn('finalize create: ai-draft failed; falling back to placeholder', { err });
    }

    const taken = new Set<string>(
      (await pool.query<{ slug: string }>('SELECT slug FROM artworks')).rows.map(
        (r) => r.slug,
      ),
    );
    slug = uniqueSlug(slugify(title) || 'untitled', taken);
    collectionFolder = collectionSlug || (input.collectionId ? String(input.collectionId) : 'misc');

    // Insert the artwork row before moving files so a slug collision
    // (race on uniqueSlug) fails before any object moves.
    const r = await pool.query<{ id: number }>(
      `INSERT INTO artworks
         (collection_id, slug, title, artist_note, location, year_shot,
          image_web_url, image_print_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, '', '', 'draft')
       RETURNING id`,
      [input.collectionId, slug, title, artistNote, location, yearShot],
    );
    artworkId = r.rows[0].id;

    // Clean up the temp web key — we'll write the canonical one below.
    // (Object stays public until we delete; tiny window, acceptable.)
    try {
      await deletePublic(tempWebKey);
    } catch {
      /* fall through — orphan reaping handles it */
    }
  }

  // 5. Upload the derived web image at its canonical key.
  const webKey = `artworks/${collectionFolder}/${slug}.jpg`;
  const webUrl = await uploadPublic(webKey, derived.buf, derived.contentType);

  // 6. Move the master from incoming/ to its canonical key.
  const printKey = `artworks-print/${collectionFolder}/${slug}.${printExt}`;
  await copyAndDeletePrivate(input.stagedKey, printKey);

  // 7. Record the URLs on the artwork row.
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE artworks
       SET image_web_url = $1, image_print_url = $2, updated_at = NOW()
       WHERE id = $3`,
      [webUrl, printKey, artworkId],
    );
  });

  return NextResponse.json({
    artworkId,
    slug,
    image_web_url: webUrl,
    image_print_url: printKey,
  });
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/artworks/bulk-upload/finalize/route.ts
git commit -m "feat: bulk-upload/finalize — derive web, copy master, write artwork row"
```

---

## Task 6: Add publish-requires-master gate to PATCH and bulk routes

**Files:**
- Modify: `app/api/admin/artworks/[id]/route.ts:72-104`
- Modify: `app/api/admin/artworks/route.ts:60-64` (bulk publish branch)

- [ ] **Step 1: Update the PATCH handler**

In `app/api/admin/artworks/[id]/route.ts`, find the block beginning at line 72 (`await withTransaction(async (client) => {`) and replace it with:

```ts
  // Reject status='published' if the artwork has no print master. The
  // invariant: nothing publishable without a master. This closes off the
  // prior "publish first, fulfill later" path that the Stripe webhook had
  // to compensate for.
  if (d.status === 'published') {
    const cur = await pool.query<{ image_print_url: string | null }>(
      'SELECT image_print_url FROM artworks WHERE id = $1',
      [id],
    );
    if (!cur.rowCount) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    if (!cur.rows[0].image_print_url) {
      return NextResponse.json(
        { error: 'cannot publish: print master required' },
        { status: 409 },
      );
    }
  }

  await withTransaction(async (client) => {
```

(Insert the new block immediately before the existing `await withTransaction` line; everything inside the transaction stays the same.)

- [ ] **Step 2: Update the bulk publish branch**

In `app/api/admin/artworks/route.ts`, find the `if (action === 'publish')` block (around line 60) and replace it with:

```ts
  if (action === 'publish') {
    // Same invariant as the per-artwork PATCH: never publish artworks
    // missing a master. Filter inside the WHERE so the response can
    // honestly report how many were skipped.
    const u = await pool.query(
      `UPDATE artworks
       SET status='published', updated_at=NOW()
       WHERE id = ANY($1) AND image_print_url IS NOT NULL`,
      [ids],
    );
    return NextResponse.json({
      ok: true,
      published: u.rowCount ?? 0,
      skipped: ids.length - (u.rowCount ?? 0),
    });
  } else if (action === 'retire') {
```

(Replace from `if (action === 'publish')` through the original closing of that branch — the `else if (action === 'retire')` line is the marker for where the new code ends.)

- [ ] **Step 3: Verify it compiles**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Manual verify**

Start dev server in a separate shell (`set -a; source .env.local; set +a; npm run dev`).

Pick an existing artwork id with `image_print_url IS NULL`. Try to publish it via curl:

```bash
curl -s -X PATCH http://localhost:3000/api/admin/artworks/<id> \
  -b "wl_admin=<your-admin-cookie>" \
  -H "Content-Type: application/json" \
  -d '{"status":"published"}' | python -m json.tool
```

Expected: `{"error": "cannot publish: print master required"}` with HTTP 409.

Try the bulk path with the same artwork:

```bash
curl -s -X POST http://localhost:3000/api/admin/artworks \
  -b "wl_admin=<your-admin-cookie>" \
  -H "Content-Type: application/json" \
  -d '{"ids":[<id>],"action":"publish"}' | python -m json.tool
```

Expected: `{"ok": true, "published": 0, "skipped": 1}` — silently skipped, not erroring (matches existing bulk semantics).

For an artwork that does have a master, both calls should publish it normally.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/artworks/[id]/route.ts app/api/admin/artworks/route.ts
git commit -m "feat: artworks publish gate — single + bulk routes both require master"
```

---

## Task 7: Disable Publish action in admin UI when no master

**Files:**
- Modify: `app/admin/artworks/[id]/page.tsx`

- [ ] **Step 1: Find the publish action**

In `app/admin/artworks/[id]/page.tsx`, locate where the status field is rendered (search for `'published'` and `status` references — the page uses `AdminPill` and likely an inline status changer).

- [ ] **Step 2: Add a guard around the status control**

Wherever the status `<select>` or status-change action lives, wrap the "Publish" option / button with a disabled state when `data.artwork.image_print_url` is null. Add a tooltip that explains why. Example pattern:

```tsx
{!data.artwork.image_print_url && (
  <p className="wl-admin-hint" style={{ marginTop: 8, color: 'var(--admin-warn)' }}>
    Upload a print master before publishing.
  </p>
)}
```

If a `<select>` lists statuses, set `disabled` on the `<option value="published">` element when `!data.artwork.image_print_url`.

- [ ] **Step 3: Verify it compiles**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Manual verify**

Reload `/admin/artworks/<id>` for an artwork with no master. Confirm the hint is visible and the Publish control is disabled. For an artwork with a master, confirm it works as before.

- [ ] **Step 5: Commit**

```bash
git add app/admin/artworks/[id]/page.tsx
git commit -m "feat: admin disables publish action when print master is missing"
```

---

## Task 8: Build cleanup-orphans endpoint

**Files:**
- Create: `app/api/admin/artworks/bulk-upload/cleanup-orphans/route.ts`

- [ ] **Step 1: Create the file**

```ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export async function GET() {
  await requireAdmin();
  const r = await pool.query<{ id: number; slug: string; title: string }>(
    `SELECT id, slug, title FROM artworks
     WHERE status = 'published' AND image_print_url IS NULL
     ORDER BY id`,
  );
  return NextResponse.json({ count: r.rowCount, rows: r.rows });
}

export async function POST() {
  await requireAdmin();
  const r = await pool.query<{ slug: string }>(
    `UPDATE artworks
     SET status = 'draft', updated_at = NOW()
     WHERE status = 'published' AND image_print_url IS NULL
     RETURNING slug`,
  );
  return NextResponse.json({
    demoted: r.rowCount ?? 0,
    slugs: r.rows.map((row) => row.slug),
  });
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/artworks/bulk-upload/cleanup-orphans/route.ts
git commit -m "feat: bulk-upload/cleanup-orphans — list + demote published-without-master"
```

---

## Task 9: Build the demote-orphan-publishes script

**Files:**
- Create: `scripts/demote-orphan-publishes.ts`
- Modify: `package.json` (add script entry)

- [ ] **Step 1: Create the script**

```ts
import { pool } from '@/lib/db';

async function main() {
  const apply = process.argv.includes('--apply');

  const r = await pool.query<{ id: number; slug: string; title: string }>(
    `SELECT id, slug, title FROM artworks
     WHERE status = 'published' AND image_print_url IS NULL
     ORDER BY id`,
  );

  if (!r.rowCount) {
    console.log('No published artworks are missing a print master.');
    await pool.end();
    return;
  }

  console.log(`Found ${r.rowCount} published artwork(s) without a print master:`);
  for (const row of r.rows) {
    console.log(`  - id=${row.id}  slug=${row.slug}  "${row.title}"`);
  }

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to demote them to draft.');
    await pool.end();
    return;
  }

  const u = await pool.query<{ slug: string }>(
    `UPDATE artworks
     SET status = 'draft', updated_at = NOW()
     WHERE status = 'published' AND image_print_url IS NULL
     RETURNING slug`,
  );
  console.log(`\nDemoted ${u.rowCount ?? 0} artwork(s).`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json` (under `"scripts"`), add:

```json
    "demote:orphans": "tsx scripts/demote-orphan-publishes.ts",
```

- [ ] **Step 3: Manual verify (dry run)**

```bash
set -a; source .env.local; set +a
npm run demote:orphans
```

Expected: lists the orphan-published artworks (or "No published artworks…"). Does **not** apply.

- [ ] **Step 4: Commit**

```bash
git add scripts/demote-orphan-publishes.ts package.json
git commit -m "feat: scripts/demote-orphan-publishes — CLI mirror of cleanup endpoint"
```

---

## Task 10: Build the cleanup-staged script

**Files:**
- Create: `scripts/cleanup-staged.ts`
- Modify: `package.json` (add script entry)

- [ ] **Step 1: Create the script**

```ts
import { listPrivatePrefix, deletePrivate } from '@/lib/r2';

const MAX_AGE_HOURS = 24;

async function main() {
  const apply = process.argv.includes('--apply');
  const cutoff = Date.now() - MAX_AGE_HOURS * 3600 * 1000;

  const items = await listPrivatePrefix('incoming/');
  const stale = items.filter((it) => {
    const ts = it.lastModified?.getTime() ?? 0;
    return ts > 0 && ts < cutoff;
  });

  if (!stale.length) {
    console.log(`No staged objects older than ${MAX_AGE_HOURS}h.`);
    return;
  }

  console.log(`Found ${stale.length} stale staging object(s):`);
  for (const it of stale) {
    const ageH = Math.floor((Date.now() - (it.lastModified?.getTime() ?? 0)) / 3600 / 1000);
    console.log(`  - ${it.key}  ${(it.size / 1024 / 1024).toFixed(1)}MB  ${ageH}h old`);
  }

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to delete them.');
    return;
  }

  let n = 0;
  for (const it of stale) {
    try {
      await deletePrivate(it.key);
      n++;
    } catch (err) {
      console.warn(`failed to delete ${it.key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`\nDeleted ${n} of ${stale.length} stale staging object(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json` (under `"scripts"`), add:

```json
    "cleanup:staged": "tsx scripts/cleanup-staged.ts",
```

- [ ] **Step 3: Manual verify (dry run)**

```bash
set -a; source .env.local; set +a
npm run cleanup:staged
```

Expected: lists stale incoming/ objects (or "No staged objects…"). Does **not** apply.

- [ ] **Step 4: Commit**

```bash
git add scripts/cleanup-staged.ts package.json
git commit -m "feat: scripts/cleanup-staged — reap incoming/ R2 keys older than 24h"
```

---

## Task 11: Build bulk-upload page scaffolding + Section A

**Files:**
- Create: `app/admin/artworks/bulk-upload/page.tsx`
- Modify: `app/admin/admin.css` (append CSS for the new page)

- [ ] **Step 1: Create the page with Section A only**

```tsx
'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminTopBar } from '@/components/admin/AdminTopBar';

interface NeedsRow {
  id: number;
  slug: string;
  title: string;
  status: string;
  image_web_url: string | null;
  collection_title: string | null;
}

type RowState =
  | { kind: 'idle' }
  | { kind: 'uploading'; pct: number }
  | { kind: 'processing' }
  | { kind: 'done'; webUrl: string }
  | { kind: 'error'; message: string };

async function presign(
  filename: string,
  contentType: string,
  size: number,
): Promise<{ key: string; url: string }> {
  const r = await fetch('/api/admin/artworks/bulk-upload/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, contentType, size }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `presign ${r.status}`);
  return r.json();
}

function putWithProgress(
  url: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`PUT ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('PUT network error'));
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.send(file);
  });
}

async function finalizeUpdate(
  artworkId: number,
  stagedKey: string,
): Promise<{ image_web_url: string }> {
  const r = await fetch('/api/admin/artworks/bulk-upload/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'update', artworkId, stagedKey }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `finalize ${r.status}`);
  return r.json();
}

export default function BulkUploadPage() {
  const [rows, setRows] = useState<NeedsRow[]>([]);
  const [states, setStates] = useState<Record<number, RowState>>({});
  const [hideDone, setHideDone] = useState(false);

  const reload = useCallback(async () => {
    const r = await fetch('/api/admin/artworks?needs_print=1');
    const d = (await r.json()) as { rows: NeedsRow[] };
    setRows(d.rows);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setRowState = useCallback((id: number, s: RowState) => {
    setStates((prev) => ({ ...prev, [id]: s }));
  }, []);

  // Beforeunload guard while uploads are in flight.
  useEffect(() => {
    const inFlight = Object.values(states).some(
      (s) => s.kind === 'uploading' || s.kind === 'processing',
    );
    if (!inFlight) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [states]);

  async function uploadOne(row: NeedsRow, file: File) {
    setRowState(row.id, { kind: 'uploading', pct: 0 });
    try {
      const { key, url } = await presign(file.name, file.type, file.size);
      await putWithProgress(url, file, (pct) =>
        setRowState(row.id, { kind: 'uploading', pct }),
      );
      setRowState(row.id, { kind: 'processing' });
      const res = await finalizeUpdate(row.id, key);
      setRowState(row.id, { kind: 'done', webUrl: res.image_web_url });
    } catch (err) {
      setRowState(row.id, {
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const visibleRows = hideDone
    ? rows.filter((r) => states[r.id]?.kind !== 'done')
    : rows;

  return (
    <div className="wl-admin-page">
      <AdminTopBar
        title="Bulk upload"
        subtitle="Add print masters, create new artworks, clean up orphans"
      />

      <section className="wl-admin-card wl-bulk-section">
        <header className="wl-bulk-section-header">
          <h2>
            Print masters needed{' '}
            <span className="wl-bulk-count">({rows.length})</span>
          </h2>
          <label className="wl-bulk-toggle">
            <input
              type="checkbox"
              checked={hideDone}
              onChange={(e) => setHideDone(e.target.checked)}
            />
            Hide artworks already in this batch
          </label>
        </header>

        {!rows.length && <p className="wl-admin-empty">No artworks need a print master.</p>}

        <ul className="wl-bulk-rows">
          {visibleRows.map((row) => (
            <BulkRow key={row.id} row={row} state={states[row.id] || { kind: 'idle' }} onPick={uploadOne} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function BulkRow({
  row,
  state,
  onPick,
}: {
  row: NeedsRow;
  state: RowState;
  onPick: (row: NeedsRow, file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <li className="wl-bulk-row" data-state={state.kind}>
      <div className="wl-bulk-row-thumb">
        {row.image_web_url ? (
          <Image src={row.image_web_url} alt="" width={48} height={48} unoptimized />
        ) : (
          <div className="wl-bulk-row-thumb-placeholder">—</div>
        )}
      </div>
      <div className="wl-bulk-row-meta">
        <div className="wl-bulk-row-title">{row.title}</div>
        <div className="wl-bulk-row-sub">
          {row.collection_title || 'no collection'} · {row.slug}
        </div>
      </div>
      <div className="wl-bulk-row-state">
        {state.kind === 'idle' && (
          <>
            <button
              className="wl-admin-btn"
              onClick={() => inputRef.current?.click()}
            >
              Choose file…
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/tiff"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPick(row, f);
                e.target.value = '';
              }}
            />
          </>
        )}
        {state.kind === 'uploading' && (
          <div className="wl-bulk-progress">
            <div className="wl-bulk-progress-bar" style={{ width: `${state.pct}%` }} />
            <span>{state.pct}%</span>
          </div>
        )}
        {state.kind === 'processing' && <span className="wl-bulk-processing">processing…</span>}
        {state.kind === 'done' && <span className="wl-bulk-done">✓ uploaded</span>}
        {state.kind === 'error' && (
          <button
            className="wl-admin-btn"
            onClick={() => inputRef.current?.click()}
            title={state.message}
          >
            Retry
          </button>
        )}
      </div>
    </li>
  );
}
```

- [ ] **Step 2: Extend the artworks list endpoint to accept `needs_print=1`**

Open `app/api/admin/artworks/route.ts` (the GET handler). Wherever the WHERE clause is built from query params, add a clause that filters to `image_print_url IS NULL` when the `needs_print` query param equals `1`. Search for the existing status filter and follow the same pattern. Example:

```ts
const needsPrint = url.searchParams.get('needs_print') === '1';
// ...
if (needsPrint) where.push('a.image_print_url IS NULL');
```

If the endpoint already returns `image_web_url`, `slug`, `title`, `status`, and `collection_title` (it does, per the existing list page), no extra fields are needed.

- [ ] **Step 3: Add CSS for the bulk-upload UI**

Append to `app/admin/admin.css`:

```css
/* ── bulk-upload page ─────────────────────────────────────── */
.wl-bulk-section { display: block; padding: 16px; }
.wl-bulk-section + .wl-bulk-section { margin-top: 16px; }
.wl-bulk-section-header {
  display: flex; align-items: baseline; justify-content: space-between;
  margin-bottom: 12px;
}
.wl-bulk-section-header h2 { margin: 0; font-size: 18px; font-weight: 600; }
.wl-bulk-count { color: var(--admin-muted); font-weight: 400; }
.wl-bulk-toggle { font-size: 12px; color: var(--admin-muted); display: flex; gap: 6px; align-items: center; }

.wl-bulk-rows { list-style: none; margin: 0; padding: 0; }
.wl-bulk-row {
  display: grid; grid-template-columns: 56px 1fr auto; gap: 12px;
  align-items: center; padding: 10px 8px; border-bottom: 1px solid var(--admin-rule);
}
.wl-bulk-row[data-state="done"] { opacity: 0.55; }
.wl-bulk-row[data-state="error"] { background: var(--admin-warn-bg, rgba(255,80,80,0.05)); }

.wl-bulk-row-thumb { width: 48px; height: 48px; overflow: hidden; border-radius: 4px; }
.wl-bulk-row-thumb-placeholder {
  width: 48px; height: 48px; background: var(--admin-rule); color: var(--admin-muted);
  display: grid; place-items: center; border-radius: 4px;
}
.wl-bulk-row-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.wl-bulk-row-title { font-weight: 500; }
.wl-bulk-row-sub { font-size: 12px; color: var(--admin-muted); }

.wl-bulk-row-state { min-width: 160px; text-align: right; }
.wl-bulk-progress { display: inline-flex; align-items: center; gap: 8px; }
.wl-bulk-progress-bar {
  height: 4px; background: var(--admin-accent); width: 0%;
  display: inline-block; min-width: 60px; max-width: 120px; transition: width 0.2s;
}
.wl-bulk-processing { font-size: 12px; color: var(--admin-muted); font-style: italic; }
.wl-bulk-done { font-size: 13px; color: var(--admin-accent); }
```

- [ ] **Step 4: Verify it compiles**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Manual smoke test**

Visit `/admin/artworks/bulk-upload` in dev. Confirm:
- The "Print masters needed" section lists artworks without `image_print_url`.
- Click `Choose file…` on one row → pick a JPEG → progress bar advances → ✓ uploaded.
- Refresh `/admin/artworks` → that artwork now shows it has a print file.

- [ ] **Step 6: Commit**

```bash
git add app/admin/artworks/bulk-upload/page.tsx app/admin/admin.css app/api/admin/artworks/route.ts
git commit -m "feat: bulk-upload page Section A — masters for existing artworks"
```

---

## Task 12: Add Section B — drop zone for new artworks

**Files:**
- Modify: `app/admin/artworks/bulk-upload/page.tsx`

- [ ] **Step 1: Add a finalize-create helper at the top of the file**

After the `finalizeUpdate` function, add:

```ts
async function finalizeCreate(
  stagedKey: string,
  collectionId: number | null,
): Promise<{ artworkId: number; slug: string; image_web_url: string }> {
  const r = await fetch('/api/admin/artworks/bulk-upload/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'create', stagedKey, collectionId }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `finalize ${r.status}`);
  return r.json();
}
```

- [ ] **Step 2: Add Section B state + UI to the component**

Inside `BulkUploadPage`, after the existing state, add:

```tsx
  const [collections, setCollections] = useState<Array<{ id: number; title: string }>>([]);
  const [defaultCollection, setDefaultCollection] = useState<number | null>(null);
  const [created, setCreated] = useState<
    Array<
      | { kind: 'uploading'; tempId: string; filename: string; pct: number }
      | { kind: 'processing'; tempId: string; filename: string }
      | { kind: 'done'; tempId: string; filename: string; artworkId: number; slug: string; title: string }
      | { kind: 'error'; tempId: string; filename: string; message: string }
    >
  >([]);

  useEffect(() => {
    void (async () => {
      const r = await fetch('/api/admin/collections');
      const d = (await r.json()) as { rows: Array<{ id: number; title: string }> };
      setCollections(d.rows.map((c) => ({ id: c.id, title: c.title })));
      // The endpoint orders by display_order, id; the first row is the
      // primary/default collection. Falls back to none if the catalog is empty.
      if (d.rows.length) setDefaultCollection(d.rows[0].id);
    })();
  }, []);

  async function uploadNew(file: File) {
    const tempId = crypto.randomUUID();
    setCreated((prev) => [
      ...prev,
      { kind: 'uploading', tempId, filename: file.name, pct: 0 },
    ]);
    const update = (
      next:
        | { kind: 'uploading'; tempId: string; filename: string; pct: number }
        | { kind: 'processing'; tempId: string; filename: string }
        | { kind: 'done'; tempId: string; filename: string; artworkId: number; slug: string; title: string }
        | { kind: 'error'; tempId: string; filename: string; message: string },
    ) => {
      setCreated((prev) => prev.map((p) => (p.tempId === tempId ? next : p)));
    };
    try {
      const { key, url } = await presign(file.name, file.type, file.size);
      await putWithProgress(url, file, (pct) =>
        update({ kind: 'uploading', tempId, filename: file.name, pct }),
      );
      update({ kind: 'processing', tempId, filename: file.name });
      const res = await finalizeCreate(key, defaultCollection);
      // Pull the title back so we can show it.
      const t = await fetch(`/api/admin/artworks/${res.artworkId}`)
        .then((r) => r.json())
        .then((d: { artwork: { title: string } }) => d.artwork.title)
        .catch(() => '');
      update({
        kind: 'done',
        tempId,
        filename: file.name,
        artworkId: res.artworkId,
        slug: res.slug,
        title: t || res.slug,
      });
      // Refresh the existing-artworks list so the new one appears in needs-print
      // until a master is set (it has been, but reload keeps state honest).
      void reload();
    } catch (err) {
      update({
        kind: 'error',
        tempId,
        filename: file.name,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    files.forEach(uploadNew);
  }
  const browseRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 3: Render Section B**

Just after the closing `</section>` of Section A in the JSX, add:

```tsx
      <section className="wl-admin-card wl-bulk-section">
        <header className="wl-bulk-section-header">
          <h2>Add new artworks</h2>
          <label className="wl-bulk-toggle">
            Default collection:
            <select
              value={defaultCollection ?? ''}
              onChange={(e) =>
                setDefaultCollection(e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">(none)</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
        </header>

        <div
          className="wl-bulk-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => browseRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <p>Drop files here, or click to browse</p>
          <p className="wl-bulk-drop-sub">
            Each file becomes a new draft artwork — AI drafts the title and
            description on upload.
          </p>
          <input
            ref={browseRef}
            type="file"
            accept="image/jpeg,image/png,image/tiff"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              files.forEach(uploadNew);
              e.target.value = '';
            }}
          />
        </div>

        {created.length > 0 && (
          <ul className="wl-bulk-rows wl-bulk-created">
            {created.map((c) => (
              <li key={c.tempId} className="wl-bulk-row" data-state={c.kind}>
                <div className="wl-bulk-row-meta">
                  <div className="wl-bulk-row-title">{c.filename}</div>
                  <div className="wl-bulk-row-sub">
                    {c.kind === 'done' && (
                      <a href={`/admin/artworks/${c.artworkId}`}>
                        → "{c.title}" ({c.slug}) — review &amp; publish
                      </a>
                    )}
                    {c.kind === 'error' && c.message}
                  </div>
                </div>
                <div className="wl-bulk-row-state">
                  {c.kind === 'uploading' && (
                    <div className="wl-bulk-progress">
                      <div className="wl-bulk-progress-bar" style={{ width: `${c.pct}%` }} />
                      <span>{c.pct}%</span>
                    </div>
                  )}
                  {c.kind === 'processing' && <span className="wl-bulk-processing">processing…</span>}
                  {c.kind === 'done' && <span className="wl-bulk-done">✓ created</span>}
                  {c.kind === 'error' && <span className="wl-bulk-error">✗</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
```

- [ ] **Step 4: Add CSS for the drop zone**

Append to `app/admin/admin.css`:

```css
.wl-bulk-drop {
  border: 2px dashed var(--admin-rule);
  border-radius: 6px;
  padding: 32px;
  text-align: center;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.wl-bulk-drop:hover {
  background: var(--admin-rule);
  border-color: var(--admin-accent);
}
.wl-bulk-drop p { margin: 0; }
.wl-bulk-drop-sub { font-size: 12px; color: var(--admin-muted); margin-top: 6px !important; }
.wl-bulk-error { color: var(--admin-warn, #c44); }
```

- [ ] **Step 5: Verify it compiles**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Manual smoke test**

Drop a fresh JPEG into the new-artworks zone. Expected:
- Filename appears in the "Newly added" list with progress bar.
- After upload + processing, row shows the AI-drafted title and a link to the artwork detail page.
- New draft artwork appears in `/admin/artworks`.

- [ ] **Step 7: Commit**

```bash
git add app/admin/artworks/bulk-upload/page.tsx app/admin/admin.css
git commit -m "feat: bulk-upload Section B — drop new artworks, AI-drafted metadata"
```

---

## Task 13: Add Section C — cleanup orphans card

**Files:**
- Modify: `app/admin/artworks/bulk-upload/page.tsx`

- [ ] **Step 1: Add fetch + state + render**

Inside `BulkUploadPage`, add this state near the others:

```tsx
  const [orphanCount, setOrphanCount] = useState<number | null>(null);
  const [demoting, setDemoting] = useState(false);

  const reloadOrphans = useCallback(async () => {
    const r = await fetch('/api/admin/artworks/bulk-upload/cleanup-orphans');
    if (!r.ok) return;
    const d = (await r.json()) as { count: number };
    setOrphanCount(d.count);
  }, []);

  useEffect(() => {
    void reloadOrphans();
  }, [reloadOrphans]);

  async function demote() {
    if (!orphanCount) return;
    if (!confirm(`Demote ${orphanCount} artwork(s) to draft? They'll keep their slugs and metadata, but stop displaying publicly.`)) return;
    setDemoting(true);
    try {
      const r = await fetch('/api/admin/artworks/bulk-upload/cleanup-orphans', {
        method: 'POST',
      });
      if (!r.ok) throw new Error(`demote ${r.status}`);
      await reloadOrphans();
      void reload();
    } finally {
      setDemoting(false);
    }
  }
```

After Section B's `</section>`, add:

```tsx
      <section className="wl-admin-card wl-bulk-section">
        <header className="wl-bulk-section-header">
          <h2>Cleanup</h2>
        </header>
        {orphanCount === null ? (
          <p className="wl-admin-empty">Checking…</p>
        ) : orphanCount === 0 ? (
          <p className="wl-admin-empty">No published artworks are missing a master.</p>
        ) : (
          <div className="wl-bulk-cleanup">
            <p>
              <strong>{orphanCount}</strong> published artwork(s) have no print master.
            </p>
            <button
              className="wl-admin-btn wl-admin-btn-danger"
              onClick={demote}
              disabled={demoting}
            >
              {demoting ? 'Demoting…' : `Demote ${orphanCount} to draft`}
            </button>
          </div>
        )}
      </section>
```

- [ ] **Step 2: Append CSS**

```css
.wl-bulk-cleanup { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
```

- [ ] **Step 3: Verify it compiles**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Manual smoke test**

If at least one artwork is currently `published` with `image_print_url IS NULL` (likely true at start), the cleanup card shows a count + button. Click → confirm → page refreshes → count is 0.

- [ ] **Step 5: Commit**

```bash
git add app/admin/artworks/bulk-upload/page.tsx app/admin/admin.css
git commit -m "feat: bulk-upload Section C — demote published-without-master to draft"
```

---

## Task 14: Add "Bulk upload" topbar action on artworks index

**Files:**
- Modify: `app/admin/artworks/page.tsx`

- [ ] **Step 1: Find the existing topbar / "+ New artwork" CTA**

In `app/admin/artworks/page.tsx`, locate the JSX for the topbar (search `AdminTopBar`). It already renders a "+ New artwork" link. Add a sibling link `Bulk upload`.

Example pattern (adapt to actual prop shape):

```tsx
<AdminTopBar
  title="Artworks"
  subtitle="…"
  actions={
    <>
      <Link className="wl-admin-btn" href="/admin/artworks/bulk-upload">
        Bulk upload
      </Link>
      <Link className="wl-admin-btn wl-admin-btn-primary" href="/admin/artworks/new">
        + New artwork
      </Link>
    </>
  }
/>
```

If `AdminTopBar` doesn't take an `actions` slot, add the link in whichever slot is used for the existing "+ New artwork" CTA, immediately before it.

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Manual smoke test**

Visit `/admin/artworks`. Confirm the "Bulk upload" link is visible in the topbar and navigates to `/admin/artworks/bulk-upload`.

- [ ] **Step 4: Commit**

```bash
git add app/admin/artworks/page.tsx
git commit -m "feat: admin artworks index — link to bulk-upload page"
```

---

## Manual verification (full flow, after all tasks)

Per `CLAUDE.md`, anything touching R2 signing needs end-to-end verification.

1. **Section A — masters for existing artworks.** Pick an artwork with no master. Use the bulk-upload page to upload one. Verify: row goes idle → uploading → processing → done. Open `/admin/artworks/<id>` — the new web image displays, `image_print_url` is set. Open R2: master sits at `artworks-print/<col>/<slug>.<ext>`, web image at `artworks/<col>/<slug>.jpg`, no leftover at `incoming/`.
2. **Section B — new artwork.** Drop an unrelated JPEG into the drop zone. Verify: row appears, progresses, ends with link to a new draft artwork. Confirm the AI-drafted title and artist_note are populated. R2 has both files at canonical keys; no orphan in `incoming/` or in `artworks/incoming/`.
3. **Section C — cleanup.** With at least one currently-published artwork having no master, confirm the cleanup card shows the count. Click the button. Confirm: artwork's status flipped to draft; cleanup count is 0; `/admin/artworks` reflects the change.
4. **Publish gate.** From the artwork detail page, attempt to set status=published on an artwork with `image_print_url IS NULL`. Confirm: hint visible in UI, server returns 409 with the right message.
5. **Edge: bad TIFF.** Drop a corrupted/unsupported TIFF. Confirm: 415 returned, row shows the error message, `incoming/<uuid>` is reaped (or scheduled to reap by the cleanup script).
6. **Edge: leave page mid-upload.** Start an upload, try to navigate away. Confirm: browser warning fires.

---

## Self-Review Notes

Spec coverage check (each invariant/section/requirement → task):

- Schema invariant: `published` requires `image_print_url` → Task 6 (PATCH gate) + Task 7 (UI hint).
- Web derived from print → Task 2 (lib/image-derive) + Task 5 (finalize uses it).
- Bulk uploader page with three sections → Task 11 (A), Task 12 (B), Task 13 (C).
- `presign` endpoint → Task 4.
- `finalize` endpoint covering update + create modes → Task 5.
- `cleanup-orphans` endpoint → Task 8.
- `signedPrivateUploadUrl`, `copyAndDeletePrivate` → Task 3.
- `image-derive.ts` with sharp → Task 2.
- `demote-orphan-publishes` script → Task 9.
- `cleanup-staged` script → Task 10.
- Topbar link → Task 14.
- Vitest unit tests for image-derive → Task 2.
- AI-draft integration on create → Task 5 (uses existing `lib/ai-draft.ts`).
- Edge cases (mid-upload close, finalize R2-success-DB-fail, bad TIFF, slug collision, AI-draft missing) → covered in Task 5 implementation comments + Manual verification checklist.
