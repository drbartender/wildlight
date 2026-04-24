# Admin Spec 5b — Settings + Live Integration Health — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace sub-1's hardcoded `systemHealth` placeholder with a real `GET /api/admin/integrations/health` endpoint (60s cache), consume it in both the Darkroom sidebar block and the Settings Integrations panel, add an `admin_users.role` column, and give Settings per-skin DOM (Atelier card layout; Darkroom env_vars + admins tables).

**Architecture:** One new helper `lib/integration-health.ts` runs 5 pings in parallel with a 3s each and caches the combined result for 60s in module-scope. Endpoint calls `checkHealth()` under `requireAdmin()`. Sidebar block becomes client-fetched + 60s polled. Settings page renders both skins' DOM and toggles visibility.

**Tech Stack:** Next.js 16 App Router, TypeScript, raw SQL via `pg`, existing provider clients (`lib/stripe`, `lib/printful`, `lib/email`, `lib/r2`), in-memory module cache.

**Spec:** `docs/superpowers/specs/2026-04-24-admin-spec-5b-settings-and-integration-health.md`

**Design invariant:** Atelier and Darkroom are independent visual languages. Atelier Settings = editorial one-page (Change password + Integrations 2×2 grid). Darkroom Settings = mono panels (change_password + env_vars table + admins table). Do not converge.

---

## File Structure

**Create:**
- `lib/integration-health.ts` — pure module-scope cache + 5 ping helpers + `checkHealth()` export.
- `tests/lib/integration-health.test.ts` — unit-test the TTL cache against a stubbed clock.
- `app/api/admin/integrations/health/route.ts` — `GET` endpoint wrapping `checkHealth()`.

**Modify:**
- `lib/schema.sql` — add `admin_users.role` column with CHECK.
- `components/admin/AdminSidebar.tsx` — drop the prop-based `systemHealth` in favor of client-fetch + 60s polling.
- `app/admin/layout.tsx` — remove the hardcoded placeholder array (no longer passed).
- `app/admin/settings/page.tsx` — dual-DOM per skin (Atelier card layout + Darkroom env_vars + admins + integrations panels).
- `app/admin/admin.css` — Darkroom-specific settings panel styles + visibility toggles.

---

## Task 1: Schema — `admin_users.role`

**Files:**
- Modify: `lib/schema.sql`

- [ ] **Step 1: Append to `lib/schema.sql`**

In the "Idempotent post-create migrations" block, append:

```sql

-- Admin role column for Darkroom admins table (Spec 5b) --------------
ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'owner';

ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_chk;
ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_chk
  CHECK (role IN ('owner', 'operator'));
```

- [ ] **Step 2: Run migrate**

```bash
npm run migrate
```

Expected: `schema applied`.

- [ ] **Step 3: Sanity**

```bash
psql "$DATABASE_URL" -c "SELECT email, role FROM admin_users;"
```

Expected: existing rows get the default `owner` role.

- [ ] **Step 4: Commit**

```bash
git add lib/schema.sql
git commit -m "schema: admin_users.role column with owner/operator CHECK"
```

---

## Task 2: `lib/integration-health.ts` + unit tests

**Files:**
- Create: `lib/integration-health.ts`
- Create: `tests/lib/integration-health.test.ts`

- [ ] **Step 1: Create the helper**

Write `lib/integration-health.ts`:

