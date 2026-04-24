# Admin Redesign — Sub-project 5b: Settings + Live Integration Health

**Date:** 2026-04-24
**Status:** Spec
**Parent:** `2026-04-24-admin-redesign-overview.md`

## Design invariant

Atelier's Settings is an editorial one-page: Change password card,
Integrations card with a 2×2 grid of provider tiles, read-only
prose about env var rotation. Darkroom's Settings is an instrument
panel: `change_password`, `env_vars` table with status column,
`admins` table with role + last-seen, plus a sidebar system-health
block (already placeholder-wired in sub-project 1) that gets real
data here. Do not converge the two.

## Target mockup

- `atelier.jsx:762–797` — `ASettings`. Max-width 720 page. Two
  stacked cards: `Change password` with `AField` inputs + primary
  button; `Integrations` card with 2×2 grid of tiles
  (Stripe / Printful / Resend / Cloudflare R2), each tile has
  provider name + mono detail + status dot + a muted footer
  paragraph about env var rotation.
- `darkroom.jsx:802–854` — `DSettings`. Three stacked panels:
  `change_password`, `env_vars` (read-only table with key / masked
  value / status), `admins [N]` (table with email / role / last
  seen). All mono.
- Darkroom `DSidebar:112-124` — system-health block. Already wired
  with placeholder data from sub-project 1; replace with live.
- Open `Wildlight Admin.html` locally.

## Scope

1. **Replace sub-project 1's hardcoded `systemHealth` placeholder**
   with a real feed from a new `GET /api/admin/integrations/health`
   endpoint.
2. **New endpoint** with 60-second in-memory cache returns:
   ```jsonc
   {
     "stripe":   { "state": "ok"|"warn"|"error", "note": "...", "checked_at": "..." },
     "printful": { "state": "...", "note": "...", "checked_at": "..." },
     "resend":   { ... },
     "r2":       { ... },
     "webhooks": { ... }
   }
   ```
3. **Two consumers, per skin**:
   - `AdminSidebar` system-health block (Darkroom-only) polls every
     60s while visible.
   - Settings page Integrations panel reads the same endpoint on
     mount; Atelier renders 2×2 tiles, Darkroom renders a compact
     panel with a row per provider.
4. **Env vars read-only display (Darkroom)**. Sub-project 1
   intentionally left this off. Render a table of masked values for
   the relevant env keys with a green/amber dot indicating
   freshness (age heuristic only — no real expiry data).
5. **Admins list**. Render the existing `admin_users` rows. Add a
   `role` column to the schema (default `owner`) so the mockup's
   owner/operator distinction is representable. `last_seen` is NOT
   tracked yet; render `—`.
6. **Password form**. No change — existing `PasswordForm.tsx`
   stays. Per-skin chrome only.

## Non-goals

- No env var editing in the UI. `CLAUDE.md` is load-bearing here —
  rotation happens in the Vercel dashboard.
- No provider-specific config UIs (no Stripe webhook registration,
  no Printful store picker, etc.).
- No `last_seen` tracking on admins. Placeholder.
- No sending provider writes from the health endpoint — every check
  is read-only.
- No secrets surfacing beyond the masked last-4 pattern the mockup
  already shows.

## Current state

- `components/admin/AdminSidebar.tsx` — rendering a
  `systemHealth` prop as a 4-row block in Darkroom. Today it
  receives `[{stripe ok},{printful ok},{resend ok},{webhooks ok}]`
  from `app/admin/layout.tsx`.
- `app/admin/settings/page.tsx` — Atelier design (password card +
  integrations tile grid + prose paragraph). No Darkroom-specific
  shape; the mockup has a significantly different layout.
- `app/admin/settings/PasswordForm.tsx` — password-change client
  form, unchanged.
- `lib/admin-theme.ts` — helper to read the theme cookie. Useful if
  we need to branch SSR behavior by theme.
- `lib/stripe.ts`, `lib/printful.ts`, `lib/email.ts`, `lib/r2.ts` —
  provider clients, all usable for health pings.

## Schema

Minimal additive migration. Append to `lib/schema.sql`.

```sql
-- Admins: optional role for the Darkroom admin table.
ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'owner';

ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_chk;
ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_chk
  CHECK (role IN ('owner', 'operator'));
```

No other columns added. `last_seen` is deliberately omitted.

## Health endpoint

New `app/api/admin/integrations/health/route.ts`.

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

New `lib/integration-health.ts`:

```ts
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

export async function checkHealth(): Promise<HealthReport> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const [stripe, printful, resend, r2, webhooks] = await Promise.all([
    pingStripe(),
    pingPrintful(),
    pingResend(),
    pingR2(),
    pingWebhooks(),
  ]);
  const value = { stripe, printful, resend, r2, webhooks };
  cache = { at: Date.now(), value };
  return value;
}
```

### Individual pings

Each returns a `HealthPing`; none throws. All have a 3s timeout.

- **`pingStripe`**: `stripe.customers.list({ limit: 1 })`. On
  success: `{state:'ok', note:'live acct_…'}` (strip the acct id
  from the response metadata if available; else `'live'`). On
  failure: `{state:'error', note: errorMessage}`.
