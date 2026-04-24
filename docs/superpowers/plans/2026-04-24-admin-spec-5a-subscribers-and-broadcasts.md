# Admin Spec 5a — Subscribers + Broadcast Composer + History — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `broadcast_log` table, make the broadcast route write to it with a per-send idempotency key, expose `GET /api/admin/subscribers/broadcasts` for History, and render the subscribers screens (list / composer / history) per skin.

**Architecture:** Schema appended to `lib/schema.sql`. Broadcast route wraps the full-send path in a transaction that INSERTs a log row with a UUID idempotency key, ON CONFLICT DO NOTHING → 409. History tab reads from a new GET endpoint. Subscribers page gets dual-DOM per skin where tab row, composer, and history diverge.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, raw SQL via `pg`, Zod, Resend (existing `lib/email.sendBroadcast`).

**Spec:** `docs/superpowers/specs/2026-04-24-admin-spec-5a-subscribers-and-broadcasts.md`

**Design invariant:** Atelier and Darkroom are independent visual languages. Tab bar underline-green vs tab-pill-teal. Composer editorial form vs terminal panel. History serif list vs mono analytics table. Do not converge.

---

## File Structure

**Create:**
- `app/api/admin/subscribers/broadcasts/route.ts` — `GET` returns recent log rows.

**Modify:**
- `lib/schema.sql` — add `broadcast_log` table + index.
- `app/api/admin/subscribers/broadcast/route.ts` — idempotency key + write on successful full send.
- `app/admin/subscribers/page.tsx` — dual-DOM for tabs, composer, history; fetch broadcasts on history-tab mount; send UUID idempotency key.
- `app/admin/admin.css` — Darkroom tab-pill styles, composer-in-panel styles, history-table styles.

**No tests written** — the spec calls out an optional unit test for the idempotency helper but there's no helper being introduced; the `ON CONFLICT DO NOTHING` behavior is a single query exercised by manual verification.

---

## Task 1: Schema — `broadcast_log` table

**Files:**
- Modify: `lib/schema.sql`

- [ ] **Step 1: Append to `lib/schema.sql`**

At the end of `lib/schema.sql`, inside the "Idempotent post-create migrations" block, append:

```sql

-- Broadcast log (one row per successful non-test send) --------------
-- Added 2026-04-24 for admin Spec 5a.
CREATE TABLE IF NOT EXISTS broadcast_log (
  id               SERIAL PRIMARY KEY,
  subject          TEXT NOT NULL,
  html             TEXT NOT NULL,
  recipient_count  INT NOT NULL DEFAULT 0,
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_by          TEXT,
  idempotency_key  UUID UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_broadcast_log_sent_at
  ON broadcast_log(sent_at DESC);
```

- [ ] **Step 2: Run migrate**

```bash
npm run migrate
```

Expected: `schema applied`.

- [ ] **Step 3: Sanity check**

```bash
psql "$DATABASE_URL" -c "SELECT * FROM broadcast_log LIMIT 5;"
```

Expected: zero rows.

- [ ] **Step 4: Commit**

```bash
git add lib/schema.sql
git commit -m "schema: broadcast_log table for subscriber broadcast history"
```

---

## Task 2: Instrument `broadcast/route.ts` with idempotency + log insert

**Files:**
- Modify: `app/api/admin/subscribers/broadcast/route.ts`

Use `withTransaction` for the full-send path. Insert a `broadcast_log` row with the client-supplied `idempotencyKey` before sending; on `ON CONFLICT DO NOTHING` returning zero rows, reject with `409`. After a successful `sendBroadcast`, `UPDATE broadcast_log SET recipient_count = $n WHERE id = $logId`.

- [ ] **Step 1: Rewrite the route**

Replace the entire contents of `app/api/admin/subscribers/broadcast/route.ts` with:

```ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { sendBroadcast } from '@/lib/email';

const Body = z.object({
  subject: z.string().min(1).max(200),
  html: z.string().min(1).max(50_000),
  testTo: z.string().email().optional(),
  idempotencyKey: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  const session = await requireAdmin();
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  // Test sends bypass the log entirely — they go to a single address and
  // don't need idempotency (admins can re-send tests at will).
  if (p.data.testTo) {
    await sendBroadcast(p.data.subject, p.data.html, [p.data.testTo], {
      siteUrl,
      plainEmails: true,
    });
    return NextResponse.json({ sentTest: true });
  }

  // Full send requires an idempotency key; without it we'd risk a
  // double-click sending to every subscriber twice.
  const idemKey = p.data.idempotencyKey;
  if (!idemKey) {
    return NextResponse.json(
      { error: 'idempotency key required for full send' },
      { status: 400 },
    );
  }

  const { rows: subs } = await pool.query<{ id: number; email: string }>(
    `SELECT id, email FROM subscribers
     WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL`,
  );
  if (!subs.length) return NextResponse.json({ sent: 0 });

  // Try to claim the key. INSERT ON CONFLICT DO NOTHING returns 0 rows
  // if another request already claimed the same UUID — respond 409.
  let logId = 0;
  await withTransaction(async (client) => {
    const claim = await client.query<{ id: number }>(
      `INSERT INTO broadcast_log (subject, html, recipient_count, sent_by, idempotency_key)
       VALUES ($1, $2, 0, $3, $4)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [p.data.subject, p.data.html, session.email, idemKey],
    );
    if (claim.rowCount) logId = claim.rows[0].id;
  });
  if (!logId) {
    return NextResponse.json({ error: 'duplicate' }, { status: 409 });
  }

  try {
    await sendBroadcast(p.data.subject, p.data.html, subs, { siteUrl });
    await pool.query(
      `UPDATE broadcast_log SET recipient_count = $1 WHERE id = $2`,
      [subs.length, logId],
    );
    return NextResponse.json({ sent: subs.length });
  } catch (err) {
    // Roll back the log row so admin can retry with the same UUID.
    await pool.query(`DELETE FROM broadcast_log WHERE id = $1`, [logId]);
    throw err;
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. If `lib/session.requireAdmin()` returns a different shape than `{ email }`, adjust `sent_by` accordingly — verify with:

```bash
rg "export.*requireAdmin" lib/session.ts
```

Use whatever property exposes the admin's email. If none, fallback to `null` for `sent_by`.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/subscribers/broadcast/route.ts
git commit -m "api: broadcast route writes broadcast_log with UUID idempotency key"
```

---

## Task 3: New `GET /api/admin/subscribers/broadcasts`

**Files:**
- Create: `app/api/admin/subscribers/broadcasts/route.ts`

- [ ] **Step 1: Create the route**

Write `app/api/admin/subscribers/broadcasts/route.ts`:

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
    `SELECT id, subject, recipient_count, sent_at::text, sent_by
     FROM broadcast_log
     ORDER BY sent_at DESC
     LIMIT 200`,
  );
  return NextResponse.json({ rows });
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/subscribers/broadcasts/route.ts
git commit -m "api: GET /api/admin/subscribers/broadcasts — list log rows"
```

---

## Task 4: Subscribers page — send idempotency key, fetch broadcasts

**Files:**
- Modify: `app/admin/subscribers/page.tsx`

Add a UUID generated per-mount, send it with the full-send body, and fetch `/broadcasts` when the history tab opens.

- [ ] **Step 1: Add state for idempotency + history**

In `app/admin/subscribers/page.tsx`, inside `SubscribersInner` (approximately after the `state`/`error` state declarations, around line 61), add:

```tsx
  const [idemKey, setIdemKey] = useState<string>(() => crypto.randomUUID());
  const [broadcasts, setBroadcasts] = useState<
    { id: number; subject: string; recipient_count: number; sent_at: string; sent_by: string | null }[]
  >([]);
  const [broadcastsLoading, setBroadcastsLoading] = useState(false);

  useEffect(() => {
    if (tab !== 'history') return;
    setBroadcastsLoading(true);
    fetch('/api/admin/subscribers/broadcasts')
      .then((r) => r.json())
      .then((d: { rows: typeof broadcasts }) => setBroadcasts(d.rows))
      .catch(() => setBroadcasts([]))
      .finally(() => setBroadcastsLoading(false));
  }, [tab]);
```

- [ ] **Step 2: Send the key on full send**

Find the `send` function body (approximately line 75-90). Currently it takes a plain `body` object. Update the call site for full-send so `idempotencyKey` gets included. Find the "Send to N subscribers" button onClick (approximately line 212-229):

```tsx
                  onClick={() => {
                    if (
                      !confirm(
                        `Send to ${activeCount} active subscriber${activeCount === 1 ? '' : 's'}?`,
                      )
                    )
                      return;
                    void send({ subject, html, idempotencyKey: idemKey });
                  }}
```

And the "Send test" button is unchanged — test sends don't need the key.

After `setState('done')`, rotate the key so a future send gets a new UUID:

In the `send` function, after `setState('done');`, add:

```tsx
    setState('done');
    setIdemKey(crypto.randomUUID()); // rotate for next send
```

If the `send` function currently returns before setting `done` on some branches, use a `finally` or rotate at each success point carefully. The simple pattern is:

```tsx
  async function send(body: Record<string, unknown>) {
    setState('sending');
    setError(null);
    const r = await fetch('/api/admin/subscribers/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = (await r.json()) as { error?: string };
    if (!r.ok) {
      setError(d.error || 'send failed');
      setState('idle');
      return;
    }
    setState('done');
    if (!('testTo' in body)) {
      setIdemKey(crypto.randomUUID());
    }
  }
```

- [ ] **Step 3: Replace the history-tab placeholder**

Find the `{tab === 'history' && (…)}` block (approximately lines 281-289). Replace its contents with:

```tsx
        {tab === 'history' && (
          <>
            {broadcastsLoading ? (
              <div
                className="wl-adm-card"
                style={{ padding: 20, color: 'var(--adm-muted)', fontSize: 13 }}
              >
                Loading broadcast history…
              </div>
            ) : broadcasts.length === 0 ? (
              <div className="wl-adm-card">
                <div className="wl-adm-history-empty">
                  Nothing sent yet. Your first broadcast will show up here.
                </div>
              </div>
            ) : (
              <>
                {/* Atelier — editorial list */}
                <div className="wl-adm-card wl-adm-history-atelier">
                  {broadcasts.map((b, i) => (
                    <div
                      key={b.id}
                      className="row"
                      style={{ borderTop: i ? '1px solid var(--adm-rule-soft, var(--adm-rule))' : 'none' }}
                    >
                      <div className="ttl">{b.subject}</div>
                      <div className="meta">
                        <span>{new Date(b.sent_at).toLocaleString()}</span>
                        <span>·</span>
                        <span className="mono">{b.recipient_count} recipients</span>
                      </div>
                      <div className="by">{b.sent_by || 'system'}</div>
                    </div>
                  ))}
                </div>

                {/* Darkroom — tabular panel */}
                <div className="wl-adm-panel wl-adm-history-darkroom">
                  <table className="wl-adm-table mono">
                    <thead>
                      <tr>
                        <th>sent_at</th>
                        <th>subject</th>
                        <th className="right">recipients</th>
                        <th className="right">open_rate</th>
                        <th className="right">click_rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {broadcasts.map((b) => (
                        <tr key={b.id}>
                          <td className="muted">
                            {new Date(b.sent_at).toLocaleDateString(undefined, {
                              month: 'short',
                              day: '2-digit',
                            })}{' '}
                            ·{' '}
                            {new Date(b.sent_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td>{b.subject}</td>
                          <td className="right">{b.recipient_count}</td>
                          <td className="right" style={{ color: 'var(--adm-green)' }}>
                            —
                          </td>
                          <td className="right" style={{ color: 'var(--adm-green)' }}>
                            —
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="f">
                    // open/click rates not tracked yet — requires resend webhook + link rewriting
                  </div>
                </div>
              </>
            )}
          </>
        )}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/admin/subscribers/page.tsx
git commit -m "admin: subscribers page — idempotency key + real History tab"
```

---

## Task 5: Dual-DOM tab bar + composer (per skin)

**Files:**
- Modify: `app/admin/subscribers/page.tsx`
- Modify: `app/admin/admin.css`

The existing tab bar uses `.wl-adm-tabs` (Atelier-shaped with a green underline). Add a Darkroom variant with pill-shaped tabs + `[N]` bracket suffixes.

- [ ] **Step 1: Render dual tab bars**

In `app/admin/subscribers/page.tsx`, find the existing `<div className="wl-adm-tabs" style={{ flex: 1 }}>` block (approximately lines 98-114). Replace it with:

```tsx
          {/* Atelier tab bar */}
          <div className="wl-adm-tabs wl-adm-subs-tabs-atelier" style={{ flex: 1 }}>
            {(
              [
                ['list', 'Subscribers'],
                ['broadcast', 'New broadcast'],
                ['history', 'History'],
              ] as [Tab, string][]
            ).map(([k, l]) => (
              <button
                key={k}
                className={tab === k ? 'on' : ''}
                onClick={() => setTab(k)}
              >
                {l}
              </button>
            ))}
          </div>

          {/* Darkroom tab bar */}
          <div className="wl-adm-subs-tabs-darkroom" style={{ flex: 1 }}>
            {(
              [
                ['list', `subscribers [${rows.length}]`],
                ['broadcast', 'new_broadcast'],
                ['history', `history [${broadcasts.length}]`],
              ] as [Tab, string][]
            ).map(([k, l]) => (
              <button
                key={k}
                className={tab === k ? 'on' : ''}
                onClick={() => setTab(k)}
              >
                {l}
              </button>
            ))}
          </div>
```

- [ ] **Step 2: Add CSS for dual tab bars + history + Darkroom composer polish**

Append to `app/admin/admin.css`:

```css
/* Subscribers — tab bars */
.wl-adm-subs-tabs-atelier  { display: flex; }
.wl-adm-subs-tabs-darkroom { display: none; }
.wl-admin-surface[data-theme='dark'] .wl-adm-subs-tabs-atelier  { display: none; }
.wl-admin-surface[data-theme='dark'] .wl-adm-subs-tabs-darkroom { display: flex; gap: 4px; }

.wl-adm-subs-tabs-darkroom button {
  padding: 4px 10px;
  border: none;
  cursor: pointer;
  border-radius: 3px;
  background: transparent;
  color: var(--adm-ink-2);
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  font-size: 11px;
}
.wl-admin-surface[data-theme='dark'] .wl-adm-subs-tabs-darkroom button.on {
  background: var(--adm-panel);
  color: var(--adm-green);
  box-shadow: inset 0 0 0 1px var(--adm-rule);
}

/* Subscribers — history atelier list */
.wl-adm-history-atelier  { display: block; }
.wl-adm-history-darkroom { display: none; }
.wl-admin-surface[data-theme='dark'] .wl-adm-history-atelier  { display: none; }
.wl-admin-surface[data-theme='dark'] .wl-adm-history-darkroom { display: block; }

.wl-adm-history-atelier .row {
  padding: 14px 18px;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 16px;
  align-items: baseline;
}
.wl-adm-history-atelier .row .ttl {
  font-family: var(--f-caslon), 'Libre Caslon Text', Georgia, serif;
  font-size: 16px;
  color: var(--adm-ink);
}
.wl-adm-history-atelier .row .meta {
  font-size: 12px;
  color: var(--adm-muted);
  display: flex;
  gap: 6px;
  align-items: baseline;
}
.wl-adm-history-atelier .row .meta .mono {
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
}
.wl-adm-history-atelier .row .by {
  font-size: 11px;
  color: var(--adm-muted);
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: start;
}

/* Subscribers — history darkroom table */
.wl-adm-history-darkroom .f {
  padding: 10px 14px;
  border-top: 1px solid var(--adm-rule);
  color: var(--adm-muted);
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  font-size: 10px;
}
```

- [ ] **Step 3: Typecheck + smoke**

```bash
npm run typecheck && npm run dev
```

Open `/admin/subscribers`. Atelier tab bar is underline-green; Darkroom tab bar is teal pills with `[N]` suffixes. Click `Send test` (to a known address) — test goes through. Switch to history tab — existing sends appear (empty state if none yet).

- [ ] **Step 4: Commit**

```bash
git add app/admin/subscribers/page.tsx app/admin/admin.css
git commit -m "admin: subscribers — dual-DOM tabs + per-skin history treatment"
```

---

## Task 6: Manual smoke verification

**Files:** none.

- [ ] **Step 1: Typecheck + tests**

```bash
npm run typecheck && npm test
```

Expected: no errors, all tests pass.

- [ ] **Step 2: Test send + full send**

On a staging DB with 1-2 confirmed subscribers:

```bash
npm run dev
```

- Subscribers → New broadcast. Fill subject + html. Click `Send test` to a known inbox — verify it arrives.
- Click `Send to N subscribers` (with N small). Confirm the modal and click through. Verify the email arrives at the real subscribers' inboxes. Switch to History tab — one new row.
- Rapid-double-click `Send to N` (or open the Network tab and replay the POST with the same idempotency key). Second call should 409.
- Verify in both skins that the history tab renders — Atelier list, Darkroom table.

- [ ] **Step 3: Confirm clean**

```bash
git status
```

Expected: clean. 5 commits.

---

## Exit criteria

- `npm run typecheck` passes.
- `broadcast_log` table exists; `npm run migrate` re-runs safely.
- `POST /api/admin/subscribers/broadcast` requires `idempotencyKey` for full sends; duplicate keys return 409 without re-sending.
- Successful full send writes exactly one row in `broadcast_log` with the correct `recipient_count` and `sent_by`.
- `GET /api/admin/subscribers/broadcasts` returns rows ordered newest-first.
- History tab renders real data in both skins — Atelier editorial list, Darkroom mono table.
- Atelier tab bar keeps its green underline treatment; Darkroom tab bar renders pill buttons with `[N]` count suffixes.
- Tests send goes through Resend on both skins.
