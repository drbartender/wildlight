# Wildlight Audit Fixes — Top-Tier Batch (Design Spec)

_Date: 2026-07-07 · Source: `docs/audit-2026-07-06.md` (multi-agent audit, 27 verified findings)_

## Context

The 2026-07-06 full-codebase audit produced 27 CONFIRMED findings. This spec covers the
**top-tier batch** Dallas approved: the two High findings plus the three highest-value
money/reliability items. Everything else is explicitly deferred to later lanes.

## Scope

**In this batch:**

1. **H1** — limited-edition oversell (`COUNT(rows)` vs `SUM(quantity)`)
2. **H2** — `finalize` rollback deletes a live artwork's image + print master (update mode)
3. **Partial refund** flips the whole order to `refunded`
4. **Webhook** first-delivery failure is never retried (paid order never created)
5. **`npm audit fix`** — 6 HIGH `undici` CVEs + `dompurify`/`postcss`/`uuid`

**Deferred (NOT in this batch):** login-rate-limit TOCTOU, unauth re-subscribe opt-out,
`ai-draft` rate limit, `withConnRetry` roll-out to all read paths, `requireAdmin` 500-vs-401,
security headers, Sentry client wiring / `beforeSend` scrub, Stripe client memoization,
refund idempotency-key, R2 presign size bound, and the **edition concurrency race**
(finding #26 / gap G2 — deterministic oversell is fixed by H1; the two-buyers-same-second
race is a separate, lower-probability lane).

## The fixes

### 1. H1 — Edition oversell (deterministic)

**Root cause:** the cap guard compares `sold + requested > edition_size`, but `sold` is
`COUNT(oi.id)` (one row per cart line, regardless of quantity) while `requested` sums
`quantity`. `order_items.quantity INT NOT NULL DEFAULT 1` confirms one row can represent N units.

**Fix:** replace `SELECT COUNT(oi.id)::int` with `SELECT COALESCE(SUM(oi.quantity),0)::int`
in the edition sold-count subquery at all **5** sites:

- `lib/editions.ts:30`
- `app/api/checkout/route.ts:97`
- `app/api/admin/artworks/[id]/route.ts:38`
- `app/api/admin/artworks/[id]/route.ts:259`
- `app/(shop)/shop/artwork/[slug]/page.tsx:62`

No schema change. The `NOT IN ('canceled','refunded')` status filter stays as-is.

**Test:** seed an artwork with `edition_size=5`; insert a paid order with one `order_items`
row of `quantity=3`; assert `getEditionStatus().soldCount === 3` (was `1`) and that a
checkout requesting `quantity=3` more is rejected (`3+3 > 5`).

### 2. H2 — finalize delete guard

**Root cause:** in **update** mode, `webKey`/`printKey` are the artwork's *canonical* keys.
The happy path `uploadPublic(webKey)` + `copyAndDeletePrivate(staged→printKey)` overwrites
the live objects (and deletes the staged source), then the DB `UPDATE` can throw (Neon drop);
the catch runs `deletePublic(webKey)` + `deletePrivate(printKey)` **unconditionally**,
destroying the live image + print master with no recoverable source. Row-delete is already
guarded by `createdRowId != null`; the file-deletes are not.

**Fix:** wrap the two canonical file-deletes (lines 268-269) in `if (createdRowId != null)`
so they only run in **create** mode (where the keys are brand-new and safe to reap). Leave
the staged-key delete (line 270) unconditional. In update mode a rollback then leaves the
freshly-uploaded (valid) image at the canonical key the row still points to — no data loss;
the admin simply retries to refresh `print_width/height/updated_at`.

**Test:** unit test mocking `@/lib/r2`; drive `POST` in update mode, force the
`withTransaction` to reject; assert `deletePublic`/`deletePrivate` were **not** called with
the canonical keys (only `deletePrivate(stagedKey)`). Repeat in create mode; assert the
canonical deletes **are** called.

### 3. Partial refund status

**Verified Stripe behavior (docs, 2026-07-07):** the `charge.refunded` *event* fires for
partial refunds too; `charge.amount_refunded` is cumulative; the charge's **`refunded`
boolean is `true` only when the entire amount is refunded**. We subscribe only to
`charge.refunded` (not `refund.updated`), so there is no dual-event ordering concern.

**Root cause:** `handleChargeRefunded` unconditionally sets `status='refunded'`, which frees
the numbered-edition slot for resale (sold filter excludes `refunded`) and, via the
`uniq_order_events_refunded` index, drops any later refund event.

**Fix:** gate on the authoritative full-refund signal.

- If `charge.refunded === true` (full refund): keep current behavior — insert the `refunded`
  event (ON CONFLICT unique index) and `UPDATE ... status='refunded'`.
