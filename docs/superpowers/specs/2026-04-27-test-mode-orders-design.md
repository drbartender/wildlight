# Test-mode orders — design spec

**Date:** 2026-04-27
**Status:** Approved by user, awaiting implementation plan.

## Problem

Stripe-test-card checkouts go through Stripe successfully, but the
webhook (`app/api/webhooks/stripe/route.ts`) submits the resulting order
to Printful with `confirm: true`, which queues a real print job for
fulfillment. There is no way to exercise the end-to-end checkout →
webhook → DB → email path without burning a print.

Two related symptoms motivate the work:

1. The user reported test-card payments hitting the "thank you —
   processing" page (`app/api/orders/by-session/[id]/route.ts:36-55`)
   and never advancing, with no confirmation email arriving. That fallback
   page only renders when no `orders` row exists for the session id, which
   means the `checkout.session.completed` webhook is not creating the
   order. **Webhook delivery to the deployed environment is a separate
   prerequisite (see "Out of scope" below) — this spec does not solve it
   but does not depend on it being already fixed at design time.**
2. Even with webhook delivery working, the user wants to repeatedly run
   end-to-end checkouts during a development push without triggering
   actual fulfillment, and rarely after that.

## Goal

When Stripe is operating in test mode, the webhook must:

- Submit the order to Printful as a **draft** (not auto-confirmed), so
  the order appears in the Printful dashboard but is not fulfilled or
  charged on Printful.
- Persist the order to the DB with an `is_test` flag so admin surfaces
  can distinguish test runs from real sales without filtering them out.
- Suppress operator alert emails (`needs_review`) for test orders so a
  flaky test run does not page the operator.

Real (`sk_live_…`) traffic must behave **identically to today** — same
auto-confirm, same DB writes, same alerts.

## Non-goals (Out of scope)

- **Fixing webhook delivery to the deployed environment.** That is a
  config issue (Stripe Dashboard endpoint registration, signing-secret
  parity in Vercel) and is handled separately. This spec assumes that
  once the webhook is reaching the app, the test-mode behavior described
  here will fire.
- **Auto-cleanup of test orders or Printful drafts.** Manual cleanup
  (`DELETE FROM orders WHERE is_test = true` plus dashboard purge in
  Printful) is sufficient given the "frequent during dev, rare after"
  cadence.
- **Test-flagging the customer-facing confirmation email** (no `[TEST]`
  subject prefix). The user's own email address is the only recipient
  during test runs; the prefix earns no real safety.
- **Test-flagging the order-detail page** (`/orders/[token]`). The page
  is the surface we *want* to verify renders correctly during testing,
  so it should look like a normal order page.
- **A separate `test_orders` table.** Total isolation, but doubles every
  query path and admin component for marginal benefit.

## Test-mode signal

Source of truth: `getStripeConfig().testMode` in `lib/stripe.ts`.

Today, `testMode` is true only when the timed `STRIPE_TEST_MODE_UNTIL`
window is active. That misses the common dev configuration of plain
`sk_test_…` keys plugged into the regular slots. The signal is widened
so that `testMode` is also true when the active `STRIPE_SECRET_KEY`
starts with `sk_test_`.

`testMode` is read in two places downstream:

1. The webhook's Printful submit (controls `confirm`).
2. The webhook's order INSERT (controls `is_test`).

It is not propagated to the client. The frontend has no need to know.

## Schema change

```sql
ALTER TABLE orders
  ADD COLUMN is_test BOOLEAN NOT NULL DEFAULT false;
```

Default `false` makes the migration safe to run against existing rows
(which were all real orders). No backfill needed.

The migration goes through `lib/migrate.ts` like every other change. It
runs automatically as the first step of `npm run build`
(`tsx lib/migrate.ts && next build`); `build:skip-migrate` is the
opt-out, used only when deliberately decoupling. Idempotent: the
migration script either runs the `ADD COLUMN` once or no-ops if the
column already exists, matching the pattern already in place for prior
migrations.

## Webhook behavior

In `app/api/webhooks/stripe/route.ts` → `handleCheckoutCompleted`:

1. **Read `testMode` once** at the top of the function:
   `const { testMode } = getStripeConfig();`
