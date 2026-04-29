// Studio drafts — DB shape for the unified composer.
//
// Two physical stores behind one logical "draft":
//   * Journal kind ⇒ blog_posts row (`published=false` is a draft, `true`
//     is published; either can be re-edited in the composer).
//   * Newsletter kind ⇒ newsletter_drafts row, with broadcast_log holding
//     the immutable send audit on the other side of Publish.
//
// Routes call into these helpers so kind-routing logic lives in exactly
// one place. Anything that's not just SELECT/INSERT/UPDATE belongs at
// the route layer (auth, rate limits, send-side effects).

import { pool } from './db';
import { slugify, uniqueSlug } from './slug';
import { sanitizeJournalHtml } from './journal-html';
import { composerTextToHtml, htmlToComposerText } from './composer-text';
import { deletePublic } from './r2';
import { logger } from './logger';

// ─── Types ──────────────────────────────────────────────────────────

export type StudioKind = 'journal' | 'newsletter';

export interface StudioImage {
  url: string;
  // R2 key — populated when uploaded via /api/admin/journal/upload-image.
  // Lets us delete the object on draft discard. Optional so older
  // entries with only a cover_image_url can lift into the gallery.
  key?: string;
}

export interface StudioMeta {
  // Blurb/preheader override — for journal this mirrors blog_posts.excerpt
  // (the canonical place); for newsletter this mirrors preheader column.
  // We persist it here too so transient edits in the composer survive a
  // reload before the user types anything that triggers the canonical
  // column write. NULL when the user hasn't touched it.
  subjectDraft?: string;
  images?: StudioImage[];
  chooseForMe?: boolean;
  // True once the user manually edited the slug — turns off the title
  // → slug auto-derive in subsequent PATCHes.
  slugTouched?: boolean;
  // Plaintext-with-markdown source as the user typed it into the
  // textarea. The `body` column always holds the rendered HTML for
  // public display; this preserves the source so reload + composer
  // round-trip without showing literal `<p>` tags. Legacy rows fall
  // back to htmlToComposerText(body) when this is missing.
  bodySource?: string;
  // Last "Generate · with SEO" result. Cached so the panel survives
  // navigation. Goes stale when body changes; UI may flag that later.
  // `generatedAt` is optional because legacy rows + the initial Generate
  // response don't carry one — the composer stamps it on auto-save.
  seo?: {
    keywords: string[];
    meta: string;
    related: string[];
    readingTime: string;
    generatedAt?: string; // ISO
  };
}

// Server-side shape returned by GET /draft/[id]. Normalized so the
// client doesn't have to handle null studio_meta or legacy rows.
export interface StudioDraft {
  id: number;
  kind: StudioKind;
  title: string;
  // Journal: blog_posts.excerpt; Newsletter: newsletter_drafts.preheader
  subject: string;
  body: string;
  coverImageUrl: string | null;
  slug: string | null;       // newsletter has no slug, returns null
  published: boolean;        // journal: published flag; newsletter: sent_at != null
  publishedAt: string | null;
  studioMeta: StudioMeta;
  updatedAt: string;
}

export interface RecentItem {
  id: number;
  kind: StudioKind;
  title: string;
  subject: string | null;
  status: 'draft' | 'published' | 'sent';
  updatedAt: string;
}

// ─── Helpers ────────────────────────────────────────────────────────

function readMeta(raw: unknown): StudioMeta {
  if (!raw || typeof raw !== 'object') return {};
  return raw as StudioMeta;
}

function deriveCover(meta: StudioMeta, fallback: string | null): string | null {
  const first = meta.images?.[0]?.url;
  return first ?? fallback;
}

// Lift an existing blog_posts row that pre-dates the new composer into
// a sane StudioMeta. `cover_image_url` fills the gallery's first slot
// so editing an old chapter shows the cover as a thumbnail.
function liftLegacyMeta(meta: StudioMeta, cover: string | null): StudioMeta {
  if (meta.images && meta.images.length > 0) return meta;
  if (!cover) return meta;
  return { ...meta, images: [{ url: cover }] };
}

// ─── Journal CRUD ───────────────────────────────────────────────────

interface JournalRow {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string;
  cover_image_url: string | null;
  studio_meta: unknown;
  published: boolean;
  published_at: string | null;
  updated_at: string;
}

