# Journal System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Postgres-backed journal at `/journal` and `/journal/[slug]` with admin authoring at `/admin/journal/*`, including image uploads to public R2, body sanitization, and prev/next navigation.

**Architecture:** New `blog_posts` table (DRB-shape) on the existing schema. Server-component public pages with `revalidate=60`. Admin authoring is a single client-page form sharing the existing `requireAdmin()` auth + JSON API pattern from `app/api/admin/artworks/[id]/route.ts`. Cover and inline images upload directly to the existing public R2 bucket via `lib/r2.ts` `uploadPublic()`. Body HTML sanitized at write with `isomorphic-dompurify`.

**Tech Stack:** Next.js 16 App Router · Postgres (`pg` raw SQL) · Cloudflare R2 (public bucket) · `isomorphic-dompurify` (new dep) · existing `requireAdmin()` from `lib/session.ts`.

**Spec:** `docs/superpowers/specs/2026-04-28-journal-system-design.md`

---

## File Structure

**Created:**
- `lib/journal-html.ts` — server-side body HTML sanitization helper (DOMPurify wrapper)
- `app/api/admin/journal/route.ts` — GET list, POST create
- `app/api/admin/journal/[id]/route.ts` — GET, PATCH, DELETE
- `app/api/admin/journal/[id]/publish/route.ts` — POST toggle published
- `app/api/admin/journal/upload-image/route.ts` — POST multipart → R2 public URL
- `app/admin/journal/page.tsx` — list page (drafts + published, status filters)
- `app/admin/journal/new/page.tsx` — create form
- `app/admin/journal/[id]/page.tsx` — edit form
- `components/admin/JournalEditor.tsx` — shared editor form (used by new + edit pages)
- `app/(shop)/journal/page.tsx` — public listing
- `app/(shop)/journal/[slug]/page.tsx` — public entry

**Modified:**
- `lib/schema.sql` — append `blog_posts` table + index
- `package.json` — add `isomorphic-dompurify` dep
- `app/globals.css` — append `.wl-journal-*` classes (~150 lines)
- `app/sitemap.ts` — emit journal URLs
- `next.config.ts` — flip `/blog/*` redirect from 307 → `/` to 308 → `/journal`

---

## Task 1: Schema migration + dependency

**Files:**
- Modify: `lib/schema.sql` (append at end)
- Modify: `package.json`

- [ ] **Step 1: Append the `blog_posts` table to `lib/schema.sql`**

Append at the end of the file:

```sql

-- ─── Journal entries (DRB-shaped blog_posts) ───────────────────────
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

CREATE INDEX IF NOT EXISTS idx_blog_posts_slug
  ON blog_posts(slug);
```

- [ ] **Step 2: Install `isomorphic-dompurify`**

```bash
npm install isomorphic-dompurify
```

This adds `isomorphic-dompurify` to `dependencies` in `package.json` and updates `package-lock.json`.

- [ ] **Step 3: Apply the migration**

```bash
npm run migrate
```

Expected: `schema applied` and exit 0. The `IF NOT EXISTS` clauses make this idempotent — running twice is safe.

- [ ] **Step 4: Verify the table exists**

```bash
node -e "require('dotenv').config({path:'.env.local'});require('./lib/db').pool.query('SELECT column_name FROM information_schema.columns WHERE table_name=\$1 ORDER BY ordinal_position',['blog_posts']).then(r=>{console.log(r.rows);process.exit(0)})"
```

Expected: list of 10 columns — `id`, `slug`, `title`, `excerpt`, `body`, `cover_image_url`, `published`, `published_at`, `created_at`, `updated_at`.

- [ ] **Step 5: Verify typecheck and tests still pass**

Run: `npm run typecheck && npm test`
Expected: exit 0; all 57 tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/schema.sql package.json package-lock.json
git commit -m "feat(db): blog_posts table for the journal + DOMPurify dep

DRB-shaped blog_posts (id/slug/title/excerpt/body/cover_image_url/
published/published_at/timestamps) plus index on published_at DESC
for the public ordering query and one on slug for lookup.

isomorphic-dompurify dep used by lib/journal-html.ts (next task)
to sanitize body HTML at write."
```

---

## Task 2: Server-side HTML sanitizer

**Files:**
- Create: `lib/journal-html.ts`

- [ ] **Step 1: Create the sanitizer**

```ts
// lib/journal-html.ts
//
// Server-side sanitization of journal body HTML. Runs at write (POST/PATCH),
// not at read, so public render stays fast and the stored body is already
// clean. Admin authors are trusted (Auth.js + admin role check) but defense
// in depth strips scripting and event handlers regardless.

import DOMPurify from 'isomorphic-dompurify';

