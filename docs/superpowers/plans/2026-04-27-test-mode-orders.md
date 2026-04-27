# Test-mode orders — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make end-to-end checkout testable on a deployed Stripe-test-mode environment without queueing real Printful fulfillment, by writing an `is_test` flag on orders, submitting Printful as a draft, and suppressing operator alerts for test runs.

**Architecture:** Single test-mode signal from `getStripeConfig().testMode` (widened to also detect `sk_test_…` keys, not just the timed `STRIPE_TEST_MODE_UNTIL` window). Webhook reads it once, persists `is_test` on the new order row, sets `confirm: !testMode` on the Printful submit, and skips `sendNeedsReviewAlert`. Admin order list surfaces a small "TEST" pill on test rows. Customer email and `/orders/[token]` are unchanged.

**Tech Stack:** Next.js 16 App Router, Postgres (Neon) via raw `pg`, Stripe webhooks (`stripe` SDK), Printful REST API, Vitest unit tests, Vercel deploy.

**Spec:** `docs/superpowers/specs/2026-04-27-test-mode-orders-design.md`

**Pre-existing uncommitted changes (to be absorbed by this plan):**
- `lib/stripe.ts` — `testMode` widening to recognize `sk_test_…` (Task 1).
- `app/api/webhooks/stripe/route.ts` — `confirm: !testMode` and the test-mode log line at the Printful submit (Task 3).

These edits exist in the working tree from the brainstorming session. The plan commits them in the right places rather than asking you to revert and rewrite. Diff against `git show HEAD:<file>` to see exactly what's already there.

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `lib/schema.sql` | Idempotent schema. Add `orders.is_test`. | Modified (Task 1) |
| `lib/stripe.ts` | `testMode` source of truth. Widen detection. | Modified — already edited (Task 1) |
| `tests/lib/stripe-config.test.ts` | New vitest covering `getStripeConfig` modes. | Created (Task 1) |
| `app/api/webhooks/stripe/route.ts` | Write `is_test`, draft Printful, gate alerts. | Modified — partially edited (Tasks 2 & 3) |
| `app/api/admin/orders/route.ts` | Surface `is_test` to admin list. | Modified (Task 4) |
| `app/admin/orders/page.tsx` | Render TEST pill on test rows. | Modified (Task 4) |
| `app/admin/admin.css` | Style for `.wl-adm-test-pill`. | Modified (Task 4) |

No new components extracted — the TEST pill is a 4-line inline `<span>`, not worth its own component file.

---

## Task 1: Schema migration + `testMode` widening + unit test

**Why grouped:** the schema change and the lib widening both establish the test-mode foundation. The unit test exercises the lib change directly. Grouping them keeps one logical commit per atomic concept ("test-mode signal exists and is detectable").

**Files:**
- Modify: `lib/schema.sql` (add `is_test` to orders block, around the existing `printful_attempt` ALTER at lines 89-90)
- Modify: `lib/stripe.ts` (already edited; the diff is the widening logic at lines 14, 24-34)
- Create: `tests/lib/stripe-config.test.ts`

- [ ] **Step 1.1: Confirm `lib/stripe.ts` already has the widened `testMode`**

Run: `git diff lib/stripe.ts`
Expected: a diff showing `testMode: secret.startsWith('sk_test_')` on the non-forced path and a comment about the widening. If the diff is empty (i.e., the file matches HEAD), the working tree was reverted — re-apply the change below before continuing.

If you need to re-apply, the final state of `pick()` is:

```ts
function pick(): StripeConfig {
  const until = process.env.STRIPE_TEST_MODE_UNTIL;
  const forceTest = until ? new Date(until) > new Date() : false;
  if (forceTest) {
    const secret = process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY || '';
    return {
      secret,
      publishable:
        process.env.STRIPE_PUBLISHABLE_KEY_TEST || process.env.STRIPE_PUBLISHABLE_KEY || '',
      webhookSecret:
        process.env.STRIPE_WEBHOOK_SECRET_TEST || process.env.STRIPE_WEBHOOK_SECRET || '',
      testMode: true,
    };
  }
  // Also treat a plain `sk_test_…` secret as test mode, even without the
  // timed STRIPE_TEST_MODE_UNTIL window. This is what's in effect when the
  // operator just plugs test keys into the regular slots — downstream code
  // (Printful draft submission) can rely on `testMode` to gate side effects.
  const secret = process.env.STRIPE_SECRET_KEY || '';
  return {
    secret,
    publishable: process.env.STRIPE_PUBLISHABLE_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    testMode: secret.startsWith('sk_test_'),
  };
}
```

