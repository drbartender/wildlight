export const runtime = 'nodejs';
// Newsletter sends iterate active subscribers in batches of 50 (the
// existing sendBroadcast batch size). 1,000 subscribers ≈ 20 batches;
// well under the 120s ceiling.
export const maxDuration = 120;

import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool, parsePathId, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { logger } from '@/lib/logger';
import {
  getJournalDraft,
  getNewsletterDraft,
  type StudioKind,
  type StudioMeta,
} from '@/lib/studio-drafts';
import { slugify } from '@/lib/slug';
import { sanitizeJournalHtml } from '@/lib/journal-html';
import {
  sendBroadcast,
  renderComposerBroadcast,
  type BroadcastRecipient,
} from '@/lib/email';
import { recordAndCheckRateLimit } from '@/lib/rate-limit';
import type { PoolClient } from 'pg';

// POST /api/admin/studio/draft/[id]/publish?kind=journal|newsletter
// body: { crossPublish?: boolean }
//
// Newsletter publish ordering (after review feedback):
//   1. Inside ONE transaction:
//        a. (optional) INSERT mirror blog_posts row with race-safe slug
//        b. Render the broadcast HTML using the mirror slug (if any)
//        c. INSERT broadcast_log with ON CONFLICT (idempotency_key)
//           DO NOTHING. If we get zero rows back, throw to roll back —
//           rolling back also undoes the mirror INSERT, so retries can't
//           leave orphan published mirrors.
//   2. After commit, fetch subscribers and call sendBroadcast.
//   3. In a second transaction, stamp the draft + update recipient_count.
//
// Journal publish ordering:
//   1. UPDATE blog_posts SET published = TRUE (idempotent via COALESCE).
//   2. If crossPublish: claim broadcast_log row, send.
//
// Zero-subscriber handling: the claim still INSERTs a real broadcast_log
// row (recipient_count = 0). The draft's sent_broadcast_id FK is satisfied;
// nothing actually mails out. The history page shows the row as a 0-recipient
// send for audit clarity.

const Body = z.object({
  crossPublish: z.boolean().optional(),
});

function readKind(req: Request): StudioKind | null {
  const k = new URL(req.url).searchParams.get('kind');
  return k === 'journal' || k === 'newsletter' ? k : null;
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(
    /\/$/,
    '',
  );
}

// ─── Deterministic UUID v5 ────────────────────────────────────────
//
// broadcast_log.idempotency_key is UUID-typed; PG accepts only valid
// RFC 4122 UUIDs. We hash a fixed namespace + the seed and write the
// version (5) and variant (10) bits per spec. Same seed → same UUID,
// so retries collide on the unique index and ON CONFLICT DO NOTHING
// dedups them.

// Standard URL namespace UUID — fixed, public, defined in RFC 4122.
const NS_UUID = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
const NS_BYTES = Buffer.from(NS_UUID.replace(/-/g, ''), 'hex');

