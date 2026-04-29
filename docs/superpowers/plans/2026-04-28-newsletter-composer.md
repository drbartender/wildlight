# Newsletter Composer Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the journal-to-newsletter pre-fill picker to the existing admin broadcast composer, sanitize broadcast HTML on send, and drop a forward-looking column for SP#6's limited-edition early-access window.

**Architecture:** Two file edits + one schema migration. The composer at `app/admin/subscribers/page.tsx` already has subject/body/test/full-send/preview-iframe — we add a "Start from journal entry" picker above the subject field that fetches `/api/admin/journal`, filters to published, and on selection mutates `setSubject` + `setHtml`. The existing send endpoint at `app/api/admin/subscribers/broadcast/route.ts` gains one line that pipes `html` through `sanitizeJournalHtml` before reaching `sendBroadcast`. Schema appends one nullable column.

**Tech Stack:** Next.js 16 · existing React composer state · `lib/journal-html.ts` (built in SP#3) · `pg` · `lib/schema.sql`.

**Spec:** `docs/superpowers/specs/2026-04-28-newsletter-composer-design.md`

**Note on scope:** The spec mentioned an "optional preview pane" — already shipped (sandboxed iframe at `app/admin/subscribers/page.tsx:319-334`). No work needed there.

---

## File Structure

**Modified:**
- `lib/schema.sql` — append `ALTER TABLE artwork_variants ADD COLUMN IF NOT EXISTS subscriber_early_access_until TIMESTAMPTZ;`
- `app/api/admin/subscribers/broadcast/route.ts` — sanitize `html` before passing to `sendBroadcast`
- `app/admin/subscribers/page.tsx` — picker state, fetch effect, picker UI block above the subject field

**No new files.**

---

## Task 1: Schema column for subscriber early-access (SP#6 hook)

**Files:**
- Modify: `lib/schema.sql` (append)

- [ ] **Step 1: Append the column**

Add at the end of `lib/schema.sql`:

```sql

-- Phase-2 hook for SP#6 limited editions: per-variant subscriber-only
-- early-access window. NULL means no gating (variant is public when active).
ALTER TABLE artwork_variants
  ADD COLUMN IF NOT EXISTS subscriber_early_access_until TIMESTAMPTZ;
```

- [ ] **Step 2: Apply the migration**

Run: `npm run migrate`
Expected: `schema applied`. Idempotent — `ADD COLUMN IF NOT EXISTS` no-ops on re-run.

- [ ] **Step 3: Verify typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: exit 0; 62 tests pass.

- [ ] **Step 4: Commit**

```bash
git add lib/schema.sql
git commit -m "feat(db): subscriber_early_access_until on artwork_variants

Forward-looking column for SP#6 limited editions. NULL means no
gating (default for current variants). SP#6 will populate this and
add the gating logic on the storefront.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Sanitize broadcast HTML on send

**Files:**
- Modify: `app/api/admin/subscribers/broadcast/route.ts`

- [ ] **Step 1: Add the sanitize import + apply at both send paths**

Find at line 6:
```ts
import { sendBroadcast } from '@/lib/email';
```

Add immediately after:
```ts
import { sanitizeJournalHtml } from '@/lib/journal-html';
```

Then find the test-send call at lines 27-32:

```ts
  if (p.data.testTo) {
    await sendBroadcast(p.data.subject, p.data.html, [p.data.testTo], {
      siteUrl,
      plainEmails: true,
    });
    return NextResponse.json({ sentTest: true });
  }
```

Replace with:

```ts
  // Defense in depth — even though admins are trusted, sanitize any HTML
  // that pasted in unwanted scripting. Same allowed-tags whitelist as the
  // journal body since these emails often link or excerpt journal content.
  const cleanHtml = sanitizeJournalHtml(p.data.html);

  if (p.data.testTo) {
    await sendBroadcast(p.data.subject, cleanHtml, [p.data.testTo], {
      siteUrl,
      plainEmails: true,
    });
    return NextResponse.json({ sentTest: true });
  }
```

Then find the full-send section. The two places that reference `p.data.html` are line 58 (the INSERT) and line 67 (the `sendBroadcast` call). Update both:

Line 58 — replace `p.data.html` with `cleanHtml` so the broadcast log records the sanitized version (what was actually sent):

```ts
    const claim = await client.query<{ id: number }>(
      `INSERT INTO broadcast_log (subject, html, recipient_count, sent_by, idempotency_key)
       VALUES ($1, $2, 0, $3, $4)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [p.data.subject, cleanHtml, session.email, idemKey],
    );
```

Line 67 — same:

```ts
    await sendBroadcast(p.data.subject, cleanHtml, subs, { siteUrl });
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/subscribers/broadcast/route.ts
git commit -m "feat(api): sanitize broadcast HTML on send

Pipes the body through sanitizeJournalHtml (built in SP#3) before
the test send and the full send. Strips script/iframe tags, event
handlers, and javascript:/data: URIs. The broadcast_log row stores
the sanitized version so what's audited matches what was sent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: "Start from journal entry" picker in the composer

**Files:**
- Modify: `app/admin/subscribers/page.tsx`

- [ ] **Step 1: Add the JournalEntry interface near the existing interfaces**

After the `BroadcastRow` interface declaration (around line 53), add:

```ts
interface JournalListEntry {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string;
  cover_image_url: string | null;
  published: boolean;
  published_at: string | null;
  updated_at: string;
}
```

The existing admin/journal API GET returns rows that match this shape (with the body included via the single-entry GET — but the list endpoint doesn't include body; we'll handle this in Step 5).

- [ ] **Step 2: Add picker state alongside the existing state hooks**

Find the existing `useState` block in `SubscribersInner()` (around lines 61-73):

```tsx
  const [rows, setRows] = useState<Row[]>([]);

  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState(
    `<p>Dear friends,</p>\n<p>…</p>\n<p>Dan</p>`,
  );
  const [testTo, setTestTo] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState<string>(() => crypto.randomUUID());

  const [broadcasts, setBroadcasts] = useState<BroadcastRow[]>([]);
  const [broadcastsLoading, setBroadcastsLoading] = useState(false);
```

Add after the `broadcastsLoading` line:

```tsx
  // Picker state — published journal entries available as starting points.
  const [journalEntries, setJournalEntries] = useState<JournalListEntry[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
```

- [ ] **Step 3: Fetch the journal list when the broadcast tab opens**

Find the existing `useEffect` that fetches `/api/admin/subscribers/broadcasts` (around lines 82-90):

```tsx
  useEffect(() => {
    if (tab !== 'history') return;
    setBroadcastsLoading(true);
    fetch('/api/admin/subscribers/broadcasts')
      .then((r) => r.json())
      .then((d: { rows: BroadcastRow[] }) => setBroadcasts(d.rows))
      .catch(() => setBroadcasts([]))
      .finally(() => setBroadcastsLoading(false));
  }, [tab]);
```

Add a sibling `useEffect` immediately after:

```tsx
  // Load published journal entries when the broadcast tab opens, so the
  // "Start from journal entry" picker has data ready.
  useEffect(() => {
    if (tab !== 'broadcast') return;
    fetch('/api/admin/journal')
      .then((r) => r.json())
      .then((d: { entries: JournalListEntry[] }) =>
        setJournalEntries(d.entries.filter((e) => e.published)),
      )
      .catch(() => setJournalEntries([]));
  }, [tab]);
```

- [ ] **Step 4: Add the pre-fill helper function**

Below the existing `send` function (around line 116), add:

```tsx
  // Load the picked entry's full body via the single-entry GET, then build
  // a newsletter-shaped wrapper around it. The list endpoint doesn't return
  // body, so this second fetch is unavoidable.
  async function preFillFromEntry(entry: JournalListEntry) {
    const r = await fetch(`/api/admin/journal/${entry.id}`);
    if (!r.ok) {
      setError('could not load chapter');
      return;
    }
    const d = (await r.json()) as { entry: JournalListEntry };
    const e = d.entry;

    const journalUrl = `${
      typeof window !== 'undefined' ? window.location.origin : ''
    }/journal/${e.slug}`;
    const cover = e.cover_image_url
      ? `<img src="${e.cover_image_url}" alt="${e.title}" style="max-width:100%;height:auto;display:block;margin-bottom:16px;" />\n`
      : '';
    const blurb = e.excerpt
      ? `<p>${e.excerpt}</p>`
      : `<p>${e.body
          .replace(/<[^>]+>/g, '')
          .slice(0, 240)
          .trim()}…</p>`;

    setSubject(e.title);
    setHtml(
      `${cover}<p>Friends —</p>\n${blurb}\n<p><a href="${journalUrl}">Read the full chapter →</a></p>\n<p>— Dan</p>`,
    );
    setPickerOpen(false);
  }
```

- [ ] **Step 5: Render the picker block above the subject field**

Find the broadcast tab body — look for the line that opens the composer card (around line 213):

```tsx
        {tab === 'broadcast' && (
          <div className="wl-adm-broadcast">
            <div
              className="wl-adm-card"
              style={{ padding: 20, display: 'grid', gap: 14 }}
            >
              <label className="wl-adm-field">
                <span className="wl-adm-field-label">Subject</span>
```

Insert the picker UI immediately after `<div className="wl-adm-card" style={...}>` opens and before the Subject `<label>`:

```tsx
        {tab === 'broadcast' && (
          <div className="wl-adm-broadcast">
            <div
              className="wl-adm-card"
              style={{ padding: 20, display: 'grid', gap: 14 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  className="wl-adm-btn small ghost"
                  disabled={journalEntries.length === 0}
                  onClick={() => setPickerOpen((o) => !o)}
                  title={
                    journalEntries.length === 0
                      ? 'Publish a chapter first to use this.'
                      : undefined
                  }
                >
                  {pickerOpen ? 'Hide chapters' : 'Start from journal entry →'}
                </button>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--adm-muted)',
                    fontFamily: 'var(--f-mono), monospace',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                  }}
                >
                  {journalEntries.length} published
                </span>
              </div>
              {pickerOpen && (
                <div
                  style={{
                    border: '1px solid var(--adm-rule)',
                    borderRadius: 4,
                    background: 'var(--adm-paper-2)',
                    maxHeight: 320,
                    overflowY: 'auto',
                  }}
                >
                  {journalEntries.length === 0 ? (
                    <div
                      style={{
                        padding: 16,
                        color: 'var(--adm-muted)',
                        fontSize: 13,
                      }}
                    >
                      No published chapters yet.
                    </div>
                  ) : (
                    journalEntries.map((e, i) => (
                      <div
                        key={e.id}
                        style={{
                          padding: '12px 16px',
                          borderBottom:
                            i < journalEntries.length - 1
                              ? '1px solid var(--adm-rule)'
                              : 'none',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 500 }}>
                            {e.title}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: 'var(--adm-muted)',
                              marginTop: 2,
                            }}
                          >
                            {e.excerpt
                              ? e.excerpt.slice(0, 120) +
                                (e.excerpt.length > 120 ? '…' : '')
                              : '—'}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--adm-muted)',
                              fontFamily: 'var(--f-mono), monospace',
                              letterSpacing: '0.12em',
                              marginTop: 4,
                            }}
                          >
                            {e.published_at
                              ? new Date(e.published_at).toLocaleDateString()
                              : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="wl-adm-btn small"
                          onClick={() => void preFillFromEntry(e)}
                        >
                          Use this →
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
              <label className="wl-adm-field">
                <span className="wl-adm-field-label">Subject</span>
```

(The closing `<label>` continues with the existing subject input — no changes there.)

- [ ] **Step 6: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add app/admin/subscribers/page.tsx
git commit -m "feat(admin): broadcast composer — start from journal entry picker

Adds a 'Start from journal entry' button above the subject field.
Click opens an inline panel listing published chapters; 'Use this →'
on a row fetches the full entry, then populates subject (title) and
body HTML with a newsletter wrapper: optional cover image, opener,
excerpt or first 240 chars, link to the chapter, sign-off.

The button is disabled with a tooltip when no chapters are
published. The picker collapses after a selection. Existing
preview iframe automatically renders the populated body.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Manual verification

**Files:** None.

- [ ] **Step 1: Start dev server**

Run: `npm run dev`
Wait until ready.

- [ ] **Step 2: Sign in as admin and navigate to the composer**

Visit `http://localhost:3000/admin/subscribers?tab=broadcast`. The composer renders with the new button at top: "Start from journal entry →" or disabled with tooltip if no chapters are published.

- [ ] **Step 3: Picker disabled state**

If you have zero published journal entries, the button is disabled and the count chip reads `0 published`. Hovering the button shows the tooltip "Publish a chapter first to use this."

- [ ] **Step 4: Picker populated state**

If you have at least one published chapter (create one through `/admin/journal/new` if needed), the button is enabled and the count chip reflects it. Click the button — the inline picker panel shows each chapter with title, excerpt, and publish date.

- [ ] **Step 5: Pre-fill works**

Click "Use this →" on a chapter. The Subject field populates with the chapter title. The Body textarea populates with the wrapper HTML (cover image if present, "Friends —" opener, excerpt, "Read the full chapter →" link to `/journal/<slug>`, "— Dan" sign-off). The picker panel collapses. The existing right-side Preview iframe renders the populated body correctly.

- [ ] **Step 6: Sanitize on test send**

Manually edit the body to add `<script>alert('hi')</script>` somewhere. Send a test to your own email. Open the received email — the script tag is stripped, only the safe content remains.

- [ ] **Step 7: Sanitize on full send**

(Skip this if production-only — the full send writes to the broadcast log. Instead verify the SQL row directly:)

```bash
node -e "require('dotenv').config({path:'.env.local'});require('./lib/db').pool.query('SELECT html FROM broadcast_log ORDER BY id DESC LIMIT 1').then(r=>{console.log(r.rows[0]?.html?.includes('<script>'));process.exit(0)})"
```

Expected: `false` — the most recent broadcast log entry has no script tags.

- [ ] **Step 8: Run final tests**

Run: `npm run typecheck && npm test`
Expected: exit 0; 62 tests pass.

- [ ] **Step 9: Stop dev server**

If running, stop the dev server (Ctrl+C or kill).

---

## Self-Review

**Spec coverage:**
- ✓ "Start from journal entry" picker — Task 3.
- ✓ Pre-fill subject + body HTML wrapper with cover/excerpt/link/signoff — Task 3 Step 4.
- ✓ Picker disabled when zero published — Task 3 Step 5.
- ✓ Picker auto-collapses on selection — Task 3 Step 4 (`setPickerOpen(false)`).
- ✓ Sanitize broadcast HTML on send (test + full + audit log) — Task 2.
- ✓ `subscriber_early_access_until` column — Task 1.
- ✓ Optional preview pane — already shipped (no work needed; noted in plan header).

**Placeholder scan:** No "TBD" / "TODO" remaining. Each step has the actual code.

**Type consistency:** `JournalListEntry` interface in Task 3 matches the shape returned by `/api/admin/journal` (Step 1) and `/api/admin/journal/[id]` (Step 4 — single GET). The existing composer's state hooks (`subject`, `html`, etc) are reused; the helper `preFillFromEntry` calls only `setSubject`, `setHtml`, `setPickerOpen` — all defined.