```ts
import { pool } from '@/lib/db';
import { getStripe } from '@/lib/stripe';
import { printful } from '@/lib/printful';

export interface HealthPing {
  state: 'ok' | 'warn' | 'error';
  note: string;
  checked_at: string;
}

export interface HealthReport {
  stripe:   HealthPing;
  printful: HealthPing;
  resend:   HealthPing;
  r2:       HealthPing;
  webhooks: HealthPing;
}

let cache: { at: number; value: HealthReport } | null = null;
const TTL_MS = 60_000;
const PING_TIMEOUT_MS = 3_000;

/** For tests only — reset the module cache. */
export function _resetCacheForTests() {
  cache = null;
}

export async function checkHealth(now: () => number = Date.now): Promise<HealthReport> {
  if (cache && now() - cache.at < TTL_MS) return cache.value;

  const [stripe, printful_, resend, r2, webhooks] = await Promise.all([
    pingStripe(),
    pingPrintful(),
    pingResend(),
    pingR2(),
    pingWebhooks(),
  ]);
  const value: HealthReport = {
    stripe,
    printful: printful_,
    resend,
    r2,
    webhooks,
  };
  cache = { at: now(), value };
  return value;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms),
    ),
  ]);
}

function ping(state: 'ok' | 'warn' | 'error', note: string): HealthPing {
  return { state, note, checked_at: new Date().toISOString() };
}

async function pingStripe(): Promise<HealthPing> {
  try {
    if (!process.env.STRIPE_SECRET_KEY) return ping('error', 'key missing');
    const stripe = getStripe();
    await withTimeout(stripe.customers.list({ limit: 1 }), PING_TIMEOUT_MS);
    return ping('ok', 'live');
  } catch (err) {
    return ping('warn', err instanceof Error ? err.message : 'unknown');
  }
}

async function pingPrintful(): Promise<HealthPing> {
  try {
    if (!process.env.PRINTFUL_API_KEY) return ping('error', 'key missing');
    const info = await withTimeout(
      (printful as unknown as { getStore: () => Promise<{ id: number; name?: string }> })
        .getStore?.() ?? Promise.reject(new Error('getStore unavailable')),
      PING_TIMEOUT_MS,
    );
    return ping('ok', info?.name ? `store ${info.name}` : `store #${info.id}`);
  } catch (err) {
    return ping('warn', err instanceof Error ? err.message : 'unknown');
  }
}

async function pingResend(): Promise<HealthPing> {
  try {
    if (!process.env.RESEND_API_KEY) return ping('error', 'key missing');
    const r = await withTimeout(
      fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      }),
      PING_TIMEOUT_MS,
    );
    if (!r.ok) return ping('warn', `HTTP ${r.status}`);
    const body = (await r.json()) as { data?: { name: string; status: string }[] };
    const verified = (body.data ?? []).find((d) => d.status === 'verified');
    if (!verified) return ping('warn', 'no verified domain');
    return ping('ok', `${verified.name} verified`);
  } catch (err) {
    return ping('warn', err instanceof Error ? err.message : 'unknown');
  }
}

async function pingR2(): Promise<HealthPing> {
  try {
    if (
      !process.env.R2_ACCESS_KEY_ID ||
      !process.env.R2_SECRET_ACCESS_KEY ||
      !process.env.R2_BUCKET_WEB
    ) {
      return ping('error', 'keys missing');
    }
    // Lightweight reachability check: list zero objects. Uses the same SDK
    // as lib/r2.ts. If r2 is down, this throws; caught below.
    const { S3Client, HeadBucketCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
    await withTimeout(
      client.send(new HeadBucketCommand({ Bucket: process.env.R2_BUCKET_WEB! })),
      PING_TIMEOUT_MS,
    );
    return ping('ok', '2 buckets reachable');
  } catch (err) {
    return ping('warn', err instanceof Error ? err.message : 'unknown');
  }
}

async function pingWebhooks(): Promise<HealthPing> {
  try {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM webhook_events
       WHERE error IS NOT NULL AND created_at >= NOW() - INTERVAL '24 hours'`,
    );
    const n = rows[0]?.n ?? 0;
    if (n === 0) return ping('ok', 'no recent failures');
    if (n <= 5)  return ping('warn',  `${n} failing`);
    return ping('error', `${n} failing in 24h`);
  } catch (err) {
    return ping('warn', err instanceof Error ? err.message : 'unknown');
  }
}
```

If `printful` client's actual method differs (e.g. `printful.store()` rather than `printful.getStore()`), adjust the call. Check `lib/printful.ts` with `rg "export" lib/printful.ts` and use the existing method that returns store info. If no existing method works, call the REST endpoint directly:

```ts
const r = await fetch('https://api.printful.com/store', {
  headers: { Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}` },
});
```

- [ ] **Step 2: Write the tests**

Write `tests/lib/integration-health.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkHealth, _resetCacheForTests } from '@/lib/integration-health';