- [ ] **Step 1.2: Write the failing test**

Create `tests/lib/stripe-config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getStripeConfig } from '@/lib/stripe';

const ENV_KEYS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_SECRET_KEY_TEST',
  'STRIPE_PUBLISHABLE_KEY_TEST',
  'STRIPE_WEBHOOK_SECRET_TEST',
  'STRIPE_TEST_MODE_UNTIL',
];

let snapshot: Record<string, string | undefined>;

beforeEach(() => {
  snapshot = {};
  for (const k of ENV_KEYS) {
    snapshot[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
});

describe('getStripeConfig.testMode', () => {
  it('is true when STRIPE_SECRET_KEY is sk_test_…', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc123';
    expect(getStripeConfig().testMode).toBe(true);
  });

  it('is false when STRIPE_SECRET_KEY is sk_live_…', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc123';
    expect(getStripeConfig().testMode).toBe(false);
  });

  it('is false when STRIPE_SECRET_KEY is missing', () => {
    expect(getStripeConfig().testMode).toBe(false);
  });

  it('is true when STRIPE_TEST_MODE_UNTIL is in the future, regardless of key prefix', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc123';
    process.env.STRIPE_TEST_MODE_UNTIL = new Date(Date.now() + 60_000).toISOString();
    expect(getStripeConfig().testMode).toBe(true);
  });

  it('is false when STRIPE_TEST_MODE_UNTIL is in the past', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc123';
    process.env.STRIPE_TEST_MODE_UNTIL = new Date(Date.now() - 60_000).toISOString();
    expect(getStripeConfig().testMode).toBe(false);
  });
});
```

- [ ] **Step 1.3: Run the test to verify it passes (lib edit was applied earlier)**

Run: `npm test -- tests/lib/stripe-config.test.ts`
Expected: 5 tests pass.

If a test fails because `testMode` is reported as `false` for the `sk_test_` case, the lib widening was reverted. Re-apply Step 1.1 and re-run.

- [ ] **Step 1.4: Add the schema change**

In `lib/schema.sql`, after the existing `printful_attempt` ALTER block (currently lines 89-90), add:

```sql
-- is_test: marks orders that were created via Stripe test-mode checkout.
-- Read by admin surfaces to render a TEST pill and by the webhook to skip
-- operator alert emails. Default false so existing rows (all real) stay
-- correct after migration.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;
```

- [ ] **Step 1.5: Run the migration locally**

Run: `npm run migrate`
Expected: prints `schema applied` and exits 0. The `ADD COLUMN IF NOT EXISTS` is a no-op on re-run.

If you don't have a local DB pointed at by `DATABASE_URL`, you can skip running the migration and rely on `npm run build` to apply it on next deploy. The schema change is still committable.

- [ ] **Step 1.6: Verify the column landed**

Run: `psql "$DATABASE_URL" -c "\d orders" | grep is_test`
Expected: `is_test | boolean | not null | false` (or similar). Skip if no local DB; the build pipeline will apply on deploy.

- [ ] **Step 1.7: Run typecheck and full test suite**

Run: `npm run typecheck && npm test`
Expected: typecheck passes, all tests pass (including the new 5 in `stripe-config.test.ts`).

- [ ] **Step 1.8: Commit**

```bash
git add lib/schema.sql lib/stripe.ts tests/lib/stripe-config.test.ts
git commit -m "feat: orders.is_test + widen Stripe testMode signal

testMode now also reflects a plain sk_test_… secret, not just the
timed STRIPE_TEST_MODE_UNTIL window. Webhook and admin surfaces
will read this flag to gate side effects in upcoming commits."
```

---

## Task 2: Webhook persists `is_test`

**Files:**
- Modify: `app/api/webhooks/stripe/route.ts` (lines 38, 157-175 — read testMode at the top of `handleCheckoutCompleted`, add it to the INSERT)

- [ ] **Step 2.1: Read `testMode` at the top of `handleCheckoutCompleted`**

Currently the function destructures `testMode` later, near the Printful submit (line 324). Move that read to the top of the function so it's available at order INSERT time.

In `app/api/webhooks/stripe/route.ts`, locate the start of `handleCheckoutCompleted` (currently at line 91):

```ts
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const cart = JSON.parse(
    (session.metadata?.cart_json as string) || '[]',
  ) as CartLine[];
  if (!cart.length) throw new Error('empty cart metadata');
  const ids = cart.map((l) => l.variantId);
```

Change to:

```ts
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const { testMode } = getStripeConfig();
  const cart = JSON.parse(
    (session.metadata?.cart_json as string) || '[]',
  ) as CartLine[];
  if (!cart.length) throw new Error('empty cart metadata');
  const ids = cart.map((l) => l.variantId);
```

