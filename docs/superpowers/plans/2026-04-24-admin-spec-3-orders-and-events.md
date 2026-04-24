# Admin Spec 3 — Orders + `order_events` Timeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the append-only `order_events` ledger, wire writes from every mutation site, and rebuild the admin list + detail pages to render per-skin (Atelier vs Darkroom) from the ledger.

**Architecture:** Raw SQL via `pg`, idempotent migration appended to `lib/schema.sql`, writes happen inside existing `withTransaction` blocks, reads extend the existing `GET /api/admin/orders/[id]`. UI uses dual-DOM per-theme where the two skins diverge (filter strip, timeline, Darkroom-only Printful sidebar, Darkroom-only `ship_to` column) with `.wl-admin-surface[data-theme='dark']` CSS toggling which DOM shows. Shared DOM where the skins only diverge on typography (banner, items card, totals, Customer/Ship/Payment sidebar).

**Tech Stack:** Next.js 16 App Router, React, TypeScript, plain CSS custom properties, `pg`, Zod (request bodies), Vitest (lib tests only).

**Spec:** `docs/superpowers/specs/2026-04-24-admin-spec-3-orders-and-events.md`

**Design invariant:** Atelier and Darkroom are independent visual languages over the same data. Every piece of data is reachable in both skins; the shape, chrome, and typography belong to each skin individually. Do not converge the two.

---

## File Structure

**Create:**
- `lib/order-event-text.ts` — pure helper, event → human string. One `renderEventText(event)` export.
- `tests/lib/order-event-text.test.ts` — unit test the above.
- `app/api/admin/orders/[id]/note/route.ts` — `POST` admin-note endpoint.

**Modify:**
- `lib/schema.sql` — append `order_events` table + CHECK constraints + index + idempotent backfill statements.
- `app/api/webhooks/stripe/route.ts` — write `placed`, `paid`, `printful_submitted`, `printful_flagged` events inside existing transaction; add handler for `charge.refunded` event to write `refunded`.
- `app/api/webhooks/printful/route.ts` — write `shipped`, `delivered`, `canceled` events.
- `app/api/admin/orders/[id]/refund/route.ts` — write `refund_initiated` before Stripe refund call, `refunded` after success.
- `app/api/admin/orders/[id]/resubmit/route.ts` — write `resubmit_attempted` with outcome in payload.
- `app/api/admin/orders/[id]/route.ts` — extend `GET` to include `events`.
- `app/admin/orders/[id]/page.tsx` — remove field-derived timeline, render from `events[]`, dual-DOM per skin for timeline + sidebar; inline add-note form.
- `app/admin/orders/page.tsx` — dual-DOM per skin for filter strip + table (Darkroom adds `ship_to` column).
- `app/admin/admin.css` — CSS for new Darkroom `event_log`, Darkroom-only `ship_to` column, Darkroom-only Printful sidebar panel, list filter group styles.

**Delete:** nothing. The old field-derived timeline code in `app/admin/orders/[id]/page.tsx` is replaced in place.

---

## Task 1: Add `order_events` table + backfill to `lib/schema.sql`

**Files:**
- Modify: `lib/schema.sql` (append at the end, inside the "Idempotent post-create migrations" block — after existing `CREATE INDEX` statements).

All statements are idempotent and safe to re-run.

- [ ] **Step 1: Read the current end of `lib/schema.sql`**

Open `lib/schema.sql`. Locate the final `CREATE INDEX IF NOT EXISTS idx_subscribers_active …` statement. You'll append below it.

- [ ] **Step 2: Append the table + constraints + index**

Add to the end of `lib/schema.sql`:

```sql

-- Order events (append-only lifecycle ledger) -----------------------
-- Added 2026-04-24 for admin Spec 3.
CREATE TABLE IF NOT EXISTS order_events (
  id          SERIAL PRIMARY KEY,
  order_id    INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  who         TEXT NOT NULL DEFAULT 'system',
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_events_order_created
  ON order_events(order_id, created_at);

ALTER TABLE order_events DROP CONSTRAINT IF EXISTS order_events_type_chk;
ALTER TABLE order_events ADD CONSTRAINT order_events_type_chk CHECK (type IN (
  'placed', 'paid',
  'printful_submitted', 'printful_flagged',
  'shipped', 'delivered',
  'refund_initiated', 'refunded',
  'resubmit_attempted',
  'canceled',
  'admin_note',
  'error'
));

ALTER TABLE order_events DROP CONSTRAINT IF EXISTS order_events_who_chk;
ALTER TABLE order_events ADD CONSTRAINT order_events_who_chk CHECK (who IN (
  'customer', 'system', 'admin', 'stripe', 'printful'
));
```

- [ ] **Step 3: Append the backfill statements**

Still in `lib/schema.sql`, immediately after the constraint block added above, append:

```sql

-- Backfill order_events from existing orders. Every INSERT is guarded
-- by NOT EXISTS so the script is safe to re-run. Historical
-- created_at approximations use orders.created_at for `placed` and
-- orders.updated_at for later events — close-enough signal for rows
-- that existed before the ledger.
INSERT INTO order_events (order_id, type, who, payload, created_at)
SELECT o.id, 'placed', 'customer', '{}'::jsonb, o.created_at FROM orders o
WHERE NOT EXISTS (
  SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.type = 'placed'
);

INSERT INTO order_events (order_id, type, who, payload, created_at)
SELECT o.id, 'paid', 'stripe',
       jsonb_build_object('amount_cents', o.total_cents), o.updated_at
FROM orders o
WHERE o.status <> 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.type = 'paid'
  );

INSERT INTO order_events (order_id, type, who, payload, created_at)
SELECT o.id, 'printful_submitted', 'printful',
       jsonb_build_object('printful_order_id', o.printful_order_id),
       o.updated_at
FROM orders o
WHERE o.printful_order_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM order_events e
    WHERE e.order_id = o.id AND e.type = 'printful_submitted'
  );

INSERT INTO order_events (order_id, type, who, payload, created_at)
SELECT o.id, 'printful_flagged', 'system',
       jsonb_build_object('reason', COALESCE(o.notes, 'unknown')),
       o.updated_at
FROM orders o
WHERE o.status = 'needs_review'
  AND NOT EXISTS (
    SELECT 1 FROM order_events e
    WHERE e.order_id = o.id AND e.type = 'printful_flagged'
  );

INSERT INTO order_events (order_id, type, who, payload, created_at)
SELECT o.id, 'shipped', 'printful',
       jsonb_build_object(
         'tracking_number', o.tracking_number,
         'tracking_url',    o.tracking_url
       ),
       o.updated_at
FROM orders o
WHERE o.tracking_number IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM order_events e
    WHERE e.order_id = o.id AND e.type = 'shipped'
  );

INSERT INTO order_events (order_id, type, who, payload, created_at)
SELECT o.id, 'delivered', 'printful', '{}'::jsonb, o.updated_at
FROM orders o
WHERE o.status = 'delivered'
  AND NOT EXISTS (
    SELECT 1 FROM order_events e
    WHERE e.order_id = o.id AND e.type = 'delivered'
  );

INSERT INTO order_events (order_id, type, who, payload, created_at)
SELECT o.id, 'refunded', 'admin', '{}'::jsonb, o.updated_at
FROM orders o
WHERE o.status = 'refunded'
  AND NOT EXISTS (
    SELECT 1 FROM order_events e
    WHERE e.order_id = o.id AND e.type = 'refunded'
  );
```