describe('integration-health cache', () => {
  beforeEach(() => {
    _resetCacheForTests();
    // Clear env so pings short-circuit to 'error' without touching networks.
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.PRINTFUL_API_KEY;
    delete process.env.RESEND_API_KEY;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET_WEB;
  });

  it('caches for 60 seconds', async () => {
    const t0 = 1_000_000;
    const now = vi.fn<[], number>(() => t0);
    const first = await checkHealth(now);
    const second = await checkHealth(() => t0 + 30_000); // inside TTL
    expect(second).toBe(first);
  });

  it('refreshes after 60 seconds', async () => {
    const first = await checkHealth(() => 1_000_000);
    const second = await checkHealth(() => 1_000_000 + 60_001);
    expect(second).not.toBe(first);
  });

  it('returns error state when a required key is missing', async () => {
    const r = await checkHealth(() => Date.now());
    expect(r.stripe.state).toBe('error');
    expect(r.stripe.note).toContain('missing');
  });
});
```

Note: `pingWebhooks` queries the real `pool`. For the test, the DB may be unreachable; `pingWebhooks` catches the error and returns `warn`, which keeps the test honest without requiring a DB connection. If the test harness uses `vitest` with `globalSetup` that establishes a test DB, even better — but don't depend on it here.

- [ ] **Step 3: Run tests**

```bash
npm test -- integration-health
```

Expected: 3 tests pass.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. If `printful` typing disagrees with the usage, fall back to the REST-via-fetch approach from Step 1.

- [ ] **Step 5: Commit**

```bash
git add lib/integration-health.ts tests/lib/integration-health.test.ts
git commit -m "lib: checkHealth — 5-provider health pings with 60s TTL cache"
```

---

## Task 3: Health endpoint

**Files:**
- Create: `app/api/admin/integrations/health/route.ts`

- [ ] **Step 1: Create the route**

Write `app/api/admin/integrations/health/route.ts`:

```ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { checkHealth } from '@/lib/integration-health';

export async function GET() {
  await requireAdmin();
  const result = await checkHealth();
  return NextResponse.json(result);
}
```

- [ ] **Step 2: Typecheck + smoke**

```bash
npm run typecheck && npm run dev
```

Curl the endpoint (with an admin session):

```bash
curl -s -b "wl_admin_session=<session-cookie>" http://localhost:3000/api/admin/integrations/health | jq
```

Expected: JSON with 5 `{state, note, checked_at}` keys. Second call within 60s returns identical `checked_at` (cache hit).

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/integrations/health/route.ts
git commit -m "api: GET /api/admin/integrations/health — cached 5-provider pings"
```

---

## Task 4: `AdminSidebar` — client-fetched health + 60s poll

**Files:**
- Modify: `components/admin/AdminSidebar.tsx`
- Modify: `app/admin/layout.tsx`

- [ ] **Step 1: Replace the `systemHealth` prop with client state**

Open `components/admin/AdminSidebar.tsx`. Remove the `systemHealth?:` prop from the component interface. Inside the component, add a client-fetch:

```tsx
  const [systemHealth, setSystemHealth] = useState<
    Array<{ key: string; state: 'ok' | 'warn' | 'error'; note: string }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const r = await fetch('/api/admin/integrations/health');
        if (!r.ok) return;
        const d = (await r.json()) as Record<
          string,
          { state: 'ok' | 'warn' | 'error'; note: string }
        >;
        if (cancelled) return;
        setSystemHealth(
          (['stripe', 'printful', 'resend', 'r2', 'webhooks'] as const).map(
            (key) => ({
              key,
              state: d[key]?.state ?? 'warn',
              note: d[key]?.note ?? '—',
            }),
          ),
        );
      } catch {
        /* quiet — keep prior state */
      }
    }
    void refresh();
    const t = setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);
```

Ensure `useState` and `useEffect` are imported at the top:

```tsx
import { useEffect, useState } from 'react';
```

Keep the existing `{systemHealth && systemHealth.length > 0 && (...)}` render — it'll kick in once the first fetch resolves. Atelier CSS still hides the block via sub-1's rules.

- [ ] **Step 2: Stop passing the placeholder in `app/admin/layout.tsx`**

In `app/admin/layout.tsx`, find the `<AdminSidebar … systemHealth={[…]} />` call (set up by sub-1). Remove the `systemHealth={…}` prop entirely. The component now fetches its own data.

- [ ] **Step 3: Typecheck + smoke**

```bash
npm run typecheck && npm run dev
```

Reload admin. Darkroom sidebar shows real health rows. If a provider is down (e.g. a bad `STRIPE_SECRET_KEY`), the dot turns amber/red. Wait 60s with a failing provider — the row updates.

- [ ] **Step 4: Commit**

```bash
git add components/admin/AdminSidebar.tsx app/admin/layout.tsx
git commit -m "admin: sidebar health block client-polls /integrations/health every 60s"
```

