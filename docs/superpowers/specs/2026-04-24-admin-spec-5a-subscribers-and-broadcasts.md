# Admin Redesign — Sub-project 5a: Subscribers + Broadcast Composer + History

**Date:** 2026-04-24
**Status:** Spec
**Parent:** `2026-04-24-admin-redesign-overview.md`

## Design invariant

Atelier and Darkroom are independent visual languages over the same
data. The subscribers composer in Atelier is an editorial form with a
side preview card; in Darkroom it's a terminal-panel form with a mono
preview; history in Atelier is a single-row summary treatment, in
Darkroom it's a full analytics table. Do not converge the two.

## Target mockup

- `atelier.jsx:679–760` — `ASubscribers`. Tab row under a rule
  (`Subscribers` / `New broadcast` / `History`), active underlined
  green. List tab: single card table; muted date column; status pill.
  Broadcast tab: `1fr 340px` grid with Subject + Body-HTML textarea +
  test-to email + `Send test` / `Send to N subscribers`; right
  column: `Preview` card rendered in serif. History tab: single-line
  summary card ("Last broadcast: … sent March 18 to 1,214 subscribers
  · 62% open · 14% click").
- `darkroom.jsx:699–800` — `DSubscribers`. Tab pills (`subscribers
  [N]` / `new_broadcast` / `history [N]`), active = teal on
  `panel`. List tab: mono panel table. Broadcast tab: `1fr 300px`
  grid — left panel is mono form + `→ send to N subscribers` primary
  button; right panel is `preview · rendered` with the preview
  rendered in sans at reduced size. History tab: panel table with
  `sent_at`, `subject`, `recipients` right, `open_rate` right (teal),
  `click_rate` right (teal).
- Open `Wildlight Admin.html` locally to compare.

## Scope

1. **New `broadcast_log` table.** Capture every successful broadcast
   so the History tab stops being a placeholder.
2. **Instrument `broadcast/route.ts`** to INSERT a row on successful
   non-test send.
3. **New `GET /api/admin/subscribers/broadcasts`** to list log rows
   for the History tab.
4. **History tab reads real data** in each skin:
   - Atelier: editorial list of broadcasts, one per row with subject
     serif, muted date, mono recipient count. (No open/click rates
     — Resend doesn't expose them via the API reliably enough to
     report. Flag in the UI as "delivery only".)
   - Darkroom: tabular panel with `sent_at`, `subject`, `recipients`.
     Open / click rate columns **rendered as `—` placeholders** with
     a muted TODO in the footer — we don't have that data yet.
4. **Both skins keep real send via Resend.** That wiring is already
   in `app/api/admin/subscribers/broadcast/route.ts`. Verified here,
   not re-implemented.
5. **Per-send idempotency key.** A hidden field in the composer
   carries a client-generated UUID; the endpoint refuses a duplicate
   send with the same key inside an hour. Prevents double-sends on
   accidental double-click.
6. **Composer layout per skin**. Atelier = `AField`-style editorial
   form + preview in serif (`A.serif` body, `A.sans` header lock-up);
   Darkroom = mono form + preview rendered in sans but reduced +
   `→ send to N subscribers` mono primary.

## Non-goals

- No drip sequences / automations.
- No segmentation — "send to all active subscribers" is the only
  target.
- No rich-text editor. Textarea + HTML preview only.
- No open/click rate tracking (would require Resend webhook wiring
  and link rewriting — out of scope).
- No CSV import of subscribers (out of scope; they arrive via the
  shop email capture strip).
- No unsubscribe page redesign. `/unsubscribe` is a shop concern.

## Current state

- `app/admin/subscribers/page.tsx` — already has the 3-tab UI. One
  DOM shape for both skins today; the per-skin differences are in
  CSS scope only. This spec splits the content shape per tab per
  skin where the mockups diverge.
- `app/api/admin/subscribers/broadcast/route.ts` — real Resend send
  via `lib/email.sendBroadcast`. Test send with `testTo`; full send
  pulls `id, email` from `subscribers` where `confirmed_at IS NOT
  NULL AND unsubscribed_at IS NULL`.
- `app/api/admin/subscribers/route.ts` — list endpoint; returns rows
  for the list tab. No change.
- History tab placeholder copy lives at `app/admin/subscribers/
  page.tsx:283–287`. Remove in this spec.

## Schema

Append to `lib/schema.sql`, in the "Idempotent post-create migrations"
block. Safe to re-run.

```sql
-- Broadcast log (capture each successful non-test send) -------------
CREATE TABLE IF NOT EXISTS broadcast_log (
  id               SERIAL PRIMARY KEY,
  subject          TEXT NOT NULL,
  html             TEXT NOT NULL,
  recipient_count  INT NOT NULL,
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_by          TEXT,                              -- admin email, FK-free
  idempotency_key  UUID UNIQUE                        -- prevents double-sends
);

CREATE INDEX IF NOT EXISTS idx_broadcast_log_sent_at
  ON broadcast_log(sent_at DESC);
```

## Writes

Modify `app/api/admin/subscribers/broadcast/route.ts`:

- Extend request body schema with `idempotencyKey: z.string().uuid()`
  (required — frontend and backend deploy together in this app, so
  there's no mixed-version window to tolerate).
- On the full-send path (the branch that currently does `SELECT …
  FROM subscribers`), wrap the operation in a transaction. Before
  sending, attempt:

  ```sql
  INSERT INTO broadcast_log (subject, html, recipient_count, sent_by, idempotency_key)
  VALUES ($1, $2, 0, $3, $4)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id;
  ```

  If `RETURNING id` is empty, refuse the send with `409 { error:
  'duplicate' }`. Otherwise carry on.
- After `sendBroadcast` succeeds, `UPDATE broadcast_log SET
  recipient_count = $1 WHERE id = $2` with the actual count. If
  `sendBroadcast` throws, roll back the transaction (the insert
  disappears, and the admin can retry safely).
- `sent_by` comes from `(await requireAdmin()).email`.

### Endpoint for reads

New `app/api/admin/subscribers/broadcasts/route.ts`:

```ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export async function GET() {
  await requireAdmin();
  const { rows } = await pool.query<{
    id: number;
    subject: string;
    recipient_count: number;
    sent_at: string;
    sent_by: string | null;
  }>(
    `SELECT id, subject, recipient_count, sent_at, sent_by
     FROM broadcast_log
     ORDER BY sent_at DESC
     LIMIT 200`,
  );
  return NextResponse.json({ rows });
}
```

## Reads

Client fetches on History tab mount, then renders per skin.

## Layout per skin

### `/admin/subscribers` — Atelier (`ASubscribers`)

- Tab row under a 1px rule line, `flex: 1`. Each tab has 2px bottom
  border `green` when active, transparent otherwise. Right-side
  small muted text: `{activeCount} active · {total} total`.
- **List tab**: single card table (8px radius, rule border), header
  row in `paperAlt`. Columns: `Email`, `Source` (mono muted),
  `Joined` (muted, smart relative), `Status` (`AdminPill`).
- **Broadcast tab**: `1fr 340px` grid.
  - Left card: `AField`-style Subject input, then a
    `Body · HTML` label above a textarea (220px min-height, mono
    12px, soft-rule border, paper background). Controls row:
    test-to email input + `Send test` ghost small button; spacer;
    `Send to {active} subscribers` primary.
  - Right card: `Preview` label + a paper-bordered inner box with
    the wordmark stamp at the top (mono uppercase letter-spacing),
    the subject as serif 18px, and the HTML body rendered in
    serif (`A.serif`, 14px, ink2, line-height 1.6). Links show in
    green.
- **History tab**: editorial list — one entry per row, each entry
  has:
  - Serif 16px subject
  - Muted mono datetime + mono recipient count (e.g.
    `Mar 18 · 09:00 · 1,214 recipients`)
  - Muted sent-by email on the right.
  - Hover: subtle `paperAlt` wash.
  Rendered as a single card with `rule`-separated rows. No open/click
  columns.

### `/admin/subscribers` — Darkroom (`DSubscribers`)

- Tab pill row: each tab is a mono small button; selected tab has
  `panel` bg + teal label + inset 1px `rule` shadow. Subject labels
  carry counts in brackets: `subscribers [N]`, `history [N]`. Right
  side muted text: `active: N · pending: N · unsub: N`.
- **List tab**: mono panel table (4px radius, rule border). Columns
  are lowercase: `email` (ink), `source` (muted), `joined` (muted),
  `status` (`AdminPill`).
- **Broadcast tab**: `1fr 300px` grid.
  - Left panel: `DField`-style Subject, then `body_html` muted
    label above a mono textarea (200px min-height, `bg` background,
    3px radius, ink text). Controls row: test-to input (mono, thin),
    `send test` small button, spacer, `→ send to N subscribers`
    primary mono button.
  - Right panel: `preview · rendered` label; inner box in `bg`
    background, rendered preview in sans (`D.sans`, 12px, ink2).
    Wordmark stamp in mono uppercase. Subject in sans 14px ink.
    Links teal.
- **History tab**: mono panel table. Columns: `sent_at` (muted),
  `subject` (ink), `recipients` (right), `open_rate` (right, teal,
  `—` placeholder), `click_rate` (right, teal, `—` placeholder).
  Footer note in the panel: `// open/click rates not tracked yet —
  requires resend webhook + link rewriting`.

## Testing

- Unit: `tests/lib/broadcast-idempotency.test.ts` — if the
  idempotency insert helper lands as a small module, test the
  `ON CONFLICT DO NOTHING` path.
- Manual:
  - Click `Send test` to a known inbox; verify arrival.
  - Click `Send to N` (on a staging DB with one or two test rows),
    verify a `broadcast_log` row appears and the History tab shows
    it in both skins.
  - Rapid-double-click `Send to N`: second click should see `409
    duplicate`.

## Rollout

Single PR. Additive schema. Backfill: no — historical sends from
before the ledger aren't recoverable (Resend retains message records
per account, but this project hasn't been polling them). Acceptable.

## Open questions

1. **`sent_by`**: capture admin email on send so History can show
   "Sent by Dan". Recommendation: yes, trivial.
2. **Open/click rate**: shown as `—` in Darkroom. If Dan wants them,
   we'd need to rewrite all links through a tracking path and
   consume Resend webhooks. Probably later.

## Exit criteria

- `broadcast_log` exists, `SELECT * FROM broadcast_log` returns zero
  rows on a fresh DB, one row per completed non-test send.
- `GET /api/admin/subscribers/broadcasts` returns an ordered list.
- History tab renders real data in both skins, each in its own
  mockup's shape.
- Duplicate `Send to N` presses within the hour trigger a `409`.
- Both skins send via Resend without regression.
