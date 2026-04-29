-- Wildlight Imagery — idempotent full schema. Safe to re-run.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Collections --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collections (
  id              SERIAL PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  tagline         TEXT,
  cover_image_url TEXT,
  display_order   INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Artworks ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artworks (
  id              SERIAL PRIMARY KEY,
  collection_id   INT REFERENCES collections(id) ON DELETE SET NULL,
  slug            TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  artist_note     TEXT,
  year_shot       INT,
  location        TEXT,
  image_web_url   TEXT NOT NULL,
  image_print_url TEXT,
  image_width     INT,
  image_height    INT,
  exif            JSONB,
  status          TEXT NOT NULL DEFAULT 'draft',
  display_order   INT NOT NULL DEFAULT 0,
  edition_size    INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_artworks_collection_published
  ON artworks(collection_id) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_artworks_status ON artworks(status);

-- Variants ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artwork_variants (
  id                        SERIAL PRIMARY KEY,
  artwork_id                INT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  printful_sync_variant_id  BIGINT,
  type                      TEXT NOT NULL,
  size                      TEXT NOT NULL,
  finish                    TEXT,
  price_cents               INT NOT NULL,
  cost_cents                INT NOT NULL,
  active                    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_variants_artwork_active
  ON artwork_variants(artwork_id) WHERE active = TRUE;

-- Orders ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id                SERIAL PRIMARY KEY,
  public_token      UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  stripe_session_id TEXT UNIQUE,
  stripe_payment_id TEXT,
  customer_email    TEXT NOT NULL,
  customer_name     TEXT,
  shipping_address  JSONB,
  subtotal_cents    INT NOT NULL,
  shipping_cents    INT NOT NULL DEFAULT 0,
  tax_cents         INT NOT NULL DEFAULT 0,
  total_cents       INT NOT NULL,
  printful_order_id BIGINT,
  tracking_url      TEXT,
  tracking_number   TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_stripe ON orders(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_orders_printful ON orders(printful_order_id);

-- printful_attempt: monotonic per-order counter bumped on every Printful
-- submit. Embedded in external_id as `order_<id>_<attempt>` so a stale
-- webhook from a prior attempt fails the (id, attempt) match in
-- app/api/webhooks/printful/route.ts and is silently ignored. Default 0
-- so legacy rows whose pending webhooks lack the suffix still match.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS printful_attempt INT NOT NULL DEFAULT 0;

-- is_test: marks orders that were created via Stripe test-mode checkout.
-- Read by admin surfaces to render a TEST pill and by the webhook to skip
-- operator alert emails. Default false so existing rows (all real) stay
-- correct after migration.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;

-- Immutable checkout snapshot keyed by stripe_session_id. Written at
-- checkout-session creation, read by the Stripe webhook so an admin
-- editing title/size/price/print-file/sync-id between checkout and webhook
-- delivery cannot silently rewrite order history.
CREATE TABLE IF NOT EXISTS checkout_intents (
  stripe_session_id TEXT PRIMARY KEY,
  snapshot          JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checkout_intents_created_at
  ON checkout_intents(created_at);

-- Order items -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id                   SERIAL PRIMARY KEY,
  order_id             INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id           INT REFERENCES artwork_variants(id) ON DELETE SET NULL,
  artwork_snapshot     JSONB NOT NULL,
  variant_snapshot     JSONB NOT NULL,
  price_cents_snapshot INT NOT NULL,
  cost_cents_snapshot  INT NOT NULL,
  quantity             INT NOT NULL DEFAULT 1
);

-- Subscribers -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscribers (
  id              SERIAL PRIMARY KEY,
  email           TEXT UNIQUE NOT NULL,
  confirmed_at    TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  source          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Admin users -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Webhook event log -------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_events (
  id           SERIAL PRIMARY KEY,
  source       TEXT NOT NULL,
  event_id     TEXT UNIQUE NOT NULL,
  payload      JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent post-create migrations ---------------------------------------
-- Use this block for column additions + constraint refinements so `npm run
-- migrate` remains safe on existing databases. Every statement must be safe
-- to re-run.

-- CHECK constraints on status enums (protects dashboards from silent typos).
-- DROP-then-ADD pattern since Postgres has no `ADD CONSTRAINT IF NOT EXISTS`.
ALTER TABLE artworks DROP CONSTRAINT IF EXISTS artworks_status_chk;
ALTER TABLE artworks ADD CONSTRAINT artworks_status_chk
  CHECK (status IN ('draft', 'published', 'retired'));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_chk;
ALTER TABLE orders ADD CONSTRAINT orders_status_chk CHECK (status IN (
  'pending', 'paid', 'submitted', 'needs_review',
  'fulfilled', 'shipped', 'delivered',
  'canceled', 'refunded',
  'refunding', 'resubmitting'          -- intermediate states used during admin actions
));

ALTER TABLE artwork_variants DROP CONSTRAINT IF EXISTS artwork_variants_type_chk;
ALTER TABLE artwork_variants ADD CONSTRAINT artwork_variants_type_chk
  CHECK (type IN ('print', 'canvas', 'framed', 'metal'));

-- Indexes added after initial CREATE TABLE.
CREATE INDEX IF NOT EXISTS idx_orders_created_at       ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_variants_printful_sync  ON artwork_variants(printful_sync_variant_id)
  WHERE printful_sync_variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_events_unprocessed
  ON webhook_events(source, created_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_subscribers_active      ON subscribers(id)
  WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL;

-- Home "Latest" season — published_at column (Shop-Polish) ---------------
-- Added 2026-04-24.
ALTER TABLE artworks
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- Backfill: for rows currently published without a published_at,
-- seed to updated_at. Idempotent — re-running never overwrites an
-- already-populated value.
UPDATE artworks
SET published_at = updated_at
WHERE status = 'published' AND published_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_artworks_published_at
  ON artworks(published_at DESC NULLS LAST)
  WHERE status = 'published';

-- Admin role column for Darkroom admins table (Spec 5b) --------------
ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'owner';

ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_chk;
ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_chk
  CHECK (role IN ('owner', 'operator'));

-- Session revocation — bumped on password change so stolen cookies expire
-- the moment the owner rotates their password. Embedded in the JWT and
-- compared per-request in lib/session.ts:getAdminSession.
ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS session_version INT NOT NULL DEFAULT 1;
ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

-- Login rate limit — rolling-window per (ip_hash, email_normalized) to
-- defang credential stuffing on /api/auth/login. Read by
-- lib/login-rate-limit.ts.
CREATE TABLE IF NOT EXISTS login_attempts (
  id               SERIAL PRIMARY KEY,
  ip_hash          TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  success          BOOLEAN NOT NULL,
  attempted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip
  ON login_attempts(ip_hash, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email
  ON login_attempts(email_normalized, attempted_at DESC);

-- Generic per-scope rate limit (subscribe, contact, etc). Read by
-- lib/rate-limit.ts.
CREATE TABLE IF NOT EXISTS rate_limit_events (
  id           SERIAL PRIMARY KEY,
  scope        TEXT NOT NULL,
  key_hash     TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_lookup
  ON rate_limit_events(scope, key_hash, attempted_at DESC);

-- Double-opt-in confirmation token for newsletter signups. Cleared once
-- the subscriber clicks the confirmation link. NULL on already-confirmed
-- rows.
ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS confirm_token TEXT;

-- Broadcast log (one row per successful non-test send) — Spec 5a ----
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

-- Review round: supporting indexes for hot queries added in this release.
-- pingWebhooks() in lib/integration-health.ts runs every 60s once admin
-- is visible — without this it seq-scans as webhook_events grows.
CREATE INDEX IF NOT EXISTS idx_webhook_events_errored
  ON webhook_events(created_at DESC)
  WHERE error IS NOT NULL;

-- Dashboard top-artworks query in app/admin/page.tsx joins
-- order_items → orders → artworks on (artwork_snapshot->>'slug').
CREATE INDEX IF NOT EXISTS idx_order_items_artwork_slug
  ON order_items(((artwork_snapshot->>'slug')));

-- order_items.order_id FK has no supporting index by default on SERIAL —
-- add one so both the dashboard aggregation and order_items.order_id
-- lookups stay efficient.
CREATE INDEX IF NOT EXISTS idx_order_items_order
  ON order_items(order_id);

-- handleChargeRefunded's `SELECT … WHERE stripe_payment_id = $1 FOR UPDATE`
-- held row locks on a seq-scan without this. Partial index: the column
-- is nullable for orders that never completed payment.
CREATE INDEX IF NOT EXISTS idx_orders_stripe_payment
  ON orders(stripe_payment_id)
  WHERE stripe_payment_id IS NOT NULL;

-- Order events (append-only lifecycle ledger) — Spec 3 --------------
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

-- Dedupe the refunded event across the admin refund route and Stripe's
-- charge.refunded webhook. Partial unique index → `INSERT … ON CONFLICT
-- DO NOTHING` on the second writer wins the race.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_order_events_refunded
  ON order_events(order_id)
  WHERE type = 'refunded';

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

-- Backfill order_events from existing orders. Each statement is guarded
-- by NOT EXISTS so the script is safe to re-run.
-- Historic rows collapse all lifecycle events onto o.updated_at (we don't
-- have per-event timestamps for pre-ledger orders); the `ORDER BY
-- created_at ASC, id ASC` at read time uses id as the tiebreaker so the
-- timeline keeps insertion order within a collapsed clump.
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

-- ─── Journal entries (DRB-shaped blog_posts) ───────────────────────
CREATE TABLE IF NOT EXISTS blog_posts (
  id              SERIAL PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  excerpt         TEXT,
  body            TEXT NOT NULL,
  cover_image_url TEXT,
  published       BOOLEAN NOT NULL DEFAULT FALSE,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_published_at
  ON blog_posts(published_at DESC) WHERE published = TRUE;

CREATE INDEX IF NOT EXISTS idx_blog_posts_slug
  ON blog_posts(slug);

-- Phase-2 hook for SP#6 limited editions: per-variant subscriber-only
-- early-access window. NULL means no gating (variant is public when active).
ALTER TABLE artwork_variants
  ADD COLUMN IF NOT EXISTS subscriber_early_access_until TIMESTAMPTZ;

-- Studio reminder cron audit log — one row per quarterly nudge.
CREATE TABLE IF NOT EXISTS studio_reminders (
  id            SERIAL PRIMARY KEY,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered     BOOLEAN NOT NULL DEFAULT FALSE,
  trend_angles  JSONB
);