2. **Order INSERT:** add `is_test` to the column list, bound to
   `testMode`.
3. **Printful submit:** change `confirm: true` to `confirm: !testMode`.
   Add a single `logger.info` line on the test-mode branch so log triage
   can tell at a glance whether a Printful submit was a draft.
4. **`sendNeedsReviewAlert` calls:** wrap the `alert()` helper so it
   becomes a no-op when `is_test`. The `flagOrder` lifecycle write still
   happens (the order is still flagged in the DB and in the admin queue;
   we just don't email Dan about it).

The price-drift, missing-print-file, and missing-sync-variant flagging
paths all continue to set `status='needs_review'`. That's intentional:
during dev you may *want* to see test orders parked in needs_review to
verify the flagging logic works. Suppressing the email keeps that visible
in admin without spamming inbox.

## Admin order list

`app/admin/orders/page.tsx` (or its server component data fetch) selects
`is_test`. The order row renders a small "TEST" pill next to the status
badge for test orders. No filtering — they sit inline with real orders.

Style: secondary/muted, not alarming. The pill is informational, not a
warning. (Picking specific colors is a UI implementation detail handled
in the plan.)

## Order detail page

`app/orders/[token]/page.tsx` is **unchanged**. The page does not select
`is_test` and does not render any test indicator. The page exists to
let us verify the post-purchase customer view renders correctly.

## Customer email

Unchanged. `sendOrderConfirmation` is called identically. Stripe is
collecting Dan's own email on test runs; a `[TEST]` subject prefix earns
no real safety and adds template surface.

## Operator alert email

`sendNeedsReviewAlert` is gated by `is_test` at the call site (the
`alert()` closure inside `handleCheckoutCompleted`). The function itself
is not modified — leaving it pure means it stays callable from any
future code path without re-deciding the gating.

## Cleanup

Manual:

```sql
DELETE FROM orders WHERE is_test = true;
```

`order_items` and `order_events` rows cascade-delete via existing
foreign keys (`ON DELETE CASCADE` is already in place; if it isn't on a
specific FK, the cleanup script will need a `WHERE order_id IN (…)`
sub-query — to be confirmed during planning).

Printful drafts are purged manually in the Printful dashboard. They are
identifiable by `external_id` matching `order_<id>_<attempt>` for the
deleted order rows.

No automation in this spec.

## Testing

- **Unit:** add a vitest case under `tests/lib/` that calls
  `getStripeConfig` with a `sk_test_…` env and asserts `testMode === true`,
  plus a case asserting that a `sk_live_…` env yields `testMode === false`.
  No webhook unit tests exist today (`tests/lib/` covers `errors`, `slug`,
  `money`, `variant-templates`, `order-event-text`, `image-derive`, `auth`,
  `integration-health`), so the webhook changes are exercised by the
  end-to-end verification below rather than by adding a new harness.
- **End-to-end:** out of scope for unit tests; verified by the user
  taking a Stripe test card through the deployed flow once the webhook
  delivery prerequisite is met. Verification points:
  1. Order row has `is_test = true`.
  2. Printful dashboard shows a draft order, not a confirmed one.
  3. No `needs_review` alert email fires (even if the order is flagged
     in the DB).
  4. Customer confirmation email arrives (Dan to himself).
  5. `/orders/[token]` renders normally.

## Alternatives considered

**Separate `test_orders` table.** Rejected: doubles admin code paths
and read/write surfaces for an "occasional during dev" use case.

**A `status='test'` enum value instead of an `is_test` column.**
Rejected: `status` represents lifecycle stage (placed → paid → submitted
→ fulfilled → delivered). A test order has a real lifecycle. Conflating
the dimensions loses information.

**Hide test orders from the admin order list.** Rejected: during dev
you want to *see* the test orders to verify the flow worked.

**Skip the DB write entirely in test mode.** Rejected: breaks the
`/api/orders/by-session/[id]` redirect (which needs the row to exist) and
prevents verifying admin surfaces.

## Open dependency: webhook delivery

The deployed Stripe webhook is currently not creating order rows. Until
that is fixed (in Stripe Dashboard config + Vercel env), no test of any
kind — test mode or otherwise — exercises this code path. The spec is
complete and implementable without that fix; verification waits on it.