Then in the Printful submit branch (currently around line 324), remove the duplicate `const { testMode } = getStripeConfig();` line and the surrounding comment block. The comment about test mode now belongs at the top of the function or inline at the `confirm: !testMode` call.

After the edit, the Printful submit block should read:

```ts
      const attempt = bump.rows[0].printful_attempt;
      const pfOrder = await printful.createOrder({
        external_id: `order_${orderId}_${attempt}`,
        recipient: {
          name: session.customer_details?.name || '',
          address1: addr?.line1 || '',
          address2: addr?.line2 || undefined,
          city: addr?.city || '',
          state_code: addr?.state || '',
          country_code: addr?.country || 'US',
          zip: addr?.postal_code || '',
          email: session.customer_details?.email || undefined,
        },
        items: pfItems,
        retail_costs: {
          currency: 'usd',
          subtotal: ((session.amount_subtotal || 0) / 100).toFixed(2),
          shipping: ((session.shipping_cost?.amount_total || 0) / 100).toFixed(2),
          tax: ((session.total_details?.amount_tax || 0) / 100).toFixed(2),
          total: ((session.amount_total || 0) / 100).toFixed(2),
        },
        // Test mode submits as a Printful draft (not auto-confirmed) so the
        // order shows in their dashboard but is not fulfilled or charged.
        confirm: !testMode,
      });
      if (testMode) {
        logger.info('printful order submitted as draft (stripe test mode)', {
          orderId,
          printfulOrderId: pfOrder.id,
        });
      }
```

- [ ] **Step 2.2: Add `is_test` to the order INSERT**

Locate the INSERT at lines 157-175 of `app/api/webhooks/stripe/route.ts`:

```ts
  await withTransaction(async (client) => {
    const orderRes = await client.query<{ id: number; public_token: string }>(
      `INSERT INTO orders (stripe_session_id, stripe_payment_id, customer_email, customer_name,
                           shipping_address, subtotal_cents, shipping_cents, tax_cents, total_cents, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'paid')
       ON CONFLICT (stripe_session_id) DO NOTHING
       RETURNING id, public_token`,
      [
        session.id,
        typeof session.payment_intent === 'string' ? session.payment_intent : null,
        session.customer_details?.email,
        session.customer_details?.name,
        addr || null,
        session.amount_subtotal || 0,
        session.shipping_cost?.amount_total || 0,
        session.total_details?.amount_tax || 0,
        session.amount_total || 0,
      ],
    );
```

Change to add `is_test` as the last column and `$10` parameter:

```ts
  await withTransaction(async (client) => {
    const orderRes = await client.query<{ id: number; public_token: string }>(
      `INSERT INTO orders (stripe_session_id, stripe_payment_id, customer_email, customer_name,
                           shipping_address, subtotal_cents, shipping_cents, tax_cents, total_cents,
                           status, is_test)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'paid', $10)
       ON CONFLICT (stripe_session_id) DO NOTHING
       RETURNING id, public_token`,
      [
        session.id,
        typeof session.payment_intent === 'string' ? session.payment_intent : null,
        session.customer_details?.email,
        session.customer_details?.name,
        addr || null,
        session.amount_subtotal || 0,
        session.shipping_cost?.amount_total || 0,
        session.total_details?.amount_tax || 0,
        session.amount_total || 0,
        testMode,
      ],
    );
```

- [ ] **Step 2.3: Run typecheck**

Run: `npm run typecheck`
Expected: passes. The `testMode` boolean is a valid `pg` query parameter; no new types needed.

- [ ] **Step 2.4: Commit**

```bash
git add app/api/webhooks/stripe/route.ts
git commit -m "feat: webhook persists orders.is_test from Stripe testMode

Read testMode once at the top of handleCheckoutCompleted, bind it
to the INSERT, and submit Printful as a draft when test. The Stripe
test mode signal now flows into the DB so admin surfaces can render
a TEST pill in a follow-up commit."
```

---

## Task 3: Skip operator alerts for test orders

**Files:**
- Modify: `app/api/webhooks/stripe/route.ts` (lines 247-253 — the `alert` closure)

**Why a separate task:** the alert change is conceptually distinct (an outbound email side effect) and small enough that bundling it would obscure intent. Easier to revert in isolation if Dan later decides he wants test-mode alerts after all.

- [ ] **Step 3.1: Gate the `alert` closure on `testMode`**

In `app/api/webhooks/stripe/route.ts`, find the existing `alert` closure (currently lines 247-253):