- Else (partial): insert a **new** `refund_partial` order-event recording
  `amount_cents: charge.amount_refunded` (cumulative) and `refunded_total`; **do not** touch
  `orders.status`. This keeps the edition slot counted and preserves the fulfillment status.
  The `refund_partial` type is not covered by the `refunded` unique index, so multiple
  partials log cleanly.

No schema/status-enum change; no new status value. `refund_partial` is a new `order_events.type`.

**Test:** (a) full refund — `charge.refunded=true`, `amount_refunded=total` → status becomes
`refunded`, one `refunded` event, edition slot freed. (b) partial — `charge.refunded=false`,
`amount_refunded < total` → status unchanged, one `refund_partial` event, edition slot still
counted, order still shows its prior fulfillment status. (c) two partials → two
`refund_partial` events, status still unchanged.

### 4. Webhook first-delivery retry

**Root cause:** the handler claims the `webhook_events` row (INSERT ON CONFLICT DO NOTHING)
*before* processing, and on any thrown error returns HTTP 200. Stripe treats 2xx as
acknowledged and never retries; a retry would also short-circuit on `!claim.rowCount`. So a
transient failure (Neon idle-drop) during order creation = customer charged, no order, no
email, no Printful, no `needs_review` row.

**Fix (two parts):**

- **(a) In-process resilience:** wrap `handleCheckoutCompleted`'s order-creation
  `withTransaction` in `withConnRetry` (`lib/db.ts:95`) so a single transient Neon drop is
  retried in-process. The transaction is a naked multi-statement insert guarded by
  `ON CONFLICT (stripe_session_id) DO NOTHING`, so a retry is safe.
- **(b) Completion-based dedupe + Stripe retry:** treat an event as a duplicate only when
  `processed_at IS NOT NULL`. On the dedupe short-circuit, `SELECT processed_at` for the
  existing row; if processed → return 200 `{duplicate:true}`; if not processed → fall through
  and process (idempotent re-entry protects us). On a processing **error**, still record
  `webhook_events.error` but return **5xx** so Stripe retries with backoff.

**Idempotency safety:** on re-entry the order INSERT `ON CONFLICT (stripe_session_id) DO
NOTHING` returns 0 rows → `handleCheckoutCompleted` early-returns before Printful submit and
before the attempt-counter bump, so no double order and no double Printful submit. Concurrent
duplicate deliveries (both un-processed) are safe for the same reason.

**Test:** (a) first delivery throws inside the order txn → response is 5xx and
`webhook_events.processed_at IS NULL`; a second delivery of the same event id then succeeds
and creates exactly one order. (b) a genuine duplicate after success → 200 `{duplicate:true}`,
no second order. (c) `withConnRetry` path: first txn attempt throws a transient
`connection terminated`, retry succeeds → one order, 200.

### 5. npm audit fix

Run `npm audit fix` (non-breaking range for `undici`/`postcss`/`uuid`/`dompurify`), then
`npm run typecheck && npm run build && npm test`. Commit the lockfile bump **separately and
first** so a dependency regression is isolated from the code changes. If `npm audit fix`
wants a breaking `--force` bump for anything, stop and report rather than force it.

## Verification approach

- **Local throwaway Postgres on this box** (32 GB RAM available). `DATABASE_URL` → a
  `localhost` DB; `lib/db.ts` `wantsNoSsl` already disables SSL for `localhost`. Apply
  `lib/schema.sql` via `npm run migrate`, seed a limited edition + a paid order. This isolates
  all DB-touching verification from the live Neon DB. No Vercel-managed Neon access needed.
- **Stripe:** test-mode keys only; drive `handleChargeRefunded` / `handleCheckoutCompleted`
  with constructed test `Charge` / `Session` objects and fault injection. No live charges.
- **R2 (H2):** no live R2 — unit test mocks `@/lib/r2` and asserts which deletes fire per mode.
- **Vitest** unit tests per fix (extend `tests/lib/`); `npm run typecheck` and
  `CI-style npm run build` green before review.

## Process

- Work in a **git worktree lane** off `main` (code-only, squash-merged back).
- **TDD** per fix: red test reproducing the defect first, then the fix, then green.
- **Pre-push review fleet** (security + correctness + money-seam reviewers) before any merge.
- Nothing pushed to `main` without Dallas's explicit go.

## Risks & rollback

- Highest-risk change is #4 (webhook retry semantics on the money path). Mitigation: the
  idempotent-re-entry argument above + explicit double-processing tests; the change is additive
  (adds retry, never removes the existing dedupe row) and reverts cleanly.
- #3 introduces a new `order_events.type` value (`refund_partial`); any admin UI that switches
  on event type must tolerate the new value (verify the order timeline renderer).
- Each fix is an independent commit in the lane, so any single one can be dropped before merge.

## Out of scope / follow-ups

The deferred findings above become their own lanes. The edition **concurrency** race (G2)
should be the immediate next one after this batch, since H1 fixes only the deterministic case.