export function sanitizeJournalHtml(input: string): string {
  return DOMPurify.sanitize(input, {
    // Whitelist: prose tags + tables + figure/figcaption + media basics.
    ALLOWED_TAGS: [
      'p', 'br', 'hr',
      'h2', 'h3', 'h4',
      'strong', 'em', 'b', 'i', 'u', 's', 'sub', 'sup', 'mark', 'small',
      'a',
      'ul', 'ol', 'li',
      'blockquote', 'cite',
      'code', 'pre',
      'figure', 'figcaption',
      'img',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'span', 'div',
    ],
    ALLOWED_ATTR: [
      'href', 'title', 'target', 'rel',
      'src', 'alt', 'width', 'height', 'loading',
      'class', 'id',
    ],
    // Block scripting + iframe entirely. event-handler attrs (onclick=, etc.)
    // are stripped by default because they're not in ALLOWED_ATTR.
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'style', 'link'],
    // Disallow data: and javascript: URIs in href/src.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|\/|#)/i,
    // Add target=_blank rel safety on any anchor that survives.
    ADD_ATTR: ['target', 'rel'],
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Smoke-test the sanitizer in a Node REPL**

```bash
node --input-type=module -e "
import { sanitizeJournalHtml } from './lib/journal-html.ts';
console.log(sanitizeJournalHtml('<p>hello <script>alert(1)</script> world</p>'));
console.log(sanitizeJournalHtml('<a href=\"javascript:alert(1)\">click</a>'));
console.log(sanitizeJournalHtml('<a href=\"https://example.com\" onclick=\"x()\">ok</a>'));
"
```

This requires `tsx` or similar to run TS directly. If easier, write a quick Vitest unit test instead:

```ts
// tests/lib/journal-html.test.ts
import { describe, it, expect } from 'vitest';
import { sanitizeJournalHtml } from '@/lib/journal-html';

describe('sanitizeJournalHtml', () => {
  it('strips script tags', () => {
    expect(sanitizeJournalHtml('<p>hi</p><script>alert(1)</script>')).toBe('<p>hi</p>');
  });
  it('strips javascript: URIs', () => {
    const out = sanitizeJournalHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
  });
  it('strips event-handler attributes', () => {
    const out = sanitizeJournalHtml('<a href="https://x.com" onclick="x()">ok</a>');
    expect(out).toContain('href="https://x.com"');
    expect(out).not.toContain('onclick');
  });
  it('preserves prose tags', () => {
    const out = sanitizeJournalHtml('<p>One</p><h2>Two</h2><blockquote>Three</blockquote>');
    expect(out).toContain('<p>One</p>');
    expect(out).toContain('<h2>Two</h2>');
    expect(out).toContain('<blockquote>Three</blockquote>');
  });
  it('preserves img with src and alt', () => {
    const out = sanitizeJournalHtml('<img src="https://images.wildlightimagery.shop/journal/x.jpg" alt="x">');
    expect(out).toContain('src="https://images.wildlightimagery.shop/journal/x.jpg"');
    expect(out).toContain('alt="x"');
  });
});
```

Run: `npm test -- tests/lib/journal-html.test.ts`
Expected: 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add lib/journal-html.ts tests/lib/journal-html.test.ts
git commit -m "feat: sanitizeJournalHtml for journal body at write

DOMPurify-based sanitizer with prose-tag whitelist, no script/iframe,
no event handlers, no javascript:/data: URIs. Five unit tests cover
the threat-removal cases."
```

---

## Task 3: Image upload endpoint

**Files:**
- Create: `app/api/admin/journal/upload-image/route.ts`

- [ ] **Step 1: Create the endpoint**

```ts
// app/api/admin/journal/upload-image/route.ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '@/lib/session';
import { uploadPublic } from '@/lib/r2';
import { logger } from '@/lib/logger';

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export async function POST(req: Request) {
  await requireAdmin();

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'no file' }, { status: 400 });
  }

  const contentType = file.type;
  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json(
      { error: 'unsupported image type' },
      { status: 415 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'image too large' },
      { status: 413 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = EXT_BY_TYPE[contentType] ?? 'bin';
  const key = `journal/${randomUUID()}.${ext}`;

  try {
    const url = await uploadPublic(key, buf, contentType);
    return NextResponse.json({ url, key });
  } catch (err) {
    logger.error('journal image upload failed', err);
    return NextResponse.json(
      { error: 'upload failed' },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/journal/upload-image/route.ts
git commit -m "feat(api): admin/journal/upload-image accepts multipart, returns R2 URL

Admin-gated multipart upload. Allows jpeg/png/webp/gif up to 10 MB.
Generates journal/<uuid>.<ext> key, uploads to public R2 via
existing uploadPublic helper, returns { url, key }."
```

---

## Task 4: Admin list + create endpoint (`/api/admin/journal`)

**Files:**
- Create: `app/api/admin/journal/route.ts`

- [ ] **Step 1: Create the endpoint**

```ts
// app/api/admin/journal/route.ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { sanitizeJournalHtml } from '@/lib/journal-html';
import { slugify, uniqueSlug } from '@/lib/slug';
import { logger } from '@/lib/logger';

interface ListRow {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image_url: string | null;
  published: boolean;
  published_at: string | null;
  updated_at: string;
}

export async function GET() {
  await requireAdmin();
  const r = await pool.query<ListRow>(
    `SELECT id, slug, title, excerpt, cover_image_url,
            published, published_at::text, updated_at::text
     FROM blog_posts
     ORDER BY updated_at DESC`,
  );
  return NextResponse.json({ entries: r.rows });
}

const Create = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().max(100).optional(),
  excerpt: z.string().max(500).nullable().optional(),
  body: z.string().min(1).max(200000),
  cover_image_url: z.string().url().nullable().optional(),
});

export async function POST(req: Request) {
  await requireAdmin();
  const parsed = Create.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const d = parsed.data;

  // Resolve a unique slug. If client passed one, use it (still uniquify).
  // Otherwise derive from title.
  const taken = new Set(
    (await pool.query<{ slug: string }>('SELECT slug FROM blog_posts')).rows.map(
      (r) => r.slug,
    ),
  );
  const baseSlug = slugify(d.slug || d.title) || 'untitled';
  const slug = uniqueSlug(baseSlug, taken);

  const cleanBody = sanitizeJournalHtml(d.body);

  try {
    const r = await pool.query<{ id: number; slug: string }>(
      `INSERT INTO blog_posts (slug, title, excerpt, body, cover_image_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, slug`,
      [slug, d.title, d.excerpt ?? null, cleanBody, d.cover_image_url ?? null],
    );
    return NextResponse.json({ id: r.rows[0].id, slug: r.rows[0].slug });
  } catch (err) {
    logger.error('journal create failed', err);
    return NextResponse.json({ error: 'create failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/journal/route.ts
git commit -m "feat(api): admin/journal list + create

GET returns all entries (drafts + published) ordered by
updated_at desc. POST validates with zod, derives a unique slug
via lib/slug helpers, sanitizes body via journal-html, inserts
the row, returns id+slug."
```

---

## Task 5: Admin single endpoint (`/api/admin/journal/[id]`)

**Files:**
- Create: `app/api/admin/journal/[id]/route.ts`

- [ ] **Step 1: Create the endpoint**

```ts
// app/api/admin/journal/[id]/route.ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool, parsePathId } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { sanitizeJournalHtml } from '@/lib/journal-html';
import { slugify, uniqueSlug } from '@/lib/slug';
import { logger } from '@/lib/logger';

interface Row {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string;
  cover_image_url: string | null;
  published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = parsePathId(raw);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const r = await pool.query<Row>(
    `SELECT id, slug, title, excerpt, body, cover_image_url,
            published, published_at::text, created_at::text, updated_at::text
     FROM blog_posts WHERE id = $1`,
    [id],
  );
  if (!r.rowCount) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ entry: r.rows[0] });
}

const Patch = z.object({
  title: z.string().min(1).max(200).optional(),
  slug: z.string().min(1).max(100).optional(),
  excerpt: z.string().max(500).nullable().optional(),
  body: z.string().min(1).max(200000).optional(),
  cover_image_url: z.string().url().nullable().optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = parsePathId(raw);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const d = parsed.data;

  // If slug is being changed, ensure uniqueness across other rows.
  let resolvedSlug: string | undefined;
  if (d.slug != null) {
    const taken = new Set(
      (
        await pool.query<{ slug: string }>(
          'SELECT slug FROM blog_posts WHERE id <> $1',
          [id],
        )
      ).rows.map((r) => r.slug),
    );
    const baseSlug = slugify(d.slug) || 'untitled';
    resolvedSlug = uniqueSlug(baseSlug, taken);
  }

  const cleanBody = d.body != null ? sanitizeJournalHtml(d.body) : undefined;

  // Build dynamic UPDATE — only change fields that were sent.
  const sets: string[] = [];
  const vals: unknown[] = [];
  function add(col: string, val: unknown) {
    sets.push(`${col} = $${sets.length + 1}`);
    vals.push(val);
  }
  if (d.title != null) add('title', d.title);
  if (resolvedSlug != null) add('slug', resolvedSlug);
  if ('excerpt' in d) add('excerpt', d.excerpt ?? null);
  if (cleanBody != null) add('body', cleanBody);
  if ('cover_image_url' in d) add('cover_image_url', d.cover_image_url ?? null);

  if (sets.length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  add('updated_at', 'NOW()'); // sentinel — replaced below

  // Build SQL — last column uses NOW() literal not param.
  const setClauses = sets.slice(0, -1).join(', ');
  const sql = `UPDATE blog_posts SET ${setClauses}, updated_at = NOW() WHERE id = $${sets.length} RETURNING id, slug`;

  try {
    const r = await pool.query<{ id: number; slug: string }>(sql, [
      ...vals.slice(0, -1),
      id,
    ]);
    if (!r.rowCount) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ id: r.rows[0].id, slug: r.rows[0].slug });
  } catch (err) {
    logger.error('journal patch failed', err);
    return NextResponse.json({ error: 'update failed' }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = parsePathId(raw);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const r = await pool.query('DELETE FROM blog_posts WHERE id = $1', [id]);
  if (!r.rowCount) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/journal/[id]/route.ts
git commit -m "feat(api): admin/journal/[id] GET/PATCH/DELETE

GET returns full entry including body. PATCH validates with zod,
re-uniquifies slug if changed (excluding self), sanitizes body,
only writes the columns that were sent, bumps updated_at. DELETE
removes the row (orphan R2 images intentionally left in place)."
```

---

## Task 6: Admin publish toggle (`/api/admin/journal/[id]/publish`)

**Files:**
- Create: `app/api/admin/journal/[id]/publish/route.ts`

- [ ] **Step 1: Create the endpoint**

```ts
// app/api/admin/journal/[id]/publish/route.ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool, parsePathId } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { logger } from '@/lib/logger';

const Body = z.object({ published: z.boolean() });

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = parsePathId(raw);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }

  // First-publish stamps published_at; later toggles preserve it (so
  // chapter numbers stay stable across unpublish/republish cycles).
  try {
    const r = await pool.query<{ id: number; published_at: string | null }>(
      `UPDATE blog_posts
       SET published = $1,
           published_at = COALESCE(published_at, CASE WHEN $1 THEN NOW() ELSE NULL END),
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, published_at::text`,
      [parsed.data.published, id],
    );
    if (!r.rowCount) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({
      id: r.rows[0].id,
      published: parsed.data.published,
      published_at: r.rows[0].published_at,
    });
  } catch (err) {
    logger.error('journal publish toggle failed', err);
    return NextResponse.json({ error: 'publish failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/journal/[id]/publish/route.ts
git commit -m "feat(api): admin/journal/[id]/publish toggle

POST { published: boolean } flips the flag and stamps published_at
on first publish only. Re-publishing preserves the original
published_at so chapter numbers stay stable."
```

---

## Task 7: Shared admin editor component

**Files:**
- Create: `components/admin/JournalEditor.tsx`

- [ ] **Step 1: Create the editor**

```tsx
// components/admin/JournalEditor.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export interface JournalEntry {
  id?: number;
  slug?: string;
  title: string;
  excerpt: string | null;
  body: string;
  cover_image_url: string | null;
  published?: boolean;
  published_at?: string | null;
}

export interface JournalEditorProps {
  initial?: JournalEntry;
  /** True when editing existing; false when creating new. */
  isEdit: boolean;
}

export function JournalEditor({ initial, isEdit }: JournalEditorProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [excerpt, setExcerpt] = useState(initial?.excerpt ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [cover, setCover] = useState(initial?.cover_image_url ?? '');
  const [published, setPublished] = useState(initial?.published ?? false);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Auto-derive slug from title until the user touches the slug field.
  useEffect(() => {
    if (slugTouched) return;
    setSlug(
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80),
    );
  }, [title, slugTouched]);

  async function uploadImage(file: File): Promise<string> {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api/admin/journal/upload-image', {
      method: 'POST',
      body: fd,
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || `upload failed (${r.status})`);
    }
    const j = (await r.json()) as { url: string };
    return j.url;
  }

  async function pickCover(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      setCover(await uploadImage(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed');
    }
    e.target.value = '';
  }

  async function insertInlineImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const url = await uploadImage(file);
      const ta = bodyRef.current;
      const snippet = `\n<img src="${url}" alt="" />\n`;
      if (ta) {
        const at = ta.selectionStart;
        const next = body.slice(0, at) + snippet + body.slice(at);
        setBody(next);
        // Defer focus until React updates the textarea contents.
        queueMicrotask(() => {
          ta.focus();
          ta.selectionStart = ta.selectionEnd = at + snippet.length;
        });
      } else {
        setBody(body + snippet);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed');
    }
    e.target.value = '';
  }

  async function save() {
    setSaving(true);
    setError(null);
    const payload = {
      title,
      slug: slug || undefined,
      excerpt: excerpt || null,
      body,
      cover_image_url: cover || null,
    };
    try {
      const url = isEdit
        ? `/api/admin/journal/${initial!.id}`
        : '/api/admin/journal';
      const r = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || `save failed (${r.status})`);
      }
      const j = (await r.json()) as { id: number; slug: string };
      if (!isEdit) {
        router.push(`/admin/journal/${j.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  async function togglePublish() {
    if (!isEdit || !initial?.id) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/journal/${initial.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ published: !published }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || 'publish toggle failed');
      }
      setPublished((p) => !p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'publish toggle failed');
    } finally {
      setSaving(false);
    }
  }

  async function destroy() {
    if (!isEdit || !initial?.id) return;
    if (!confirm('Delete this entry permanently?')) return;
    const r = await fetch(`/api/admin/journal/${initial.id}`, {
      method: 'DELETE',
    });
    if (r.ok) router.push('/admin/journal');
    else setError('delete failed');
  }

  return (
    <div className="wl-adm-journal-editor">
      <div className="wl-adm-journal-h">
        <h1>{isEdit ? 'Edit chapter' : 'New chapter'}</h1>
        <div className="actions">
          {isEdit && (
            <button
              type="button"
              className={`wl-adm-btn ${published ? 'ghost' : 'primary'}`}
              onClick={togglePublish}
              disabled={saving}
            >
              {published ? 'Unpublish' : 'Publish'}
            </button>
          )}
          <button
            type="button"
            className="wl-adm-btn primary"
            onClick={save}
            disabled={saving || !title || !body}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error && <p className="wl-adm-err">{error}</p>}

      <label className="wl-adm-field">
        <span>Title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
        />
      </label>

      <label className="wl-adm-field">
        <span>Slug</span>
        <input
          type="text"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
          maxLength={100}
        />
      </label>

      <label className="wl-adm-field">
        <span>Excerpt (optional, used in listing + meta description)</span>
        <textarea
          rows={3}
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          maxLength={500}
        />
      </label>

      <div className="wl-adm-field">
        <span>Cover image</span>
        <div className="wl-adm-cover">
          {cover && (
            <div className="wl-adm-cover-prev">
              <Image
                src={cover}
                alt="Cover preview"
                width={240}
                height={150}
                style={{ objectFit: 'cover' }}
              />
            </div>
          )}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={pickCover}
          />
          {cover && (
            <button
              type="button"
              className="wl-adm-btn ghost small"
              onClick={() => setCover('')}
            >
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="wl-adm-field">
        <span>Body (HTML)</span>
        <div className="wl-adm-body-toolbar">
          <label className="wl-adm-btn ghost small">
            Insert image
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={insertInlineImage}
              style={{ display: 'none' }}
            />
          </label>
          <button
            type="button"
            className="wl-adm-btn ghost small"
            onClick={() => setPreview((p) => !p)}
          >
            {preview ? 'Hide preview' : 'Show preview'}
          </button>
        </div>
        <textarea
          ref={bodyRef}
          rows={20}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="<p>Your chapter starts here…</p>"
          required
        />
        {preview && (
          <div
            className="wl-adm-body-preview wl-journal-body"
            dangerouslySetInnerHTML={{ __html: body }}
          />
        )}
      </div>

      {isEdit && (
        <div className="wl-adm-journal-foot">
          <button
            type="button"
            className="wl-adm-btn danger"
            onClick={destroy}
          >
            Delete chapter
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0. The editor uses no admin CSS classes that don't yet exist — they'll be added in Task 11. Until then, the page renders unstyled but functional.

- [ ] **Step 3: Commit**

```bash
git add components/admin/JournalEditor.tsx
git commit -m "feat(admin): JournalEditor — shared form for new + edit

Single client component used by both /admin/journal/new and
/admin/journal/[id]. Title, slug (auto-derived until touched),
excerpt, cover-image upload, body textarea with insert-image
button, optional inline preview rendering body via
dangerouslySetInnerHTML, publish toggle (only on edit), delete."
```

---

## Task 8: Admin pages — list, new, edit

**Files:**
- Create: `app/admin/journal/page.tsx`
- Create: `app/admin/journal/new/page.tsx`
- Create: `app/admin/journal/[id]/page.tsx`

- [ ] **Step 1: Create the list page**

```tsx
// app/admin/journal/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminPill } from '@/components/admin/AdminPill';

interface ListEntry {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image_url: string | null;
  published: boolean;
  published_at: string | null;
  updated_at: string;
}

type Filter = 'all' | 'published' | 'drafts';

export default function JournalListPage() {
  const [entries, setEntries] = useState<ListEntry[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    void fetch('/api/admin/journal')
      .then((r) => r.json())
      .then((j: { entries: ListEntry[] }) => setEntries(j.entries));
  }, []);

  const filtered =
    entries == null
      ? null
      : entries.filter((e) =>
          filter === 'all'
            ? true
            : filter === 'published'
              ? e.published
              : !e.published,
        );

  return (
    <div className="wl-adm-page">
      <div className="wl-adm-page-h">
        <h1>Journal</h1>
        <Link href="/admin/journal/new" className="wl-adm-btn primary">
          New chapter
        </Link>
      </div>

      <div className="wl-adm-tabs">
        {(['all', 'published', 'drafts'] as Filter[]).map((k) => (
          <button
            key={k}
            type="button"
            className={`wl-adm-tab ${filter === k ? 'on' : ''}`}
            onClick={() => setFilter(k)}
          >
            {k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>

      {filtered == null ? (
        <p className="wl-adm-muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="wl-adm-muted">No chapters yet.</p>
      ) : (
        <table className="wl-adm-tbl">
          <thead>
            <tr>
              <th>Status</th>
              <th>Title</th>
              <th>Slug</th>
              <th>Published</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id}>
                <td>
                  <AdminPill status={e.published ? 'published' : 'draft'} />
                </td>
                <td>{e.title}</td>
                <td className="wl-adm-mono">{e.slug}</td>
                <td className="wl-adm-mono">
                  {e.published_at
                    ? new Date(e.published_at).toLocaleDateString()
                    : '—'}
                </td>
                <td className="wl-adm-mono">
                  {new Date(e.updated_at).toLocaleDateString()}
                </td>
                <td>
                  <Link
                    href={`/admin/journal/${e.id}`}
                    className="wl-adm-btn small ghost"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the new page**

```tsx
// app/admin/journal/new/page.tsx
import { JournalEditor } from '@/components/admin/JournalEditor';
import { requireAdminOrRedirect } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function NewJournalEntry() {
  await requireAdminOrRedirect();
  return <JournalEditor isEdit={false} />;
}
```

- [ ] **Step 3: Create the edit page**

```tsx
// app/admin/journal/[id]/page.tsx
import { notFound } from 'next/navigation';
import { JournalEditor, type JournalEntry } from '@/components/admin/JournalEditor';
import { requireAdminOrRedirect } from '@/lib/session';
import { pool, parsePathId } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function EditJournalEntry({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminOrRedirect();
  const { id: raw } = await params;
  const id = parsePathId(raw);
  if (id == null) notFound();

  const r = await pool.query<JournalEntry>(
    `SELECT id, slug, title, excerpt, body, cover_image_url,
            published, published_at::text
     FROM blog_posts WHERE id = $1`,
    [id],
  );
  const entry = r.rows[0];
  if (!entry) notFound();

  return <JournalEditor initial={entry} isEdit={true} />;
}
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/admin/journal/
git commit -m "feat(admin): journal list, new, edit pages

List page (drafts + published with All/Published/Drafts tabs),
new and edit pages that wrap JournalEditor. Pages gated by
requireAdminOrRedirect; the list page client-fetches via
/api/admin/journal and the edit page server-loads then hands
the entry to JournalEditor."
```

---

## Task 9: Public journal listing (`/journal`)

**Files:**
- Create: `app/(shop)/journal/page.tsx`

- [ ] **Step 1: Create the file**

```tsx
// app/(shop)/journal/page.tsx
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { pool } from '@/lib/db';
import { EmailCaptureStrip } from '@/components/site/EmailCaptureStrip';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'The journal — Wildlight Imagery',
  description:
    'Notes from the studio and the field. New chapter every season — sometimes more.',
};

const PER_PAGE = 20;

interface ListRow {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image_url: string | null;
  published_at: string;
  chapter_number: number;
}

interface CountRow {
  total: number;
}

function fmtMonth(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default async function JournalIndex({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const offset = (page - 1) * PER_PAGE;

  const [rowsRes, countRes] = await Promise.all([
    pool.query<ListRow>(
      `SELECT id, slug, title, excerpt, cover_image_url,
              published_at::text,
              ROW_NUMBER() OVER (ORDER BY published_at ASC)::int AS chapter_number
       FROM blog_posts
       WHERE published = TRUE
       ORDER BY published_at DESC
       LIMIT $1 OFFSET $2`,
      [PER_PAGE, offset],
    ),
    pool.query<CountRow>(
      `SELECT COUNT(*)::int AS total FROM blog_posts WHERE published = TRUE`,
    ),
  ]);

  const rows = rowsRes.rows;
  const total = countRes.rows[0]?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div>
      <header className="wl-cindex-head">
        <div>
          <span className="wl-eyebrow">The journal · {total} chapters</span>
          <h1>
            The journal<em>.</em>
          </h1>
          <p>
            Notes from the studio and the field. Behind the shot, around it,
            and in between — collected, ongoing.
          </p>
        </div>
        <div className="wl-masthead-side">
          <div>
            <b>Chapters</b> {String(total).padStart(2, '0')}
          </div>
          <div>
            <b>Cadence</b> Quarterly
          </div>
          <div>
            <b>Page</b> {page} / {totalPages}
          </div>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="wl-journal-empty">
          No chapters published yet — the first one is on its way.
        </p>
      ) : (
        <ul className="wl-journal-list">
          {rows.map((r) => (
            <li key={r.id} className="wl-journal-row">
              <Link href={`/journal/${r.slug}`}>
                <span className="ch">
                  CH · {String(r.chapter_number).padStart(2, '0')}
                </span>
                <div className="body">
                  <h2 className="title">{r.title}</h2>
                  {r.excerpt && <p className="excerpt">{r.excerpt}</p>}
                  <span className="date">{fmtMonth(r.published_at)}</span>
                </div>
                {r.cover_image_url && (
                  <div className="thumb">
                    <Image
                      src={r.cover_image_url}
                      alt={r.title}
                      width={120}
                      height={120}
                      style={{ objectFit: 'cover' }}
                    />
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <nav className="wl-journal-pager">
          {page > 1 && (
            <Link href={`/journal?page=${page - 1}`}>← Previous</Link>
          )}
          <span className="wl-mono">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link href={`/journal?page=${page + 1}`}>Next →</Link>
          )}
        </nav>
      )}

      <section className="wlmh-news-section">
        <EmailCaptureStrip
          source="journal-index"
          eyebrow="A quiet letter"
          headline="The next chapter, in your inbox."
          body="New work, the occasional studio note, and first look at limited editions before they list. No more than once a month."
        />
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add "app/(shop)/journal/page.tsx"
git commit -m "feat: /journal listing — chapter rows + pagination + newsletter

Server component, revalidate=60. Renders chapter rows with cover
thumbnails using ROW_NUMBER() over publish order for chapter
numbers. Empty state, simple ?page=N pagination at 20 per page,
and an inline newsletter strip below the list."
```

---

## Task 10: Public journal entry (`/journal/[slug]`)

**Files:**
- Create: `app/(shop)/journal/[slug]/page.tsx`

- [ ] **Step 1: Create the file**

```tsx
// app/(shop)/journal/[slug]/page.tsx
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { pool } from '@/lib/db';
import { EmailCaptureStrip } from '@/components/site/EmailCaptureStrip';

export const revalidate = 60;

interface EntryRow {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string;
  cover_image_url: string | null;
  published_at: string;
  chapter_number: number;
  total: number;
}

interface NeighborRow {
  slug: string;
  title: string;
}

function fmtMonth(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const r = await pool.query<{ title: string; excerpt: string | null }>(
    `SELECT title, excerpt FROM blog_posts
     WHERE slug = $1 AND published = TRUE`,
    [slug],
  );
  const e = r.rows[0];
  if (!e) return { title: 'Chapter not found' };
  return {
    title: `${e.title} — Wildlight Imagery`,
    description: e.excerpt ?? undefined,
  };
}

export default async function JournalEntry({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const r = await pool.query<EntryRow>(
    `WITH ord AS (
       SELECT id, slug, title, excerpt, body, cover_image_url,
              published_at,
              ROW_NUMBER() OVER (ORDER BY published_at ASC) AS chapter_number,
              COUNT(*) OVER () AS total
       FROM blog_posts WHERE published = TRUE
     )
     SELECT id, slug, title, excerpt, body, cover_image_url,
            published_at::text, chapter_number::int, total::int
     FROM ord WHERE slug = $1`,
    [slug],
  );

  const entry = r.rows[0];
  if (!entry) notFound();

  const [prevRes, nextRes] = await Promise.all([
    pool.query<NeighborRow>(
      `SELECT slug, title FROM blog_posts
       WHERE published = TRUE AND published_at < $1
       ORDER BY published_at DESC LIMIT 1`,
      [entry.published_at],
    ),
    pool.query<NeighborRow>(
      `SELECT slug, title FROM blog_posts
       WHERE published = TRUE AND published_at > $1
       ORDER BY published_at ASC LIMIT 1`,
      [entry.published_at],
    ),
  ]);
  const prev = prevRes.rows[0];
  const next = nextRes.rows[0];

  return (
    <article className="wl-journal-entry">
      <header className="wl-journal-entry-h">
        <Link href="/journal" className="back">
          ← The journal
        </Link>
        <span className="wl-eyebrow">
          Chapter {String(entry.chapter_number).padStart(2, '0')} of{' '}
          {String(entry.total).padStart(2, '0')} · {fmtMonth(entry.published_at)}
        </span>
        <h1>{entry.title}</h1>
        {entry.excerpt && <p className="lede">{entry.excerpt}</p>}
      </header>

      {entry.cover_image_url && (
        <div className="wl-journal-entry-cover">
          <Image
            src={entry.cover_image_url}
            alt={entry.title}
            width={1200}
            height={750}
            sizes="(max-width: 900px) 100vw, 1200px"
            style={{ width: '100%', height: 'auto', objectFit: 'cover' }}
          />
        </div>
      )}

      {/* Body HTML is sanitized at write time (lib/journal-html.ts). */}
      <div
        className="wl-journal-body"
        dangerouslySetInnerHTML={{ __html: entry.body }}
      />

      <nav className="wl-journal-nav">
        {prev && (
          <Link className="prev" href={`/journal/${prev.slug}`}>
            <span className="wl-mono">Previous chapter</span>
            <span className="t">{prev.title}</span>
          </Link>
        )}
        {next && (
          <Link className="next" href={`/journal/${next.slug}`}>
            <span className="wl-mono">Next chapter</span>
            <span className="t">{next.title}</span>
          </Link>
        )}
      </nav>

      <section className="wlmh-news-section">
        <EmailCaptureStrip
          source="journal-entry"
          eyebrow="A quiet letter"
          headline="Want the next chapter in your inbox?"
          body="New work, the occasional studio note, and first look at limited editions before they list. No more than once a month."
        />
      </section>
    </article>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add "app/(shop)/journal/[slug]/page.tsx"
git commit -m "feat: /journal/[slug] — single chapter with prev/next + newsletter

Server component, revalidate=60. Single CTE query computes the
chapter number + total alongside the row. Two follow-up queries
fetch the previous (older) and next (newer) chapter for the
inline navigation. 404 on unknown slug or unpublished entry.
Body rendered via dangerouslySetInnerHTML (already sanitized at
write)."
```

---

## Task 11: Append journal CSS to `app/globals.css`

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Append the journal classes**

Add at the end of `app/globals.css`:

```css

/* ─── JOURNAL ────────────────────────────────────────────────────
 * Public listing + entry, plus admin editor styles. Reuses
 * existing wl-cindex-* classes for the listing header.
 */

/* Public listing */
.wl-journal-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--rule);
}
.wl-journal-row {
  border-bottom: 1px solid var(--rule);
}
.wl-journal-row a {
  display: grid;
  grid-template-columns: 80px 1fr 120px;
  gap: 24px;
  padding: 24px 56px;
  align-items: center;
  color: inherit;
  text-decoration: none;
  transition: background 160ms;
}
.wl-journal-row a:hover { background: var(--paper-2); }
.wl-journal-row .ch {
  font: 500 11px var(--f-mono);
  letter-spacing: 0.18em;
  color: var(--ink-3);
}
.wl-journal-row .body { display: flex; flex-direction: column; gap: 6px; }
.wl-journal-row .title {
  font-family: var(--f-display);
  font-size: 28px;
  line-height: 1.1;
  margin: 0;
}
.wl-journal-row .excerpt {
  font-family: var(--f-serif);
  font-size: 15px;
  line-height: 1.5;
  color: var(--ink-2);
  margin: 0;
}
.wl-journal-row .date {
  font: 500 10.5px var(--f-mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.wl-journal-row .thumb img {
  width: 120px;
  height: 120px;
  border: 1px solid var(--rule);
}
.wl-journal-empty {
  padding: 64px 56px;
  font-family: var(--f-serif);
  font-size: 17px;
  color: var(--ink-3);
}
.wl-journal-pager {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 32px 56px;
  border-bottom: 1px solid var(--rule);
}
.wl-journal-pager a {
  font-family: var(--f-display);
  font-style: italic;
  font-size: 18px;
  color: var(--ink);
}
.wl-journal-pager a:hover { color: var(--s-orange); }

/* Public entry */
.wl-journal-entry {
  padding: 56px 56px 0;
  max-width: 880px;
  margin: 0 auto;
}
.wl-journal-entry-h .back {
  display: inline-block;
  font: 500 10.5px var(--f-mono);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-3);
  margin-bottom: 24px;
}
.wl-journal-entry-h .wl-eyebrow {
  display: block;
  margin-bottom: 16px;
}
.wl-journal-entry-h h1 {
  font-family: var(--f-display);
  font-size: clamp(40px, 5vw, 72px);
  line-height: 1;
  margin: 0 0 20px;
}
.wl-journal-entry-h .lede {
  font-family: var(--f-serif);
  font-style: italic;
  font-size: 22px;
  line-height: 1.45;
  color: var(--ink-2);
  max-width: 680px;
  margin: 0 0 40px;
}
.wl-journal-entry-cover {
  margin: 0 -56px 48px;
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
}
.wl-journal-body {
  font-family: var(--f-serif);
  font-size: 18px;
  line-height: 1.7;
  color: var(--ink);
  max-width: 680px;
}
.wl-journal-body p { margin: 0 0 1.4em; }
.wl-journal-body h2,
.wl-journal-body h3 {
  font-family: var(--f-display);
  font-weight: 400;
  margin: 1.6em 0 0.5em;
  letter-spacing: -0.01em;
}
.wl-journal-body h2 { font-size: 32px; line-height: 1.1; }
.wl-journal-body h3 { font-size: 24px; line-height: 1.2; }
.wl-journal-body a {
  color: inherit;
  border-bottom: 1px solid var(--rule-strong);
}
.wl-journal-body a:hover { color: var(--s-orange); border-color: var(--s-orange); }
.wl-journal-body blockquote {
  border-left: 2px solid var(--rule-strong);
  padding-left: 20px;
  margin: 1.6em 0;
  font-style: italic;
  color: var(--ink-2);
}
.wl-journal-body ul,
.wl-journal-body ol { padding-left: 24px; margin: 0 0 1.4em; }
.wl-journal-body li { margin-bottom: 0.5em; }
.wl-journal-body img {
  display: block;
  max-width: calc(100% + 112px);
  margin: 2em -56px;
  border: 1px solid var(--rule);
}
.wl-journal-body figure { margin: 2em 0; }
.wl-journal-body figcaption {
  font: 500 10.5px var(--f-mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-3);
  margin-top: 8px;
}
.wl-journal-body code {
  font-family: var(--f-mono);
  font-size: 15px;
  background: var(--paper-2);
  padding: 1px 4px;
  border-radius: 2px;
}

.wl-journal-nav {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin: 64px 0 48px;
  padding-top: 32px;
  border-top: 1px solid var(--rule);
}
.wl-journal-nav a {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 20px;
  border: 1px solid var(--rule);
  color: inherit;
  text-decoration: none;
  transition: border-color 160ms;
}
.wl-journal-nav a:hover { border-color: var(--ink); }
.wl-journal-nav .next { text-align: right; }
.wl-journal-nav .wl-mono {
  font: 500 10.5px var(--f-mono);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.wl-journal-nav .t {
  font-family: var(--f-display);
  font-size: 18px;
  line-height: 1.2;
}

/* Mobile responsive */
@media (max-width: 640px) {
  .wl-journal-row a {
    grid-template-columns: 1fr;
    padding: 20px;
    gap: 8px;
  }
  .wl-journal-row .thumb { display: none; }
  .wl-journal-pager { padding: 20px; flex-wrap: wrap; gap: 12px; }
  .wl-journal-entry { padding: 32px 20px 0; }
  .wl-journal-entry-cover { margin: 0 -20px 32px; }
  .wl-journal-body img { max-width: calc(100% + 40px); margin: 1.4em -20px; }
  .wl-journal-nav { grid-template-columns: 1fr; }
  .wl-journal-nav .next { text-align: left; }
}

/* ─── Admin journal editor ──────────────────────────────────── */

.wl-adm-journal-editor {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.wl-adm-journal-h {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.wl-adm-journal-h h1 {
  font-family: var(--f-display);
  font-size: 32px;
  margin: 0;
}
.wl-adm-journal-h .actions {
  display: flex;
  gap: 8px;
}
.wl-adm-cover {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.wl-adm-cover-prev img {
  border: 1px solid var(--rule);
  display: block;
}
.wl-adm-body-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.wl-adm-body-preview {
  margin-top: 16px;
  padding: 24px;
  background: var(--paper-2);
  border: 1px solid var(--rule);
  border-radius: 4px;
}
.wl-adm-journal-foot {
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--rule);
}
.wl-adm-err {
  padding: 12px 16px;
  background: rgba(217, 67, 53, 0.08);
  border: 1px solid rgba(217, 67, 53, 0.3);
  border-radius: 4px;
  color: var(--s-red);
  font-family: var(--f-serif);
  font-size: 14px;
}
.wl-adm-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--rule);
}
.wl-adm-tab {
  background: none;
  border: 0;
  padding: 8px 16px;
  font: 500 12px var(--f-mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-3);
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.wl-adm-tab.on {
  color: var(--ink);
  border-bottom-color: var(--ink);
}
```

- [ ] **Step 2: Verify dev still loads CSS**

If dev server is running, refresh; check console for parse errors.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "feat(css): journal listing, entry, and admin editor

Public listing rows, single-entry typography (constrained
680px reading width with images breaking out wider), prev/next
nav, mobile responsive blocks. Plus admin editor layout
classes. All using existing print-room tokens."
```

---

## Task 12: Update sitemap with journal URLs

**Files:**
- Modify: `app/sitemap.ts`

- [ ] **Step 1: Replace the file**

```tsx
import type { MetadataRoute } from 'next';
import { pool } from '@/lib/db';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://wildlightimagery.shop').replace(/\/$/, '');

  try {
    const [collections, artworks, journal] = await Promise.all([
      pool.query<{ slug: string; created_at: Date }>(
        'SELECT slug, created_at FROM collections',
      ),
      pool.query<{ slug: string; updated_at: Date }>(
        `SELECT slug, updated_at FROM artworks WHERE status='published'`,
      ),
      pool.query<{ slug: string; updated_at: Date }>(
        `SELECT slug, updated_at FROM blog_posts WHERE published = TRUE`,
      ),
    ]);
    return [
      // Marketing
      { url: `${base}/`, lastModified: new Date() },
      { url: `${base}/portfolio`, lastModified: new Date() },
      { url: `${base}/journal`, lastModified: new Date() },
      { url: `${base}/services/portraits`, lastModified: new Date() },
      { url: `${base}/about`, lastModified: new Date() },
      { url: `${base}/contact`, lastModified: new Date() },
      // Shop
      { url: `${base}/shop`, lastModified: new Date() },
      { url: `${base}/shop/collections`, lastModified: new Date() },
      // Per-collection portfolio + shop
      ...collections.rows.flatMap((c) => [
        { url: `${base}/portfolio/${c.slug}`, lastModified: c.created_at },
        { url: `${base}/shop/collections/${c.slug}`, lastModified: c.created_at },
      ]),
      // Per-artwork shop pages
      ...artworks.rows.map((a) => ({
        url: `${base}/shop/artwork/${a.slug}`,
        lastModified: a.updated_at,
      })),
      // Per-journal-entry pages
      ...journal.rows.map((j) => ({
        url: `${base}/journal/${j.slug}`,
        lastModified: j.updated_at,
      })),
    ];
  } catch {
    return [
      { url: `${base}/`, lastModified: new Date() },
      { url: `${base}/portfolio`, lastModified: new Date() },
      { url: `${base}/journal`, lastModified: new Date() },
      { url: `${base}/services/portraits`, lastModified: new Date() },
      { url: `${base}/about`, lastModified: new Date() },
      { url: `${base}/contact`, lastModified: new Date() },
      { url: `${base}/shop`, lastModified: new Date() },
      { url: `${base}/shop/collections`, lastModified: new Date() },
    ];
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/sitemap.ts
git commit -m "feat: sitemap — add /journal and per-entry URLs"
```

---

## Task 13: Flip /blog redirect from 307 → 308 → /journal

**Files:**
- Modify: `next.config.ts`

- [ ] **Step 1: Edit the redirects()**

Find:

```ts
// Legacy WordPress blog (sub-project #3 retargets to /journal/* later)
{ source: '/blog',                  destination: '/',                           permanent: false },
{ source: '/blog/:path*',           destination: '/',                           permanent: false },
```

Replace with:

```ts
// Legacy WordPress blog redirects to journal root (no per-slug map —
// content was not migrated, so individual paths would 404 anyway).
{ source: '/blog',                  destination: '/journal',                    permanent: true },
{ source: '/blog/:path*',           destination: '/journal',                    permanent: true },
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add next.config.ts
git commit -m "feat(redirects): /blog/* → /journal (308 permanent)

Legacy WordPress blog now points at the new journal root with
permanent redirect status. Per-slug mapping skipped — old content
is not being migrated, so individual paths can't resolve to
specific chapters."
```

---

## Task 14: Manual verification

**Files:** None (operational).

This task does not produce a commit unless verification turns up a bug.

- [ ] **Step 1: Start dev server fresh**

Stop any running dev server. Run `npm run dev`. Wait until ready.

- [ ] **Step 2: Verify schema applied**

Run:
```bash
node -e "require('dotenv').config({path:'.env.local'});require('./lib/db').pool.query('SELECT count(*) FROM blog_posts').then(r=>console.log(r.rows))"
```
Expected: `[ { count: '0' } ]` (table exists, empty).

- [ ] **Step 3: Empty-state public pages**

- `http://localhost:3000/journal` → renders empty state ("No chapters published yet — the first one is on its way") with no table errors.
- `http://localhost:3000/journal/anything` → 404.

- [ ] **Step 4: Admin create**

- Sign in as admin (use existing `/login`).
- Visit `http://localhost:3000/admin/journal` → empty list, "New chapter" button.
- Click "New chapter" → editor opens.
- Type a title — slug auto-derives.
- Type 1-2 sentences for excerpt.
- Click "Body — Insert image" — pick a small image. Wait for upload. URL appears in body as `<img src="https://images.wildlightimagery.shop/journal/<uuid>.<ext>" alt="" />`. Add 2-3 paragraphs of body around the image.
- Click cover image upload — pick another small image. Preview appears.
- Click "Save". URL changes to `/admin/journal/<id>`.
- Click "Publish". Pill flips green.

- [ ] **Step 5: Public visibility**

- Visit `/journal` → entry appears as Chapter 01 with cover thumbnail and excerpt.
- Click into the entry → renders title, eyebrow ("Chapter 01 of 01 · {month, year}"), cover image, body HTML, prev/next nav (no neighbors, so nothing renders), inline newsletter strip.

- [ ] **Step 6: Sanitization**

- Edit the entry, paste a body containing:
  ```html
  <p>Test</p><script>alert(1)</script><p>End</p><a href="javascript:alert(1)">click</a>
  ```
- Save. Reload editor — `<script>` tag and `javascript:` URL should be stripped.

- [ ] **Step 7: Slug uniqueness**

- Create another draft with the same title as the first entry. Save. The new entry's slug should be `<base>-2`.

- [ ] **Step 8: Pagination**

If you have time, create 21+ entries (e.g., via SQL bulk insert) and verify `/journal?page=2` works. Skip if not practical.

- [ ] **Step 9: Sitemap**

- `curl -s http://localhost:3000/sitemap.xml | grep journal`
- Expected: `<loc>.../journal</loc>` and one `<loc>.../journal/<slug></loc>` per published entry.

- [ ] **Step 10: /blog redirect**

- `curl -sI http://localhost:3000/blog`
- Expected: `HTTP/1.1 308 Permanent Redirect` with `location: /journal`.
- `curl -sI http://localhost:3000/blog/2021/some-old-post`
- Expected: same — 308 to `/journal`.

- [ ] **Step 11: Final tests + typecheck**

Run: `npm run typecheck && npm test`
Expected: exit 0; all tests pass (the new `journal-html` tests should be included — total now 62).

If any step fails, file a fix commit before declaring SP#3 done.

---

## Self-Review

**Spec coverage:**
- ✓ Schema with table + indexes — Task 1
- ✓ DOMPurify sanitization at write — Task 2 (used in Tasks 4, 5)
- ✓ Public `/journal` listing with chapter numbers + pagination — Task 9
- ✓ Public `/journal/[slug]` with prev/next + newsletter — Task 10
- ✓ Admin list/new/edit pages — Task 8
- ✓ Admin API (list, create, single GET/PATCH/DELETE, publish toggle, image upload) — Tasks 3-6
- ✓ Cover + inline image uploads via direct R2 public — Task 3
- ✓ Sitemap entries — Task 12
- ✓ /blog redirect 307→308 — Task 13
- ✓ Marketing-home "Latest from journal" block — explicitly NOT in this plan (flagged in spec as small follow-up)

**Out of scope per spec (intentional gaps):**
- Old WP migration — deferred entirely.
- Newsletter "start from journal entry" pre-fill — SP#4.
- AI authoring — SP#5.
- Markdown / WYSIWYG editor — deferred.
- Image proxy route — replaced with direct R2 public URL.
- Pagination beyond simple ?page=N — YAGNI.

**Placeholder scan:** No "TBD" / "TODO" remaining. Each step has the actual code.

**Type consistency:** `JournalEntry` interface defined in Task 7's `JournalEditor.tsx` is reused in Task 8's edit page (`import { JournalEditor, type JournalEntry }`). The DB row shape in Task 5 (`Row`) matches `JournalEntry` field-for-field plus computed columns. The `ListEntry` shape in Task 4 and Task 8's list page also matches.
