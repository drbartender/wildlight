# Admin Redesign — Sub-project 3: Orders + `order_events` Timeline

**Date:** 2026-04-24
**Status:** Spec
**Parent:** `2026-04-24-admin-redesign-overview.md`

## Design invariant (all admin specs)

Atelier and Darkroom are independent visual languages over the same
data. Every admin spec describes each theme's treatment separately.
"Parity" here means each theme matches its own mockup target. Never
propose changes that make one theme look more like the other — the
disparity is intentional.

## Target mockup

Source of truth: `temp/wild-light-admin/wild-light-admin/project/`.

Primary references:

- `atelier.jsx:530–586` — `AOrdersList`. Filter chip strip (outlined
  card, 5px radius, paperAlt-when-active chip, muted count suffix),
  single-card table (8px radius, rule border, `aTh` header row on
  `paperAlt`), columns: Order (mono), Placed (muted), Customer
  (name + email below), Items (right mono), Total (right mono),
  Printful (mono muted), Status (`APill`).
- `atelier.jsx:588–677` — `AOrderDetail`. Serif `Order #N` title + pill
  + right-aligned muted date. Needs-review banner = rounded border,
  red icon, red strong "Needs review.", Resubmit/Refund `ABtn`.
  Two-column grid `1fr 320px`. Items card, Timeline card, sidebar
  Customer / Ship-to / Payment cards.
- `darkroom.jsx:541–600` — `DOrdersList`. Mono chip group inside
  `panel` with 3px radius, chips show count suffix, selected chip
  teal-on-`panel2`. Right-aligned small buttons `export csv`,
  `resync printful`. Panel table (4px radius, `panel2` thead).
  Columns: `id` (teal), `placed` (muted), `customer` (ink2),
  `ship_to` (muted), `items` (right), `total` (right ink),
  `printful` (muted/dim), `status` (`DPill`).
- `darkroom.jsx:602–697` — `DOrderDetail`. Breadcrumb `← orders /
  #N` in mono muted. Row with sans `order #N` + `DPill` + muted date.
  Needs-review banner = `redBg` panel with `[ERROR]` token + notes
  + inline `resubmit` / `refund` `DBtn`. Two-column grid `1fr 280px`.
  `line_items [N]` panel, `event_log` panel with `[54px when]
  [72px who uppercase] [text]` rows, sidebar customer / ship_to /
  payment · stripe / printful panels.
- Open `Wildlight Admin.html` locally to see both themes side-by-side.

## Scope

1. **New `order_events` append-only ledger table.** Append one row
   per lifecycle event so the admin timeline becomes source-of-truth
   instead of a field-derived best-guess.
2. **Write events** from every existing mutation site: Stripe webhook
   (`placed`, `paid`, `printful_submitted`, `printful_flagged`),
   Printful webhook (`shipped`, `delivered`), refund route
   (`refund_initiated`, `refunded`), resubmit route
   (`resubmit_attempted`), plus a new admin-note endpoint
   (`admin_note`).
3. **Backfill** events for existing orders at migration time from
   columns already on `orders`. Idempotent; re-run safe.
4. **Rebuild the admin timeline** on `/admin/orders/[id]` to read
   from `order_events` and render per skin.
5. **Each skin renders its own mockup shape** for the list + detail.
   Filter chip treatment, column set (Darkroom adds `ship_to`), banner
   styling, sidebar card width (Atelier 320, Darkroom 280), and
   timeline layout all differ by design.
6. **New admin-note feature.** Small "Add note" affordance on the
   detail page → `POST /api/admin/orders/[id]/note` → writes an
   `admin_note` event → appears in the timeline like any other event.

## Non-goals

- No changes to `orders.status` transitions. The state machine in
  `lib/schema.sql` stays as-is.
- No refund / resubmit business-logic changes. Those routes gain
  event writes only.
- No new webhook handlers — Stripe and Printful are already wired.
- No change to `orders.notes`. That free-text column continues to
  back the needs-review banner body.
- No admin-wide audit log. Events are per-order.
- No ORM or query-builder. Raw SQL via `pg` + `withTransaction`,
  per `CLAUDE.md`.

## Current state

