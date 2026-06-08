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

-- (No explicit slug index — `slug TEXT UNIQUE NOT NULL` already creates
-- a unique btree on slug; an extra index is redundant write overhead.)
DROP INDEX IF EXISTS idx_blog_posts_slug;

-- ─── Studio composer · ephemeral state on blog_posts ───────────────
-- Holds composer-only fields that don't belong on the published row:
-- ordered image list (so the gallery can re-hydrate after reload), the
-- "choose for me" toggle, and the last SEO-research result so the panel
-- survives navigation. Never read by the public render — only the admin
-- studio composer reads/writes it. NULL until the row passes through
-- the new composer at least once.
ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS studio_meta JSONB;

-- Powers the "Recent entries" right-rail and the chapter list. The
-- studio composer always sorts by updated_at DESC.
CREATE INDEX IF NOT EXISTS idx_blog_posts_updated_at
  ON blog_posts(updated_at DESC);

-- ─── Newsletter drafts (WIP composer state for newsletters) ────────
-- broadcast_log stays the immutable send audit. Drafts live here until
-- the user hits Publish, at which point a new broadcast_log row is
-- inserted, the draft's sent_broadcast_id+sent_at are set, and the
-- draft is preserved as the round-trip source if the user re-opens it
-- in the composer. broadcast_log holds the rendered HTML at send time;
-- the draft holds the composer source.
CREATE TABLE IF NOT EXISTS newsletter_drafts (
  id                  SERIAL PRIMARY KEY,
  subject             TEXT NOT NULL DEFAULT '',
  preheader           TEXT NOT NULL DEFAULT '',
  body                TEXT NOT NULL DEFAULT '',
  cover_image_url     TEXT,
  studio_meta         JSONB,
  sent_broadcast_id   INT REFERENCES broadcast_log(id) ON DELETE SET NULL,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_newsletter_drafts_updated_at
  ON newsletter_drafts(updated_at DESC);

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

-- Limited editions: signed flag (paired with the existing
-- artworks.edition_size from Phase 1). signed = print is signed by
-- the artist; surfaces as a badge on the storefront when true AND
-- edition_size is non-null.
ALTER TABLE artworks
  ADD COLUMN IF NOT EXISTS signed BOOLEAN NOT NULL DEFAULT FALSE;

-- Edition sold-count subquery JOINS order_items × artwork_variants by
-- variant_id and filters by v.artwork_id. Without this index the count
-- runs as a seq-scan on order_items every artwork-detail render and
-- every checkout submit. Critical once order_items grows past ~10K.
CREATE INDEX IF NOT EXISTS idx_order_items_variant
  ON order_items(variant_id);

-- Print master pixel dimensions (separate from image_width/image_height,
-- which track the derived web JPEG, capped at 2000px long edge). Captured
-- at upload via sharp.metadata() so the admin can see whether a master is
-- high enough resolution for the largest sold size (24×36"). NULL until
-- upload or backfill runs (scripts/backfill-print-dims.ts).
ALTER TABLE artworks
  ADD COLUMN IF NOT EXISTS print_width  INT,
  ADD COLUMN IF NOT EXISTS print_height INT;

-- Wall order — the homepage "vintage wall" sequence, INDEPENDENT of
-- display_order (which orders the shop + portfolio). Set by the
-- /admin/wall drag-to-arrange tool. 0 = unarranged; the wall query falls
-- back to a stable md5(slug) shuffle so an un-arranged wall still looks
-- intentional.
ALTER TABLE artworks
  ADD COLUMN IF NOT EXISTS wall_order INT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_artworks_wall_order ON artworks(wall_order);

-- ─── Voice-training app ────────────────────────────────────────────
-- Trains the generator (lib/studio.ts) on Dan's voice. Inputs accumulate
-- across interview answers, pasted writing samples, A/B preferences,
-- and anti-voice examples; a "synthesize" step rolls everything into a
-- versioned voice_profile row with rules + summary + curated samples.
-- One profile may be active at a time; the studio prompts read it on
-- every request and merge it with the static defaults in
-- lib/studio-voice.ts.

CREATE TABLE IF NOT EXISTS voice_profiles (
  id          SERIAL PRIMARY KEY,
  active      BOOLEAN NOT NULL DEFAULT FALSE,
  summary     TEXT NOT NULL DEFAULT '',
  -- Array of {category, text} — explicit do/don't rules merged into the
  -- system prompt as a bulleted list.
  rules       JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Array of {title, note} — curated few-shot samples that replace or
  -- augment VOICE_NOTE_SAMPLES.
  samples     JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  TEXT
);

-- updated_at moves when a row's `active` flag toggles via the activate
-- route. Added after the initial table ship; existing rows backfill to
-- NOW() at migration time which is harmless — they all read as "last
-- touched at the moment we added the column."
ALTER TABLE voice_profiles
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Exactly one active profile at any time. Partial unique index over a
-- constant expression — Postgres refuses two rows with active=TRUE.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_voice_profiles_active
  ON voice_profiles((TRUE)) WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_voice_profiles_created_at
  ON voice_profiles(created_at DESC);

-- Raw writing samples Dan paste in. kind='positive' = sounds like him;
-- 'anti' = drafts that felt off, optionally annotated with why.
CREATE TABLE IF NOT EXISTS voice_samples (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,
  title       TEXT,
  text        TEXT NOT NULL,
  annotation  TEXT,
  source      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE voice_samples DROP CONSTRAINT IF EXISTS voice_samples_kind_chk;
ALTER TABLE voice_samples ADD CONSTRAINT voice_samples_kind_chk
  CHECK (kind IN ('positive', 'anti'));

CREATE INDEX IF NOT EXISTS idx_voice_samples_kind_created
  ON voice_samples(kind, created_at DESC);

-- Structured interview answers. question_key is a stable identifier
-- (e.g. 'words_avoided') so the UI can pre-fill previous answers; the
-- question_text is captured at write time so reordering or editing the
-- catalog doesn't orphan historic answers.
CREATE TABLE IF NOT EXISTS voice_interview_responses (
  id            SERIAL PRIMARY KEY,
  question_key  TEXT NOT NULL,
  question_text TEXT NOT NULL,
  answer        TEXT NOT NULL,
  category      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Latest answer per question wins — the UI just upserts. Without this,
-- repeated answers pile up and the synthesize step double-counts them.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_voice_interview_question
  ON voice_interview_responses(question_key);

-- A/B preference judgments. Two short variants of the same micro-prompt,
-- Dan picks the one that sounds more like him. Trains preferences that
-- few-shot examples can't always carry.
CREATE TABLE IF NOT EXISTS voice_ab_pairs (
  id          SERIAL PRIMARY KEY,
  prompt      TEXT NOT NULL,
  variant_a   TEXT NOT NULL,
  variant_b   TEXT NOT NULL,
  pick        TEXT,
  pick_reason TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  judged_at   TIMESTAMPTZ
);

ALTER TABLE voice_ab_pairs DROP CONSTRAINT IF EXISTS voice_ab_pairs_pick_chk;
ALTER TABLE voice_ab_pairs ADD CONSTRAINT voice_ab_pairs_pick_chk
  CHECK (pick IS NULL OR pick IN ('A', 'B', 'neither'));

CREATE INDEX IF NOT EXISTS idx_voice_ab_pairs_judged
  ON voice_ab_pairs(judged_at DESC NULLS LAST);