- [ ] **Step 4: Run migrate**

```bash
npm run migrate
```

Expected: `schema applied`. If you see a CHECK-constraint violation, an existing row must have an unexpected `status`; investigate first. Re-running is safe.

- [ ] **Step 5: Sanity check**

```bash
# Pseudocode — use your preferred psql client. If DATABASE_URL points to
# a local dev DB with seed orders, this should return rows.
psql "$DATABASE_URL" -c "SELECT order_id, type, who FROM order_events ORDER BY order_id, created_at LIMIT 20;"
```

Expected: at least one `placed` event per existing order plus later events derived from each order's state.

- [ ] **Step 6: Re-run to confirm idempotency**

```bash
npm run migrate
```

Expected: `schema applied` a second time. Then:

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM order_events;"
```

Expected: the same count as before the second migrate. No duplicates.

- [ ] **Step 7: Commit**

```bash
git add lib/schema.sql
git commit -m "admin: order_events table + idempotent backfill"
```

---

## Task 2: `lib/order-event-text.ts` + unit tests

**Files:**
- Create: `lib/order-event-text.ts`
- Create: `tests/lib/order-event-text.test.ts`

A pure helper both the Atelier and Darkroom timeline renderers consume — ensures event wording stays consistent across skins.

- [ ] **Step 1: Create the helper**

Write `lib/order-event-text.ts`:

```ts
import { formatUSD } from '@/lib/money';

export type OrderEventType =
  | 'placed'
  | 'paid'
  | 'printful_submitted'
  | 'printful_flagged'
  | 'shipped'
  | 'delivered'
  | 'refund_initiated'
  | 'refunded'
  | 'resubmit_attempted'
  | 'canceled'
  | 'admin_note'
  | 'error';

export type OrderEventWho =
  | 'customer'
  | 'system'
  | 'admin'
  | 'stripe'
  | 'printful';

export interface OrderEvent {
  id: number;
  type: OrderEventType;
  who: OrderEventWho;
  payload: Record<string, unknown>;
  created_at: string;
}

/**
 * Render an order event as a single sentence. Pure. Used by both the
 * Atelier and Darkroom timelines.
 */
export function renderEventText(e: OrderEvent): string {
  switch (e.type) {
    case 'placed':
      return 'Placed by customer';
    case 'paid': {
      const amount = Number(e.payload.amount_cents ?? 0);
      return `Paid · ${formatUSD(amount)}`;
    }
    case 'printful_submitted': {
      const id = e.payload.printful_order_id;
      return id != null
        ? `Submitted to Printful · #${id}`
        : 'Submitted to Printful';
    }
    case 'printful_flagged': {
      const reason = typeof e.payload.reason === 'string' ? e.payload.reason : 'unknown';
      return `Flagged — ${reason}`;
    }
    case 'shipped': {
      const num = typeof e.payload.tracking_number === 'string' ? e.payload.tracking_number : '';
      const carrier = typeof e.payload.carrier === 'string' ? e.payload.carrier : 'carrier';
      return num ? `Shipped via ${carrier} · ${num}` : 'Shipped';
    }
    case 'delivered':
      return 'Delivered';
    case 'refund_initiated':
      return `Refund initiated by ${e.who}`;
    case 'refunded': {
      const amount = typeof e.payload.amount_cents === 'number' ? e.payload.amount_cents : null;
      return amount != null ? `Refunded · ${formatUSD(amount)}` : 'Refunded';
    }
    case 'resubmit_attempted': {
      const outcome = e.payload.outcome;
      if (outcome === 'ok') return 'Resubmit succeeded';
      const reason = typeof e.payload.reason === 'string' ? e.payload.reason : 'unknown';
      return `Resubmit failed — ${reason}`;
    }
    case 'admin_note': {
      const text = typeof e.payload.text === 'string' ? e.payload.text : '';
      return `Note — ${text}`;
    }
    case 'canceled':
      return 'Canceled';
    case 'error': {
      const msg = typeof e.payload.message === 'string' ? e.payload.message : 'unknown error';
      return `Error — ${msg}`;
    }
  }
}
```

- [ ] **Step 2: Write the failing test**

Write `tests/lib/order-event-text.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderEventText, type OrderEvent } from '@/lib/order-event-text';

function ev(partial: Partial<OrderEvent>): OrderEvent {
  return {
    id: 1,
    type: 'placed',
    who: 'customer',
    payload: {},
    created_at: '2026-04-24T00:00:00Z',
    ...partial,
  };
}