- `app/admin/orders/page.tsx` — client-rendered list with filter tabs
  (`all` / `needs_review` / `paid` / `submitted` / `shipped` /
  `delivered` / `refunded`). One DOM shape today; both skins share it.
  Needs per-skin divergence.
- `app/admin/orders/[id]/page.tsx` — client-rendered detail. Timeline
  is assembled inline from order columns: `placed` from `created_at`,
  `captured` when `status != 'pending'`, `submitted` when
  `printful_order_id` set, `flagged` when `status == 'needs_review'`,
  `shipped` when `tracking_number` set. This assembly is brittle and
  has no ordering signal beyond column presence. Replacing it with the
  real ledger is this spec's core change.
- `app/api/admin/orders/route.ts` — admin list endpoint (already
  returns the shape needed for per-row status).
- `app/api/admin/orders/[id]/route.ts` — detail GET. Returns
  `{ order, items }`. Extended here to also return `events`.
- `app/api/admin/orders/[id]/{refund,resubmit}/route.ts` — existing
  admin actions. Both use `withTransaction`. Neither writes an event
  today; both gain one.
- `app/api/webhooks/stripe/route.ts` — signature-verified,
  `INSERT ON CONFLICT` dedupe via `webhook_events`. `handleCheckout­
  Completed` runs inside a transaction and sets `status` to `paid` /
  `submitted` / `needs_review`. Needs event writes.
- `app/api/webhooks/printful/route.ts` — shipment + delivery
  transitions. Needs event writes.

## Schema

Append to `lib/schema.sql`, inside the existing "Idempotent post-create
migrations" block. Every statement is safe to re-run.

```sql
-- Order events (append-only lifecycle ledger) -----------------------
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

### Event taxonomy

Closed list. New events require a spec amendment.

| type                 | who       | written when                                                  | payload shape                                              |
|----------------------|-----------|---------------------------------------------------------------|------------------------------------------------------------|
| `placed`             | customer  | Immediately after `INSERT` of `orders` row in Stripe webhook  | `{}`                                                       |
| `paid`               | stripe    | Same transaction as `placed`                                  | `{amount_cents}`                                           |
| `printful_submitted` | printful  | After successful Printful order creation                      | `{printful_order_id}`                                      |
| `printful_flagged`   | system    | When Printful creation fails and order sets `needs_review`    | `{reason}`                                                 |
| `shipped`            | printful  | Printful shipment webhook                                     | `{tracking_number, tracking_url, carrier?}`                |
| `delivered`          | printful  | Printful delivery webhook                                     | `{}`                                                       |
| `refund_initiated`   | admin     | In refund route, before Stripe refund API call                | `{}`                                                       |
| `refunded`           | admin     | In refund route, after Stripe refund + Printful cancel        | `{amount_cents}`                                           |
| `resubmit_attempted` | admin     | In resubmit route, at end of handler                          | `{outcome: 'ok' \| 'failed', reason?, printful_order_id?}` |
| `canceled`           | admin     | Reserved — future admin-cancel path, no UI in this spec       | `{}`                                                       |
| `admin_note`         | admin     | New `/note` endpoint                                          | `{text}`                                                   |
| `error`              | system    | Catch-all for exceptional paths worth surfacing               | `{message}`                                                |

## Write points

Event writes happen inside the existing transaction for each mutation
(never a separate connection). Canonical pattern:

```ts
await client.query(
  `INSERT INTO order_events (order_id, type, who, payload)
   VALUES ($1, $2, $3, $4)`,
  [orderId, 'paid', 'stripe', { amount_cents: session.amount_total }],
);
```

Files touched:

- `app/api/webhooks/stripe/route.ts` — inside `handleCheckout­
  Completed`, after inserting the `orders` row, write `placed` and
  `paid`. After successful Printful creation, write
  `printful_submitted`. In the Printful-failure branch, write
  `printful_flagged`. Optionally (open question #1): on
  `charge.refunded` webhook, write `refunded`.
- `app/api/webhooks/printful/route.ts` — on shipment notify, write
  `shipped`; on delivery, write `delivered`. Both inside the existing
  handler transaction.
- `app/api/admin/orders/[id]/refund/route.ts` — write
  `refund_initiated` before Stripe refund call, `refunded` after the
  Stripe refund + Printful cancel both succeed.
- `app/api/admin/orders/[id]/resubmit/route.ts` — write
  `resubmit_attempted` at the end, outcome in payload regardless of
  success/failure.
- **New** `app/api/admin/orders/[id]/note/route.ts` — `requireAdmin()`,
  body `{ text: string (1..500) }`, writes `admin_note`, returns
  `{ event }`.

### Idempotency

Webhook events sit under the existing `webhook_events` `INSERT ON
CONFLICT` claim at the top of each handler. If Stripe or Printful
re-delivers an event, the top-level dedupe skips the work, so
`order_events` never sees a duplicate. Admin actions are naturally
idempotent (the `orders.status` gate prevents double-refund, for
example); events ride the same gate.

## Backfill

Append to `lib/schema.sql` after the table + constraint block. One
statement per historical event type. Every statement is guarded by a
`NOT EXISTS` subquery so the script re-runs without producing
duplicates. Historical `created_at` is `orders.created_at` for
`placed` and `orders.updated_at` as a close-enough approximation for
later events (we don't have per-event timestamps for pre-ledger
orders; that's acceptable — the timeline is authoritative from here
forward only).

```sql
-- Backfill order_events from existing orders. Idempotent.
INSERT INTO order_events (order_id, type, who, payload, created_at)
SELECT o.id, 'placed', 'customer', '{}'::jsonb, o.created_at FROM orders o
WHERE NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.type = 'placed');

