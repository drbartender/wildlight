# AGENTS.md

Project-specific guidance for Codex working in this repo. Keep it short —
add something here only when it's non-obvious from reading files.

## Project

Wildlight Imagery — fine art photography storefront for Dan Raby.
Next.js 16 App Router · Postgres (Neon) · Stripe · Printful · Vercel.

## Read first

- `README.md` — stack, scripts, deploy targets, architecture notes.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — frozen design
  artifacts for the monetization build. Don't edit these as part of a code
  change.

## Conventions (non-obvious)

- **Money is integer cents everywhere.** Format and round via `lib/money.ts`
  only — never `toFixed` or multiply by 100 inline.
- **Raw SQL via `pg`** (`lib/db.ts`). No ORM, no query-builder. Use
  `withTransaction` for multi-statement writes. `statement_timeout = 15s` —
  any single query that needs longer is a bug.
- **Webhook handlers** must be authenticated and idempotent via the
  `webhook_events` table. Stripe uses HMAC-SHA256 body signature
  (canonical example: `app/api/webhooks/stripe/route.ts`); Printful uses
  a self-generated token in the registered URL (`?token=…` checked
  constant-time against `PRINTFUL_WEBHOOK_SECRET` — Printful's v1 API
  doesn't issue HMAC secrets). Fail closed — a Printful error marks the
  order `needs_review` + alerts admins, it does not silently drop.
- **Two image tiers.** `image_web_url` (R2 public, ~1600–2000px) is for
  catalog display. `image_print_url` (R2 private, full-res) is signed at
  fulfillment time, not at publish time. Print URL is a path key matching
  `artworks-print/.../<file>.<ext>` — validated on PATCH in
  `app/api/admin/artworks/[id]/route.ts`.
- **Variant pricing.** Retail = cost × 2.1, rounded up to a $5-ending price
  via `roundPriceCents` (`lib/money.ts`). Printful catalog variant IDs are
  `0` placeholders in `lib/variant-templates.ts` and get resolved at sync
  time (`npm run sync:printful`), not at variant creation.
- **Env vars are not editable in the admin UI** — rotate in the Vercel
  dashboard. `lib/stripe.ts` supports a timed test-mode fallback via
  `STRIPE_TEST_MODE_UNTIL`.

## Gotchas

- **`_`-prefixed folders under `app/` are private** — Next.js excludes them
  from routing, so a route file under `app/_foo/...` will 404. This already
  bit once (fix: commit `55881f2`).
- **Neon cold starts.** `connectionTimeoutMillis = 15s` is deliberate
  fail-fast — don't raise it without reason.
- **SSL detection.** `lib/db.ts` → `wantsNoSsl` disables SSL for
  `localhost`/`127.0.0.1`/`::1` and `sslmode=disable`. Add other local-dev
  hosts there, not by flipping `rejectUnauthorized`.
- **Build runs migrations first.** `npm run build` is
  `tsx lib/migrate.ts && next build`. A bad migration breaks deploys — use
  `build:skip-migrate` only when deliberately decoupling.
- **Private folder for bootstrap routes.** If you ever re-add a one-off
  admin route, don't put it under an `_`-prefixed directory.

## Workflow

```bash
npm run dev          # localhost:3000
npm run typecheck    # tsc --noEmit — run before claiming done
npm test             # vitest unit tests
npm run migrate      # idempotent schema apply
```

## Tests

Vitest, unit-only under `tests/lib/`. No integration harness. Anything
touching checkout, webhooks, Printful sync, or R2 signing needs manual
end-to-end verification — unit tests won't catch the regression.

## Don'ts

- Don't introduce an ORM or query-builder layer.
- Don't add a new env var without updating `.env.example`.
- Don't commit `.env.*.local` files.
- Don't edit `docs/superpowers/specs/` or `plans/` as part of a code change.
- Don't bypass the `webhook_events` dedupe — new webhooks go through the
  same pattern.