describe('renderEventText', () => {
  it('renders placed', () => {
    expect(renderEventText(ev({ type: 'placed' }))).toBe('Placed by customer');
  });

  it('renders paid with USD-formatted amount', () => {
    expect(
      renderEventText(ev({ type: 'paid', who: 'stripe', payload: { amount_cents: 12800 } })),
    ).toBe('Paid · $128.00');
  });

  it('renders printful_submitted with printful order id', () => {
    expect(
      renderEventText(
        ev({
          type: 'printful_submitted',
          who: 'printful',
          payload: { printful_order_id: 'P-9001' },
        }),
      ),
    ).toBe('Submitted to Printful · #P-9001');
  });

  it('renders printful_flagged with reason', () => {
    expect(
      renderEventText(
        ev({
          type: 'printful_flagged',
          who: 'system',
          payload: { reason: 'missing sync variant' },
        }),
      ),
    ).toBe('Flagged — missing sync variant');
  });

  it('renders shipped with carrier + tracking number', () => {
    expect(
      renderEventText(
        ev({
          type: 'shipped',
          who: 'printful',
          payload: { tracking_number: '1Z999', carrier: 'UPS' },
        }),
      ),
    ).toBe('Shipped via UPS · 1Z999');
  });

  it('renders shipped without carrier as "carrier"', () => {
    expect(
      renderEventText(
        ev({
          type: 'shipped',
          who: 'printful',
          payload: { tracking_number: '1Z999' },
        }),
      ),
    ).toBe('Shipped via carrier · 1Z999');
  });

  it('renders delivered', () => {
    expect(renderEventText(ev({ type: 'delivered', who: 'printful' }))).toBe('Delivered');
  });

  it('renders refund_initiated with the initiating actor', () => {
    expect(
      renderEventText(ev({ type: 'refund_initiated', who: 'admin' })),
    ).toBe('Refund initiated by admin');
  });

  it('renders refunded with amount when present', () => {
    expect(
      renderEventText(
        ev({ type: 'refunded', who: 'admin', payload: { amount_cents: 12800 } }),
      ),
    ).toBe('Refunded · $128.00');
  });

  it('renders refunded without amount as just "Refunded"', () => {
    expect(renderEventText(ev({ type: 'refunded', who: 'admin' }))).toBe('Refunded');
  });

  it('renders resubmit_attempted ok as success', () => {
    expect(
      renderEventText(
        ev({ type: 'resubmit_attempted', who: 'admin', payload: { outcome: 'ok' } }),
      ),
    ).toBe('Resubmit succeeded');
  });

  it('renders resubmit_attempted failed with reason', () => {
    expect(
      renderEventText(
        ev({
          type: 'resubmit_attempted',
          who: 'admin',
          payload: { outcome: 'failed', reason: 'timeout' },
        }),
      ),
    ).toBe('Resubmit failed — timeout');
  });

  it('renders admin_note with text', () => {
    expect(
      renderEventText(
        ev({
          type: 'admin_note',
          who: 'admin',
          payload: { text: 'called Dan; swapping print' },
        }),
      ),
    ).toBe('Note — called Dan; swapping print');
  });

  it('renders canceled', () => {
    expect(renderEventText(ev({ type: 'canceled', who: 'admin' }))).toBe('Canceled');
  });

  it('renders error with message', () => {
    expect(
      renderEventText(
        ev({ type: 'error', who: 'system', payload: { message: 'printful 502' } }),
      ),
    ).toBe('Error — printful 502');
  });
});
```

- [ ] **Step 3: Run the tests**

```bash
npm test -- order-event-text
```

Expected: all 15 tests pass.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/order-event-text.ts tests/lib/order-event-text.test.ts
git commit -m "lib: renderEventText helper + unit tests"
```

---

## Task 3: Stripe webhook — write events inside the existing transaction

**Files:**
- Modify: `app/api/webhooks/stripe/route.ts`

Write four kinds of events from `handleCheckoutCompleted`, and register a new handler for `charge.refunded` that writes a `refunded` event for refunds done through the Stripe dashboard.

- [ ] **Step 1: Add event writes inside `withTransaction`**

In `app/api/webhooks/stripe/route.ts`, find the `withTransaction` block starting at approximately line 126. Inside it, after `orderToken = orderRes.rows[0].public_token;` (around line 147) but **before** the `for (const l of cart)` loop, add:

```ts
    await client.query(
      `INSERT INTO order_events (order_id, type, who, payload)
       VALUES ($1, 'placed', 'customer', '{}'::jsonb)`,
      [orderId],
    );
    await client.query(
      `INSERT INTO order_events (order_id, type, who, payload)
       VALUES ($1, 'paid', 'stripe', $2::jsonb)`,
      [orderId, JSON.stringify({ amount_cents: session.amount_total ?? 0 })],
    );
```

- [ ] **Step 2: Write `printful_submitted` after successful Printful creation**

Still in `handleCheckoutCompleted`, find the `try { ... await printful.createOrder(…) ... UPDATE orders SET status='submitted' … }` branch (starts approximately line 218, ends approximately line 266). Immediately after the `await pool.query(UPDATE orders … 'submitted' …)` statement (approximately line 262-265), append:

```ts
      await pool.query(
        `INSERT INTO order_events (order_id, type, who, payload)
         VALUES ($1, 'printful_submitted', 'printful', $2::jsonb)`,
        [orderId, JSON.stringify({ printful_order_id: pfOrder.id })],
      );
```

- [ ] **Step 3: Write `printful_flagged` on every `needs_review` branch**

There are four places `handleCheckoutCompleted` writes `status='needs_review'`:
(1) the `priceDrift` branch, (2) missing `image_print_url`, (3) missing `printful_sync_variant_id`, (4) the `catch` that fires when `printful.createOrder` throws. Immediately after **each** of those `await pool.query(UPDATE orders SET status='needs_review' …)` calls, append:

```ts
    await pool.query(
      `INSERT INTO order_events (order_id, type, who, payload)
       VALUES ($1, 'printful_flagged', 'system', $2::jsonb)`,
      [orderId, JSON.stringify({ reason: /* the same notes string used in the UPDATE */ })],
    );
```

Use the **same** reason string that the `notes` column gets. Examples:

- priceDrift branch: reason is the full `price drift: …` string built at the top of that branch.
- missing print url: reason is `'missing image_print_url on one or more artworks'`.
- missing sync variant: reason is `'printful_sync_variant_id missing on one or more variants'`.
- createOrder catch: reason is `err instanceof Error ? err.message : String(err)`.

For readability, extract the notes string into a local `const reason = ...;` just before the UPDATE and reuse it in both statements.

- [ ] **Step 4: Handle `charge.refunded` for dashboard refunds**

In the top-level `POST` handler, find the existing branch:

```ts
if (event.type === 'checkout.session.completed') {
  await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
}
```

Replace it with:

```ts
if (event.type === 'checkout.session.completed') {
  await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
} else if (event.type === 'charge.refunded') {
  await handleChargeRefunded(event.data.object as Stripe.Charge);
}
```

Then append this handler at the end of the file:

```ts
async function handleChargeRefunded(charge: Stripe.Charge) {
  const paymentIntent =
    typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
  if (!paymentIntent) return;
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM orders WHERE stripe_payment_id = $1`,
    [paymentIntent],
  );
  if (!rows.length) return;
  const orderId = rows[0].id;

  // The order may already have a refunded event from the admin refund route
  // (which runs first). Make this idempotent via a best-effort not-exists
  // check instead of a real unique key — events deduplicate here.
  const existing = await pool.query<{ id: number }>(
    `SELECT 1 AS id FROM order_events
     WHERE order_id = $1 AND type = 'refunded' LIMIT 1`,
    [orderId],
  );
  if (existing.rowCount) return;

  await pool.query(
    `UPDATE orders SET status='refunded', updated_at=NOW()
     WHERE id = $1 AND status <> 'refunded'`,
    [orderId],
  );
  await pool.query(
    `INSERT INTO order_events (order_id, type, who, payload)
     VALUES ($1, 'refunded', 'stripe', $2::jsonb)`,
    [orderId, JSON.stringify({ amount_cents: charge.amount_refunded ?? 0 })],
  );
}
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. If there are `Stripe.Charge` typing issues, import the type explicitly at the top of the file: it is already imported as part of `type Stripe` on line 3.

- [ ] **Step 6: Commit**

```bash
git add app/api/webhooks/stripe/route.ts
git commit -m "api: stripe webhook writes placed/paid/printful events + charge.refunded"
```

---

## Task 4: Printful webhook — write events

**Files:**
- Modify: `app/api/webhooks/printful/route.ts`

Add event writes to the three outcome branches.

- [ ] **Step 1: Write `shipped` after the shipping UPDATE**

In `app/api/webhooks/printful/route.ts`, find the `if (event.type === 'package_shipped') { … }` branch (approximately line 72). After the `await pool.query(UPDATE orders … status='shipped' … RETURNING customer_email, public_token …)` completes and **after** the `if (r.rowCount)` body (so outside of the email try/catch), append:

```ts
      if (r.rowCount) {
        await pool.query(
          `INSERT INTO order_events (order_id, type, who, payload)
           VALUES ($1, 'shipped', 'printful', $2::jsonb)`,
          [
            ourId,
            JSON.stringify({
              tracking_number: trackingNumber,
              tracking_url: trackingUrl,
            }),
          ],
        );
      }
```

Place this **before** the `try { await sendOrderShipped … }` block so the event is recorded even if the email fails.

- [ ] **Step 2: Write `canceled` for package_returned / order_canceled**

Still in the handler, find the `else if (event.type === 'package_returned' || event.type === 'order_canceled')` branch. After its `await pool.query(UPDATE … status='canceled' …)`, append:

```ts
      await pool.query(
        `INSERT INTO order_events (order_id, type, who, payload)
         VALUES ($1, 'canceled', 'printful', $2::jsonb)`,
        [ourId, JSON.stringify({ via: event.type })],
      );
```

- [ ] **Step 3: Write `printful_flagged` for order_failed / order_put_hold**

Find the final `else if (event.type === 'order_failed' || event.type === 'order_put_hold')` branch. After its UPDATE, append:

```ts
      await pool.query(
        `INSERT INTO order_events (order_id, type, who, payload)
         VALUES ($1, 'printful_flagged', 'printful', $2::jsonb)`,
        [ourId, JSON.stringify({ reason: event.type })],
      );
```

- [ ] **Step 4: Handle a `package_delivered` event**

Printful sends this when a package is delivered. Add a new branch **above** the existing `package_returned` branch:

```ts
    } else if (event.type === 'package_delivered') {
      const r = await pool.query<{ id: number }>(
        `UPDATE orders SET status='delivered', updated_at=NOW() WHERE id = $1 RETURNING id`,
        [ourId],
      );
      if (r.rowCount) {
        await pool.query(
          `INSERT INTO order_events (order_id, type, who, payload)
           VALUES ($1, 'delivered', 'printful', '{}'::jsonb)`,
          [ourId],
        );
      }
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/webhooks/printful/route.ts
git commit -m "api: printful webhook writes shipped/delivered/canceled/flagged events"
```

---

## Task 5: Refund route — write `refund_initiated` + `refunded`

**Files:**
- Modify: `app/api/admin/orders/[id]/refund/route.ts`

- [ ] **Step 1: Write `refund_initiated` before the Stripe call**

In `app/api/admin/orders/[id]/refund/route.ts`, find the line `const { stripe_payment_id, printful_order_id } = claim.rows[0];` (approximately line 39). Immediately after it, add:

```ts
  await pool.query(
    `INSERT INTO order_events (order_id, type, who, payload)
     VALUES ($1, 'refund_initiated', 'admin', '{}'::jsonb)`,
    [id],
  );
```

- [ ] **Step 2: Write `refunded` after the success UPDATE**

Find `await pool.query(UPDATE orders SET status='refunded' … WHERE id = $1, [id])` (approximately line 56-58). Replace that query AND add a follow-up event write, like so:

```ts
    await pool.query(
      `UPDATE orders SET status='refunded', updated_at=NOW() WHERE id = $1`,
      [id],
    );
    await pool.query(
      `INSERT INTO order_events (order_id, type, who, payload)
       VALUES ($1, 'refunded', 'admin', '{}'::jsonb)`,
      [id],
    );
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/orders/[id]/refund/route.ts
git commit -m "api: refund route writes refund_initiated + refunded events"
```

---

## Task 6: Resubmit route — write `resubmit_attempted`

**Files:**
- Modify: `app/api/admin/orders/[id]/resubmit/route.ts`

- [ ] **Step 1: Write `resubmit_attempted` on success**

In `app/api/admin/orders/[id]/resubmit/route.ts`, find `await pool.query(UPDATE orders SET status='submitted' … [id, pf.id])` inside the success `try` (approximately line 112-115). Immediately after it, add:

```ts
    await pool.query(
      `INSERT INTO order_events (order_id, type, who, payload)
       VALUES ($1, 'resubmit_attempted', 'admin', $2::jsonb)`,
      [id, JSON.stringify({ outcome: 'ok', printful_order_id: pf.id })],
    );
```

- [ ] **Step 2: Write `resubmit_attempted` on failure**

Still in the handler, find the `catch (err)` block at the bottom (approximately line 117-129). After the `UPDATE orders SET status = 'needs_review' …` roll-back, append:

```ts
    await pool.query(
      `INSERT INTO order_events (order_id, type, who, payload)
       VALUES ($1, 'resubmit_attempted', 'admin', $2::jsonb)`,
      [
        id,
        JSON.stringify({
          outcome: 'failed',
          reason: err instanceof Error ? err.message : String(err),
        }),
      ],
    );
```