```ts
  // Wrap alert sends so a Resend hiccup is logged distinctly from a real
  // processing failure (which is what `webhook_events.error` is for).
  const alert = async (reason: string) => {
    try {
      await sendNeedsReviewAlert(orderId, reason);
    } catch (err) {
      logger.warn('needs_review alert failed', { err, orderId });
    }
  };
```

Replace with:

```ts
  // Wrap alert sends so a Resend hiccup is logged distinctly from a real
  // processing failure (which is what `webhook_events.error` is for). For
  // test-mode orders the alert is a no-op — flagging still happens in the
  // DB (visible in admin), but Dan's inbox stays quiet during dev pushes.
  const alert = async (reason: string) => {
    if (testMode) {
      logger.info('needs_review alert suppressed (test mode)', { orderId, reason });
      return;
    }
    try {
      await sendNeedsReviewAlert(orderId, reason);
    } catch (err) {
      logger.warn('needs_review alert failed', { err, orderId });
    }
  };
```

`testMode` is already in scope from Task 2 (declared at the top of `handleCheckoutCompleted`).

- [ ] **Step 3.2: Run typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3.3: Commit**

```bash
git add app/api/webhooks/stripe/route.ts
git commit -m "feat: suppress needs_review alert email for test orders

Test-mode orders still flag in the DB (visible in admin), but
sendNeedsReviewAlert becomes a no-op so Dan's inbox stays quiet
during dev pushes. A logger.info records the suppression for log
triage."
```

---

## Task 4: Surface `is_test` in admin order list with TEST pill

**Files:**
- Modify: `app/api/admin/orders/route.ts` (line 9-15 — SELECT list)
- Modify: `app/admin/orders/page.tsx` (the `Row` interface + both table bodies)
- Modify: `app/admin/admin.css` (add `.wl-adm-test-pill` rule)

- [ ] **Step 4.1: Add `is_test` to the admin orders API**

In `app/api/admin/orders/route.ts`, change the SELECT from:

```ts
  const { rows } = await pool.query(
    `SELECT o.id, o.status, o.customer_email, o.customer_name, o.total_cents,
            o.shipping_address,
            o.created_at::text, o.printful_order_id,
            (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id) AS item_count
     FROM orders o
     ORDER BY o.created_at DESC
     LIMIT 500`,
  );
```

To:

```ts
  const { rows } = await pool.query(
    `SELECT o.id, o.status, o.customer_email, o.customer_name, o.total_cents,
            o.shipping_address, o.is_test,
            o.created_at::text, o.printful_order_id,
            (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id) AS item_count
     FROM orders o
     ORDER BY o.created_at DESC
     LIMIT 500`,
  );
```

- [ ] **Step 4.2: Extend the `Row` interface in the page**

In `app/admin/orders/page.tsx`, change the `Row` interface (currently lines 9-19) from:

```ts
interface Row {
  id: number;
  status: string;
  customer_email: string;
  customer_name: string | null;
  total_cents: number;
  shipping_address: Record<string, string> | null;
  created_at: string;
  printful_order_id: number | null;
  item_count: number;
}
```

To:

```ts
interface Row {
  id: number;
  status: string;
  customer_email: string;
  customer_name: string | null;
  total_cents: number;
  shipping_address: Record<string, string> | null;
  created_at: string;
  printful_order_id: number | null;
  item_count: number;
  is_test: boolean;
}
```

- [ ] **Step 4.3: Render the TEST pill in both skin tables**

The page renders two table skins (Atelier ~lines 199-237 and Darkroom ~lines 257-282). Each row's `<td>` containing `<AdminPill status={r.status} />` becomes:

```tsx
                      <td>
                        {r.is_test && (
                          <span className="wl-adm-test-pill" aria-label="Test order">
                            TEST
                          </span>
                        )}
                        <AdminPill status={r.status} />
                      </td>
```

Apply this to **both** table bodies — once for the Atelier skin, once for the Darkroom skin. Spec says they're intentionally distinct visual languages over the same data, so don't try to factor out a shared component.

- [ ] **Step 4.4: Add CSS for `.wl-adm-test-pill`**

In `app/admin/admin.css`, near the existing `.wl-adm-pill` rule (currently around line 581), append:

```css
/* Informational TEST badge for orders created via Stripe test-mode
   checkout. Sits next to the lifecycle-status pill. Muted on purpose
   — this is a "heads up", not a warning. */
.wl-adm-test-pill {
  display: inline-flex;
  align-items: center;
  margin-right: 6px;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--adm-rule-soft);
  color: var(--adm-muted);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.wl-admin-surface[data-theme='dark'] .wl-adm-test-pill {
  border-radius: 3px;
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  font-size: 10px;
  text-transform: lowercase;
  letter-spacing: 0.02em;
}
```

