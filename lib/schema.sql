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