INSERT INTO order_events (order_id, type, who, payload, created_at)
SELECT o.id, 'paid', 'stripe', jsonb_build_object('amount_cents', o.total_cents), o.updated_at FROM orders o
WHERE o.status <> 'pending'
  AND NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.type = 'paid');

INSERT INTO order_events (order_id, type, who, payload, created_at)
SELECT o.id, 'printful_submitted', 'printful',
       jsonb_build_object('printful_order_id', o.printful_order_id), o.updated_at
FROM orders o
WHERE o.printful_order_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.type = 'printful_submitted');

INSERT INTO order_events (order_id, type, who, payload, created_at)
SELECT o.id, 'printful_flagged', 'system',
       jsonb_build_object('reason', COALESCE(o.notes, 'unknown')), o.updated_at
FROM orders o
WHERE o.status = 'needs_review'
  AND NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.type = 'printful_flagged');

INSERT INTO order_events (order_id, type, who, payload, created_at)
SELECT o.id, 'shipped', 'printful',
       jsonb_build_object('tracking_number', o.tracking_number, 'tracking_url', o.tracking_url), o.updated_at
FROM orders o
WHERE o.tracking_number IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.type = 'shipped');

INSERT INTO order_events (order_id, type, who, payload, created_at)
SELECT o.id, 'delivered', 'printful', '{}'::jsonb, o.updated_at FROM orders o
WHERE o.status = 'delivered'
  AND NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.type = 'delivered');

INSERT INTO order_events (order_id, type, who, payload, created_at)
SELECT o.id, 'refunded', 'admin', '{}'::jsonb, o.updated_at FROM orders o
WHERE o.status = 'refunded'
  AND NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.type = 'refunded');
```

## Reads

Extend `GET /api/admin/orders/[id]` to include `events`:

```jsonc
{
  "order":  { /* existing */ },
  "items":  [ /* existing */ ],
  "events": [
    { "id": 42, "type": "placed", "who": "customer", "payload": {}, "created_at": "2026-04-21T14:02:10Z" },
    { "id": 43, "type": "paid",   "who": "stripe",   "payload": { "amount_cents": 12800 }, "created_at": "..." }
  ]
}
```

Query:

```sql
SELECT id, type, who, payload, created_at
FROM order_events WHERE order_id = $1
ORDER BY created_at ASC, id ASC;
```

No dedicated list endpoint (`GET /api/admin/orders/[id]/events`)
unless pagination becomes necessary — for now, events per order stay
small.

## Layout per skin

### `/admin/orders` — Atelier treatment (`AOrdersList`)

- Outer page `padding: 28`.
- Filter chip strip: outlined card (5px radius), each chip padding
  `6px 12px`, `paperAlt` when selected, `ink` selected text, muted
  count suffix.
- Right-aligned ghost `Export CSV` button.
- Single card table, 8px radius, rule border. Header row
  `paperAlt`, `aTh` cells. Columns (left-to-right): `Order` (mono,
  ink2), `Placed` (muted), `Customer` (name ink + email muted
  below), `Items` (right, mono), `Total` (right, mono), `Printful`
  (mono muted), `Status` (`AdminPill`).
- Row click navigates to detail. Hover: subtle `paperAlt` tint.

### `/admin/orders` — Darkroom treatment (`DOrdersList`)

- Outer page `padding: 16`.
- Mono chip group inside a thin `panel` wrapper, 3px outer radius,
  2px inner radius per chip. Selected chip `panel2` bg, teal label
  for `needs_review` when selected, ink otherwise; muted count
  suffix. To the right: `range: last 30d` placeholder (non-interactive
  this spec).
- Right-aligned small `export csv`, `resync printful` buttons.
  Resync: render disabled with a tooltip `"Global resync — coming
  in a later pass"`.
