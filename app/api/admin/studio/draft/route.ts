export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/session';
import { logger } from '@/lib/logger';
import { createJournalDraft, createNewsletterDraft } from '@/lib/studio-drafts';
import { recordAndCheckRateLimit } from '@/lib/rate-limit';
import { isTransientPgError, withConnRetry } from '@/lib/db';

// POST /api/admin/studio/draft  body { kind } → { id, kind }
//
// Creates an empty row of the right shape so the composer can start
// auto-saving via PATCH /draft/[id]. Mirrors the pattern of the New
// Chapter button on the old journal admin — one click, one row, then
// the composer takes over.
const Body = z.object({
  kind: z.enum(['journal', 'newsletter']),
});

export async function POST(req: Request) {
  const session = await requireAdmin();
  try {
    // Cap blank-row creation. The composer auto-creates exactly one row
    // per "New entry" click, so a normal session does ≤10 of these per
    // hour. 30/hour leaves room for legitimate bursts (rapid kind-switch
    // restarts) without letting a stolen cookie pollute the table.
    // withConnRetry handles a single Neon idle-drop on either the rate
    // limit's transactional INSERT or the create — both are idempotent
    // (the slug uses a Date.now/random salt, the rate-limit row is just
    // an attempt counter that's safe to double-write).
    const gate = await withConnRetry(() =>
      recordAndCheckRateLimit('studio-draft-create', session.email, 3600, 30),
    );
    if (gate.blocked) {
      return NextResponse.json(
        { error: 'too many drafts — try again later' },
        {
          status: 429,
          headers: gate.retryAfter
            ? { 'Retry-After': String(gate.retryAfter) }
            : undefined,
        },
      );
    }
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid input' }, { status: 400 });
    }

    if (parsed.data.kind === 'journal') {
      const r = await withConnRetry(() => createJournalDraft());
      return NextResponse.json({ id: r.id, kind: 'journal' });
    }
    const r = await withConnRetry(() => createNewsletterDraft());
    return NextResponse.json({ id: r.id, kind: 'newsletter' });
  } catch (err) {
    const transient = isTransientPgError(err);
    logger.error('studio draft create failed', err, { transient });
    if (transient) {
      return NextResponse.json(
        { error: 'database connection dropped — please retry' },
        { status: 503, headers: { 'Retry-After': '1' } },
      );
    }
    return NextResponse.json({ error: 'create failed' }, { status: 500 });
  }
}