Also write the `resubmit_attempted` failure event for the two early-exit branches (`missing print file`, `missing sync variant id`) so "I clicked resubmit" is visible even when we reject before calling Printful. Immediately after each of those two `UPDATE orders SET status='needs_review' … notes=…` calls (approximately lines 62-66 and 70-74), append:

```ts
    await pool.query(
      `INSERT INTO order_events (order_id, type, who, payload)
       VALUES ($1, 'resubmit_attempted', 'admin', $2::jsonb)`,
      [id, JSON.stringify({ outcome: 'failed', reason: /* the same string used for notes */ })],
    );
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/orders/[id]/resubmit/route.ts
git commit -m "api: resubmit route writes resubmit_attempted event with outcome"
```

---

## Task 7: New admin-note endpoint

**Files:**
- Create: `app/api/admin/orders/[id]/note/route.ts`

- [ ] **Step 1: Create the route**

Write `app/api/admin/orders/[id]/note/route.ts`:

```ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

const Body = z.object({ text: z.string().min(1).max(500) });

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id: raw } = await ctx.params;
  const id = Number(raw);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const { rows } = await pool.query<{
    id: number;
    created_at: string;
  }>(
    `INSERT INTO order_events (order_id, type, who, payload)
     VALUES ($1, 'admin_note', 'admin', $2::jsonb)
     RETURNING id, created_at`,
    [id, JSON.stringify({ text: parsed.data.text })],
  );

  return NextResponse.json(
    {
      event: {
        id: rows[0].id,
        type: 'admin_note',
        who: 'admin',
        payload: { text: parsed.data.text },
        created_at: rows[0].created_at,
      },
    },
    { status: 201 },
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/orders/[id]/note/route.ts
git commit -m "api: POST /api/admin/orders/[id]/note — write admin_note event"
```

---

## Task 8: Extend `GET /api/admin/orders/[id]` to return events

**Files:**
- Modify: `app/api/admin/orders/[id]/route.ts`

- [ ] **Step 1: Add the events query**

Replace the entire contents of `app/api/admin/orders/[id]/route.ts` with:

```ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id } = await ctx.params;
  const [o, items, events] = await Promise.all([
    pool.query('SELECT * FROM orders WHERE id = $1', [id]),
    pool.query('SELECT * FROM order_items WHERE order_id = $1', [id]),
    pool.query(
      `SELECT id, type, who, payload, created_at
       FROM order_events
       WHERE order_id = $1
       ORDER BY created_at ASC, id ASC`,
      [id],
    ),
  ]);
  if (!o.rowCount) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({
    order: o.rows[0],
    items: items.rows,
    events: events.rows,
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/orders/[id]/route.ts
git commit -m "api: GET /api/admin/orders/[id] includes events[]"
```

---

## Task 9: Admin detail page — consume events, dual-DOM timeline

**Files:**
- Modify: `app/admin/orders/[id]/page.tsx`
- Modify: `app/admin/admin.css`

Remove the inline `tl` field-derived construction. Add `events: OrderEvent[]` to `Data`. Render the Atelier timeline (existing `.wl-adm-timeline`) and a new Darkroom `event_log` treatment; CSS toggles visibility per theme.

- [ ] **Step 1: Extend the `Data` interface and import the helper**

In `app/admin/orders/[id]/page.tsx`, update the top of the file. Replace the existing imports block (approximately lines 1-8) with:

```tsx
'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { formatUSD } from '@/lib/money';
import { AdminPill } from '@/components/admin/AdminPill';
import { AdminTopBar } from '@/components/admin/AdminTopBar';
import { renderEventText, type OrderEvent } from '@/lib/order-event-text';
```

Then, still near the top, extend the `Data` interface (approximately line 36):

```tsx
interface Data {
  order: Order;
  items: Item[];
  events: OrderEvent[];
}
```

- [ ] **Step 2: Delete the field-derived timeline array**

In `AdminOrderDetail`, find the entire block that builds `tl` (from `// Build a minimal timeline …` through the final push-`shipped`; approximately lines 111-157). Delete it all. Do NOT leave a placeholder.

- [ ] **Step 3: Replace the Timeline JSX with dual-DOM**

Find the `{tl.length > 0 && (…)}` JSX (approximately lines 333-349). Replace that entire block with:

```tsx
            {data.events.length > 0 && (
              <>
                {/* Atelier timeline */}
                <div className="wl-adm-panel wl-adm-timeline-atelier" style={{ marginTop: 20 }}>
                  <h3 style={{ fontSize: 16, marginBottom: 12 }}>Timeline</h3>
                  <div className="wl-adm-timeline">
                    {data.events.map((e) => (
                      <div
                        key={e.id}
                        className={`entry ${e.who === 'customer' ? 'ok' : e.type === 'printful_flagged' || e.type === 'error' ? 'err' : ''}`}
                      >
                        <span className="when">{fmtShort(e.created_at)}</span>
                        <span className="dot" />
                        <span className="what">{renderEventText(e)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Darkroom event_log */}
                <div className="wl-adm-panel wl-adm-event-log" style={{ marginTop: 12 }}>
                  <div className="h">event_log</div>
                  <div className="wl-adm-event-log-rows">
                    {data.events.map((e) => (
                      <div
                        key={e.id}
                        className={`row ${e.type === 'printful_flagged' || e.type === 'error' ? 'err' : ''}`}
                      >
                        <span className="when">{fmtShort(e.created_at)}</span>
                        <span className={`who who-${e.who}`}>{e.who}</span>
                        <span className="what">{renderEventText(e)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
```

- [ ] **Step 4: Add CSS — Darkroom event_log + visibility toggles**

Open `app/admin/admin.css`. Find the existing `.wl-adm-timeline` rules (search for `.wl-adm-timeline {`). Immediately before them, add visibility rules for the new dual-DOM:

```css
/* Order timeline — dual-DOM per skin.
   Atelier default; Darkroom hides Atelier + shows event_log. */
.wl-adm-timeline-atelier { display: block; }
.wl-adm-event-log        { display: none; }
.wl-admin-surface[data-theme='dark'] .wl-adm-timeline-atelier { display: none; }
.wl-admin-surface[data-theme='dark'] .wl-adm-event-log        { display: block; }
```

Then, at the end of the file, append the `event_log` styling:

```css
/* ─────── ORDER DETAIL — Darkroom event_log ─────── */

.wl-adm-event-log {
  background: var(--adm-panel);
  border: 1px solid var(--adm-rule);
  border-radius: 4px;
}
.wl-adm-event-log .h {
  padding: 8px 14px;
  border-bottom: 1px solid var(--adm-rule);
  color: var(--adm-ink);
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  font-size: 11px;
}
.wl-adm-event-log-rows {
  padding: 8px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  font-size: 11px;
}
.wl-adm-event-log-rows .row {
  display: grid;
  grid-template-columns: 54px 72px 1fr;
  gap: 10px;
  align-items: baseline;
  color: var(--adm-ink-2);
}
.wl-adm-event-log-rows .row .when   { color: var(--adm-muted); }
.wl-adm-event-log-rows .row .who    { text-transform: uppercase; font-size: 10px; }
.wl-adm-event-log-rows .row .who-customer { color: var(--adm-green); }
.wl-adm-event-log-rows .row .who-admin    { color: var(--adm-ink-2); }
.wl-adm-event-log-rows .row .who-system,
.wl-adm-event-log-rows .row .who-stripe,
.wl-adm-event-log-rows .row .who-printful { color: var(--adm-muted); }
.wl-adm-event-log-rows .row.err .who,
.wl-adm-event-log-rows .row.err .what { color: var(--adm-red); }
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Smoke**

Run `npm run dev` (skip if already running). Sign in as admin, open an existing order's detail page. In Atelier, the Timeline card shows the events. Flip to Darkroom: the Timeline card disappears and the event_log panel replaces it with the 3-column `when · who · what` layout.

- [ ] **Step 7: Commit**

```bash
git add app/admin/orders/[id]/page.tsx app/admin/admin.css
git commit -m "admin: order detail timeline reads from order_events, dual-DOM per skin"
```

---

## Task 10: Admin detail page — Darkroom-only Printful sidebar panel

**Files:**
- Modify: `app/admin/orders/[id]/page.tsx`
- Modify: `app/admin/admin.css`

Darkroom's sidebar includes a `printful` panel showing submitted state / reason. Atelier omits it.

- [ ] **Step 1: Add the Darkroom-only Printful panel JSX**

In `app/admin/orders/[id]/page.tsx`, find the sidebar (`<div className="wl-adm-side">`, approximately line 375). After the existing `Payment` panel (the last `.wl-adm-panel` inside `wl-adm-side`; approximately the closing tag near the end of the sidebar), add a Darkroom-only panel:

```tsx
            <div className="wl-adm-panel wl-adm-side-printful">
              <div className="head">Printful</div>
              {o.printful_order_id ? (
                <>
                  <div className="big" style={{ color: 'var(--adm-green)' }}>
                    #{o.printful_order_id}
                  </div>
                  <div className="line">submitted</div>
                </>
              ) : (
                <>
                  <div className="big" style={{ color: 'var(--adm-red)' }}>
                    — not submitted
                  </div>
                  {o.notes && (
                    <div className="line" style={{ color: 'var(--adm-muted)' }}>
                      {o.notes}
                    </div>
                  )}
                </>
              )}
            </div>
```

- [ ] **Step 2: Add CSS — Atelier hides the Printful sidebar panel**

Append to `app/admin/admin.css`:

```css
/* Atelier hides the Darkroom-only Printful sidebar panel. */
.wl-admin-surface:not([data-theme='dark']) .wl-adm-side-printful {
  display: none;
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Smoke**

Reload the detail page. Atelier sidebar has Customer / Ship to / Payment only. Darkroom sidebar adds the Printful panel below.

- [ ] **Step 5: Commit**

```bash
git add app/admin/orders/[id]/page.tsx app/admin/admin.css
git commit -m "admin: Darkroom order detail adds printful sidebar panel"
```

---

## Task 11: Admin detail page — inline add-note form

**Files:**
- Modify: `app/admin/orders/[id]/page.tsx`

A tiny `+ Add note` affordance. Clicking opens a 2-row textarea + Save/Cancel. Submits to `/note` and merges the returned event into client state so the timeline updates without a full reload.

- [ ] **Step 1: Add note state and handler**

In `app/admin/orders/[id]/page.tsx`, inside `AdminOrderDetail`, after the existing `const load = useCallback(…)` (approximately line 73-76), add:

```tsx
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  async function saveNote() {
    if (!noteText.trim()) return;
    setNoteSaving(true);
    setNoteError(null);
    try {
      const r = await fetch(`/api/admin/orders/${id}/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: noteText.trim() }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || `HTTP ${r.status}`);
      }
      const { event } = (await r.json()) as { event: OrderEvent };
      setData((d) => (d ? { ...d, events: [...d.events, event] } : d));
      setNoteText('');
      setNoteOpen(false);
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : String(err));
    } finally {
      setNoteSaving(false);
    }
  }
```

- [ ] **Step 2: Render the affordance under both timelines**

After the `{data.events.length > 0 && (…)}` block from Task 9 (the block that renders both timeline shapes), add a single shared "Add note" affordance:

```tsx
            <div className="wl-adm-note-add">
              {!noteOpen ? (
                <button
                  type="button"
                  className="wl-adm-btn small"
                  onClick={() => setNoteOpen(true)}
                >
                  + Add note
                </button>
              ) : (
                <div className="editor">
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder="Anything worth remembering about this order…"
                  />
                  <div className="row">
                    <button
                      type="button"
                      className="wl-adm-btn small primary"
                      disabled={noteSaving || !noteText.trim()}
                      onClick={saveNote}
                    >
                      {noteSaving ? 'Saving…' : 'Save note'}
                    </button>
                    <button
                      type="button"
                      className="wl-adm-btn small"
                      disabled={noteSaving}
                      onClick={() => {
                        setNoteText('');
                        setNoteOpen(false);
                        setNoteError(null);
                      }}
                    >
                      Cancel
                    </button>
                    {noteError && (
                      <span style={{ color: 'var(--adm-red)', fontSize: 12 }}>
                        {noteError}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
```

- [ ] **Step 3: Add CSS**

Append to `app/admin/admin.css`:

```css
/* ─────── ORDER DETAIL — add-note affordance ─────── */

.wl-adm-note-add {
  margin-top: 10px;
  font-family: inherit;
}
.wl-adm-note-add .editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--adm-card);
  border: 1px solid var(--adm-rule);
  border-radius: var(--adm-radius-md);
  padding: 10px 12px;
}
.wl-adm-note-add .editor textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--adm-rule);
  background: var(--adm-paper);
  border-radius: var(--adm-radius-sm);
  font-family: inherit;
  font-size: 13px;
  color: var(--adm-ink);
  resize: vertical;
  min-height: 52px;
}
.wl-adm-note-add .editor .row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.wl-admin-surface[data-theme='dark'] .wl-adm-note-add .editor {
  border-radius: 4px;
  padding: 8px 10px;
}
.wl-admin-surface[data-theme='dark'] .wl-adm-note-add .editor textarea {
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  font-size: 11px;
  background: var(--adm-bg, var(--adm-paper));
  border-radius: 3px;
}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Smoke**