- Panel table, 4px radius. Header row `panel2`, lowercase headings
  per `dTh`. Columns: `id` (teal `#N`), `placed` (muted), `customer`
  (ink2), `ship_to` (muted, city-level summary from
  `shipping_address.city`), `items` (right), `total` (right, ink),
  `printful` (muted or `dim` if null), `status` (`AdminPill`).

### `/admin/orders/[id]` — Atelier treatment (`AOrderDetail`)

- `← All orders` muted button.
- Serif `Order #N` title + `AdminPill` + right-aligned muted date.
- When `status === 'needs_review'`: rounded banner (1px `redSoft`
  border on `#f9eee9`), red circle-i icon, red strong "Needs
  review.", `orders.notes` text in ink2, inline `Resubmit to
  Printful` + `Refund` small buttons.
- Two-column grid `1fr 320px`, `gap: 24`.
- Left column, top card: card header with serif `Items` + right
  "N lines"; each item row has 58×72 ruled thumbnail, title (ink),
  variant label (muted), `×qty` mono muted, line-total mono 90px
  right. Footer row `paperAlt` with sub / ship / tax / total grid.
- Left column, bottom card: serif `Timeline`. Rows
  `[56px mono time] [8px dot] [event text]`. Dot color from `who`:
  `customer` → green, `system`/`printful`/`stripe`/`admin` →
  muted, `error` flag (any event with `error === true` in payload)
  → red. Event text uses the renderer table below.
- Add-note affordance: below the timeline list, a `+ Add note`
  small ghost link. Click reveals a 2-row textarea + `Save` / `Cancel`
  buttons. Submits to `/note`, reloads events, resets textarea.
- Right column: Customer / Ship to / Payment cards. Each card has
  uppercase-mono label, serif or sans body.

### `/admin/orders/[id]` — Darkroom treatment (`DOrderDetail`)

- Breadcrumb `← orders / #N` in mono muted + last segment ink.
- Row: sans 22px `order #N` + `AdminPill` + right-aligned muted date.
- When `status === 'needs_review'`: `redBg` panel with `[ERROR]`
  mono token + notes (ink2, line-height 1.6) + inline small
  `resubmit` / `refund` buttons.
- Two-column grid `1fr 280px`, `gap: 12`.
- Left column, top panel: `line_items [N]` header. Item rows have
  40×50 thumbnails, title (ink), variant (muted), `×qty` muted,
  line total (ink, 80px right). Footer sub-panel with grid sub /
  ship / tax + total line on `panel2`.
- Left column, bottom panel: `event_log` header. Rows are a 3-column
  grid `[54px mono when] [72px who uppercase 10px] [event text]`.
  `who` colors: `customer` → teal, `admin` → ink2, `stripe` /
  `printful` → muted, `system` → muted, `error` payload → red.
- Add-note: below the log, mono `+ add_note` small button, inline
  textarea of the same mono flavor. Same POST target.
- Right column: customer / ship_to / payment · stripe / printful
  panels. `printful` panel shows `— not submitted` in red + reason
  when order has no `printful_order_id`.

### Shared rendering — event text

Both skins use the same `who`-aware wording, rendered in the skin's
typography:

| type                 | when                                  | text                                                                     |
|----------------------|---------------------------------------|--------------------------------------------------------------------------|
| `placed`             | `{created_at}`                        | `Placed by customer`                                                     |
| `paid`               | `{created_at}`                        | `Paid · {formatUSD(amount_cents)}`                                       |
| `printful_submitted` | `{created_at}`                        | `Submitted to Printful · #{printful_order_id}`                           |
| `printful_flagged`   | `{created_at}`                        | `Flagged — {reason}`                                                     |
| `shipped`            | `{created_at}`                        | `Shipped via {carrier ?? 'carrier'} · {tracking_number}`                 |
| `delivered`          | `{created_at}`                        | `Delivered`                                                              |
| `refund_initiated`   | `{created_at}`                        | `Refund initiated by {who}`                                              |
| `refunded`           | `{created_at}`                        | `Refunded · {formatUSD(amount_cents)}`                                   |
| `resubmit_attempted` | `{created_at}`                        | `Resubmit {outcome === 'ok' ? 'succeeded' : 'failed — ' + reason}`       |
| `admin_note`         | `{created_at}`                        | `Note — {text}`                                                          |
| `canceled`           | `{created_at}`                        | `Canceled`                                                               |
| `error`              | `{created_at}`                        | `Error — {message}`                                                      |

Implementation: a single pure helper `lib/order-event-text.ts`
keyed on `type`, returning a string. Imported by both themes' renderers.

## Admin-note endpoint

New `app/api/admin/orders/[id]/note/route.ts`:

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

  const { rows } = await pool.query<{ id: number; created_at: string }>(
    `INSERT INTO order_events (order_id, type, who, payload)
     VALUES ($1, 'admin_note', 'admin', $2)
     RETURNING id, created_at`,
    [id, { text: parsed.data.text }],
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

## Testing

- `tests/lib/order-event-text.test.ts` — unit-test the renderer
  helper against every event type.
- Manual end-to-end verification:
  - `stripe trigger checkout.session.completed` against a dev order,
    confirm `placed` + `paid` appear in the timeline.
  - Manually flag a Printful error path (invalid sync variant id in
    a test artwork), confirm `printful_flagged` writes.
  - Exercise refund + resubmit admin actions; confirm events.
  - Post a note via the UI; confirm it appears in both skins.

No integration harness. Consistent with `CLAUDE.md`.

## Rollout

Single PR. Migration runs during `npm run build` (`lib/migrate.ts`
re-applies `lib/schema.sql` on every deploy). Backfill completes in
the same deploy. All historical orders get `placed` events plus
whatever later-state events are derivable from their columns. Rollback
means dropping the table — the old field-derived timeline is removed
in this spec, so a rollback would require re-introducing it; acceptable
risk given the migration is additive and tested locally first.

## Open questions

1. **`charge.refunded` Stripe event**: should the Stripe webhook also
   listen for `charge.refunded` and write a `refunded` event to
   cover Stripe-dashboard refunds? Recommendation: yes, in scope of
   this spec. Cheap to add, closes a blind spot.
2. **Darkroom `resync printful` list-page action**: the mockup shows
   it but its semantics are unclear (per-order bulk? global sync of
   missing variant IDs?). Recommendation: render disabled with a
   tooltip, defer wiring to a follow-up.
3. **Event text localization**: strings are hard-coded English for
   now. If Dan ever internationalizes, extract to a table. Not worth
   structural accommodation yet.

## Exit criteria

- Migration applies idempotently; re-running `npm run migrate`
  produces zero duplicate `order_events` rows.
- All five mutation sites (Stripe webhook, Printful webhook, refund,
  resubmit, admin-note) write their event inside the existing
  transaction.
- `GET /api/admin/orders/[id]` includes `events: []` ordered ASC by
  `created_at, id`.
- Admin list + detail render the Atelier layout on Atelier and the
  Darkroom layout on Darkroom. No shared rendering for the list
  filter strip, the banner, the items card, the timeline panel, or
  the sidebar cards.
- Event text renders consistently via `lib/order-event-text.ts` in
  both skins.
- Webhook replay test produces zero duplicate events.
- Admin-note POST writes an event visible immediately in the timeline
  (with the returned `event` merged into client state — no full
  reload required).