function uuidV5(seed: string): string {
  const hash = createHash('sha1');
  hash.update(NS_BYTES);
  hash.update(`wildlight-studio:${seed}`);
  const digest = hash.digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  // Set version (top nibble of byte 6) → 0101 (v5).
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  // Set variant (top two bits of byte 8) → 10 (RFC 4122).
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  const kind = readKind(req);
  if (!kind) return NextResponse.json({ error: 'kind required' }, { status: 400 });
  const id = parsePathId((await ctx.params).id);
  if (id == null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  // 5 publishes per hour per admin caps mass-mail blast risk from a
  // stolen cookie. Idempotency key already blocks re-sending the same
  // draft id, but a malicious actor could spin fresh drafts and burn
  // through subscribers without this. Genuinely-bursty operators (rare)
  // can bump the cap.
  const gate = await recordAndCheckRateLimit(
    'studio-publish',
    session.email,
    3600,
    5,
  );
  if (gate.blocked) {
    return NextResponse.json(
      { error: 'too many publishes — try again later' },
      {
        status: 429,
        headers: gate.retryAfter
          ? { 'Retry-After': String(gate.retryAfter) }
          : undefined,
      },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }
  const crossPublish = parsed.data.crossPublish ?? false;

  try {
    if (kind === 'journal') {
      return await publishJournal(id, crossPublish, session.email);
    }
    return await publishNewsletter(id, crossPublish, session.email);
  } catch (err) {
    logger.error('studio publish failed', err, { id, kind });
    return NextResponse.json({ error: 'publish failed' }, { status: 500 });
  }
}

// ─── Journal publish ─────────────────────────────────────────────

async function publishJournal(
  id: number,
  crossPublish: boolean,
  by: string,
): Promise<Response> {
  const draft = await getJournalDraft(id);
  if (!draft) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!draft.title.trim() || !draft.body.trim()) {
    return NextResponse.json(
      { error: 'title and body required to publish' },
      { status: 400 },
    );
  }

  // Read the rendered HTML (the body column) directly — getJournalDraft
  // returns the textarea-shaped source, but the broadcast template
  // expects HTML.
  const htmlBody = await readBlogPostBodyHtml(id);
  if (htmlBody == null) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const r = await pool.query<{
    id: number;
    slug: string;
    published_at: string | null;
  }>(
    `UPDATE blog_posts
     SET published = TRUE,
         published_at = COALESCE(published_at, NOW()),
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, slug, published_at::text`,
    [id],
  );
  if (!r.rowCount) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const row = r.rows[0];

  let crossSent = 0;
  let crossSkippedDuplicate = false;
  if (crossPublish) {
    const url = `${siteUrl()}/journal/${row.slug}`;
    const html = renderComposerBroadcast({
      subject: draft.title,
      bodyHtml: htmlBody,
      coverImageUrl: draft.coverImageUrl,
      crosslinkUrl: url,
      siteUrl: siteUrl(),
    });
    const result = await claimAndSend({
      subject: draft.title,
      html,
      sentBy: by,
      idempotencyKey: uuidV5(`journal-cross-${id}`),
    });
    if (result.duplicate) crossSkippedDuplicate = true;
    else crossSent = result.sent;
  }

  return NextResponse.json({
    id: row.id,
    slug: row.slug,
    publishedAt: row.published_at,
    crossSent,
    crossSkippedDuplicate,
  });
}

// ─── Newsletter publish ──────────────────────────────────────────

async function publishNewsletter(
  id: number,
  crossPublish: boolean,
  by: string,
): Promise<Response> {
  const draft = await getNewsletterDraft(id);
  if (!draft) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (draft.published) {
    return NextResponse.json(
      { error: 'newsletter already sent' },
      { status: 409 },
    );
  }
  if (!draft.title.trim()) {
    return NextResponse.json(
      { error: 'subject line required to send' },
      { status: 400 },
    );
  }
  if (!draft.body.trim()) {
    return NextResponse.json(
      { error: 'body required to send' },
      { status: 400 },
    );
  }

  // The composer textarea source is in draft.body; the rendered HTML
  // for the email lives in newsletter_drafts.body. Read it here.
  const htmlBody = await readNewsletterBodyHtml(id);
  if (htmlBody == null) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // Phase 1: transactional claim + (optional) mirror.
  // The throw on duplicate triggers withTransaction rollback, which
  // also undoes the mirror INSERT — so a retry of an already-sent
  // newsletter never accumulates orphan published mirrors.
  let phaseOne: {
    logId: number;
    cleanHtml: string;
    crossSlug: string | null;
    crossId: number | null;
  } | null = null;
  let phaseOneFailureReason: 'duplicate' | null = null;

  try {
    phaseOne = await withTransaction(async (client) => {
      let crossSlug: string | null = null;
      let crossId: number | null = null;
      if (crossPublish) {
        const m = await insertMirrorBlogPost(client, {
          title: draft.title,
          excerpt: draft.subject || null,
          bodyHtml: htmlBody,
          coverImageUrl: draft.coverImageUrl,
          studioMeta: draft.studioMeta,
        });
        crossSlug = m.slug;
        crossId = m.id;
      }

      const html = renderComposerBroadcast({
        subject: draft.title,
        bodyHtml: htmlBody,
        coverImageUrl: draft.coverImageUrl,
        crosslinkUrl: crossSlug ? `${siteUrl()}/journal/${crossSlug}` : null,
        siteUrl: siteUrl(),
      });
      const cleanHtml = sanitizeJournalHtml(html);

      const claim = await client.query<{ id: number }>(
        `INSERT INTO broadcast_log (subject, html, recipient_count, sent_by, idempotency_key)
         VALUES ($1, $2, 0, $3, $4)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [draft.title, cleanHtml, by, uuidV5(`newsletter-${id}`)],
      );
      if (!claim.rowCount) {
        // Throwing here both signals duplicate to the catch below AND
        // rolls back the mirror insert. The thrown error type is checked
        // outside the transaction.
        throw new DuplicatePublishError();
      }
      return {
        logId: claim.rows[0].id,
        cleanHtml,
        crossSlug,
        crossId,
      };
    });
  } catch (err) {
    if (err instanceof DuplicatePublishError) {
      phaseOneFailureReason = 'duplicate';
    } else {
      throw err;
    }
  }

  if (phaseOneFailureReason === 'duplicate' || !phaseOne) {
    return NextResponse.json(
      {
        error:
          'newsletter already sent — refresh and load the broadcast from history',
      },
      { status: 409 },
    );
  }

  // Phase 2: send. Outside the transaction because Resend can't be
  // rolled back. If this throws, the broadcast_log row is already
  // committed; the operator sees a 500 with logs and can verify
  // partial-send state through history.
  const subs = await pool
    .query<{ id: number; email: string }>(
      `SELECT id, email FROM subscribers
       WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL`,
    )
    .then((r) => r.rows);

  if (subs.length > 0) {
    const recipients: BroadcastRecipient[] = subs;
    await sendBroadcast(draft.title, phaseOne.cleanHtml, recipients, {
      siteUrl: siteUrl(),
    });
  }

  // Phase 3: stamp draft + update recipient_count in one transaction
  // so the audit log and the draft state move together.
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE broadcast_log SET recipient_count = $1 WHERE id = $2`,
      [subs.length, phaseOne!.logId],
    );
    await client.query(
      `UPDATE newsletter_drafts
       SET sent_broadcast_id = $1, sent_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [phaseOne!.logId, id],
    );
  });

  return NextResponse.json({
    id,
    sent: subs.length,
    broadcastLogId: phaseOne.logId,
    crossBlogPostId: phaseOne.crossId,
    crossSlug: phaseOne.crossSlug,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────

class DuplicatePublishError extends Error {
  constructor() {
    super('duplicate idempotency key');
    this.name = 'DuplicatePublishError';
  }
}

interface SendArgs {
  subject: string;
  html: string;
  sentBy: string;
  idempotencyKey: string;
}

interface SendResult {
  sent: number;
  broadcastLogId: number;
  duplicate: boolean;
}

// Used only by the journal cross-publish path. Newsletter goes through
// the inline transactional flow above so mirror + claim can roll back
// together. Zero-subscriber sends still claim the row so retries
// continue to dedup.
async function claimAndSend(args: SendArgs): Promise<SendResult> {
  const cleanHtml = sanitizeJournalHtml(args.html);

  let logId = 0;
  await withTransaction(async (client) => {
    const claim = await client.query<{ id: number }>(
      `INSERT INTO broadcast_log (subject, html, recipient_count, sent_by, idempotency_key)
       VALUES ($1, $2, 0, $3, $4)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [args.subject, cleanHtml, args.sentBy, args.idempotencyKey],
    );
    if (claim.rowCount) logId = claim.rows[0].id;
  });
  if (!logId) {
    return { sent: 0, broadcastLogId: 0, duplicate: true };
  }

  const subs = await pool
    .query<{ id: number; email: string }>(
      `SELECT id, email FROM subscribers
       WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL`,
    )
    .then((r) => r.rows);

  if (subs.length > 0) {
    const recipients: BroadcastRecipient[] = subs;
    await sendBroadcast(args.subject, cleanHtml, recipients, {
      siteUrl: siteUrl(),
    });
    await pool.query(
      `UPDATE broadcast_log SET recipient_count = $1 WHERE id = $2`,
      [subs.length, logId],
    );
  }

  return { sent: subs.length, broadcastLogId: logId, duplicate: false };
}

async function readBlogPostBodyHtml(id: number): Promise<string | null> {
  const r = await pool.query<{ body: string }>(
    'SELECT body FROM blog_posts WHERE id = $1',
    [id],
  );
  return r.rows[0]?.body ?? null;
}

async function readNewsletterBodyHtml(id: number): Promise<string | null> {
  const r = await pool.query<{ body: string }>(
    'SELECT body FROM newsletter_drafts WHERE id = $1',
    [id],
  );
  return r.rows[0]?.body ?? null;
}

// ─── Cross-publish: newsletter → journal ─────────────────────────

interface MirrorInput {
  title: string;
  excerpt: string | null;
  bodyHtml: string;
  coverImageUrl: string | null;
  studioMeta: StudioMeta;
}

// Race-safe mirror INSERT. INSERT … ON CONFLICT (slug) DO NOTHING +
// suffix walk handles two simultaneous mirrors of the same subject.
// 50 attempts is the same ceiling the existing /api/admin/journal POST
// uses for new chapters.
async function insertMirrorBlogPost(
  client: PoolClient,
  input: MirrorInput,
): Promise<{ id: number; slug: string }> {
  const baseSlug = slugify(input.title) || 'untitled';
  const meta = JSON.stringify({
    images: input.studioMeta.images ?? [],
    chooseForMe: !!input.studioMeta.chooseForMe,
    seo: input.studioMeta.seo,
    bodySource: input.studioMeta.bodySource,
  });

  for (let attempt = 0; attempt < 50; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    const r = await client.query<{ id: number; slug: string }>(
      `INSERT INTO blog_posts
         (slug, title, excerpt, body, cover_image_url, studio_meta,
          published, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW())
       ON CONFLICT (slug) DO NOTHING
       RETURNING id, slug`,
      [
        slug,
        input.title,
        input.excerpt,
        input.bodyHtml,
        input.coverImageUrl,
        meta,
      ],
    );
    if (r.rowCount) return r.rows[0];
  }
  throw new Error('mirror_slug_collision_retries_exhausted');
}