Reload detail. Click `+ Add note`, type "test note", Save. Timeline gains a new entry `Note — test note` without a page reload. Flip themes; the same behavior works in Darkroom (mono textarea).

- [ ] **Step 6: Commit**

```bash
git add app/admin/orders/[id]/page.tsx app/admin/admin.css
git commit -m "admin: order detail inline add-note form — writes admin_note event"
```

---

## Task 12: Admin orders list — dual-DOM filter strip + table

**Files:**
- Modify: `app/api/admin/orders/route.ts`
- Modify: `app/admin/orders/page.tsx`
- Modify: `app/admin/admin.css`

Extend the list endpoint to return `shipping_address` (needed for Darkroom's `ship_to` column). Rewrite the page's JSX to emit both Atelier and Darkroom DOM shapes; CSS toggles visibility. Darkroom adds a `ship_to` column and a `resync printful` button (rendered disabled with a tooltip for now).

- [ ] **Step 1: Extend the API endpoint**

Open `app/api/admin/orders/route.ts`. Replace its contents with:

```ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export async function GET() {
  await requireAdmin();
  const { rows } = await pool.query(
    `SELECT o.id, o.status, o.customer_email, o.customer_name, o.total_cents,
            o.shipping_address,
            o.created_at::text, o.printful_order_id,
            (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id) AS item_count
     FROM orders o
     ORDER BY o.created_at DESC
     LIMIT 500`,
  );
  return NextResponse.json({ rows });
}
```

- [ ] **Step 2: Replace the page with dual-DOM**

Replace the entire contents of `app/admin/orders/page.tsx` with:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatUSD } from '@/lib/money';
import { AdminPill } from '@/components/admin/AdminPill';
import { AdminTopBar } from '@/components/admin/AdminTopBar';

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