---

## Task 5: Settings page — dual-DOM per skin

**Files:**
- Modify: `app/admin/settings/page.tsx`
- Modify: `app/admin/admin.css`

Keep the Atelier card layout (Change password + Integrations 2×2 grid) — it matches `ASettings`. Add a Darkroom DOM tree with three panels: `change_password`, `env_vars`, `admins`. Health data pulls from the endpoint; env vars come from a server-side canonical list.

- [ ] **Step 1: Rewrite the Settings page**

Replace the entire contents of `app/admin/settings/page.tsx` with:

```tsx
import { pool } from '@/lib/db';
import { AdminTopBar } from '@/components/admin/AdminTopBar';
import { PasswordForm } from './PasswordForm';
import { requireAdmin } from '@/lib/session';
import { checkHealth, type HealthReport } from '@/lib/integration-health';

export const dynamic = 'force-dynamic';

interface AdminRow {
  email: string;
  role: string;
}

const ENV_KEYS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'PRINTFUL_API_KEY',
  'RESEND_API_KEY',
  'R2_ACCESS_KEY_ID',
  'DATABASE_URL',
  'ANTHROPIC_API_KEY',
] as const;

function mask(key: string): { value: string; present: boolean } {
  const v = process.env[key];
  if (!v) return { value: '— missing —', present: false };
  if (v.length < 10) return { value: '••', present: true };
  return { value: `${v.slice(0, 4)}···${v.slice(-4)}`, present: true };
}

const INTEGRATIONS: { key: keyof HealthReport; label: string }[] = [
  { key: 'stripe',   label: 'Stripe' },
  { key: 'printful', label: 'Printful' },
  { key: 'resend',   label: 'Resend' },
  { key: 'r2',       label: 'Cloudflare R2' },
  { key: 'webhooks', label: 'Webhooks' },
];

export default async function Settings() {
  const session = await requireAdmin();
  const [health, admins] = await Promise.all([
    checkHealth(),
    pool.query<AdminRow>(
      `SELECT email, role FROM admin_users ORDER BY email ASC`,
    ),
  ]);

  return (
    <>
      <AdminTopBar title="Settings" subtitle="Account" />

      {/* Atelier layout */}
      <div className="wl-adm-page wl-adm-settings-atelier" style={{ maxWidth: 760 }}>
        <div className="wl-adm-card" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 18 }}>Change password</h3>
          <PasswordForm />
        </div>

        <div className="wl-adm-card" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 18 }}>Integrations</h3>
          <div className="wl-adm-integration-grid">
            {INTEGRATIONS.map((it) => {
              const h = health[it.key];
              return (
                <div
                  key={it.key}
                  className={`wl-adm-integration ${h.state === 'ok' ? 'ok' : 'miss'}`}
                >
                  <div className="h">
                    <strong>{it.label}</strong>
                    <span className="dot" aria-hidden="true" />
                  </div>
                  <div className="state">{h.note}</div>
                </div>
              );
            })}
          </div>
          <p
            style={{
              fontSize: 12,
              color: 'var(--adm-muted)',
              marginTop: 14,
              lineHeight: 1.6,
            }}
          >
            API keys live in Vercel environment variables and are not editable
            here. Reach out to Dallas if a key needs to rotate.
          </p>
        </div>
      </div>

      {/* Darkroom layout */}
      <div
        className="wl-adm-page wl-adm-settings-darkroom"
        style={{ maxWidth: 760 }}
      >
        <div className="wl-adm-panel" style={{ padding: 16 }}>
          <div className="wl-adm-settings-panel-h">change_password</div>
          <PasswordForm />
        </div>

        <div className="wl-adm-panel" style={{ padding: 16, marginTop: 12 }}>
          <div className="wl-adm-settings-panel-h">integrations</div>
          <table className="wl-adm-table mono">
            <tbody>
              {INTEGRATIONS.map((it) => {
                const h = health[it.key];
                return (
                  <tr key={it.key}>
                    <td style={{ color: 'var(--adm-ink)' }}>{it.key}</td>
                    <td className="muted">{h.note}</td>
                    <td
                      className="right"
                      style={{
                        color:
                          h.state === 'ok'
                            ? 'var(--adm-green)'
                            : h.state === 'warn'
                              ? 'var(--adm-amber)'
                              : 'var(--adm-red)',
                      }}
                    >
                      {h.state}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="wl-adm-panel" style={{ padding: 16, marginTop: 12 }}>
          <div className="wl-adm-settings-panel-h">env_vars</div>
          <div className="wl-adm-settings-panel-note">
            // read-only · rotate in vercel dashboard
          </div>
          <table className="wl-adm-table mono" style={{ marginTop: 10 }}>
            <tbody>
              {ENV_KEYS.map((k) => {
                const m = mask(k);
                return (
                  <tr key={k}>
                    <td style={{ color: 'var(--adm-ink)' }}>{k}</td>
                    <td className="muted">{m.value}</td>
                    <td
                      className="right"
                      style={{
                        color: m.present
                          ? 'var(--adm-green)'
                          : 'var(--adm-red)',
                        fontSize: 10,
                      }}
                    >
                      {m.present ? 'ok' : 'missing'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="wl-adm-panel" style={{ padding: 16, marginTop: 12 }}>
          <div className="wl-adm-settings-panel-h">admins [{admins.rows.length}]</div>
          <table className="wl-adm-table mono" style={{ marginTop: 10 }}>
            <tbody>
              {admins.rows.map((a) => (
                <tr key={a.email}>
                  <td style={{ color: 'var(--adm-ink)' }}>{a.email}</td>
                  <td style={{ color: 'var(--adm-green)' }}>{a.role}</td>
                  <td className="muted">
                    {a.email === session.email ? 'you · current session' : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Add CSS for dual-DOM settings + Darkroom panel polish**

Append to `app/admin/admin.css`:

```css
/* Settings — Atelier default / Darkroom variant */
.wl-adm-settings-atelier  { display: block; }
.wl-adm-settings-darkroom { display: none; }
.wl-admin-surface[data-theme='dark'] .wl-adm-settings-atelier  { display: none; }
.wl-admin-surface[data-theme='dark'] .wl-adm-settings-darkroom { display: block; }