export async function createJournalDraft(): Promise<{ id: number; slug: string }> {
  // Body is NOT NULL on blog_posts but accepts ''. Slug must be unique
  // and we don't have a title yet, so we hand out a placeholder anchored
  // to the row id post-insert. Two parallel creates can't collide on
  // 'untitled' because we suffix with a temporary UUID slice; the first
  // PATCH replaces the slug from the real title.
  const tempSlug = `untitled-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  const r = await pool.query<{ id: number; slug: string }>(
    `INSERT INTO blog_posts (slug, title, body)
     VALUES ($1, '', '')
     RETURNING id, slug`,
    [tempSlug],
  );
  return r.rows[0];
}

export async function getJournalDraft(id: number): Promise<StudioDraft | null> {
  const r = await pool.query<JournalRow>(
    `SELECT id, slug, title, excerpt, body, cover_image_url, studio_meta,
            published, published_at::text, updated_at::text
     FROM blog_posts WHERE id = $1`,
    [id],
  );
  const row = r.rows[0];
  if (!row) return null;
  const meta = liftLegacyMeta(readMeta(row.studio_meta), row.cover_image_url);
  return {
    id: row.id,
    kind: 'journal',
    title: row.title,
    subject: row.excerpt ?? '',
    // The composer textarea wants the plain-text source. Prefer the
    // saved bodySource (set on every PATCH after this fix); fall back
    // to converting the rendered HTML back to text for legacy rows or
    // entries that pre-date this column.
    body: meta.bodySource ?? htmlToComposerText(row.body),
    coverImageUrl: deriveCover(meta, row.cover_image_url),
    slug: row.slug,
    published: row.published,
    publishedAt: row.published_at,
    studioMeta: meta,
    updatedAt: row.updated_at,
  };
}

export interface JournalPatchInput {
  title?: string;
  subject?: string;
  body?: string;
  studioMeta?: StudioMeta;
}

// Auto-save a journal draft. Re-derives slug from title unless the
// user has manually touched it (tracked in studio_meta.slugTouched).
// The auto-derive is collision-safe: a TOCTOU between the slug SELECT
// and the UPDATE can race two parallel auto-saves into the same slug
// — the UNIQUE index throws 23505 in that case, which we catch and
// retry by walking past the new collision. The retry loop is bounded
// to keep a runaway from spinning forever.
export async function patchJournalDraft(
  id: number,
  input: JournalPatchInput,
): Promise<{ id: number; slug: string }> {
  // Pull current state so we can auto-derive slug + sanitize body in
  // one round-trip. If the row doesn't exist, callers translate the
  // null return into 404.
  //
  // Note: getJournalDraft returns body as plaintext (preferring
  // bodySource), but we need the raw `body` column for unchanged-body
  // patches. Re-read just the column we need — single primary-key
  // lookup.
  const current = await getJournalDraft(id);
  if (!current) throw new Error('not_found');

  const incomingMeta = input.studioMeta ?? {};
  // Persist the user's text source on every body change so the
  // textarea round-trips on reload. AI-generated drafts (HTML) get
  // converted to text on the client before reaching this path; here
  // we just store whatever was sent.
  const nextMeta: StudioMeta = {
    ...current.studioMeta,
    ...incomingMeta,
    ...(input.body != null ? { bodySource: input.body } : {}),
  };

  // Body — empty allowed (auto-save before user types). When non-empty,
  // run through composer-text so plain-text paragraphs survive publish,
  // then sanitize.
  let bodyNext: string | undefined;
  if (input.body != null) {
    bodyNext =
      input.body.trim().length === 0
        ? ''
        : sanitizeJournalHtml(composerTextToHtml(input.body));
  }

  // Cover derivation — first image in studioMeta wins. NULL if gallery empty.
  const coverNext = nextMeta.images?.[0]?.url ?? null;

  // Slug auto-derive runs inside a retry loop so a 23505 collision
  // bumps us to the next free suffix and we try again. 5 attempts is
  // far above any realistic concurrent-edit fan-out.
  for (let attempt = 0; attempt < 5; attempt++) {
    let resolvedSlug = current.slug;
    const titleNext = input.title ?? current.title;
    const shouldDerive =
      !nextMeta.slugTouched && input.title != null && titleNext.trim();
    if (shouldDerive) {
      const base = slugify(titleNext) || 'untitled';
      if (base !== current.slug) {
        const taken = new Set(
          (
            await pool.query<{ slug: string }>(
              'SELECT slug FROM blog_posts WHERE id <> $1',
              [id],
            )
          ).rows.map((r) => r.slug),
        );
        // On retry attempts, suffix beyond the highest known to dodge
        // whatever just won the race.
        if (attempt > 0) {
          taken.add(uniqueSlug(base, taken));
        }
        resolvedSlug = uniqueSlug(base, taken);
      }
    }

    const sets: string[] = ['updated_at = NOW()'];
    const vals: unknown[] = [];
    function add(col: string, val: unknown) {
      sets.push(`${col} = $${vals.length + 1}`);
      vals.push(val);
    }
    if (input.title != null) add('title', input.title);
    if (resolvedSlug !== current.slug) add('slug', resolvedSlug);
    if (input.subject != null) add('excerpt', input.subject || null);
    if (bodyNext != null) add('body', bodyNext);
    add('cover_image_url', coverNext);
    add('studio_meta', JSON.stringify(nextMeta));

    const sql = `UPDATE blog_posts SET ${sets.join(', ')}
                 WHERE id = $${vals.length + 1}
                 RETURNING id, slug`;
    vals.push(id);
    try {
      const r = await pool.query<{ id: number; slug: string }>(sql, vals);
      if (!r.rowCount) throw new Error('not_found');
      return r.rows[0];
    } catch (err) {
      if (err instanceof Error && (err as { code?: string }).code === '23505') {
        // Slug raced with a parallel write; loop and try the next free
        // suffix. If we couldn't derive (slugTouched, no title change),
        // the violation isn't slug-related — rethrow.
        if (!shouldDerive) throw err;
        continue;
      }
      throw err;
    }
  }
  throw new Error('slug_collision_retries_exhausted');
}

export async function deleteJournalDraft(id: number): Promise<boolean> {
  // Read the meta first so we can clean up R2 objects after the row
  // delete commits. Failures here are logged but don't block the row
  // delete — orphaned objects are recoverable via the listPublicPrefix
  // sweep, double-deleting a row that's already gone is not.
  const draft = await getJournalDraft(id);
  const r = await pool.query('DELETE FROM blog_posts WHERE id = $1', [id]);
  if (!r.rowCount) return false;
  if (draft) await sweepImagesFromR2(draft.studioMeta.images ?? []);
  return true;
}

// ─── Newsletter CRUD ────────────────────────────────────────────────

interface NewsletterRow {
  id: number;
  subject: string;
  preheader: string;
  body: string;
  cover_image_url: string | null;
  studio_meta: unknown;
  sent_broadcast_id: number | null;
  sent_at: string | null;
  updated_at: string;
}

export async function createNewsletterDraft(): Promise<{ id: number }> {
  const r = await pool.query<{ id: number }>(
    `INSERT INTO newsletter_drafts DEFAULT VALUES RETURNING id`,
  );
  return r.rows[0];
}

export async function getNewsletterDraft(id: number): Promise<StudioDraft | null> {
  const r = await pool.query<NewsletterRow>(
    `SELECT id, subject, preheader, body, cover_image_url, studio_meta,
            sent_broadcast_id, sent_at::text, updated_at::text
     FROM newsletter_drafts WHERE id = $1`,
    [id],
  );
  const row = r.rows[0];
  if (!row) return null;
  const meta = liftLegacyMeta(readMeta(row.studio_meta), row.cover_image_url);
  return {
    id: row.id,
    kind: 'newsletter',
    title: row.subject,
    subject: row.preheader,
    // Same source-preferred convention as the journal side — see
    // getJournalDraft for the rationale.
    body: meta.bodySource ?? htmlToComposerText(row.body),
    coverImageUrl: deriveCover(meta, row.cover_image_url),
    slug: null,
    published: row.sent_at != null,
    publishedAt: row.sent_at,
    studioMeta: meta,
    updatedAt: row.updated_at,
  };
}

export interface NewsletterPatchInput {
  title?: string;        // mapped to subject column (the email subject line)
  subject?: string;      // mapped to preheader
  body?: string;
  studioMeta?: StudioMeta;
}

export async function patchNewsletterDraft(
  id: number,
  input: NewsletterPatchInput,
): Promise<{ id: number }> {
  const current = await getNewsletterDraft(id);
  if (!current) throw new Error('not_found');

  // Newsletter drafts that have already been sent shouldn't be edited
  // through auto-save — they're an audit record. The composer should
  // either fork-to-new on open or surface read-only mode. For now we
  // hard-stop the patch.
  if (current.published) throw new Error('already_sent');

  // Persist the user's text source on body change so the textarea
  // round-trips on reload (same shape as the journal side).
  const nextMeta: StudioMeta = {
    ...current.studioMeta,
    ...(input.studioMeta ?? {}),
    ...(input.body != null ? { bodySource: input.body } : {}),
  };

  let bodyNext: string | undefined;
  if (input.body != null) {
    bodyNext =
      input.body.trim().length === 0
        ? ''
        : sanitizeJournalHtml(composerTextToHtml(input.body));
  }

  const coverNext = nextMeta.images?.[0]?.url ?? null;

  const sets: string[] = ['updated_at = NOW()'];
  const vals: unknown[] = [];
  function add(col: string, val: unknown) {
    sets.push(`${col} = $${vals.length + 1}`);
    vals.push(val);
  }
  if (input.title != null) add('subject', input.title);
  if (input.subject != null) add('preheader', input.subject);
  if (bodyNext != null) add('body', bodyNext);
  add('cover_image_url', coverNext);
  add('studio_meta', JSON.stringify(nextMeta));

  const sql = `UPDATE newsletter_drafts SET ${sets.join(', ')}
               WHERE id = $${vals.length + 1}
               RETURNING id`;
  vals.push(id);
  const r = await pool.query<{ id: number }>(sql, vals);
  if (!r.rowCount) throw new Error('not_found');
  return r.rows[0];
}

export async function deleteNewsletterDraft(id: number): Promise<boolean> {
  // Drafts only — sent newsletters live in broadcast_log and aren't
  // touched here. The schema FK is ON DELETE SET NULL, so deleting a
  // draft never breaks the broadcast audit.
  const draft = await getNewsletterDraft(id);
  const r = await pool.query(
    'DELETE FROM newsletter_drafts WHERE id = $1 AND sent_at IS NULL',
    [id],
  );
  if (!r.rowCount) return false;
  if (draft) await sweepImagesFromR2(draft.studioMeta.images ?? []);
  return true;
}

// Best-effort R2 cleanup on draft discard. We collected `key` on every
// upload so we can free the public bucket here; an image without a key
// (legacy / direct URL paste) is intentionally skipped — we don't want
// to derive an R2 key from a URL by guessing. Failures per object are
// logged and swallowed so a single bad delete doesn't block the rest.
async function sweepImagesFromR2(images: StudioImage[]): Promise<void> {
  for (const img of images) {
    if (!img.key) continue;
    try {
      await deletePublic(img.key);
    } catch (err) {
      logger.warn('studio image delete failed', { key: img.key, err });
    }
  }
}

// ─── Recent rail ────────────────────────────────────────────────────

export async function recentJournal(limit: number): Promise<RecentItem[]> {
  const r = await pool.query<{
    id: number;
    title: string;
    excerpt: string | null;
    published: boolean;
    updated_at: string;
  }>(
    `SELECT id, title, excerpt, published, updated_at::text
     FROM blog_posts
     ORDER BY updated_at DESC
     LIMIT $1`,
    [limit],
  );
  return r.rows.map((row) => ({
    id: row.id,
    kind: 'journal' as const,
    title: row.title || 'Untitled',
    subject: row.excerpt,
    status: row.published ? ('published' as const) : ('draft' as const),
    updatedAt: row.updated_at,
  }));
}

// Newsletter recent = union of in-flight drafts and sent broadcasts.
// Sent broadcasts live in broadcast_log; drafts live in newsletter_drafts.
// The UI clicks an item to load it back into the composer. Drafts open
// editable; sent broadcasts open as a read-only template (Phase 3).
export async function recentNewsletter(limit: number): Promise<RecentItem[]> {
  // Fan-out the two SELECTs — they're independent and each indexed,
  // so parallel issuing roughly halves the wall time on cold pools.
  const [drafts, sent] = await Promise.all([
    pool.query<{
      id: number;
      subject: string;
      preheader: string;
      sent_at: string | null;
      updated_at: string;
    }>(
      `SELECT id, subject, preheader, sent_at::text, updated_at::text
       FROM newsletter_drafts
       ORDER BY updated_at DESC
       LIMIT $1`,
      [limit],
    ),
    pool.query<{
      id: number;
      subject: string;
      sent_at: string;
    }>(
      `SELECT id, subject, sent_at::text
       FROM broadcast_log
       ORDER BY sent_at DESC
       LIMIT $1`,
      [limit],
    ),
  ]);

  const items: RecentItem[] = [
    ...drafts.rows.map((row) => ({
      id: row.id,
      kind: 'newsletter' as const,
      title: row.subject || 'Untitled',
      subject: row.preheader || null,
      status: (row.sent_at ? 'sent' : 'draft') as 'sent' | 'draft',
      updatedAt: row.updated_at,
    })),
    ...sent.rows.map((row) => ({
      // Sent broadcasts use a negative id space so the rail can route
      // them to a different load handler — they aren't editable drafts.
      id: -row.id,
      kind: 'newsletter' as const,
      title: row.subject || 'Untitled',
      subject: null,
      status: 'sent' as const,
      updatedAt: row.sent_at,
    })),
  ];

  items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return items.slice(0, limit);
}