const FILTERS = [
  { key: 'all',          label: 'All' },
  { key: 'needs_review', label: 'Needs review' },
  { key: 'paid',         label: 'Paid' },
  { key: 'submitted',    label: 'Submitted' },
  { key: 'shipped',      label: 'Shipped' },
  { key: 'delivered',    label: 'Delivered' },
  { key: 'refunded',     label: 'Refunded' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
}

function cityOf(addr: Record<string, string> | null | undefined): string {
  if (!addr) return '';
  return [addr.city, addr.state].filter(Boolean).join(', ');
}

export default function AdminOrdersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('all');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/orders');
    if (res.ok) {
      const d = (await res.json()) as { rows: Row[] };
      setRows(d.rows);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = filter === 'all' ? rows : rows.filter((r) => r.status === filter);
  const count = (s: FilterKey) =>
    s === 'all' ? rows.length : rows.filter((r) => r.status === s).length;

  return (
    <>
      <AdminTopBar title="Orders" subtitle={`${rows.length} in the catalog`} />

      <div className="wl-adm-page tight">
        {/* Atelier filter strip */}
        <div className="wl-adm-orders-filters-atelier">
          <div className="chips">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={f.key === filter ? 'on' : ''}
                onClick={() => setFilter(f.key)}
              >
                {f.label} <span className="count">{count(f.key)}</span>
              </button>
            ))}
          </div>
          <div className="actions">
            <button type="button" className="wl-adm-btn small" disabled title="Coming soon">
              Export CSV
            </button>
          </div>
        </div>

        {/* Darkroom filter strip */}
        <div className="wl-adm-orders-filters-darkroom">
          <div className="chips">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={f.key === filter ? 'on' : ''}
                onClick={() => setFilter(f.key)}
              >
                {f.key} <span className="count">{count(f.key)}</span>
              </button>
            ))}
          </div>
          <span className="note">· range: last 30d</span>
          <div className="actions">
            <button type="button" className="wl-adm-btn small" disabled title="Coming soon">
              export csv
            </button>
            <button type="button" className="wl-adm-btn small" disabled title="Coming soon">
              resync printful
            </button>
          </div>
        </div>

        {loading ? (
          <div
            style={{
              padding: 20,
              color: 'var(--adm-muted)',
              fontSize: 13,
            }}
          >
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div
            style={{
              padding: 40,
              textAlign: 'center',
              color: 'var(--adm-muted)',
              fontSize: 13,
            }}
          >
            No orders
            {filter !== 'all' ? ` in "${filter.replace('_', ' ')}"` : ''}.
          </div>
        ) : (
          <>
            {/* Atelier table */}
            <div className="wl-adm-card wl-adm-orders-atelier" style={{ overflow: 'hidden' }}>
              <table className="wl-adm-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Placed</th>
                    <th>Customer</th>
                    <th className="right">Items</th>
                    <th className="right">Total</th>
                    <th>Printful</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={r.id}
                      className="clickable"
                      onClick={() => router.push(`/admin/orders/${r.id}`)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td className="mono muted">#{r.id}</td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {fmtWhen(r.created_at)}
                      </td>
                      <td>
                        <div>{r.customer_name || '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--adm-muted)' }}>
                          {r.customer_email}
                        </div>
                      </td>
                      <td className="right mono muted">{r.item_count || '—'}</td>
                      <td className="right mono">{formatUSD(r.total_cents)}</td>
                      <td className="mono muted">
                        {r.printful_order_id ? `P-${r.printful_order_id}` : '—'}
                      </td>
                      <td>
                        <AdminPill status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Darkroom table */}
            <div className="wl-adm-panel wl-adm-orders-darkroom">
              <table className="wl-adm-table mono">
                <thead>
                  <tr>
                    <th>id</th>
                    <th>placed</th>
                    <th>customer</th>
                    <th>ship_to</th>
                    <th className="right">items</th>
                    <th className="right">total</th>
                    <th>printful</th>
                    <th>status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={r.id}
                      className="clickable"
                      onClick={() => router.push(`/admin/orders/${r.id}`)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td style={{ color: 'var(--adm-green)' }}>#{r.id}</td>
                      <td className="muted">{fmtWhen(r.created_at)}</td>
                      <td>{r.customer_email}</td>
                      <td className="muted">{cityOf(r.shipping_address) || '—'}</td>
                      <td className="right">{r.item_count}</td>
                      <td className="right">{formatUSD(r.total_cents)}</td>
                      <td className="muted">
                        {r.printful_order_id ? `#${r.printful_order_id}` : '—'}
                      </td>
                      <td>
                        <AdminPill status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 3: Add CSS for filter strips + visibility toggles**

Append to `app/admin/admin.css`:

```css
/* ─────── ORDERS LIST — filter strips ─────── */

.wl-adm-orders-filters-atelier {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.wl-adm-orders-filters-atelier .chips {
  display: flex;
  border: 1px solid var(--adm-rule);
  border-radius: 5px;
  overflow: hidden;
  background: var(--adm-card);
}
.wl-adm-orders-filters-atelier .chips button {
  padding: 6px 12px;
  border: none;
  cursor: pointer;
  background: transparent;
  font-family: inherit;
  font-size: 12px;
  color: var(--adm-ink-2);
  border-right: 1px solid var(--adm-rule);
  white-space: nowrap;
}
.wl-adm-orders-filters-atelier .chips button:last-child {
  border-right: none;
}
.wl-adm-orders-filters-atelier .chips button.on {
  background: var(--adm-paper-2, var(--adm-panel-2));
  color: var(--adm-ink);
}
.wl-adm-orders-filters-atelier .chips .count {
  color: var(--adm-muted);
  margin-left: 4px;
}
.wl-adm-orders-filters-atelier .actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
}

.wl-adm-orders-filters-darkroom {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  font-size: 11px;
  flex-wrap: wrap;
}
.wl-adm-orders-filters-darkroom .chips {
  display: flex;
  gap: 2px;
  background: var(--adm-panel);
  border: 1px solid var(--adm-rule);
  border-radius: 3px;
  padding: 2px;
}
.wl-adm-orders-filters-darkroom .chips button {
  padding: 3px 8px;
  border: none;
  cursor: pointer;
  border-radius: 2px;
  background: transparent;
  color: var(--adm-ink-2);
  font-family: inherit;
  font-size: 11px;
}
.wl-adm-orders-filters-darkroom .chips button.on {
  background: var(--adm-panel-2);
  color: var(--adm-ink);
}
.wl-adm-orders-filters-darkroom .chips .count {
  color: var(--adm-muted);
  margin-left: 4px;
}
.wl-adm-orders-filters-darkroom .note {
  color: var(--adm-muted);
}
.wl-adm-orders-filters-darkroom .actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
}

/* Skin visibility */
.wl-adm-orders-filters-atelier  { display: flex; }
.wl-adm-orders-filters-darkroom { display: none; }
.wl-adm-orders-atelier          { display: block; }
.wl-adm-orders-darkroom         { display: none; }
.wl-admin-surface[data-theme='dark'] .wl-adm-orders-filters-atelier  { display: none; }
.wl-admin-surface[data-theme='dark'] .wl-adm-orders-filters-darkroom { display: flex; }
.wl-admin-surface[data-theme='dark'] .wl-adm-orders-atelier          { display: none; }
.wl-admin-surface[data-theme='dark'] .wl-adm-orders-darkroom         { display: block; }
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Smoke**

Reload `/admin/orders`. Atelier shows the card table with filter chips; Darkroom shows the panel table (additional `ship_to` column) with mono chips. Clicking a row navigates to the detail page.

- [ ] **Step 6: Commit**

```bash
git add app/admin/orders/page.tsx app/admin/admin.css app/api/admin/orders/route.ts
git commit -m "admin: orders list dual-DOM per skin; Darkroom adds ship_to column"
```

---

## Task 13: Manual smoke verification + final typecheck

**Files:** none modified.

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 2: Run unit tests**

```bash
npm test
```

Expected: all existing tests pass, plus the new `order-event-text` suite.

- [ ] **Step 3: Exercise the webhook paths**

If you have a dev Stripe account wired:

```bash
stripe trigger checkout.session.completed
```

Open `/admin/orders/<new-order-id>`. Confirm the timeline shows `placed` + `paid` entries, plus `printful_submitted` or `printful_flagged` depending on whether Printful accepts the order. Switch to Darkroom and confirm the event_log renders.

For the Printful webhook, manually POST a `package_shipped` fixture (see `app/api/webhooks/printful/route.ts` for the expected shape) with a valid `PRINTFUL_WEBHOOK_SECRET`-signed request, or trigger via Printful's sandbox.

- [ ] **Step 4: Exercise refund + resubmit paths**

On a test order in `needs_review` status:

1. Click Resubmit. If it succeeds: `submitted` status + `resubmit_attempted { outcome: 'ok' }` event. If it fails: status returns to `needs_review` + `resubmit_attempted { outcome: 'failed', reason }` event.
2. Click Refund. Confirm the confirm dialog. Both `refund_initiated` and `refunded` events appear.

- [ ] **Step 5: Add-note flow**

Click `+ Add note`, type text, Save. Confirm the `admin_note` event appears without a reload. Flip themes and verify both skins show it.

- [ ] **Step 6: Idempotency check**

Re-trigger a Stripe checkout complete event with the same event id (Stripe CLI `--id <id>` if available, or re-POST the body by hand). Confirm no duplicate events appear — the top-level `webhook_events` dedupe keeps the order_events insert from running twice.

- [ ] **Step 7: Confirm clean tree**

```bash
git status
```

Expected: clean. Branch is ahead of origin/main by 12 commits (Tasks 1-12, each one commit).

---

## Exit criteria

- `npm run typecheck` passes.
- `npm test` passes, including 15 new `renderEventText` tests.
- `order_events` table exists with the constraint set from the spec; re-running the migration produces zero duplicate backfill rows.
- All five mutation sites (Stripe webhook, Printful webhook, refund, resubmit, admin-note) write events inside their existing transactions.
- `GET /api/admin/orders/[id]` includes `events: []` sorted ASC by (created_at, id).
- Admin list renders two different DOM shapes per skin; Darkroom has `ship_to` column.
- Admin detail renders two different timeline layouts per skin, Darkroom gets the Printful sidebar panel, both skins share the add-note affordance (styled per skin).
- Replaying a webhook produces no duplicate events.
- Add-note POST writes an event that appears immediately in the timeline without a full reload.