- **`pingPrintful`**: `GET /store` via the existing `printful`
  client. On success: `{state:'ok', note: 'Store #… · N products'}`.
- **`pingResend`**: `GET /domains` via Resend SDK. On success:
  `{state:'ok', note: '<primary domain> verified'}`; on unverified
  domain: `{state:'warn', note:'domain not verified'}`.
- **`pingR2`**: `HeadBucket` on `R2_BUCKET_WEB`. On success:
  `{state:'ok', note:'2 buckets · <size>'}` where size is the sum of
  content-length snapshots from a HEAD on each bucket's `.meta`
  object if present; else `'2 buckets · unknown size'`.
- **`pingWebhooks`**: `SELECT COUNT(*) FROM webhook_events WHERE
  error IS NOT NULL AND created_at >= NOW() - INTERVAL '24 hours'`.
  Zero → `ok`. 1–5 → `warn`. >5 → `error`. Note: `N failing`.

## Layout per skin

### `/admin/settings` — Atelier (`ASettings`)

- `padding: 28, maxWidth: 720`.
- **Change password card**: 8px radius, rule border. Serif `Change
  password` header + `AField` grid at max 400px: Current password,
  New password · 12+ chars, primary button.
- **Integrations card** below: serif `Integrations` header. 2×2 grid
  of provider tiles; each tile is 6px radius, 1px rule, `paperAlt`
  bg, 14px padding:
  - Provider name in sans, right-side dot (7px) in green/amber/red.
  - Mono footer line with the provider's `note`.
  - Tile click navigates to the provider's dashboard (external link).
- Muted paragraph below: `API keys live in Vercel environment
  variables and are not editable here. Reach out to Dallas if a key
  needs to rotate.`
- **No admins table, no env_vars table.** Atelier omits these by
  design.

### `/admin/settings` — Darkroom (`DSettings`)

- `padding: 16, maxWidth: 760`, mono.
- **`change_password` panel**: panel header, 320px form, mono
  `DField`s, small primary `update` button.
- **`env_vars` panel**: panel header `env_vars` + muted `// read-only
  · rotate in vercel dashboard`. Mono table:
  - Key column (ink): e.g. `STRIPE_SECRET_KEY`, `DATABASE_URL`.
  - Masked value: `sk_live_···Rx2k`, `re_···8Ha4` (show first 2-3
    chars + `···` + last 4).
  - Status column, right-aligned:
    - `ok` (teal) for every mandatory key that is set
    - `missing` (red) for any mandatory key that is unset
    - (No age tracking — the mockup's `24d old` amber cell stays
      out of scope. Every present key is `ok`.)
  - Key list: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
    `PRINTFUL_API_KEY`, `RESEND_API_KEY`, `R2_ACCESS_KEY_ID`,
    `DATABASE_URL`, `ANTHROPIC_API_KEY`. This is the canonical list
    per `.env.example`; future env vars added there automatically
    need to appear here (a lightweight map drives the render).
- **`admins [N]` panel**: panel header. Mono table: email (ink),
  role (teal), last seen `—` muted. Active session gets `you · current
  session` annotation derived from the current session cookie.

## Sidebar system-health wiring

- `components/admin/AdminSidebar.tsx` stops receiving placeholder
  data from `app/admin/layout.tsx`. Instead it fetches
  `/api/admin/integrations/health` on mount (client-side) and
  re-polls every 60s. While loading, render the block with muted
  dots.
- Atelier hides the block; no change to that CSS. (Sub-project 1
  already wired the `:not([data-theme='dark'])` visibility rule.)
- Keep the `systemHealth` prop path too, so server-side can still
  push a known state if we ever want to (leave the client-fetch as
  the default).

## Testing

- Unit: `tests/lib/integration-health.test.ts` — mock the ping
  helpers, assert `checkHealth()` caches within TTL and re-runs
  after.
- Manual: `/admin/settings` in both skins; flip network off for the
  Stripe call (breakpoint or comment out API key temporarily), see
  the red `error` state propagate to both the sidebar and Settings
  panels.

## Rollout

Single PR. Additive schema.

## Open questions

1. **R2 size reporting**: the `HeadBucket` call doesn't return size.
   Options: skip size (just `2 buckets · ok`), or do an expensive
   `ListObjectsV2` sum (no — too slow). Recommendation: skip.
2. **Failed health vs. auth failure**: if a key is missing, should
   the ping return `error` or `warn`? Recommendation: missing key
   is `error` (it's actionable). Misconfigured but present is
   `warn`. Hard crash from a transient network problem is `warn`.

## Exit criteria

- `GET /api/admin/integrations/health` returns real state for the
  five providers with a 60s cache.
- Sidebar health block reflects reality in Darkroom.
- Settings Integrations panel (Atelier) and
  env_vars+admins+integrations panels (Darkroom) both render from
  the endpoint / DB.
- Migration adds `role` column idempotently.
- No env var shown in plaintext — always masked.