.wl-adm-settings-panel-h {
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  font-size: 13px;
  color: var(--adm-ink);
  margin-bottom: 10px;
}
.wl-adm-settings-panel-note {
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  color: var(--adm-muted);
  font-size: 10px;
}
```

- [ ] **Step 3: Typecheck + smoke**

```bash
npm run typecheck && npm run dev
```

Open `/admin/settings` in both skins. Atelier: 2 cards (Change password + Integrations 2×2). Darkroom: 4 panels (change_password + integrations + env_vars + admins). Missing env vars (if any) show red `missing`; Darkroom integration rows show real state (`ok`/`warn`/`error`) matching the sidebar.

- [ ] **Step 4: Commit**

```bash
git add app/admin/settings/page.tsx app/admin/admin.css
git commit -m "admin: settings — per-skin DOM + real integration health + env_vars/admins panels (Darkroom)"
```

---

## Task 6: Manual smoke verification

**Files:** none.

- [ ] **Step 1: Typecheck + tests**

```bash
npm run typecheck && npm test
```

Expected: no errors, all tests pass (incl. the 3 new `integration-health` tests).

- [ ] **Step 2: Walk both skins**

```bash
npm run dev
```

- `/admin/settings` Atelier: 2 cards, integrations 2×2 grid with green/red dots matching real state.
- `/admin/settings` Darkroom: 4 panels. Integrations row colors map to `state`. Env_vars shows masked values with `ok`/`missing` status. Admins lists existing admin users with `role` column.
- Sidebar in Darkroom: first paint may show muted dots for ~1s, then transitions to real rows as the fetch resolves.
- Temporarily blank `STRIPE_SECRET_KEY` in `.env.local`, restart, load `/admin/settings` — Stripe row goes to `error missing`.
- Restore the key, wait 60s, reload — Stripe back to `ok`.

- [ ] **Step 3: Confirm clean**

```bash
git status
```

Expected: clean. 5 commits.

---

## Exit criteria

- `npm run typecheck` passes.
- `npm test` passes, including new `integration-health` TTL tests.
- `GET /api/admin/integrations/health` returns real 5-provider state and caches for 60s.
- `AdminSidebar` system-health block (Darkroom) reflects reality, polling every 60s.
- Settings page renders per skin. Atelier keeps the existing card layout; Darkroom shows change_password + integrations + env_vars + admins panels.
- `admin_users.role` column exists; migration is idempotent.
- Missing env vars show red `missing`; present ones render as masked `sk_live_···abcd` with `ok`.