The dark-theme override mirrors the existing `.wl-adm-pill` dark variant pattern (lowercase, mono font, square corners) so the TEST badge feels native in Darkroom.

- [ ] **Step 4.5: Start dev and verify visually**

Run: `npm run dev`

In a second terminal, insert a fake test row to verify rendering (skip if you have real test orders already from prior dev work):

```bash
psql "$DATABASE_URL" -c "
  UPDATE orders SET is_test = true
  WHERE id = (SELECT id FROM orders ORDER BY created_at DESC LIMIT 1);
"
```

Open `http://localhost:3000/admin/orders` (log in as admin if prompted). The most recent row should show a small "TEST" pill before the status pill in both Atelier and Darkroom views (toggle the theme picker if available, otherwise inspect each table block in DevTools).

Revert the test write when done if you don't want it persisted:

```bash
psql "$DATABASE_URL" -c "
  UPDATE orders SET is_test = false
  WHERE id = (SELECT id FROM orders ORDER BY created_at DESC LIMIT 1);
"
```

- [ ] **Step 4.6: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: typecheck passes, all tests pass.

- [ ] **Step 4.7: Commit**

```bash
git add app/api/admin/orders/route.ts app/admin/orders/page.tsx app/admin/admin.css
git commit -m "feat: TEST pill on test orders in admin list

Surface orders.is_test in the admin orders API and render a small
informational TEST badge in both Atelier and Darkroom order tables.
Muted styling (not a warning) — test orders sit inline with real
ones and aren't filtered out, since you want to see them during dev."
```

---

## Task 5: Final verification

- [ ] **Step 5.1: Run full typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: typecheck passes, all tests pass (including the 5 new `stripe-config.test.ts` cases).

- [ ] **Step 5.2: Confirm git log shows clean separation**

Run: `git log --oneline main..HEAD`
Expected: 4 commits in this order:

```
<sha> feat: TEST pill on test orders in admin list
<sha> feat: suppress needs_review alert email for test orders
<sha> feat: webhook persists orders.is_test from Stripe testMode
<sha> feat: orders.is_test + widen Stripe testMode signal
```

If commits are out of order or merged, that's fine as long as each is reviewable on its own. Don't rebase to "fix" ordering.

- [ ] **Step 5.3: Note unresolved deployed-webhook delivery issue**

This plan does **not** address the original symptom Dan reported (test card → page never advances → no email). That's a deployed-environment config issue: either the Stripe Dashboard webhook endpoint isn't registered against the deployed URL, or `STRIPE_WEBHOOK_SECRET` in Vercel doesn't match the secret on that endpoint.

When Dan is ready to verify this work end-to-end, he'll need to:

1. Confirm the webhook endpoint is registered at Stripe Dashboard → Developers → Webhooks for the deployed URL (`https://<deployed-domain>/api/webhooks/stripe`).
2. Confirm `STRIPE_WEBHOOK_SECRET` (or `STRIPE_WEBHOOK_SECRET_TEST` if the timed window is in use) in Vercel matches the signing secret shown on that endpoint.
3. Run a test-card checkout against the deployed site.
4. Verify in the DB:
   ```sql
   SELECT id, status, is_test, printful_order_id
   FROM orders ORDER BY created_at DESC LIMIT 1;
   ```
   Expected: most recent row has `is_test = true`, `status` is `paid` or `submitted`, and `printful_order_id` is set if no flagging path triggered.
5. Verify in Printful's dashboard that the order is a **draft** (not a confirmed order).
6. Verify the customer confirmation email arrived.
7. Verify no `needs_review` alert email arrived (even if the order is in needs_review status in the DB).

Don't add this verification to a commit — it's a runtime check Dan does once the deploy lands.

---

## Self-review notes (already applied)

- Spec coverage: every section of the spec maps to a task — schema migration (Task 1), testMode signal (Task 1), webhook is_test write (Task 2), webhook draft Printful (Task 2), webhook alert gating (Task 3), admin pill (Task 4). Email and order-detail page are explicitly unchanged per spec.
- No placeholders.
- Type/name consistency: `is_test` (snake_case in DB, snake_case in API JSON, snake_case on the `Row` interface to match existing `printful_order_id` and `created_at` field naming).
- The two-skin admin table (Atelier + Darkroom) duplication is preserved deliberately — per memory, those skins are intentionally distinct visual languages and shouldn't be converged.
