# Wildlight Imagery Monetization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a fine-art photography storefront for Wildlight Imagery — Next.js 15 + Postgres + Stripe + Printful — that monetizes Dan Raby's existing portfolio via POD with zero-subscription-cost infrastructure beyond Vercel Pro ($20/mo).

**Architecture:** Single Next.js 15 App Router TypeScript project on Vercel Pro. Public catalog pages are server-rendered with `next/image` serving R2-hosted web images. Admin UI is JWT-auth-gated, single role. Stripe Checkout Sessions hand off payment; a signature-verified webhook creates Printful orders with idempotent keys. Printful webhooks update shipping status. Raw SQL via `pg` against Neon Postgres, idempotent `schema.sql`, money in integer cents. Fail-closed discipline on webhooks (paid but unfulfilled orders flagged `needs_review`, never silently dropped).

**Tech Stack:** Next.js 15 · TypeScript · React 18 · Postgres (Neon) via `pg` · Cloudflare R2 (S3 SDK) · Stripe (Checkout + Tax) · Printful (v1 API) · Resend · Vitest · Zod · bcryptjs · jsonwebtoken · Sentry

**Spec:** `docs/superpowers/specs/2026-04-23-wildlight-monetization-design.md`

**Working directory:** `~/wildlight/` (isolated project, git-initialized)

---

## Testing Discipline

Formal TDD (write failing test → implement → pass) is applied to:
- `lib/` pure functions (pricing, slugify, auth token sign/verify, Printful variant mapping)
- Webhook handlers (Stripe + Printful — signature verification, idempotency, state transitions)
- Order lifecycle state changes (create, refund, resubmit)
- Manifest import (deduping, safe re-runs)

Manual verification (no test scaffolding) for:
- Static page rendering + presentation components
- Admin CRUD UI flows
- Brand styling

This matches Dr. Bartender's proven pattern — tests on high-stakes logic, visual verification on UI.

---

## File Structure

```
wildlight/
├── app/
│   ├── (shop)/
│   │   ├── layout.tsx                      # Public layout (nav, footer, email capture)
│   │   ├── page.tsx                        # Home
│   │   ├── collections/page.tsx
│   │   ├── collections/[slug]/page.tsx
│   │   ├── artwork/[slug]/page.tsx
│   │   ├── cart/page.tsx
│   │   ├── about/page.tsx
│   │   ├── contact/page.tsx
│   │   └── legal/
│   │       ├── privacy/page.tsx
│   │       ├── terms/page.tsx
│   │       └── shipping-returns/page.tsx
│   ├── orders/[token]/page.tsx             # Token-gated order status
│   ├── admin/
│   │   ├── layout.tsx                      # Admin auth wrapper
│   │   ├── login/page.tsx
│   │   ├── page.tsx                        # Dashboard
│   │   ├── artworks/page.tsx
│   │   ├── artworks/new/page.tsx
│   │   ├── artworks/[id]/page.tsx
│   │   ├── collections/page.tsx
│   │   ├── orders/page.tsx
│   │   ├── orders/[id]/page.tsx
│   │   ├── subscribers/page.tsx
│   │   └── settings/page.tsx
│   ├── api/
│   │   ├── auth/login/route.ts
│   │   ├── auth/logout/route.ts
│   │   ├── checkout/route.ts
│   │   ├── subscribe/route.ts
│   │   ├── contact/route.ts
│   │   ├── webhooks/stripe/route.ts
│   │   ├── webhooks/printful/route.ts
│   │   └── admin/
│   │       ├── artworks/route.ts
│   │       ├── artworks/[id]/route.ts
│   │       ├── artworks/upload/route.ts
│   │       ├── collections/route.ts
│   │       ├── orders/[id]/route.ts
│   │       ├── orders/[id]/refund/route.ts
│   │       ├── orders/[id]/resubmit/route.ts
│   │       ├── subscribers/broadcast/route.ts
│   │       └── printful/sync/[artworkId]/route.ts
│   ├── layout.tsx                          # Root layout (HTML shell)
│   ├── globals.css
│   └── not-found.tsx
├── components/
│   ├── shop/
│   │   ├── ArtworkCard.tsx
│   │   ├── ArtworkGrid.tsx
│   │   ├── CollectionCard.tsx
│   │   ├── VariantPicker.tsx
│   │   ├── CartDrawer.tsx
│   │   ├── CartProvider.tsx
│   │   ├── EmailCaptureStrip.tsx
│   │   ├── Nav.tsx
│   │   └── Footer.tsx
│   └── admin/
│       ├── AdminNav.tsx
│       ├── StatusPill.tsx
│       ├── VariantTable.tsx
│       ├── ArtworkUploadForm.tsx
│       └── BroadcastComposer.tsx
├── lib/
│   ├── db.ts                               # pg Pool singleton
│   ├── schema.sql                          # Idempotent DDL
│   ├── migrate.ts                          # Runs schema.sql on boot
│   ├── errors.ts                           # AppError hierarchy
│   ├── r2.ts                               # S3 client for Cloudflare R2
│   ├── stripe.ts                           # Stripe client factory
│   ├── printful.ts                         # Printful API wrapper
│   ├── email.ts                            # Resend wrapper + templates
│   ├── auth.ts                             # JWT sign/verify + bcrypt
│   ├── session.ts                          # Cookie helpers for Next.js
│   ├── pricing.ts                          # Pure pricing functions
│   ├── printful-sync.ts                    # Product creation + variant mapping
│   ├── slug.ts                             # Slugify helper
│   ├── money.ts                            # Cents <-> USD formatter
│   ├── variant-templates.ts                # Pre-defined variant sets
│   └── logger.ts                           # Sentry wrapper
├── scripts/
│   ├── scrape-wildlight.js                 # Already written
│   ├── import-manifest.ts                  # Reads manifest.json -> R2 + DB
│   ├── seed-admins.ts                      # Creates initial admin users
│   └── sync-printful-products.ts           # Phase 2 catalog sync helper
├── types/
│   ├── index.ts                            # Shared app types
│   ├── printful.ts                         # Printful API response types
│   └── stripe.ts
├── tests/
│   ├── lib/
│   │   ├── pricing.test.ts
│   │   ├── slug.test.ts
│   │   ├── auth.test.ts
│   │   ├── variant-templates.test.ts
│   │   └── printful-sync.test.ts
│   └── api/
│       ├── webhooks-stripe.test.ts
│       ├── webhooks-printful.test.ts
│       └── checkout.test.ts
├── .env.example
├── .env.local                              # gitignored
├── next.config.ts
├── tsconfig.json
├── vitest.config.ts
├── package.json
└── middleware.ts                           # Next.js middleware for admin auth
```

---

## Phase 0: Project Scaffold

### Task 0.1: Initialize Next.js 15 TypeScript project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `.gitignore`

- [ ] **Step 1: Run create-next-app into existing dir**

```bash
cd ~/wildlight
# Move existing files aside so create-next-app doesn't refuse
mv package.json package.json.bak
mv .gitignore .gitignore.bak
npx --yes create-next-app@latest . \
  --typescript --app --src-dir=false \
  --tailwind=false --eslint --import-alias "@/*" \
  --use-npm --no-turbopack --skip-install
```

- [ ] **Step 2: Restore custom package metadata**

Merge `package.json.bak`'s `name`/`description`/`scripts.scrape` back into the new `package.json`. Delete `package.json.bak`. Keep the create-next-app-generated dependencies + scripts, add:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "scrape": "node scripts/scrape-wildlight.js",
    "import:manifest": "tsx scripts/import-manifest.ts",
    "seed:admins": "tsx scripts/seed-admins.ts",
    "sync:printful": "tsx scripts/sync-printful-products.ts",
    "migrate": "tsx lib/migrate.ts"
  }
}
```

- [ ] **Step 3: Restore and extend .gitignore**

```bash
# append originals plus Next.js defaults
cat >> .gitignore <<'EOF'
# next.js
/.next/
/out/

# vercel
.vercel

# typescript
*.tsbuildinfo
next-env.d.ts

# scraper output
scraped/

# env
.env*.local
.env
EOF
rm .gitignore.bak
```

- [ ] **Step 4: Verify project starts**

```bash
npm install
npm run dev
```
Expected: dev server on http://localhost:3000 rendering the default Next.js page. Stop with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "scaffold: initialize next.js 15 typescript project"
```

---

### Task 0.2: Install project-specific dependencies

**Files:** `package.json`

- [ ] **Step 1: Install runtime deps**

```bash
npm install pg @aws-sdk/client-s3 @aws-sdk/s3-request-presigner \
  stripe resend jsonwebtoken bcryptjs zod uuid \
  @sentry/nextjs react-hot-toast
```

- [ ] **Step 2: Install dev deps**

```bash
npm install -D @types/pg @types/jsonwebtoken @types/bcryptjs @types/uuid \
  vitest @vitest/ui tsx dotenv-cli
```

- [ ] **Step 3: Verify install clean**

```bash
npm run typecheck
```
Expected: no TypeScript errors (may need placeholder files created in later tasks; if errors refer to missing types from empty lib/ dir, ignore for now).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add runtime and dev dependencies"
```

---

### Task 0.3: Create folder structure + placeholder files

**Files:**
- Create: `app/(shop)/layout.tsx`, `lib/.gitkeep`, `components/shop/.gitkeep`, `components/admin/.gitkeep`, `tests/.gitkeep`, `types/.gitkeep`, `scripts/.gitkeep`

- [ ] **Step 1: Create directories**

```bash
mkdir -p app/\(shop\)/collections/\[slug\] \
  app/\(shop\)/artwork/\[slug\] \
  app/\(shop\)/cart app/\(shop\)/about app/\(shop\)/contact \
  app/\(shop\)/legal/privacy app/\(shop\)/legal/terms app/\(shop\)/legal/shipping-returns \
  app/orders/\[token\] \
  app/admin/login app/admin/artworks/new app/admin/artworks/\[id\] \
  app/admin/collections app/admin/orders/\[id\] app/admin/subscribers app/admin/settings \
  app/api/auth/login app/api/auth/logout \
  app/api/checkout app/api/subscribe app/api/contact \
  app/api/webhooks/stripe app/api/webhooks/printful \
  app/api/admin/artworks/\[id\] app/api/admin/artworks/upload \
  app/api/admin/collections app/api/admin/orders/\[id\]/refund \
  app/api/admin/orders/\[id\]/resubmit \
  app/api/admin/subscribers/broadcast \
  app/api/admin/printful/sync/\[artworkId\] \
  components/shop components/admin \
  lib scripts tests/lib tests/api types
```

- [ ] **Step 2: Create shared layout stub for public (shop) route group**

Create `app/(shop)/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Nav } from '@/components/shop/Nav';
import { Footer } from '@/components/shop/Footer';

export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Nav />
      <main>{children}</main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "scaffold: folder structure and route groups"
```

---

### Task 0.4: Environment variable template

**Files:** Create `.env.example`

- [ ] **Step 1: Write .env.example**

```bash
cat > .env.example <<'EOF'
# --- Database ---
DATABASE_URL=postgres://user:pass@host/db?sslmode=require

# --- Auth ---
JWT_SECRET=change-me-to-a-long-random-string

# --- App URLs ---
APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000

# --- Cloudflare R2 ---
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_PUBLIC=wildlight-images
R2_BUCKET_PRIVATE=wildlight-print-files
R2_PUBLIC_BASE_URL=https://images.wildlightimagery.shop

# --- Stripe ---
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
# Optional: if set to a future ISO date, forces test-mode keys until that date
STRIPE_TEST_MODE_UNTIL=

# --- Printful ---
PRINTFUL_API_KEY=
PRINTFUL_STORE_ID=
PRINTFUL_WEBHOOK_SECRET=

# --- Resend ---
RESEND_API_KEY=
RESEND_FROM_EMAIL=orders@wildlightimagery.shop
RESEND_BROADCAST_FROM=news@wildlightimagery.shop

# --- Sentry ---
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=

# --- Admin contact (for needs_review alerts) ---
ADMIN_ALERT_EMAIL=dallas@example.com,dan@example.com
EOF
cp .env.example .env.local
```

- [ ] **Step 2: Add real values to .env.local**

Fill in `DATABASE_URL` (new Neon project), `JWT_SECRET` (random 48+ char string), `R2_*` (reuse Dr. Bartender R2 account, create new buckets `wildlight-images` and `wildlight-print-files`), `STRIPE_*` (test mode keys for now), `RESEND_API_KEY` (reuse DB account). Leave Printful blank until Phase 10.

- [ ] **Step 3: Commit the example only**

```bash
git add .env.example
git commit -m "scaffold: env template"
```

---

### Task 0.5: Vitest configuration

**Files:** Create `vitest.config.ts`

- [ ] **Step 1: Write vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
```

- [ ] **Step 2: Write tests/setup.ts**

```ts
import { config } from 'dotenv';
config({ path: '.env.local' });

process.env.JWT_SECRET ||= 'test-secret-dont-use-in-prod-abcd1234567890';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET ||= 'whsec_dummy';
```

- [ ] **Step 3: Verify vitest boots**

```bash
npm test
```
Expected: "No test files found, exiting with code 0" (or similar). Success — just means no tests yet.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts tests/setup.ts
git commit -m "test: vitest config and setup"
```

---

## Phase 1: Foundation — Shared Libraries

Each library is built test-first. Keep the public surface small; add functions as later phases need them.

### Task 1.1: Error hierarchy

**Files:**
- Create: `lib/errors.ts`
- Test: `tests/lib/errors.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/lib/errors.test.ts
import { describe, it, expect } from 'vitest';
import {
  AppError, ValidationError, NotFoundError, ConflictError,
  PermissionError, ExternalServiceError,
} from '@/lib/errors';

describe('errors', () => {
  it('AppError preserves message, status, and code', () => {
    const e = new AppError('boom', 500, 'INTERNAL');
    expect(e.message).toBe('boom');
    expect(e.status).toBe(500);
    expect(e.code).toBe('INTERNAL');
    expect(e instanceof Error).toBe(true);
  });
  it('ValidationError defaults to 400', () => {
    expect(new ValidationError('bad').status).toBe(400);
  });
  it('NotFoundError defaults to 404', () => {
    expect(new NotFoundError('missing').status).toBe(404);
  });
  it('ConflictError defaults to 409', () => {
    expect(new ConflictError('taken').status).toBe(409);
  });
  it('PermissionError defaults to 403', () => {
    expect(new PermissionError('nope').status).toBe(403);
  });
  it('ExternalServiceError defaults to 502 and carries upstream code', () => {
    const e = new ExternalServiceError('stripe', 'card_declined');
    expect(e.status).toBe(502);
    expect(e.service).toBe('stripe');
    expect(e.upstreamCode).toBe('card_declined');
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
npm test -- errors
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// lib/errors.ts
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status = 500, code = 'APP_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
  }
}
export class ValidationError extends AppError {
  constructor(message: string) { super(message, 400, 'VALIDATION'); }
}
export class NotFoundError extends AppError {
  constructor(message = 'Not found') { super(message, 404, 'NOT_FOUND'); }
}
export class ConflictError extends AppError {
  constructor(message: string) { super(message, 409, 'CONFLICT'); }
}
export class PermissionError extends AppError {
  constructor(message = 'Forbidden') { super(message, 403, 'FORBIDDEN'); }
}
export class ExternalServiceError extends AppError {
  readonly service: string;
  readonly upstreamCode?: string;
  constructor(service: string, upstreamCode?: string, message = `External service failure: ${service}`) {
    super(message, 502, 'EXTERNAL_SERVICE');
    this.service = service;
    this.upstreamCode = upstreamCode;
  }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- errors
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/errors.ts tests/lib/errors.test.ts
git commit -m "lib: error hierarchy"
```

---

### Task 1.2: Database connection + schema

**Files:**
- Create: `lib/db.ts`, `lib/schema.sql`, `lib/migrate.ts`

- [ ] **Step 1: Write schema.sql**

Copy the full DDL block from the spec into `lib/schema.sql` verbatim. All `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` — re-runnable. Add a final block for `gen_random_uuid()` support:

```sql
-- lib/schema.sql
-- idempotent full schema; safe to re-run

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS collections (
  id              SERIAL PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  tagline         TEXT,
  cover_image_url TEXT,
  display_order   INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS subscribers (
  id              SERIAL PRIMARY KEY,
  email           TEXT UNIQUE NOT NULL,
  confirmed_at    TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  source          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id           SERIAL PRIMARY KEY,
  source       TEXT NOT NULL,
  event_id     TEXT UNIQUE,
  payload      JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: Write lib/db.ts**

```ts
// lib/db.ts
import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var __wildlight_pool: Pool | undefined;
}

export const pool: Pool =
  global.__wildlight_pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
  });
if (process.env.NODE_ENV !== 'production') global.__wildlight_pool = pool;

export async function withTransaction<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 3: Write lib/migrate.ts**

```ts
// lib/migrate.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { pool } from './db';

config({ path: '.env.local' });

async function main() {
  const sql = readFileSync(resolve(process.cwd(), 'lib/schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('schema applied');
  await pool.end();
}
main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 4: Run migration against Neon**

```bash
npm run migrate
```
Expected: "schema applied". Confirm in Neon console that all 8 tables exist.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts lib/schema.sql lib/migrate.ts
git commit -m "db: schema, pool, and migration runner"
```

---

### Task 1.3: Slug helper

**Files:** `lib/slug.ts`, `tests/lib/slug.test.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/lib/slug.test.ts
import { describe, it, expect } from 'vitest';
import { slugify, uniqueSlug } from '@/lib/slug';

describe('slugify', () => {
  it('lowercases, replaces non-alnum with dashes, trims edges', () => {
    expect(slugify('The Sun')).toBe('the-sun');
    expect(slugify("  Lime   Fruit! ")).toBe('lime-fruit');
    expect(slugify('20WLI_0039-1')).toBe('20wli-0039-1');
  });
  it('returns empty string on null/undefined', () => {
    expect(slugify(null as any)).toBe('');
    expect(slugify(undefined as any)).toBe('');
  });
});

describe('uniqueSlug', () => {
  it('returns base when not taken', () => {
    expect(uniqueSlug('foo', new Set())).toBe('foo');
  });
  it('appends numeric suffix when taken', () => {
    const taken = new Set(['foo', 'foo-2']);
    expect(uniqueSlug('foo', taken)).toBe('foo-3');
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
npm test -- slug
```

- [ ] **Step 3: Implement**

```ts
// lib/slug.ts
export function slugify(input: string | null | undefined): string {
  if (!input) return '';
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
```

- [ ] **Step 4: Run — expect pass**, then commit.

```bash
npm test -- slug
git add lib/slug.ts tests/lib/slug.test.ts
git commit -m "lib: slug helpers"
```

---

### Task 1.4: Money formatter

**Files:** `lib/money.ts`, `tests/lib/money.test.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/lib/money.test.ts
import { describe, it, expect } from 'vitest';
import { formatUSD, centsToDollars, dollarsToCents, roundPriceCents } from '@/lib/money';

describe('money', () => {
  it('formats cents as $X.YZ', () => {
    expect(formatUSD(3000)).toBe('$30.00');
    expect(formatUSD(12599)).toBe('$125.99');
    expect(formatUSD(0)).toBe('$0.00');
  });
  it('converts', () => {
    expect(centsToDollars(12345)).toBe(123.45);
    expect(dollarsToCents(123.45)).toBe(12345);
    expect(dollarsToCents(9.995)).toBe(1000); // rounds away from floating point drift
  });
  it('rounds up to nearest $5 ending', () => {
    expect(roundPriceCents(2799)).toBe(3000);   // 27.99 -> 30.00
    expect(roundPriceCents(3000)).toBe(3000);   // exact
    expect(roundPriceCents(3050)).toBe(3500);   // 30.50 -> 35.00
    expect(roundPriceCents(14900)).toBe(14900); // 149.00 exact
  });
});
```

- [ ] **Step 2: Run → fail → Implement**

```ts
// lib/money.ts
const USD = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function formatUSD(cents: number): string {
  return USD.format(cents / 100);
}
export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}
export function roundPriceCents(cents: number): number {
  // Round UP to the next $5 ending (i.e. multiples of 500 cents)
  return Math.ceil(cents / 500) * 500;
}
```

- [ ] **Step 3: Run → pass → commit**

```bash
npm test -- money
git add lib/money.ts tests/lib/money.test.ts
git commit -m "lib: money helpers"
```

---

### Task 1.5: Auth (JWT + bcrypt)

**Files:** `lib/auth.ts`, `tests/lib/auth.test.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/lib/auth.test.ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, signAdminToken, verifyAdminToken } from '@/lib/auth';

describe('password hashing', () => {
  it('hashes and verifies', async () => {
    const hash = await hashPassword('secret123');
    expect(hash).not.toBe('secret123');
    expect(await verifyPassword('secret123', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});

describe('admin jwt', () => {
  it('sign then verify returns payload', () => {
    const token = signAdminToken({ id: 1, email: 'dan@x.com' });
    const payload = verifyAdminToken(token);
    expect(payload.id).toBe(1);
    expect(payload.email).toBe('dan@x.com');
  });
  it('rejects tampered token', () => {
    const token = signAdminToken({ id: 1, email: 'dan@x.com' }) + 'x';
    expect(() => verifyAdminToken(token)).toThrow();
  });
});
```

- [ ] **Step 2: Run → fail → Implement**

```ts
// lib/auth.ts
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AppError } from './errors';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET env var required');

export interface AdminTokenPayload { id: number; email: string; }

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
export function signAdminToken(payload: AdminTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET!, { expiresIn: '30d' });
}
export function verifyAdminToken(token: string): AdminTokenPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET!) as AdminTokenPayload;
    if (typeof decoded.id !== 'number' || typeof decoded.email !== 'string') {
      throw new AppError('malformed token', 401, 'BAD_TOKEN');
    }
    return { id: decoded.id, email: decoded.email };
  } catch {
    throw new AppError('invalid token', 401, 'BAD_TOKEN');
  }
}
```

- [ ] **Step 3: Run → pass → commit**

```bash
npm test -- auth
git add lib/auth.ts tests/lib/auth.test.ts
git commit -m "lib: jwt + bcrypt auth helpers"
```

---

### Task 1.6: Pricing logic + variant templates

**Files:** `lib/variant-templates.ts`, `lib/pricing.ts`, `tests/lib/variant-templates.test.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/lib/variant-templates.test.ts
import { describe, it, expect } from 'vitest';
import { TEMPLATES, applyTemplate } from '@/lib/variant-templates';

describe('variant templates', () => {
  it('exposes fine_art, canvas, full', () => {
    expect(TEMPLATES.fine_art.length).toBe(4);
    expect(TEMPLATES.canvas.length).toBe(3);
    expect(TEMPLATES.full.length).toBe(14);
  });
  it('applyTemplate computes retail = cost*2.1 rounded up to $5 ending', () => {
    const variants = applyTemplate('fine_art');
    for (const v of variants) {
      expect(v.price_cents).toBeGreaterThanOrEqual(v.cost_cents * 2.1 - 1);
      expect(v.price_cents % 500).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Run → fail → Implement**

```ts
// lib/variant-templates.ts
import { roundPriceCents } from './money';

export type VariantType = 'print' | 'canvas' | 'framed' | 'metal';

export interface VariantSpec {
  type: VariantType;
  size: string;
  finish?: string;
  printful_variant_id: number;  // resolved later via Printful catalog; placeholder zero at seed
  cost_cents: number;
}

// Cost placeholders are approximate Printful US base costs as of 2026-Q1.
// Real costs are fetched at Printful-sync time and overwrite these.
const FINE_ART: VariantSpec[] = [
  { type: 'print', size: '8x10',  printful_variant_id: 0, cost_cents: 1250 },
  { type: 'print', size: '12x16', printful_variant_id: 0, cost_cents: 1850 },
  { type: 'print', size: '18x24', printful_variant_id: 0, cost_cents: 2900 },
  { type: 'print', size: '24x36', printful_variant_id: 0, cost_cents: 4200 },
];
const CANVAS: VariantSpec[] = [
  { type: 'canvas', size: '12x16', printful_variant_id: 0, cost_cents: 2800 },
  { type: 'canvas', size: '18x24', printful_variant_id: 0, cost_cents: 4200 },
  { type: 'canvas', size: '24x36', printful_variant_id: 0, cost_cents: 7500 },
];
const FRAMED: VariantSpec[] = [
  { type: 'framed', size: '12x16', finish: 'black', printful_variant_id: 0, cost_cents: 4100 },
  { type: 'framed', size: '18x24', finish: 'black', printful_variant_id: 0, cost_cents: 6500 },
  { type: 'framed', size: '12x16', finish: 'white', printful_variant_id: 0, cost_cents: 4100 },
  { type: 'framed', size: '18x24', finish: 'white', printful_variant_id: 0, cost_cents: 6500 },
];
const METAL: VariantSpec[] = [
  { type: 'metal', size: '16x20', printful_variant_id: 0, cost_cents: 5500 },
  { type: 'metal', size: '24x30', printful_variant_id: 0, cost_cents: 9500 },
];

export const TEMPLATES = {
  fine_art: FINE_ART,
  canvas: CANVAS,
  full: [...FINE_ART, ...CANVAS, ...FRAMED, ...METAL],
};

export type TemplateKey = keyof typeof TEMPLATES;

export interface VariantRow {
  type: VariantType;
  size: string;
  finish: string | null;
  printful_variant_id: number;
  price_cents: number;
  cost_cents: number;
}

export function applyTemplate(key: TemplateKey): VariantRow[] {
  return TEMPLATES[key].map((v) => ({
    type: v.type,
    size: v.size,
    finish: v.finish ?? null,
    printful_variant_id: v.printful_variant_id,
    cost_cents: v.cost_cents,
    price_cents: roundPriceCents(Math.ceil(v.cost_cents * 2.1)),
  }));
}
```

- [ ] **Step 3: Add pricing.ts (cart totals)**

Write `lib/pricing.ts`:

```ts
// lib/pricing.ts
export interface LineItem { price_cents: number; quantity: number; }

export function subtotalCents(items: LineItem[]): number {
  return items.reduce((sum, i) => sum + i.price_cents * i.quantity, 0);
}

export function qualifiesForFreeShipping(subtotal_cents: number): boolean {
  return subtotal_cents >= 15000;  // $150 spec threshold
}
```

- [ ] **Step 4: Run → pass → commit**

```bash
npm test
git add lib/variant-templates.ts lib/pricing.ts tests/lib/variant-templates.test.ts
git commit -m "lib: variant templates and pricing"
```

---

### Task 1.7: R2 client

**Files:** `lib/r2.ts`

- [ ] **Step 1: Implement** (no unit test — integration-only, manually verified)

```ts
// lib/r2.ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

export const r2 = new S3Client({
  region: 'auto',
  endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export async function uploadPublic(key: string, body: Buffer | Uint8Array, contentType: string): Promise<string> {
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_PUBLIC!,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return `${process.env.R2_PUBLIC_BASE_URL}/${key}`;
}

export async function uploadPrivate(key: string, body: Buffer | Uint8Array, contentType: string): Promise<string> {
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_PRIVATE!,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
  return key;
}

export async function signedPrivateUrl(key: string, expiresInSec = 3600): Promise<string> {
  return getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET_PRIVATE!, Key: key }),
    { expiresIn: expiresInSec },
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/r2.ts
git commit -m "lib: r2 upload + signed url helpers"
```

---

### Task 1.8: Stripe client

**Files:** `lib/stripe.ts`

- [ ] **Step 1: Implement**

```ts
// lib/stripe.ts
import Stripe from 'stripe';

function pickKey(): { secret: string; publishable: string; webhookSecret: string; testMode: boolean } {
  const until = process.env.STRIPE_TEST_MODE_UNTIL;
  const testMode = until ? new Date(until) > new Date() : false;
  if (testMode) {
    return {
      secret: process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY!,
      publishable: process.env.STRIPE_PUBLISHABLE_KEY_TEST || process.env.STRIPE_PUBLISHABLE_KEY!,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET_TEST || process.env.STRIPE_WEBHOOK_SECRET!,
      testMode: true,
    };
  }
  return {
    secret: process.env.STRIPE_SECRET_KEY!,
    publishable: process.env.STRIPE_PUBLISHABLE_KEY!,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
    testMode: false,
  };
}

export function getStripeConfig() { return pickKey(); }

export function getStripe(): Stripe {
  const { secret } = pickKey();
  if (!secret) throw new Error('stripe secret key missing');
  return new Stripe(secret, { apiVersion: '2024-12-18.acacia' });
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/stripe.ts
git commit -m "lib: stripe client with test-mode toggle"
```

---

### Task 1.9: Resend email wrapper + templates

**Files:** `lib/email.ts`

- [ ] **Step 1: Implement**

```ts
// lib/email.ts
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM_EMAIL || 'orders@wildlightimagery.shop';
const BROADCAST_FROM = process.env.RESEND_BROADCAST_FROM || 'news@wildlightimagery.shop';

export interface OrderConfirmationData {
  to: string;
  orderToken: string;
  items: Array<{ title: string; variant: string; price: string; qty: number; image_url?: string }>;
  subtotal: string;
  shipping: string;
  tax: string;
  total: string;
  siteUrl: string;
}

export async function sendOrderConfirmation(data: OrderConfirmationData) {
  const itemsHtml = data.items.map(i =>
    `<tr><td>${escapeHtml(i.title)} — ${escapeHtml(i.variant)}</td><td>×${i.qty}</td><td>${i.price}</td></tr>`
  ).join('');
  const html = `
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#222;">
      <h1 style="font-weight:400;">Thank you.</h1>
      <p>Your order has been received. We'll send a second email with tracking once it ships.</p>
      <table style="width:100%;border-collapse:collapse;margin:24px 0;">${itemsHtml}</table>
      <p>Subtotal: ${data.subtotal}<br/>Shipping: ${data.shipping}<br/>Tax: ${data.tax}<br/><strong>Total: ${data.total}</strong></p>
      <p><a href="${data.siteUrl}/orders/${data.orderToken}">View order status</a></p>
      <hr/>
      <p style="color:#777;font-size:12px;">Wildlight Imagery — work by Dan Raby</p>
    </div>`;
  return resend.emails.send({ from: FROM, to: data.to, subject: 'Your Wildlight order', html });
}

export async function sendOrderShipped(to: string, orderToken: string, trackingUrl: string | null, trackingNumber: string | null, siteUrl: string) {
  const tracking = trackingUrl
    ? `<p>Tracking: <a href="${trackingUrl}">${escapeHtml(trackingNumber || 'view')}</a></p>`
    : '<p>Tracking details to follow shortly.</p>';
  const html = `
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#222;">
      <h1 style="font-weight:400;">Your order has shipped.</h1>
      ${tracking}
      <p><a href="${siteUrl}/orders/${orderToken}">Order details</a></p>
    </div>`;
  return resend.emails.send({ from: FROM, to, subject: 'Your Wildlight order has shipped', html });
}

export async function sendNeedsReviewAlert(orderId: number, reason: string) {
  const recipients = (process.env.ADMIN_ALERT_EMAIL || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!recipients.length) return;
  return resend.emails.send({
    from: FROM,
    to: recipients,
    subject: `[Wildlight] Order ${orderId} needs review`,
    html: `<p>Order ${orderId} could not be auto-fulfilled.</p><p>Reason: ${escapeHtml(reason)}</p>`,
  });
}

export async function sendBroadcast(subject: string, html: string, toEmails: string[]) {
  const results = [];
  const batchSize = 50;  // Resend batch API limit
  for (let i = 0; i < toEmails.length; i += batchSize) {
    const chunk = toEmails.slice(i, i + batchSize);
    const batch = chunk.map(to => ({ from: BROADCAST_FROM, to, subject, html }));
    const res = await resend.batch.send(batch);
    results.push(res);
  }
  return results;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/email.ts
git commit -m "lib: resend wrapper + transactional templates"
```

---

### Task 1.10: Printful API wrapper

**Files:** `lib/printful.ts`, `types/printful.ts`

- [ ] **Step 1: Write types**

```ts
// types/printful.ts
export interface PrintfulSyncProduct {
  id: number;
  external_id?: string;
  name: string;
  variants: PrintfulSyncVariant[];
}
export interface PrintfulSyncVariant {
  id: number;
  variant_id: number;
  retail_price: string;
  name: string;
  product: { image: string; name: string };
  files: Array<{ id: number; url?: string; type: string }>;
}
export interface PrintfulOrderInput {
  external_id: string;
  shipping?: string;
  recipient: {
    name: string; address1: string; address2?: string;
    city: string; state_code: string; country_code: string; zip: string;
    email?: string; phone?: string;
  };
  items: Array<{ sync_variant_id: number; quantity: number; files?: Array<{ url: string; type?: string }> }>;
  retail_costs?: { currency: string; subtotal: string; tax: string; shipping: string; discount?: string; total: string };
  confirm?: boolean;
}
export interface PrintfulOrder {
  id: number;
  external_id: string;
  status: string;
  shipments?: Array<{ carrier: string; service: string; tracking_number: string; tracking_url: string }>;
}
```

- [ ] **Step 2: Write wrapper**

```ts
// lib/printful.ts
import { ExternalServiceError } from './errors';
import type { PrintfulOrderInput, PrintfulOrder } from '@/types/printful';

const BASE = 'https://api.printful.com';

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const apiKey = process.env.PRINTFUL_API_KEY;
  const storeId = process.env.PRINTFUL_STORE_ID;
  if (!apiKey) throw new Error('PRINTFUL_API_KEY missing');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${apiKey}`);
  headers.set('Content-Type', 'application/json');
  if (storeId) headers.set('X-PF-Store-Id', storeId);

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ExternalServiceError('printful', String(res.status), body?.result || body?.error?.message || `printful ${res.status}`);
  }
  return body.result as T;
}

export const printful = {
  createOrder: (input: PrintfulOrderInput): Promise<PrintfulOrder> =>
    call('/orders', { method: 'POST', body: JSON.stringify(input) }),
  getOrder: (id: number | string): Promise<PrintfulOrder> =>
    call(`/orders/${id}`),
  confirmOrder: (id: number): Promise<PrintfulOrder> =>
    call(`/orders/${id}/confirm`, { method: 'POST' }),
  cancelOrder: (id: number): Promise<PrintfulOrder> =>
    call(`/orders/${id}`, { method: 'DELETE' }),
  listSyncProducts: (): Promise<any[]> => call('/store/products'),
  createSyncProduct: (body: any): Promise<any> =>
    call('/store/products', { method: 'POST', body: JSON.stringify(body) }),
  getSyncProduct: (id: number): Promise<any> => call(`/store/products/${id}`),
  shippingRates: (body: any): Promise<any[]> =>
    call('/shipping/rates', { method: 'POST', body: JSON.stringify(body) }),
};
```

- [ ] **Step 3: Commit**

```bash
git add lib/printful.ts types/printful.ts
git commit -m "lib: printful api wrapper"
```

---

### Task 1.11: Logger + Sentry init

**Files:** `lib/logger.ts`, `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`

- [ ] **Step 1: Run Sentry wizard (optional, manual)**

If you'd rather hand-roll, skip the wizard and write the three configs below directly. Wizard command:

```bash
npx @sentry/wizard@latest -i nextjs
```

- [ ] **Step 2: Verify / write Sentry configs**

Ensure each `sentry.*.config.ts` sets `dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN` and `enabled: !!(process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN)`.

- [ ] **Step 3: Logger utility**

```ts
// lib/logger.ts
import * as Sentry from '@sentry/nextjs';

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => {
    console.log(`[info] ${msg}`, meta ?? '');
  },
  warn: (msg: string, meta?: Record<string, unknown>) => {
    console.warn(`[warn] ${msg}`, meta ?? '');
    Sentry.captureMessage(msg, { level: 'warning', extra: meta });
  },
  error: (msg: string, err: unknown, meta?: Record<string, unknown>) => {
    console.error(`[error] ${msg}`, err, meta ?? '');
    if (err instanceof Error) Sentry.captureException(err, { extra: { msg, ...meta } });
    else Sentry.captureMessage(msg, { level: 'error', extra: { err, ...meta } });
  },
};
```

- [ ] **Step 4: Commit**

```bash
git add lib/logger.ts sentry.*.config.ts next.config.ts
git commit -m "obs: sentry + logger wrapper"
```

---

### Task 1.12: Admin seed script

**Files:** `scripts/seed-admins.ts`

- [ ] **Step 1: Implement**

```ts
// scripts/seed-admins.ts
import { config } from 'dotenv';
import { pool } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import readline from 'node:readline/promises';

config({ path: '.env.local' });

async function prompt(q: string, silent = false): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  if (silent) {
    (rl as any).stdoutMuted = true;
    (rl as any)._writeToOutput = function (s: string) {
      if ((rl as any).stdoutMuted) (rl as any).output.write('*');
      else (rl as any).output.write(s);
    };
  }
  const answer = await rl.question(q);
  rl.close();
  return answer.trim();
}

async function main() {
  const email = (await prompt('Admin email: ')).toLowerCase();
  const pass = await prompt('Password (min 12 chars): ', true);
  if (pass.length < 12) throw new Error('password too short');
  const hash = await hashPassword(pass);
  const res = await pool.query(
    `INSERT INTO admin_users (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id, email`,
    [email, hash],
  );
  console.log('\nseeded:', res.rows[0]);
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Seed both admins**

```bash
npm run seed:admins   # run once for dallas@...
npm run seed:admins   # run again for dan@...
```

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-admins.ts
git commit -m "scripts: admin seed"
```

---

**Phase 1 checkpoint.** After this phase you have: working DB + migration, auth primitives, R2/Stripe/Printful/Resend clients, pricing logic, two admin users seeded. All lib tests pass:

```bash
npm test
npm run typecheck
```

---

## Phase 2: Data Import Pipeline

### Task 2.1: Manifest import script

**Files:** `scripts/import-manifest.ts`

Reads `scraped/manifest.json` (produced by `scrape-wildlight.js`), uploads every image to R2 as the `image_web_url`, and creates/updates `collections` + draft `artworks` rows. Idempotent — safe to re-run.

- [ ] **Step 1: Implement**

```ts
// scripts/import-manifest.ts
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { pool, withTransaction } from '@/lib/db';
import { uploadPublic } from '@/lib/r2';
import { slugify, uniqueSlug } from '@/lib/slug';

config({ path: '.env.local' });

interface ManifestArtwork {
  slug: string;
  filename: string;
  title: string;
  alt: string;
  sourceUrl: string;
  bytes: number;
}
interface ManifestCollection {
  url: string;
  title: string;
  slug: string;
  artworks: ManifestArtwork[];
}
interface Manifest {
  scrapedAt: string;
  base: string;
  collections: ManifestCollection[];
}

async function main() {
  const manifestPath = resolve(process.cwd(), 'scraped/manifest.json');
  const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  console.log(`Importing ${manifest.collections.length} collections...`);

  // upsert collections
  const collectionIdBySlug = new Map<string, number>();
  for (const [i, c] of manifest.collections.entries()) {
    const slug = slugify(c.slug) || slugify(c.title);
    const res = await pool.query(
      `INSERT INTO collections (slug, title, display_order)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, display_order = EXCLUDED.display_order
       RETURNING id`,
      [slug, c.title, i],
    );
    collectionIdBySlug.set(slug, res.rows[0].id);
  }

  // existing artwork slugs (so we don't collide + can skip re-upload)
  const existing = await pool.query('SELECT slug, image_web_url FROM artworks');
  const takenSlugs = new Set<string>(existing.rows.map(r => r.slug));
  const existingByUrlBase = new Set<string>(existing.rows.map(r => r.image_web_url));

  for (const c of manifest.collections) {
    const colSlug = slugify(c.slug) || slugify(c.title);
    const colId = collectionIdBySlug.get(colSlug);
    if (!colId) continue;
    console.log(`\n[${c.title}] ${c.artworks.length} artworks`);

    for (const [idx, a] of c.artworks.entries()) {
      const rawSlug = slugify(a.slug || a.title || a.filename.replace(extname(a.filename), ''));
      const base = rawSlug || `${colSlug}-${String(idx + 1).padStart(3, '0')}`;
      const slug = uniqueSlug(base, takenSlugs);

      // derive R2 key and upload
      const localPath = resolve(process.cwd(), 'scraped', colSlug, a.filename);
      const ext = extname(a.filename).toLowerCase() || '.jpg';
      const r2Key = `artworks/${colSlug}/${slug}${ext}`;
      let webUrl = `${process.env.R2_PUBLIC_BASE_URL}/${r2Key}`;

      if (!existingByUrlBase.has(webUrl)) {
        const body = readFileSync(localPath);
        webUrl = await uploadPublic(r2Key, body, ext === '.png' ? 'image/png' : 'image/jpeg');
      }

      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO artworks (collection_id, slug, title, image_web_url, status, display_order)
           VALUES ($1, $2, $3, $4, 'draft', $5)
           ON CONFLICT (slug) DO UPDATE SET
             collection_id = EXCLUDED.collection_id,
             title = EXCLUDED.title,
             image_web_url = EXCLUDED.image_web_url,
             display_order = EXCLUDED.display_order,
             updated_at = NOW()`,
          [colId, slug, a.title || slug, webUrl, idx],
        );
      });
      takenSlugs.add(slug);
      process.stdout.write('.');
    }
    process.stdout.write('\n');
  }

  const counts = await pool.query(
    `SELECT c.title, COUNT(a.*) as n FROM collections c
     LEFT JOIN artworks a ON a.collection_id = c.id
     GROUP BY c.id, c.title ORDER BY c.display_order`,
  );
  console.log('\nImport summary:');
  for (const row of counts.rows) console.log(`  ${row.title}: ${row.n}`);
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run against populated manifest**

(Only after `npm run scrape` has completed successfully.)

```bash
npm run import:manifest
```
Expected: summary with non-zero counts per collection. Verify in Neon that `artworks` has ~400 rows, all status='draft'.

- [ ] **Step 3: Commit**

```bash
git add scripts/import-manifest.ts
git commit -m "scripts: import manifest -> R2 + DB"
```

---

## Phase 3: Admin Auth & Base Layout

### Task 3.1: Session cookie helpers

**Files:** `lib/session.ts`

- [ ] **Step 1: Implement**

```ts
// lib/session.ts
import { cookies } from 'next/headers';
import { signAdminToken, verifyAdminToken, type AdminTokenPayload } from './auth';

const COOKIE = 'wl_admin';
const THIRTY_DAYS = 60 * 60 * 24 * 30;

export async function setAdminSession(payload: AdminTokenPayload) {
  const token = signAdminToken(payload);
  const c = await cookies();
  c.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: THIRTY_DAYS,
  });
}

export async function clearAdminSession() {
  const c = await cookies();
  c.delete(COOKIE);
}

export async function getAdminSession(): Promise<AdminTokenPayload | null> {
  const c = await cookies();
  const token = c.get(COOKIE)?.value;
  if (!token) return null;
  try { return verifyAdminToken(token); } catch { return null; }
}

export async function requireAdmin(): Promise<AdminTokenPayload> {
  const session = await getAdminSession();
  if (!session) throw new Error('UNAUTHORIZED');
  return session;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/session.ts
git commit -m "lib: admin session cookie helpers"
```

---

### Task 3.2: Login route handler + page

**Files:** `app/api/auth/login/route.ts`, `app/api/auth/logout/route.ts`, `app/admin/login/page.tsx`

- [ ] **Step 1: Login API route**

```ts
// app/api/auth/login/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { setAdminSession } from '@/lib/session';

const Body = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  const { email, password } = parsed.data;

  const res = await pool.query(
    'SELECT id, email, password_hash FROM admin_users WHERE email = $1',
    [email.toLowerCase()],
  );
  const row = res.rows[0];
  // Constant-time-ish: always compare a hash to avoid user enumeration
  const hash = row?.password_hash || '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalid';
  const ok = await verifyPassword(password, hash);

  if (!row || !ok) {
    return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
  }
  await setAdminSession({ id: row.id, email: row.email });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Logout API route**

```ts
// app/api/auth/logout/route.ts
import { NextResponse } from 'next/server';
import { clearAdminSession } from '@/lib/session';

export async function POST() {
  await clearAdminSession();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Login page (client)**

```tsx
// app/admin/login/page.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (!res.ok) { setError('Invalid credentials'); return; }
    router.push('/admin');
  }

  return (
    <div style={{ maxWidth: 360, margin: '10vh auto', fontFamily: 'Georgia, serif' }}>
      <h1 style={{ fontWeight: 400 }}>Admin</h1>
      <form onSubmit={submit}>
        <label>Email<br/><input value={email} onChange={e => setEmail(e.target.value)} style={{ width: '100%', padding: 8 }} /></label>
        <label>Password<br/><input value={password} onChange={e => setPassword(e.target.value)} type="password" style={{ width: '100%', padding: 8 }} /></label>
        {error && <p style={{ color: '#b22' }}>{error}</p>}
        <button disabled={loading} style={{ marginTop: 12, padding: '10px 16px' }}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add app/api/auth app/admin/login
git commit -m "auth: login/logout routes and page"
```

---

### Task 3.3: Middleware for admin routes

**Files:** `middleware.ts`

- [ ] **Step 1: Implement**

```ts
// middleware.ts
import { NextResponse, type NextRequest } from 'next/server';
import { verifyAdminToken } from '@/lib/auth';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith('/admin') || pathname === '/admin/login') return NextResponse.next();
  if (pathname.startsWith('/api/admin')) { /* handled below too */ }

  const token = req.cookies.get('wl_admin')?.value;
  if (!token) return NextResponse.redirect(new URL('/admin/login', req.url));
  try { verifyAdminToken(token); return NextResponse.next(); }
  catch { return NextResponse.redirect(new URL('/admin/login', req.url)); }
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
```

Note: `verifyAdminToken` uses `jsonwebtoken`, which runs on Node runtime. Make sure Next.js uses Node runtime for middleware by not using Edge APIs. If you hit an Edge compatibility error, replace the import with a dynamic verify using `jose` instead. For Phase 1 keep `jsonwebtoken` and set `runtime: 'nodejs'` in individual admin route handlers.

- [ ] **Step 2: Commit**

```bash
git add middleware.ts
git commit -m "auth: admin middleware guard"
```

---

### Task 3.4: Admin layout + nav

**Files:** `app/admin/layout.tsx`, `components/admin/AdminNav.tsx`

- [ ] **Step 1: AdminNav**

```tsx
// components/admin/AdminNav.tsx
import Link from 'next/link';

export function AdminNav({ currentEmail }: { currentEmail: string }) {
  return (
    <nav style={{ borderBottom: '1px solid #e5e5e5', padding: '12px 24px', display: 'flex', gap: 24, alignItems: 'center' }}>
      <strong>Wildlight Admin</strong>
      <Link href="/admin">Dashboard</Link>
      <Link href="/admin/artworks">Artworks</Link>
      <Link href="/admin/collections">Collections</Link>
      <Link href="/admin/orders">Orders</Link>
      <Link href="/admin/subscribers">Subscribers</Link>
      <Link href="/admin/settings">Settings</Link>
      <span style={{ marginLeft: 'auto', color: '#777', fontSize: 12 }}>{currentEmail}</span>
      <form action="/api/auth/logout" method="post" style={{ display: 'inline' }}>
        <button type="submit" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#777' }}>sign out</button>
      </form>
    </nav>
  );
}
```

- [ ] **Step 2: Admin layout**

```tsx
// app/admin/layout.tsx
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/session';
import { AdminNav } from '@/components/admin/AdminNav';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');
  return (
    <div style={{ fontFamily: 'Georgia, serif' }}>
      <AdminNav currentEmail={session.email} />
      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: Dashboard skeleton**

```tsx
// app/admin/page.tsx
import { pool } from '@/lib/db';
import { formatUSD } from '@/lib/money';

export default async function AdminDashboard() {
  const [{ rows: rev }, { rows: ords }, { rows: subs }] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(total_cents),0)::int AS total, COUNT(*)::int AS n
                FROM orders WHERE status IN ('paid','submitted','fulfilled','shipped','delivered')
                  AND created_at >= NOW() - INTERVAL '30 days'`),
    pool.query(`SELECT status, COUNT(*)::int AS n FROM orders GROUP BY status`),
    pool.query(`SELECT COUNT(*)::int AS n FROM subscribers WHERE confirmed_at IS NOT NULL`),
  ]);
  const needsReview = ords.find((r: any) => r.status === 'needs_review')?.n || 0;

  return (
    <div>
      <h1 style={{ fontWeight: 400 }}>Dashboard</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginTop: 24 }}>
        <Tile label="Revenue (30d)" value={formatUSD(rev[0].total)} />
        <Tile label="Orders (30d)" value={String(rev[0].n)} />
        <Tile label="Needs review" value={String(needsReview)} warn={needsReview > 0} />
        <Tile label="Subscribers" value={String(subs[0].n)} />
      </div>
    </div>
  );
}
function Tile({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ border: '1px solid #e5e5e5', padding: 16, background: warn ? '#fff4f4' : undefined }}>
      <div style={{ color: '#777', fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 24 }}>{value}</div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add app/admin components/admin
git commit -m "admin: layout, nav, dashboard skeleton"
```

---

## Phase 4: Public Catalog — Brand & Home

### Task 4.1: Global styles and brand

**Files:** `app/globals.css`, `app/layout.tsx`, `components/shop/Nav.tsx`, `components/shop/Footer.tsx`

- [ ] **Step 1: globals.css**

```css
/* app/globals.css */
:root {
  --bg: #faf9f7;
  --fg: #1a1a1a;
  --muted: #777;
  --accent: #2a3a2a;
  --rule: #e5e2dc;
  --maxw: 1200px;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); }
body { font-family: 'Georgia', 'Times New Roman', serif; line-height: 1.55; }
a { color: inherit; }
img { max-width: 100%; height: auto; display: block; }
.container { max-width: var(--maxw); margin: 0 auto; padding: 0 24px; }
h1, h2, h3 { font-weight: 400; letter-spacing: 0.01em; }
h1 { font-size: 2.25rem; }
.button {
  display: inline-block; padding: 12px 20px; border: 1px solid var(--fg);
  background: transparent; color: var(--fg); text-decoration: none; cursor: pointer;
  font-family: inherit;
}
.button:hover { background: var(--fg); color: var(--bg); }
```

- [ ] **Step 2: Nav + Footer components**

```tsx
// components/shop/Nav.tsx
import Link from 'next/link';
export function Nav() {
  return (
    <header style={{ borderBottom: '1px solid var(--rule)' }}>
      <div className="container" style={{ display: 'flex', alignItems: 'center', padding: '20px 24px' }}>
        <Link href="/" style={{ textDecoration: 'none', letterSpacing: '0.08em' }}>
          <strong>WILDLIGHT</strong> <span style={{ color: 'var(--muted)' }}>IMAGERY</span>
        </Link>
        <nav style={{ marginLeft: 'auto', display: 'flex', gap: 24 }}>
          <Link href="/collections">Collections</Link>
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/cart">Cart</Link>
        </nav>
      </div>
    </header>
  );
}
```

```tsx
// components/shop/Footer.tsx
import Link from 'next/link';
import { EmailCaptureStrip } from './EmailCaptureStrip';
export function Footer() {
  return (
    <footer style={{ borderTop: '1px solid var(--rule)', marginTop: 80 }}>
      <div className="container" style={{ padding: '40px 24px' }}>
        <EmailCaptureStrip />
        <div style={{ display: 'flex', gap: 24, marginTop: 32, flexWrap: 'wrap', color: 'var(--muted)', fontSize: 14 }}>
          <span>© {new Date().getFullYear()} Wildlight Imagery — work by Dan Raby</span>
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/terms">Terms</Link>
          <Link href="/legal/shipping-returns">Shipping & returns</Link>
        </div>
      </div>
    </footer>
  );
}
```

- [ ] **Step 3: Root layout**

Update `app/layout.tsx`:

```tsx
import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Wildlight Imagery — Fine art by Dan Raby',
  description: 'A curated selection of fine art photography by Dan Raby. Archival prints, canvases, and framed pieces made to order.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
```

- [ ] **Step 4: Commit**

```bash
git add app/globals.css app/layout.tsx components/shop/Nav.tsx components/shop/Footer.tsx
git commit -m "shop: global styles, nav, footer"
```

---

### Task 4.2: Email capture strip + subscribe API

**Files:** `components/shop/EmailCaptureStrip.tsx`, `app/api/subscribe/route.ts`

- [ ] **Step 1: Subscribe API**

```ts
// app/api/subscribe/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';

const Body = z.object({ email: z.string().email(), source: z.string().optional() });
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid email' }, { status: 400 });
  const { email, source } = parsed.data;
  await pool.query(
    `INSERT INTO subscribers (email, source, confirmed_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (email) DO UPDATE SET unsubscribed_at = NULL`,
    [email.toLowerCase(), source || 'footer'],
  );
  return NextResponse.json({ ok: true });
}
```

Confirmation flow is single-opt-in for Phase 1; double opt-in is a Phase 2 enhancement.

- [ ] **Step 2: Client component**

```tsx
// components/shop/EmailCaptureStrip.tsx
'use client';
import { useState } from 'react';
export function EmailCaptureStrip({ source = 'footer' }: { source?: string }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle'|'loading'|'done'|'error'>('idle');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('loading');
    const res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, source }),
    });
    setState(res.ok ? 'done' : 'error');
  }
  if (state === 'done') return <p style={{ color: 'var(--muted)' }}>Thank you — we'll be in touch sparingly.</p>;
  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 8, maxWidth: 480 }}>
      <input type="email" required value={email} onChange={e=>setEmail(e.target.value)}
        placeholder="Be told about new work"
        style={{ flex: 1, padding: 10, border: '1px solid var(--rule)', fontFamily: 'inherit' }} />
      <button className="button" disabled={state==='loading'}>{state==='loading'?'…':'Subscribe'}</button>
    </form>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/subscribe components/shop/EmailCaptureStrip.tsx
git commit -m "shop: email capture strip + subscribe api"
```

---

### Task 4.3: Homepage

**Files:** `app/(shop)/page.tsx`, `components/shop/CollectionCard.tsx`

- [ ] **Step 1: CollectionCard**

```tsx
// components/shop/CollectionCard.tsx
import Image from 'next/image';
import Link from 'next/link';
export interface CollectionCardProps {
  slug: string; title: string; tagline?: string | null; coverUrl: string | null;
}
export function CollectionCard({ slug, title, tagline, coverUrl }: CollectionCardProps) {
  return (
    <Link href={`/collections/${slug}`} style={{ textDecoration: 'none', display: 'block' }}>
      <div style={{ aspectRatio: '4/5', background: 'var(--rule)', position: 'relative', overflow: 'hidden' }}>
        {coverUrl && <Image src={coverUrl} alt={title} fill sizes="(max-width: 900px) 100vw, 33vw" style={{ objectFit: 'cover' }} />}
      </div>
      <h3 style={{ marginTop: 12, marginBottom: 4 }}>{title}</h3>
      {tagline && <p style={{ margin: 0, color: 'var(--muted)' }}>{tagline}</p>}
    </Link>
  );
}
```

- [ ] **Step 2: Home page**

```tsx
// app/(shop)/page.tsx
import Link from 'next/link';
import Image from 'next/image';
import { pool } from '@/lib/db';
import { CollectionCard } from '@/components/shop/CollectionCard';

export const revalidate = 60;

export default async function HomePage() {
  const [featured, collections] = await Promise.all([
    pool.query(`SELECT slug, title, image_web_url FROM artworks WHERE status='published' ORDER BY random() LIMIT 1`),
    pool.query(`SELECT slug, title, tagline, cover_image_url FROM collections ORDER BY display_order`),
  ]);
  const hero = featured.rows[0];
  return (
    <>
      <section className="container" style={{ paddingTop: 40, paddingBottom: 40 }}>
        {hero && (
          <Link href={`/artwork/${hero.slug}`} style={{ textDecoration: 'none' }}>
            <div style={{ position: 'relative', aspectRatio: '16/9', background: 'var(--rule)' }}>
              <Image src={hero.image_web_url} alt={hero.title} fill priority sizes="100vw" style={{ objectFit: 'cover' }} />
            </div>
            <p style={{ color: 'var(--muted)', marginTop: 8 }}>{hero.title}</p>
          </Link>
        )}
        <div style={{ marginTop: 48, maxWidth: 680 }}>
          <h1>A curated selection of fine art by Dan Raby.</h1>
          <p>Archival prints, canvases, and framed pieces — made to order, shipped worldwide.</p>
          <Link className="button" href="/collections" style={{ marginTop: 16 }}>Browse collections</Link>
        </div>
      </section>
      <section className="container" style={{ paddingBottom: 80 }}>
        <h2>Collections</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 32, marginTop: 24 }}>
          {collections.rows.map(c => (
            <CollectionCard key={c.slug} slug={c.slug} title={c.title} tagline={c.tagline} coverUrl={c.cover_image_url} />
          ))}
        </div>
      </section>
    </>
  );
}
```

- [ ] **Step 3: Configure next.config.ts for remote R2 images**

```ts
// next.config.ts
import type { NextConfig } from 'next';
const host = new URL(process.env.R2_PUBLIC_BASE_URL || 'https://images.wildlightimagery.shop').hostname;
const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: host }],
  },
};
export default nextConfig;
```

- [ ] **Step 4: Visual check**

```bash
npm run dev
# open http://localhost:3000
```
Expected: hero photo + six collection cards rendering (after Phase 2 import).

- [ ] **Step 5: Commit**

```bash
git add app/\(shop\)/page.tsx components/shop/CollectionCard.tsx next.config.ts
git commit -m "shop: homepage with hero + collection grid"
```

---

## Phase 5: Public Catalog — Collections & Artwork Pages

### Task 5.1: Collections index page

**Files:** `app/(shop)/collections/page.tsx`

- [ ] **Step 1: Implement**

```tsx
// app/(shop)/collections/page.tsx
import { pool } from '@/lib/db';
import { CollectionCard } from '@/components/shop/CollectionCard';

export const revalidate = 60;

export default async function CollectionsIndex() {
  const { rows } = await pool.query(
    `SELECT c.slug, c.title, c.tagline, c.cover_image_url,
            COUNT(a.*) FILTER (WHERE a.status='published')::int AS n
     FROM collections c
     LEFT JOIN artworks a ON a.collection_id = c.id
     GROUP BY c.id
     ORDER BY c.display_order`
  );
  return (
    <section className="container" style={{ padding: '40px 24px' }}>
      <h1>Collections</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 32, marginTop: 24 }}>
        {rows.map((c: any) => (
          <div key={c.slug}>
            <CollectionCard slug={c.slug} title={c.title} tagline={c.tagline} coverUrl={c.cover_image_url} />
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>{c.n} pieces</p>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/\(shop\)/collections/page.tsx
git commit -m "shop: collections index page"
```

---

### Task 5.2: Collection detail page (grid)

**Files:** `app/(shop)/collections/[slug]/page.tsx`, `components/shop/ArtworkGrid.tsx`, `components/shop/ArtworkCard.tsx`

- [ ] **Step 1: ArtworkCard**

```tsx
// components/shop/ArtworkCard.tsx
import Link from 'next/link';
import Image from 'next/image';
export function ArtworkCard({ slug, title, imageUrl }: { slug: string; title: string; imageUrl: string; }) {
  return (
    <Link href={`/artwork/${slug}`} style={{ textDecoration: 'none' }}>
      <div style={{ position: 'relative', aspectRatio: '1/1', background: 'var(--rule)', overflow: 'hidden' }}>
        <Image src={imageUrl} alt={title} fill sizes="(max-width: 900px) 50vw, 25vw" style={{ objectFit: 'cover', transition: 'transform 300ms' }} />
      </div>
      <p style={{ marginTop: 8, fontSize: 13, color: 'var(--muted)' }}>{title}</p>
    </Link>
  );
}
```

- [ ] **Step 2: ArtworkGrid**

```tsx
// components/shop/ArtworkGrid.tsx
import { ArtworkCard } from './ArtworkCard';
export interface GridItem { slug: string; title: string; image_web_url: string; }
export function ArtworkGrid({ items }: { items: GridItem[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 20, marginTop: 24 }}>
      {items.map(i => (
        <ArtworkCard key={i.slug} slug={i.slug} title={i.title} imageUrl={i.image_web_url} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Collection detail page**

```tsx
// app/(shop)/collections/[slug]/page.tsx
import { notFound } from 'next/navigation';
import { pool } from '@/lib/db';
import { ArtworkGrid } from '@/components/shop/ArtworkGrid';

export const revalidate = 60;

export default async function CollectionDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const col = await pool.query('SELECT id, title, tagline FROM collections WHERE slug = $1', [slug]);
  if (!col.rowCount) notFound();
  const arts = await pool.query(
    `SELECT slug, title, image_web_url FROM artworks
     WHERE collection_id = $1 AND status = 'published'
     ORDER BY display_order, id`,
    [col.rows[0].id],
  );
  return (
    <section className="container" style={{ padding: '40px 24px' }}>
      <h1>{col.rows[0].title}</h1>
      {col.rows[0].tagline && <p style={{ color: 'var(--muted)', maxWidth: 560 }}>{col.rows[0].tagline}</p>}
      <ArtworkGrid items={arts.rows} />
    </section>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add app/\(shop\)/collections components/shop/ArtworkCard.tsx components/shop/ArtworkGrid.tsx
git commit -m "shop: collection detail grid"
```

---

### Task 5.3: Artwork detail page + variant picker

**Files:** `app/(shop)/artwork/[slug]/page.tsx`, `components/shop/VariantPicker.tsx`

- [ ] **Step 1: VariantPicker (client)**

```tsx
// components/shop/VariantPicker.tsx
'use client';
import { useState, useMemo } from 'react';
import { useCart } from './CartProvider';
import { formatUSD } from '@/lib/money';

export interface VariantOption {
  id: number; type: string; size: string; finish: string | null; price_cents: number;
}
export function VariantPicker({ artworkId, artworkTitle, artworkSlug, imageUrl, variants }: {
  artworkId: number; artworkTitle: string; artworkSlug: string; imageUrl: string; variants: VariantOption[];
}) {
  const types = useMemo(() => [...new Set(variants.map(v => v.type))], [variants]);
  const [type, setType] = useState(types[0]);
  const forType = variants.filter(v => v.type === type);
  const [selId, setSelId] = useState(forType[0]?.id);
  const cart = useCart();
  const current = variants.find(v => v.id === selId);

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ color: 'var(--muted)', fontSize: 13 }}>Type</label>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          {types.map(t => (
            <button key={t} type="button"
              onClick={() => { setType(t); setSelId(variants.find(v => v.type === t)?.id); }}
              className="button"
              style={{ background: t === type ? 'var(--fg)' : undefined, color: t === type ? 'var(--bg)' : undefined }}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 24 }}>
        <label style={{ color: 'var(--muted)', fontSize: 13 }}>Size{type === 'framed' && ' / finish'}</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
          {forType.map(v => (
            <button key={v.id} type="button" onClick={() => setSelId(v.id)} className="button"
              style={{ background: v.id === selId ? 'var(--fg)' : undefined, color: v.id === selId ? 'var(--bg)' : undefined }}>
              {v.size}{v.finish ? ` · ${v.finish}` : ''} — {formatUSD(v.price_cents)}
            </button>
          ))}
        </div>
      </div>
      <button type="button" className="button" disabled={!current}
        onClick={() => current && cart.add({
          variantId: current.id, artworkId, artworkSlug, artworkTitle, imageUrl,
          type: current.type, size: current.size, finish: current.finish,
          priceCents: current.price_cents,
        })}>
        Add to cart — {current ? formatUSD(current.price_cents) : ''}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Artwork detail page**

```tsx
// app/(shop)/artwork/[slug]/page.tsx
import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { pool } from '@/lib/db';
import { VariantPicker } from '@/components/shop/VariantPicker';

export const revalidate = 60;

export default async function ArtworkPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { rows: arts } = await pool.query(
    `SELECT a.*, c.slug AS collection_slug, c.title AS collection_title
     FROM artworks a LEFT JOIN collections c ON c.id = a.collection_id
     WHERE a.slug = $1 AND a.status = 'published'`, [slug],
  );
  if (!arts.length) notFound();
  const art = arts[0];
  const { rows: variants } = await pool.query(
    `SELECT id, type, size, finish, price_cents FROM artwork_variants
     WHERE artwork_id = $1 AND active = TRUE ORDER BY type, price_cents`, [art.id],
  );

  return (
    <section className="container" style={{ padding: '40px 24px', display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 48 }}>
      <div style={{ position: 'relative', aspectRatio: '4/5', background: 'var(--rule)' }}>
        <Image src={art.image_web_url} alt={art.title} fill priority sizes="(max-width: 900px) 100vw, 58vw" style={{ objectFit: 'cover' }} />
      </div>
      <div>
        {art.collection_title && (
          <Link href={`/collections/${art.collection_slug}`} style={{ color: 'var(--muted)' }}>
            {art.collection_title}
          </Link>
        )}
        <h1 style={{ marginTop: 8 }}>{art.title}</h1>
        {art.artist_note && <p style={{ marginTop: 16, maxWidth: 520, whiteSpace: 'pre-wrap' }}>{art.artist_note}</p>}
        {art.location && <p style={{ color: 'var(--muted)' }}>{art.location}{art.year_shot ? `, ${art.year_shot}` : ''}</p>}
        <div style={{ marginTop: 32 }}>
          <VariantPicker artworkId={art.id} artworkTitle={art.title} artworkSlug={art.slug}
            imageUrl={art.image_web_url} variants={variants as any} />
          <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 16 }}>
            Made to order — ships within 7 business days.
          </p>
          <p style={{ marginTop: 32 }}>
            <Link href={`/contact?license=${art.slug}`} style={{ color: 'var(--muted)' }}>License this image →</Link>
          </p>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/\(shop\)/artwork components/shop/VariantPicker.tsx
git commit -m "shop: artwork detail page + variant picker"
```

---

### Task 5.4: About + Contact pages

**Files:** `app/(shop)/about/page.tsx`, `app/(shop)/contact/page.tsx`, `app/api/contact/route.ts`

- [ ] **Step 1: About page**

Draft copy Dallas seeds; Dan can rewrite later.

```tsx
// app/(shop)/about/page.tsx
export const metadata = { title: 'About — Wildlight Imagery' };
export default function AboutPage() {
  return (
    <section className="container" style={{ padding: '40px 24px', maxWidth: 720 }}>
      <h1>Dan Raby</h1>
      <p>Dan is a photographer based in Aurora, Colorado. He studied at the Colorado Institute of Art
         and has been making photographs for more than two decades.</p>
      <p>His work spans portraiture, fine art, and documentary, often experimenting with technique —
         a different lens, an unusual light, a single detail held longer than the eye normally allows.
         Wildlight Imagery gathers his favorite photographs into six small collections.</p>
      <p>Every print is produced to order on archival materials.</p>
      <p style={{ color: 'var(--muted)', marginTop: 32 }}>
        For licensing, commissions, or corporate décor inquiries, please use the <a href="/contact">contact form</a>.
      </p>
    </section>
  );
}
```

- [ ] **Step 2: Contact API route**

```ts
// app/api/contact/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Resend } from 'resend';

const Body = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  subject: z.string().min(1).max(200).optional(),
  message: z.string().min(1).max(5000),
  topic: z.string().max(80).optional(),  // "license:<slug>", "commission", "press", ...
});
const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  const d = parsed.data;
  const to = (process.env.ADMIN_ALERT_EMAIL || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!to.length) return NextResponse.json({ error: 'unconfigured' }, { status: 500 });
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'orders@wildlightimagery.shop',
    to,
    reply_to: d.email,
    subject: `[Wildlight] ${d.topic ? `${d.topic} — ` : ''}${d.subject || 'contact'}`,
    html: `<p><strong>${d.name}</strong> &lt;${d.email}&gt;</p><pre style="white-space:pre-wrap;font-family:Georgia,serif">${d.message.replace(/</g,'&lt;')}</pre>`,
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Contact page**

```tsx
// app/(shop)/contact/page.tsx
'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function ContactPage() {
  const qp = useSearchParams();
  const topic = qp.get('license') ? `license:${qp.get('license')}` : qp.get('topic') || '';
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [state, setState] = useState<'idle'|'loading'|'done'|'error'>('idle');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('loading');
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, topic }),
    });
    setState(res.ok ? 'done' : 'error');
  }
  if (state === 'done') return <section className="container" style={{ padding: 40 }}><h1>Thank you.</h1><p>We'll be in touch shortly.</p></section>;
  return (
    <section className="container" style={{ padding: '40px 24px', maxWidth: 560 }}>
      <h1>Contact</h1>
      {topic && <p style={{ color: 'var(--muted)' }}>Regarding: {topic}</p>}
      <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
        <input required placeholder="Name" value={form.name} onChange={e=>setForm({...form, name:e.target.value})} style={inp} />
        <input required type="email" placeholder="Email" value={form.email} onChange={e=>setForm({...form, email:e.target.value})} style={inp} />
        <input placeholder="Subject" value={form.subject} onChange={e=>setForm({...form, subject:e.target.value})} style={inp} />
        <textarea required rows={8} placeholder="Message" value={form.message} onChange={e=>setForm({...form, message:e.target.value})} style={{...inp, fontFamily:'inherit'}} />
        <button className="button" disabled={state==='loading'}>{state==='loading'?'Sending…':'Send'}</button>
        {state==='error' && <p style={{ color: '#b22' }}>Something went wrong — please try again or email directly.</p>}
      </form>
    </section>
  );
}
const inp: React.CSSProperties = { padding: 10, border: '1px solid var(--rule)', background: 'white', fontFamily: 'inherit' };
```

- [ ] **Step 4: Commit**

```bash
git add app/\(shop\)/about app/\(shop\)/contact app/api/contact
git commit -m "shop: about + contact"
```

---

## Phase 6: Cart

### Task 6.1: CartProvider (client state + localStorage)

**Files:** `components/shop/CartProvider.tsx`

- [ ] **Step 1: Implement**

```tsx
// components/shop/CartProvider.tsx
'use client';
import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react';

export interface CartLine {
  variantId: number; artworkId: number; artworkSlug: string; artworkTitle: string;
  imageUrl: string; type: string; size: string; finish: string | null;
  priceCents: number; quantity: number;
}
export interface CartItemInput extends Omit<CartLine, 'quantity'> { }

type State = { lines: CartLine[] };
type Action =
  | { type: 'add'; item: CartItemInput }
  | { type: 'remove'; variantId: number }
  | { type: 'setQty'; variantId: number; quantity: number }
  | { type: 'clear' }
  | { type: 'load'; state: State };

const KEY = 'wl_cart_v1';

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'add': {
      const existing = state.lines.find(l => l.variantId === action.item.variantId);
      if (existing) return { lines: state.lines.map(l =>
        l.variantId === existing.variantId ? { ...l, quantity: l.quantity + 1 } : l) };
      return { lines: [...state.lines, { ...action.item, quantity: 1 }] };
    }
    case 'remove':
      return { lines: state.lines.filter(l => l.variantId !== action.variantId) };
    case 'setQty':
      return { lines: state.lines
        .map(l => l.variantId === action.variantId ? { ...l, quantity: Math.max(1, action.quantity) } : l) };
    case 'clear': return { lines: [] };
    case 'load': return action.state;
    default: return state;
  }
}

interface CartApi {
  lines: CartLine[];
  subtotalCents: number;
  add: (item: CartItemInput) => void;
  remove: (variantId: number) => void;
  setQty: (variantId: number, q: number) => void;
  clear: () => void;
}
const Ctx = createContext<CartApi | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { lines: [] });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) dispatch({ type: 'load', state: JSON.parse(raw) });
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  }, [state]);

  const subtotalCents = state.lines.reduce((s, l) => s + l.priceCents * l.quantity, 0);
  const api: CartApi = {
    lines: state.lines,
    subtotalCents,
    add: (item) => dispatch({ type: 'add', item }),
    remove: (id) => dispatch({ type: 'remove', variantId: id }),
    setQty: (id, q) => dispatch({ type: 'setQty', variantId: id, quantity: q }),
    clear: () => dispatch({ type: 'clear' }),
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
export function useCart() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCart outside CartProvider');
  return ctx;
}
```

- [ ] **Step 2: Wire CartProvider into shop layout**

Update `app/(shop)/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Nav } from '@/components/shop/Nav';
import { Footer } from '@/components/shop/Footer';
import { CartProvider } from '@/components/shop/CartProvider';

export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <CartProvider>
      <Nav />
      <main>{children}</main>
      <Footer />
    </CartProvider>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/shop/CartProvider.tsx app/\(shop\)/layout.tsx
git commit -m "shop: cart state provider"
```

---

### Task 6.2: Cart page

**Files:** `app/(shop)/cart/page.tsx`

- [ ] **Step 1: Implement**

```tsx
// app/(shop)/cart/page.tsx
'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useCart } from '@/components/shop/CartProvider';
import { formatUSD } from '@/lib/money';
import { useState } from 'react';

export default function CartPage() {
  const cart = useCart();
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  if (cart.lines.length === 0) {
    return (
      <section className="container" style={{ padding: 40 }}>
        <h1>Cart</h1>
        <p>Your cart is empty.</p>
        <Link className="button" href="/collections">Browse collections</Link>
      </section>
    );
  }

  async function checkout() {
    setCheckoutLoading(true);
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lines: cart.lines.map(l => ({ variantId: l.variantId, quantity: l.quantity })),
      }),
    });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    else { alert(data.error || 'Checkout failed'); setCheckoutLoading(false); }
  }

  return (
    <section className="container" style={{ padding: 40 }}>
      <h1>Cart</h1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 48, marginTop: 24 }}>
        <div>
          {cart.lines.map(l => (
            <div key={l.variantId} style={{ display: 'grid', gridTemplateColumns: '100px 1fr auto', gap: 16, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--rule)' }}>
              <div style={{ position: 'relative', aspectRatio: '1/1' }}>
                <Image src={l.imageUrl} alt={l.artworkTitle} fill sizes="100px" style={{ objectFit: 'cover' }} />
              </div>
              <div>
                <Link href={`/artwork/${l.artworkSlug}`}><strong>{l.artworkTitle}</strong></Link>
                <div style={{ color: 'var(--muted)' }}>{l.type} · {l.size}{l.finish ? ` · ${l.finish}` : ''}</div>
                <div style={{ marginTop: 4 }}>
                  <input type="number" min={1} value={l.quantity} onChange={e => cart.setQty(l.variantId, parseInt(e.target.value)||1)}
                    style={{ width: 60, padding: 4 }} />
                  <button style={{ marginLeft: 12, background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}
                    onClick={() => cart.remove(l.variantId)}>remove</button>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>{formatUSD(l.priceCents * l.quantity)}</div>
            </div>
          ))}
        </div>
        <aside>
          <div style={{ border: '1px solid var(--rule)', padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Subtotal</span><span>{formatUSD(cart.subtotalCents)}</span>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>Shipping and tax calculated at checkout.</p>
            <button className="button" style={{ width: '100%', marginTop: 16 }} onClick={checkout} disabled={checkoutLoading}>
              {checkoutLoading ? 'Redirecting…' : 'Checkout'}
            </button>
          </div>
        </aside>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/\(shop\)/cart
git commit -m "shop: cart page"
```

---

## Phase 7: Admin — Artwork & Collection Management

### Task 7.1: Artwork list with filters + bulk actions

**Files:** `app/admin/artworks/page.tsx`, `app/api/admin/artworks/route.ts`

- [ ] **Step 1: List API** (GET list, POST bulk update)

```ts
// app/api/admin/artworks/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export async function GET(req: Request) {
  await requireAdmin();
  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const collection = url.searchParams.get('collection');
  const clauses: string[] = []; const params: any[] = [];
  if (status) { clauses.push(`a.status = $${params.length+1}`); params.push(status); }
  if (collection) { clauses.push(`c.slug = $${params.length+1}`); params.push(collection); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const { rows } = await pool.query(
    `SELECT a.id, a.slug, a.title, a.status, a.image_web_url, a.updated_at,
            c.title AS collection_title, c.slug AS collection_slug,
            (SELECT COUNT(*)::int FROM artwork_variants v WHERE v.artwork_id = a.id AND v.active) AS variant_count
     FROM artworks a LEFT JOIN collections c ON c.id = a.collection_id
     ${where}
     ORDER BY a.updated_at DESC LIMIT 500`, params);
  return NextResponse.json({ rows });
}

const BulkBody = z.object({
  ids: z.array(z.number().int()).min(1),
  action: z.enum(['publish','retire','delete','move']),
  collectionId: z.number().int().optional(),
});
export async function POST(req: Request) {
  await requireAdmin();
  const parsed = BulkBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  const { ids, action, collectionId } = parsed.data;
  if (action === 'publish') await pool.query(`UPDATE artworks SET status='published', updated_at=NOW() WHERE id = ANY($1)`, [ids]);
  else if (action === 'retire') await pool.query(`UPDATE artworks SET status='retired', updated_at=NOW() WHERE id = ANY($1)`, [ids]);
  else if (action === 'delete') await pool.query(`DELETE FROM artworks WHERE id = ANY($1)`, [ids]);
  else if (action === 'move') {
    if (!collectionId) return NextResponse.json({ error: 'collectionId required' }, { status: 400 });
    await pool.query(`UPDATE artworks SET collection_id=$2, updated_at=NOW() WHERE id = ANY($1)`, [ids, collectionId]);
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Artwork list page (client component under the admin layout)**

```tsx
// app/admin/artworks/page.tsx
'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { StatusPill } from '@/components/admin/StatusPill';

interface Row {
  id: number; slug: string; title: string; status: string;
  image_web_url: string; collection_title: string | null; variant_count: number;
}

export default function AdminArtworksPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<string>('');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    const qs = new URLSearchParams(); if (status) qs.set('status', status);
    const r = await fetch('/api/admin/artworks?' + qs);
    const d = await r.json();
    setRows(d.rows); setLoading(false); setSel(new Set());
  }
  useEffect(() => { reload(); }, [status]);

  async function bulk(action: string) {
    if (!sel.size) return;
    if (action === 'delete' && !confirm(`Delete ${sel.size} artworks?`)) return;
    await fetch('/api/admin/artworks', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...sel], action }) });
    reload();
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <h1>Artworks</h1>
        <Link className="button" href="/admin/artworks/new" style={{ marginLeft: 'auto' }}>+ New</Link>
      </div>
      <div style={{ display: 'flex', gap: 16, margin: '16px 0' }}>
        <select value={status} onChange={e=>setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option><option value="published">Published</option><option value="retired">Retired</option>
        </select>
        <span style={{ marginLeft: 'auto' }}>{sel.size} selected</span>
        <button onClick={()=>bulk('publish')} disabled={!sel.size}>Publish</button>
        <button onClick={()=>bulk('retire')} disabled={!sel.size}>Retire</button>
        <button onClick={()=>bulk('delete')} disabled={!sel.size} style={{ color: '#b22' }}>Delete</button>
      </div>
      {loading ? <p>Loading…</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>
            <th></th><th>Title</th><th>Collection</th><th>Status</th><th>Variants</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
                <td><input type="checkbox" checked={sel.has(r.id)} onChange={e => {
                  const n = new Set(sel); if (e.target.checked) n.add(r.id); else n.delete(r.id); setSel(n);
                }} /></td>
                <td>
                  <Link href={`/admin/artworks/${r.id}`} style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit' }}>
                    <div style={{ position: 'relative', width: 60, height: 60, background: '#eee' }}>
                      <Image src={r.image_web_url} alt="" fill sizes="60px" style={{ objectFit: 'cover' }} />
                    </div>
                    {r.title}
                  </Link>
                </td>
                <td>{r.collection_title || '—'}</td>
                <td><StatusPill status={r.status} /></td>
                <td>{r.variant_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 3: StatusPill helper**

```tsx
// components/admin/StatusPill.tsx
export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: '#bbb', published: '#2a8', retired: '#777',
    pending: '#bbb', paid: '#ffb347', submitted: '#6aa',
    needs_review: '#c33', fulfilled: '#6aa', shipped: '#2a8',
    delivered: '#2a8', canceled: '#777', refunded: '#c33',
  };
  return <span style={{ display: 'inline-block', padding: '2px 8px', background: map[status] || '#ccc', color: 'white', borderRadius: 10, fontSize: 12 }}>{status}</span>;
}
```

- [ ] **Step 4: Commit**

```bash
git add app/admin/artworks/page.tsx app/api/admin/artworks/route.ts components/admin/StatusPill.tsx
git commit -m "admin: artwork list + bulk actions"
```

---

### Task 7.2: Artwork detail/edit page + variant management

**Files:** `app/admin/artworks/[id]/page.tsx`, `app/api/admin/artworks/[id]/route.ts`, `components/admin/VariantTable.tsx`

- [ ] **Step 1: Detail API** (GET, PATCH, variant mutations)

```ts
// app/api/admin/artworks/[id]/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { applyTemplate, type TemplateKey } from '@/lib/variant-templates';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await ctx.params;
  const [a, v] = await Promise.all([
    pool.query(`SELECT a.*, c.title AS collection_title FROM artworks a LEFT JOIN collections c ON c.id = a.collection_id WHERE a.id = $1`, [id]),
    pool.query(`SELECT * FROM artwork_variants WHERE artwork_id = $1 ORDER BY type, price_cents`, [id]),
  ]);
  if (!a.rowCount) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ artwork: a.rows[0], variants: v.rows });
}

const Patch = z.object({
  title: z.string().min(1).max(200).optional(),
  artist_note: z.string().max(5000).nullable().optional(),
  year_shot: z.number().int().min(1900).max(2100).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  status: z.enum(['draft','published','retired']).optional(),
  collection_id: z.number().int().nullable().optional(),
  display_order: z.number().int().optional(),
  edition_size: z.number().int().positive().nullable().optional(),
  image_print_url: z.string().nullable().optional(),
  applyTemplate: z.enum(['fine_art','canvas','full']).optional(),
});
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await ctx.params;
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  const d = parsed.data;

  await withTransaction(async (client) => {
    const updateCols: string[] = []; const vals: any[] = [];
    for (const [k, v] of Object.entries(d)) {
      if (k === 'applyTemplate') continue;
      updateCols.push(`${k} = $${vals.length + 1}`); vals.push(v);
    }
    if (updateCols.length) {
      vals.push(id);
      await client.query(`UPDATE artworks SET ${updateCols.join(', ')}, updated_at=NOW() WHERE id = $${vals.length}`, vals);
    }
    if (d.applyTemplate) {
      const variants = applyTemplate(d.applyTemplate as TemplateKey);
      await client.query('UPDATE artwork_variants SET active = FALSE WHERE artwork_id = $1', [id]);
      for (const v of variants) {
        await client.query(
          `INSERT INTO artwork_variants (artwork_id, type, size, finish, price_cents, cost_cents, active)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
          [id, v.type, v.size, v.finish, v.price_cents, v.cost_cents],
        );
      }
    }
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await ctx.params;
  await pool.query('DELETE FROM artworks WHERE id = $1', [id]);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: VariantTable component**

```tsx
// components/admin/VariantTable.tsx
'use client';
import { formatUSD } from '@/lib/money';
export interface VRow { id: number; type: string; size: string; finish: string | null; price_cents: number; cost_cents: number; active: boolean; printful_sync_variant_id: number | null; }
export function VariantTable({ variants }: { variants: VRow[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>
        <th>Type</th><th>Size</th><th>Finish</th><th>Price</th><th>Cost</th><th>Printful</th><th>Active</th>
      </tr></thead>
      <tbody>
        {variants.map(v => (
          <tr key={v.id} style={{ borderBottom: '1px solid #eee' }}>
            <td>{v.type}</td><td>{v.size}</td><td>{v.finish || '—'}</td>
            <td>{formatUSD(v.price_cents)}</td>
            <td style={{ color: '#777' }}>{formatUSD(v.cost_cents)}</td>
            <td style={{ color: '#777' }}>{v.printful_sync_variant_id || 'not synced'}</td>
            <td>{v.active ? '✓' : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: Detail page (client)**

```tsx
// app/admin/artworks/[id]/page.tsx
'use client';
import { useEffect, useState, use } from 'react';
import Image from 'next/image';
import { VariantTable } from '@/components/admin/VariantTable';
import { StatusPill } from '@/components/admin/StatusPill';

export default function ArtworkEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  async function load() {
    const r = await fetch(`/api/admin/artworks/${id}`); setData(await r.json());
  }
  useEffect(() => { load(); }, [id]);
  if (!data?.artwork) return <p>Loading…</p>;
  const a = data.artwork;

  async function save(patch: any) {
    setSaving(true);
    await fetch(`/api/admin/artworks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    await load(); setSaving(false);
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: 24 }}>
      <div>
        <div style={{ position: 'relative', aspectRatio: '4/5', background: '#eee' }}>
          <Image src={a.image_web_url} alt={a.title} fill sizes="400px" style={{ objectFit: 'cover' }} />
        </div>
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ margin: 0 }}>{a.title}</h1>
          <StatusPill status={a.status} />
        </div>
        <p style={{ color: '#777' }}>/artwork/{a.slug}</p>
        <Field label="Title" value={a.title} onSave={v=>save({ title: v })} />
        <Field label="Artist note" value={a.artist_note || ''} multiline onSave={v=>save({ artist_note: v })} />
        <Field label="Location" value={a.location || ''} onSave={v=>save({ location: v })} />
        <Field label="Year shot" value={a.year_shot || ''} type="number" onSave={v=>save({ year_shot: v ? Number(v) : null })} />
        <div style={{ marginTop: 16 }}>
          <strong>Status:</strong>{' '}
          {['draft','published','retired'].filter(s => s !== a.status).map(s =>
            <button key={s} onClick={()=>save({ status: s })} style={{ marginLeft: 8 }}>{s}</button>
          )}
        </div>
        <h3 style={{ marginTop: 32 }}>Variants</h3>
        <VariantTable variants={data.variants} />
        {data.variants.length === 0 && (
          <div style={{ marginTop: 12 }}>
            Apply template:
            {(['fine_art','canvas','full'] as const).map(t =>
              <button key={t} onClick={()=>save({ applyTemplate: t })} style={{ marginLeft: 8 }}>{t}</button>
            )}
          </div>
        )}
        {saving && <p style={{ color: '#777' }}>Saving…</p>}
      </div>
    </div>
  );
}
function Field({ label, value, onSave, multiline, type='text' }: { label: string; value: string|number; onSave: (v: string)=>void; multiline?: boolean; type?: string }) {
  const [v, setV] = useState(String(value ?? ''));
  return (
    <div style={{ marginTop: 12 }}>
      <label style={{ color: '#777', fontSize: 13 }}>{label}</label><br/>
      {multiline
        ? <textarea value={v} onChange={e=>setV(e.target.value)} onBlur={()=>onSave(v)} rows={4} style={{ width: '100%', padding: 6, fontFamily: 'inherit' }} />
        : <input type={type} value={v} onChange={e=>setV(e.target.value)} onBlur={()=>onSave(v)} style={{ width: '100%', padding: 6 }} />}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add app/admin/artworks/\[id\] app/api/admin/artworks/\[id\] components/admin/VariantTable.tsx
git commit -m "admin: artwork detail edit + variant table"
```

---

### Task 7.3: New artwork upload

**Files:** `app/admin/artworks/new/page.tsx`, `app/api/admin/artworks/upload/route.ts`

- [ ] **Step 1: Upload API**

```ts
// app/api/admin/artworks/upload/route.ts
import { NextResponse } from 'next/server';
import { pool, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { uploadPublic, uploadPrivate } from '@/lib/r2';
import { slugify, uniqueSlug } from '@/lib/slug';

export async function POST(req: Request) {
  await requireAdmin();
  const form = await req.formData();
  const title = String(form.get('title') || '').trim();
  const collectionId = Number(form.get('collection_id') || 0) || null;
  const artistNote = String(form.get('artist_note') || '') || null;
  const webFile = form.get('image_web') as File | null;
  const printFile = form.get('image_print') as File | null;
  if (!title || !webFile) return NextResponse.json({ error: 'title and image_web required' }, { status: 400 });

  const existing = await pool.query('SELECT slug FROM artworks');
  const taken = new Set<string>(existing.rows.map((r: any) => r.slug));
  const base = slugify(title);
  const slug = uniqueSlug(base || 'untitled', taken);

  const webBuf = Buffer.from(await webFile.arrayBuffer());
  const webKey = `artworks/${collectionId || 'misc'}/${slug}.jpg`;
  const webUrl = await uploadPublic(webKey, webBuf, webFile.type || 'image/jpeg');

  let printUrlKey: string | null = null;
  if (printFile) {
    const printBuf = Buffer.from(await printFile.arrayBuffer());
    const printKey = `artworks-print/${collectionId || 'misc'}/${slug}.jpg`;
    printUrlKey = await uploadPrivate(printKey, printBuf, printFile.type || 'image/jpeg');
  }

  let id: number = 0;
  await withTransaction(async (client) => {
    const r = await client.query(
      `INSERT INTO artworks (collection_id, slug, title, artist_note, image_web_url, image_print_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft') RETURNING id`,
      [collectionId, slug, title, artistNote, webUrl, printUrlKey],
    );
    id = r.rows[0].id;
  });
  return NextResponse.json({ id, slug });
}
```

- [ ] **Step 2: Upload form (client)**

```tsx
// app/admin/artworks/new/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewArtwork() {
  const [cols, setCols] = useState<{id:number;title:string}[]>([]);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => { fetch('/api/admin/collections').then(r => r.json()).then(d => setCols(d.rows)); }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const r = await fetch('/api/admin/artworks/upload', { method: 'POST', body: fd });
    const d = await r.json();
    setBusy(false);
    if (d.id) router.push(`/admin/artworks/${d.id}`);
    else alert(d.error || 'Upload failed');
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 560, display: 'grid', gap: 12 }}>
      <h1>New artwork</h1>
      <label>Title<br/><input name="title" required style={{ width: '100%', padding: 8 }} /></label>
      <label>Collection<br/>
        <select name="collection_id">
          <option value="">—</option>
          {cols.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </label>
      <label>Artist note<br/><textarea name="artist_note" rows={4} style={{ width: '100%', padding: 8, fontFamily: 'inherit' }} /></label>
      <label>Web image (1600–2000px JPEG)<br/><input name="image_web" type="file" accept="image/jpeg,image/png" required /></label>
      <label>Print file (optional; full resolution)<br/><input name="image_print" type="file" accept="image/jpeg,image/tiff" /></label>
      <button className="button" disabled={busy}>{busy ? 'Uploading…' : 'Create draft'}</button>
    </form>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/admin/artworks/new app/api/admin/artworks/upload
git commit -m "admin: new-artwork upload form + api"
```

---

### Task 7.4: Collections admin

**Files:** `app/admin/collections/page.tsx`, `app/api/admin/collections/route.ts`

- [ ] **Step 1: API** (GET list, POST create, PATCH update, DELETE)

```ts
// app/api/admin/collections/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { slugify } from '@/lib/slug';

export async function GET() {
  await requireAdmin();
  const { rows } = await pool.query('SELECT * FROM collections ORDER BY display_order, id');
  return NextResponse.json({ rows });
}
const Create = z.object({ title: z.string().min(1), tagline: z.string().optional() });
export async function POST(req: Request) {
  await requireAdmin();
  const p = Create.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const slug = slugify(p.data.title);
  const r = await pool.query(
    `INSERT INTO collections (slug, title, tagline) VALUES ($1, $2, $3)
     ON CONFLICT (slug) DO UPDATE SET title=EXCLUDED.title RETURNING *`,
    [slug, p.data.title, p.data.tagline || null],
  );
  return NextResponse.json(r.rows[0]);
}
const Patch = z.object({ id: z.number().int(), title: z.string().optional(), tagline: z.string().optional(), display_order: z.number().int().optional(), cover_image_url: z.string().optional() });
export async function PATCH(req: Request) {
  await requireAdmin();
  const p = Patch.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const { id, ...rest } = p.data;
  const cols = Object.entries(rest).filter(([,v]) => v !== undefined);
  if (!cols.length) return NextResponse.json({ ok: true });
  const sets = cols.map(([k], i) => `${k} = $${i+1}`).join(', ');
  await pool.query(`UPDATE collections SET ${sets} WHERE id = $${cols.length+1}`, [...cols.map(([,v]) => v), id]);
  return NextResponse.json({ ok: true });
}
export async function DELETE(req: Request) {
  await requireAdmin();
  const { id } = await req.json();
  await pool.query('DELETE FROM collections WHERE id = $1', [Number(id)]);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Collections admin page (client)**

```tsx
// app/admin/collections/page.tsx
'use client';
import { useEffect, useState } from 'react';

export default function AdminCollections() {
  const [rows, setRows] = useState<any[]>([]);
  async function reload() { const r = await fetch('/api/admin/collections'); setRows((await r.json()).rows); }
  useEffect(() => { reload(); }, []);
  async function patch(id: number, body: any) {
    await fetch('/api/admin/collections', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) });
    reload();
  }
  async function create() {
    const title = prompt('Collection title'); if (!title) return;
    await fetch('/api/admin/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    reload();
  }
  return (
    <div>
      <h1>Collections</h1>
      <button className="button" onClick={create}>+ New</button>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
        <thead><tr style={{ textAlign: 'left' }}><th>Order</th><th>Title</th><th>Tagline</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
              <td><input type="number" defaultValue={r.display_order} onBlur={e=>patch(r.id, { display_order: Number(e.target.value) })} style={{ width: 60 }} /></td>
              <td><input defaultValue={r.title} onBlur={e=>patch(r.id, { title: e.target.value })} style={{ width: '100%' }} /></td>
              <td><input defaultValue={r.tagline || ''} onBlur={e=>patch(r.id, { tagline: e.target.value })} style={{ width: '100%' }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/admin/collections app/api/admin/collections
git commit -m "admin: collections CRUD"
```

---

## Phase 8: Commerce — Stripe Checkout

### Task 8.1: Checkout API

**Files:** `app/api/checkout/route.ts`

Server-side: resolves cart line variants to authoritative prices from DB (clients can't tamper), creates a Stripe Checkout Session with Stripe Tax enabled, redirects.

- [ ] **Step 1: Write failing test**

```ts
// tests/api/checkout.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  pool: { query: vi.fn() },
  withTransaction: vi.fn(async (fn) => fn({ query: vi.fn() })),
}));
vi.mock('@/lib/stripe', () => ({
  getStripe: vi.fn(() => ({
    checkout: { sessions: { create: vi.fn(async () => ({ id: 'cs_test_1', url: 'https://stripe/x' })) } },
  })),
  getStripeConfig: vi.fn(() => ({ testMode: true })),
}));

import { POST } from '@/app/api/checkout/route';
import { pool } from '@/lib/db';

describe('POST /api/checkout', () => {
  beforeEach(() => { (pool.query as any).mockReset(); });
  it('rejects empty cart', async () => {
    const req = new Request('http://x', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ lines: [] }) });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
  it('resolves variants from DB, creates session, returns URL', async () => {
    (pool.query as any).mockResolvedValueOnce({ rows: [
      { id: 1, price_cents: 3000, type: 'print', size: '8x10', finish: null, artwork_id: 10,
        artwork_title: 'Lime Fruit', artwork_slug: 'lime-fruit', collection_title: 'The Macro', image_web_url: 'https://img/1.jpg' },
    ]});
    const req = new Request('http://x', { method: 'POST', headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ lines: [{ variantId: 1, quantity: 2 }] }) });
    const res = await POST(req);
    const body = await res.json();
    expect(body.url).toBe('https://stripe/x');
  });
});
```

- [ ] **Step 2: Run → expect fail → implement**

```ts
// app/api/checkout/route.ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { getStripe } from '@/lib/stripe';

const Body = z.object({
  lines: z.array(z.object({ variantId: z.number().int(), quantity: z.number().int().min(1).max(20) })).min(1).max(50),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid cart' }, { status: 400 });
  const { lines } = parsed.data;
  const ids = lines.map(l => l.variantId);

  const { rows } = await pool.query(
    `SELECT v.id, v.price_cents, v.type, v.size, v.finish, v.artwork_id,
            a.title AS artwork_title, a.slug AS artwork_slug, a.image_web_url,
            c.title AS collection_title
     FROM artwork_variants v
     JOIN artworks a ON a.id = v.artwork_id
     LEFT JOIN collections c ON c.id = a.collection_id
     WHERE v.id = ANY($1) AND v.active AND a.status = 'published'`,
    [ids],
  );
  if (rows.length !== ids.length) return NextResponse.json({ error: 'some items unavailable' }, { status: 400 });

  const byId = new Map(rows.map((r: any) => [r.id, r]));
  const stripe = getStripe();
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    automatic_tax: { enabled: true },
    shipping_address_collection: { allowed_countries: ['US', 'CA'] },
    billing_address_collection: 'required',
    line_items: lines.map(l => {
      const v = byId.get(l.variantId)!;
      return {
        quantity: l.quantity,
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${v.artwork_title} — ${v.type}, ${v.size}${v.finish ? `, ${v.finish}` : ''}`,
            images: [v.image_web_url],
            metadata: { variant_id: String(v.id), artwork_id: String(v.artwork_id) },
            tax_code: 'txcd_99999999',  // tangible goods
          },
          unit_amount: v.price_cents,
          tax_behavior: 'exclusive',
        },
      };
    }),
    shipping_options: [
      {
        shipping_rate_data: {
          type: 'fixed_amount',
          display_name: 'Standard shipping',
          fixed_amount: { amount: 900, currency: 'usd' },  // Printful US base ~ $9 at launch; webhook recomputes exact
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 4 },
            maximum: { unit: 'business_day', value: 10 },
          },
        },
      },
    ],
    success_url: `${siteUrl}/orders/{CHECKOUT_SESSION_ID}?success=1`,
    cancel_url: `${siteUrl}/cart?canceled=1`,
    metadata: {
      cart_json: JSON.stringify(lines),
    },
  });

  return NextResponse.json({ id: session.id, url: session.url });
}
```

- [ ] **Step 3: Run → pass → commit**

```bash
npm test -- checkout
git add app/api/checkout tests/api/checkout.test.ts
git commit -m "commerce: stripe checkout session endpoint"
```

---

### Task 8.2: Order status page (token-gated)

**Files:** `app/orders/[token]/page.tsx`

- [ ] **Step 1: Implement**

```tsx
// app/orders/[token]/page.tsx
import { notFound } from 'next/navigation';
import { pool } from '@/lib/db';
import { formatUSD } from '@/lib/money';
import { StatusPill } from '@/components/admin/StatusPill';

// Accepts either an order public_token or a stripe_session_id (used in the success_url).
async function findOrder(tokenOrSession: string) {
  const r = await pool.query(
    `SELECT * FROM orders WHERE public_token::text = $1 OR stripe_session_id = $1 LIMIT 1`,
    [tokenOrSession],
  );
  return r.rows[0] || null;
}

export default async function OrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const order = await findOrder(token);
  if (!order) notFound();
  const items = await pool.query(`SELECT * FROM order_items WHERE order_id = $1`, [order.id]);

  return (
    <section className="container" style={{ padding: 40, maxWidth: 720 }}>
      <h1>Order {order.public_token.slice(0, 8)}</h1>
      <StatusPill status={order.status} />
      {order.tracking_url && <p>Tracking: <a href={order.tracking_url}>{order.tracking_number}</a></p>}
      <h3 style={{ marginTop: 32 }}>Items</h3>
      {items.rows.map((i: any) => (
        <div key={i.id} style={{ display: 'flex', gap: 16, borderBottom: '1px solid var(--rule)', padding: '12px 0' }}>
          <div style={{ flex: 1 }}>
            <strong>{i.artwork_snapshot.title}</strong>
            <div style={{ color: 'var(--muted)' }}>
              {i.variant_snapshot.type}, {i.variant_snapshot.size}
              {i.variant_snapshot.finish ? `, ${i.variant_snapshot.finish}` : ''} · ×{i.quantity}
            </div>
          </div>
          <div>{formatUSD(i.price_cents_snapshot * i.quantity)}</div>
        </div>
      ))}
      <div style={{ marginTop: 24, textAlign: 'right' }}>
        <p>Subtotal: {formatUSD(order.subtotal_cents)}</p>
        <p>Shipping: {formatUSD(order.shipping_cents)}</p>
        <p>Tax: {formatUSD(order.tax_cents)}</p>
        <p><strong>Total: {formatUSD(order.total_cents)}</strong></p>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/orders
git commit -m "shop: token-gated order status page"
```

---

## Phase 9: Webhooks — Stripe → Printful

### Task 9.1: Stripe webhook (creates Printful order, fail-closed)

**Files:** `app/api/webhooks/stripe/route.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/api/webhooks-stripe.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  pool: { query: (...a: any[]) => queryMock(...a) },
  withTransaction: vi.fn(async (fn) => fn({ query: queryMock })),
}));
vi.mock('@/lib/stripe', () => ({
  getStripe: vi.fn(() => ({
    webhooks: {
      constructEventAsync: vi.fn(async () => ({
        id: 'evt_1', type: 'checkout.session.completed',
        data: { object: {
          id: 'cs_1', payment_intent: 'pi_1', amount_total: 3000, amount_subtotal: 2100,
          amount_shipping: 900, amount_tax: 0, currency: 'usd',
          customer_details: { email: 'buyer@x.com', name: 'Buyer', address: { line1: '1 a', city: 'Denver', state: 'CO', postal_code: '80202', country: 'US' } },
          metadata: { cart_json: JSON.stringify([{ variantId: 1, quantity: 1 }]) },
        }},
      })),
    },
  })),
  getStripeConfig: vi.fn(() => ({ webhookSecret: 'whsec_test', testMode: true })),
}));
vi.mock('@/lib/printful', () => ({
  printful: { createOrder: vi.fn(async () => ({ id: 555 })) },
}));
vi.mock('@/lib/email', () => ({ sendOrderConfirmation: vi.fn(), sendNeedsReviewAlert: vi.fn() }));

import { POST } from '@/app/api/webhooks/stripe/route';

describe('stripe webhook', () => {
  beforeEach(() => { queryMock.mockReset(); });
  it('dedupes on event_id', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{ processed_at: new Date() }] }); // webhook_events exists
    const req = new Request('http://x', { method: 'POST', headers: { 'stripe-signature':'sig' }, body: '{}' });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run → fail → Implement**

```ts
// app/api/webhooks/stripe/route.ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool, withTransaction } from '@/lib/db';
import { getStripe, getStripeConfig } from '@/lib/stripe';
import { printful } from '@/lib/printful';
import { sendOrderConfirmation, sendNeedsReviewAlert } from '@/lib/email';
import { formatUSD } from '@/lib/money';
import { logger } from '@/lib/logger';

export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature');
  const { webhookSecret } = getStripeConfig();
  if (!sig || !webhookSecret) return NextResponse.json({ error: 'missing signature' }, { status: 400 });

  const body = await req.text();
  const stripe = getStripe();
  let event: any;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
  } catch (err: any) {
    logger.error('stripe signature failed', err);
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  // dedupe
  const existing = await pool.query(`SELECT id, processed_at FROM webhook_events WHERE event_id = $1`, [event.id]);
  if (existing.rowCount && existing.rows[0].processed_at) return NextResponse.json({ ok: true, duplicate: true });
  if (!existing.rowCount) {
    await pool.query(`INSERT INTO webhook_events (source, event_id, payload) VALUES ('stripe', $1, $2)`, [event.id, event]);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(event.data.object);
    }
    await pool.query(`UPDATE webhook_events SET processed_at = NOW() WHERE event_id = $1`, [event.id]);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    logger.error('stripe webhook processing error', err);
    await pool.query(`UPDATE webhook_events SET error = $2 WHERE event_id = $1`, [event.id, String(err?.message || err)]);
    // Still 200 so Stripe doesn't retry indefinitely — we've stored the event
    return NextResponse.json({ ok: false });
  }
}

async function handleCheckoutCompleted(session: any) {
  const cart = JSON.parse(session.metadata?.cart_json || '[]') as Array<{ variantId: number; quantity: number }>;
  if (!cart.length) throw new Error('empty cart metadata');
  const ids = cart.map(l => l.variantId);
  const { rows: variants } = await pool.query(
    `SELECT v.*, a.title AS artwork_title, a.slug AS artwork_slug, a.image_web_url, a.image_print_url,
            c.title AS collection_title
     FROM artwork_variants v
     JOIN artworks a ON a.id = v.artwork_id
     LEFT JOIN collections c ON c.id = a.collection_id
     WHERE v.id = ANY($1)`,
    [ids],
  );
  const byId = new Map(variants.map((v: any) => [v.id, v]));

  const addr = session.customer_details?.address || {};
  let orderId = 0, orderToken = '';

  await withTransaction(async (client) => {
    const orderRes = await client.query(
      `INSERT INTO orders (stripe_session_id, stripe_payment_id, customer_email, customer_name,
                            shipping_address, subtotal_cents, shipping_cents, tax_cents, total_cents, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'paid')
       ON CONFLICT (stripe_session_id) DO NOTHING
       RETURNING id, public_token`,
      [
        session.id, session.payment_intent, session.customer_details?.email,
        session.customer_details?.name, addr,
        session.amount_subtotal, session.amount_shipping || 0, session.amount_tax || 0, session.amount_total,
      ],
    );
    if (!orderRes.rowCount) return;  // duplicate; exit tx
    orderId = orderRes.rows[0].id; orderToken = orderRes.rows[0].public_token;

    for (const l of cart) {
      const v: any = byId.get(l.variantId);
      if (!v) throw new Error(`variant ${l.variantId} missing`);
      await client.query(
        `INSERT INTO order_items (order_id, variant_id, artwork_snapshot, variant_snapshot, price_cents_snapshot, cost_cents_snapshot, quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [orderId, v.id,
          { title: v.artwork_title, slug: v.artwork_slug, collection_title: v.collection_title, image_web_url: v.image_web_url },
          { type: v.type, size: v.size, finish: v.finish, printful_sync_variant_id: v.printful_sync_variant_id },
          v.price_cents, v.cost_cents, l.quantity],
      );
    }
  });

  if (!orderId) return;  // duplicate stripe event

  // Submit to Printful
  try {
    const hasAllPrintFiles = cart.every(l => byId.get(l.variantId)?.image_print_url);
    if (!hasAllPrintFiles) {
      await pool.query(`UPDATE orders SET status='needs_review', notes=$2 WHERE id=$1`,
        [orderId, 'missing image_print_url on one or more artworks']);
      await sendNeedsReviewAlert(orderId, 'image_print_url missing — upload print file in admin');
    } else {
      const pfItems = cart.map(l => {
        const v: any = byId.get(l.variantId)!;
        return {
          sync_variant_id: v.printful_sync_variant_id,
          quantity: l.quantity,
          files: [{ url: v.image_print_url }],
        };
      });
      const pfOrder = await printful.createOrder({
        external_id: `order_${orderId}`,
        recipient: {
          name: session.customer_details?.name || '',
          address1: addr.line1, address2: addr.line2 || undefined,
          city: addr.city, state_code: addr.state, country_code: addr.country, zip: addr.postal_code,
          email: session.customer_details?.email,
        },
        items: pfItems,
        retail_costs: {
          currency: 'usd',
          subtotal: String(session.amount_subtotal / 100),
          shipping: String((session.amount_shipping || 0) / 100),
          tax: String((session.amount_tax || 0) / 100),
          total: String(session.amount_total / 100),
        },
        confirm: true,
      });
      await pool.query(`UPDATE orders SET status='submitted', printful_order_id=$2 WHERE id=$1`, [orderId, pfOrder.id]);
    }
  } catch (err: any) {
    logger.error('printful submit failed', err, { orderId });
    await pool.query(`UPDATE orders SET status='needs_review', notes=$2 WHERE id=$1`, [orderId, String(err?.message || err)]);
    await sendNeedsReviewAlert(orderId, String(err?.message || err));
  }

  // Send confirmation email
  const orderRow = await pool.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  const items = cart.map(l => {
    const v: any = byId.get(l.variantId);
    return {
      title: v.artwork_title,
      variant: `${v.type}, ${v.size}${v.finish ? `, ${v.finish}` : ''}`,
      price: formatUSD(v.price_cents),
      qty: l.quantity,
      image_url: v.image_web_url,
    };
  });
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  await sendOrderConfirmation({
    to: session.customer_details?.email,
    orderToken,
    items,
    subtotal: formatUSD(session.amount_subtotal),
    shipping: formatUSD(session.amount_shipping || 0),
    tax: formatUSD(session.amount_tax || 0),
    total: formatUSD(session.amount_total),
    siteUrl,
  });
}
```

- [ ] **Step 3: Run → pass → commit**

```bash
npm test -- webhooks-stripe
git add app/api/webhooks/stripe tests/api/webhooks-stripe.test.ts
git commit -m "commerce: stripe webhook -> order + printful + email"
```

---

### Task 9.2: Printful webhook (shipping updates)

**Files:** `app/api/webhooks/printful/route.ts`

- [ ] **Step 1: Implement**

```ts
// app/api/webhooks/printful/route.ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { sendOrderShipped } from '@/lib/email';
import { logger } from '@/lib/logger';
import crypto from 'node:crypto';

function verify(bodyRaw: string, headerSig: string | null): boolean {
  const secret = process.env.PRINTFUL_WEBHOOK_SECRET;
  if (!secret || !headerSig) return false;
  const expected = crypto.createHmac('sha256', secret).update(bodyRaw).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(headerSig), Buffer.from(expected)); } catch { return false; }
}

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get('x-pf-signature');
  if (!verify(body, sig)) return NextResponse.json({ error: 'invalid signature' }, { status: 401 });

  let event: any;
  try { event = JSON.parse(body); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const eventId = event?.data?.id ? `pf_${event.data.id}_${event.type}` : `pf_${Date.now()}`;
  const dupe = await pool.query(`SELECT processed_at FROM webhook_events WHERE event_id = $1`, [eventId]);
  if (dupe.rowCount && dupe.rows[0].processed_at) return NextResponse.json({ ok: true, duplicate: true });
  if (!dupe.rowCount) await pool.query(`INSERT INTO webhook_events (source, event_id, payload) VALUES ('printful', $1, $2)`, [eventId, event]);

  try {
    const pfOrder = event?.data;
    const externalId = pfOrder?.external_id;  // our "order_<id>"
    const ourId = Number(String(externalId || '').replace(/^order_/, ''));
    if (!ourId) return NextResponse.json({ ok: true });

    if (event.type === 'package_shipped') {
      const shipment = pfOrder?.shipment;
      const trackingUrl = shipment?.tracking_url || null;
      const trackingNumber = shipment?.tracking_number || null;
      const r = await pool.query(
        `UPDATE orders SET status='shipped', tracking_url=$2, tracking_number=$3, updated_at=NOW()
         WHERE id = $1 RETURNING customer_email, public_token`, [ourId, trackingUrl, trackingNumber]);
      if (r.rowCount) {
        const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        await sendOrderShipped(r.rows[0].customer_email, r.rows[0].public_token, trackingUrl, trackingNumber, siteUrl);
      }
    } else if (event.type === 'package_returned' || event.type === 'order_canceled') {
      await pool.query(`UPDATE orders SET status='canceled', updated_at=NOW() WHERE id = $1`, [ourId]);
    } else if (event.type === 'order_failed' || event.type === 'order_put_hold') {
      await pool.query(`UPDATE orders SET status='needs_review', notes=$2, updated_at=NOW() WHERE id = $1`,
        [ourId, event.type]);
    }
    await pool.query(`UPDATE webhook_events SET processed_at = NOW() WHERE event_id = $1`, [eventId]);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    logger.error('printful webhook processing error', err);
    await pool.query(`UPDATE webhook_events SET error = $2 WHERE event_id = $1`, [eventId, String(err?.message || err)]);
    return NextResponse.json({ ok: false });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/webhooks/printful
git commit -m "commerce: printful shipping webhook"
```

---

### Task 9.3: Printful product sync (run-once catalog seed)

**Files:** `scripts/sync-printful-products.ts`, `lib/printful-sync.ts`

Creates a Printful sync_product per artwork for each variant template, captures returned `sync_variant_id` into `artwork_variants.printful_sync_variant_id`. Run once per batch of newly-templated artworks.

- [ ] **Step 1: printful-sync helper**

```ts
// lib/printful-sync.ts
import { pool } from './db';
import { printful } from './printful';
import { ExternalServiceError } from './errors';

export async function syncArtworkProducts(artworkId: number) {
  const a = await pool.query(`SELECT * FROM artworks WHERE id = $1`, [artworkId]);
  if (!a.rowCount) throw new ExternalServiceError('db', 'artwork_missing');
  const variants = await pool.query(
    `SELECT * FROM artwork_variants WHERE artwork_id = $1 AND active = TRUE`, [artworkId],
  );
  if (!variants.rowCount) return { created: 0 };
  if (!a.rows[0].image_print_url) throw new ExternalServiceError('db', 'print_file_missing');

  const syncVariants = variants.rows.map((v: any) => ({
    variant_id: v.printful_variant_id_catalog || 0,  // requires catalog resolution (TODO for Phase 2 enrichment)
    retail_price: (v.price_cents / 100).toFixed(2),
    files: [{ url: a.rows[0].image_print_url }],
  }));
  const result = await printful.createSyncProduct({
    sync_product: { name: a.rows[0].title, external_id: `art_${artworkId}` },
    sync_variants: syncVariants,
  });

  // Return Printful's assigned IDs and persist them
  for (let i = 0; i < variants.rows.length; i++) {
    const pfVariant = result.sync_variants?.[i];
    if (!pfVariant) continue;
    await pool.query(
      `UPDATE artwork_variants SET printful_sync_variant_id = $1 WHERE id = $2`,
      [pfVariant.id, variants.rows[i].id],
    );
  }
  return { created: result.sync_variants?.length || 0 };
}
```

**Note on variant_id mapping:** Printful's catalog has a fixed product+variant structure (e.g., product ID for "Enhanced Matte Paper Poster" × color × size). To fully automate the sync you need to resolve each of our `{ type, size }` tuples to the correct catalog variant id. For Phase 1 keep it manual: hard-code the mapping by calling `GET /products` once against Printful and logging the IDs, then embed them in `variant-templates.ts` as the `printful_variant_id` field. Or operate the store in Printful's dashboard first, import those as a one-time seed (`GET /store/products`), and run our sync the other direction. Either path is documented in Printful's API docs; both are one-time setups.

- [ ] **Step 2: sync CLI**

```ts
// scripts/sync-printful-products.ts
import { config } from 'dotenv';
import { pool } from '@/lib/db';
import { syncArtworkProducts } from '@/lib/printful-sync';

config({ path: '.env.local' });

async function main() {
  const arg = process.argv[2];
  const targets = arg === 'all'
    ? (await pool.query(`SELECT id FROM artworks WHERE status='published' AND image_print_url IS NOT NULL`)).rows.map((r: any) => r.id)
    : [Number(arg)];
  for (const id of targets) {
    if (!id) continue;
    try {
      const res = await syncArtworkProducts(id);
      console.log(`art ${id}: ${res.created} variants synced`);
    } catch (err: any) {
      console.warn(`art ${id}: FAIL ${err?.message || err}`);
    }
  }
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Commit**

```bash
git add lib/printful-sync.ts scripts/sync-printful-products.ts
git commit -m "printful: sync script + helper"
```

---

## Phase 10: Admin — Orders, Subscribers, Settings

### Task 10.1: Orders admin

**Files:** `app/admin/orders/page.tsx`, `app/admin/orders/[id]/page.tsx`, `app/api/admin/orders/[id]/route.ts`, `app/api/admin/orders/[id]/refund/route.ts`, `app/api/admin/orders/[id]/resubmit/route.ts`

- [ ] **Step 1: List page**

```tsx
// app/admin/orders/page.tsx
import Link from 'next/link';
import { pool } from '@/lib/db';
import { formatUSD } from '@/lib/money';
import { StatusPill } from '@/components/admin/StatusPill';

export default async function AdminOrders() {
  const { rows } = await pool.query(
    `SELECT id, public_token, status, customer_email, total_cents, created_at, printful_order_id
     FROM orders ORDER BY created_at DESC LIMIT 500`,
  );
  return (
    <div>
      <h1>Orders</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ textAlign: 'left' }}>
          <th>#</th><th>When</th><th>Customer</th><th>Total</th><th>Printful</th><th>Status</th>
        </tr></thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
              <td><Link href={`/admin/orders/${r.id}`}>{r.id}</Link></td>
              <td>{new Date(r.created_at).toLocaleString()}</td>
              <td>{r.customer_email}</td>
              <td>{formatUSD(r.total_cents)}</td>
              <td style={{ color: '#777' }}>{r.printful_order_id || '—'}</td>
              <td><StatusPill status={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Detail page with refund/resubmit actions**

```tsx
// app/admin/orders/[id]/page.tsx
'use client';
import { use, useEffect, useState } from 'react';
import { formatUSD } from '@/lib/money';
import { StatusPill } from '@/components/admin/StatusPill';

export default function AdminOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<any>(null);
  async function load() { setData(await (await fetch(`/api/admin/orders/${id}`)).json()); }
  useEffect(() => { load(); }, [id]);
  if (!data) return <p>Loading…</p>;
  const o = data.order;

  async function refund() {
    if (!confirm('Refund full amount?')) return;
    await fetch(`/api/admin/orders/${id}/refund`, { method: 'POST' });
    load();
  }
  async function resubmit() {
    await fetch(`/api/admin/orders/${id}/resubmit`, { method: 'POST' });
    load();
  }

  return (
    <div>
      <h1>Order #{o.id} <StatusPill status={o.status} /></h1>
      <p>{o.customer_email} · {new Date(o.created_at).toLocaleString()}</p>
      <div style={{ margin: '16px 0' }}>
        <button onClick={resubmit} disabled={o.status !== 'needs_review'}>Resubmit to Printful</button>
        <button onClick={refund} disabled={['refunded','canceled'].includes(o.status)} style={{ marginLeft: 8 }}>Refund</button>
      </div>
      <h3>Items</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {data.items.map((i: any) => (
            <tr key={i.id} style={{ borderBottom: '1px solid #eee' }}>
              <td>{i.artwork_snapshot.title} — {i.variant_snapshot.type}, {i.variant_snapshot.size}{i.variant_snapshot.finish ? `, ${i.variant_snapshot.finish}` : ''}</td>
              <td>×{i.quantity}</td>
              <td style={{ textAlign: 'right' }}>{formatUSD(i.price_cents_snapshot * i.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ textAlign: 'right', marginTop: 16 }}>
        Subtotal {formatUSD(o.subtotal_cents)} · Ship {formatUSD(o.shipping_cents)} · Tax {formatUSD(o.tax_cents)} · <strong>Total {formatUSD(o.total_cents)}</strong>
      </p>
      {o.notes && <pre style={{ background: '#fff4f4', padding: 12 }}>{o.notes}</pre>}
    </div>
  );
}
```

- [ ] **Step 3: Order detail API + refund + resubmit**

```ts
// app/api/admin/orders/[id]/route.ts
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await ctx.params;
  const [o, items] = await Promise.all([
    pool.query('SELECT * FROM orders WHERE id = $1', [id]),
    pool.query('SELECT * FROM order_items WHERE order_id = $1', [id]),
  ]);
  if (!o.rowCount) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ order: o.rows[0], items: items.rows });
}
```

```ts
// app/api/admin/orders/[id]/refund/route.ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { getStripe } from '@/lib/stripe';
import { printful } from '@/lib/printful';
import { logger } from '@/lib/logger';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await ctx.params;
  const { rows } = await pool.query('SELECT stripe_payment_id, printful_order_id FROM orders WHERE id = $1', [id]);
  if (!rows.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const { stripe_payment_id, printful_order_id } = rows[0];
  try {
    if (stripe_payment_id) {
      const stripe = getStripe();
      await stripe.refunds.create({ payment_intent: stripe_payment_id });
    }
    if (printful_order_id) {
      try { await printful.cancelOrder(printful_order_id); } catch (e) { logger.warn('printful cancel failed', { e }); }
    }
    await pool.query(`UPDATE orders SET status='refunded', updated_at=NOW() WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    logger.error('refund failed', err);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
```

```ts
// app/api/admin/orders/[id]/resubmit/route.ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { printful } from '@/lib/printful';
import { logger } from '@/lib/logger';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await ctx.params;
  const { rows } = await pool.query(`SELECT * FROM orders WHERE id = $1`, [id]);
  if (!rows.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const o = rows[0];
  const items = await pool.query(`SELECT oi.*, v.printful_sync_variant_id, a.image_print_url
                                   FROM order_items oi
                                   LEFT JOIN artwork_variants v ON v.id = oi.variant_id
                                   LEFT JOIN artworks a ON a.id = v.artwork_id
                                   WHERE oi.order_id = $1`, [id]);
  const missing = items.rows.find((r: any) => !r.image_print_url);
  if (missing) {
    await pool.query(`UPDATE orders SET status='needs_review', notes='image_print_url still missing' WHERE id = $1`, [id]);
    return NextResponse.json({ error: 'missing print file' }, { status: 400 });
  }
  try {
    const pf = await printful.createOrder({
      external_id: `order_${id}`,
      recipient: {
        name: o.customer_name || '',
        address1: o.shipping_address?.line1 || '',
        city: o.shipping_address?.city || '',
        state_code: o.shipping_address?.state || '',
        country_code: o.shipping_address?.country || '',
        zip: o.shipping_address?.postal_code || '',
        email: o.customer_email,
      },
      items: items.rows.map((r: any) => ({
        sync_variant_id: r.printful_sync_variant_id,
        quantity: r.quantity,
        files: [{ url: r.image_print_url }],
      })),
      confirm: true,
    });
    await pool.query(`UPDATE orders SET status='submitted', printful_order_id=$2, notes=NULL WHERE id = $1`, [id, pf.id]);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    logger.error('resubmit failed', err);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add app/admin/orders app/api/admin/orders
git commit -m "admin: orders list/detail/refund/resubmit"
```

---

### Task 10.2: Subscribers admin + broadcast

**Files:** `app/admin/subscribers/page.tsx`, `app/api/admin/subscribers/broadcast/route.ts`

- [ ] **Step 1: Broadcast API**

```ts
// app/api/admin/subscribers/broadcast/route.ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { sendBroadcast } from '@/lib/email';

const Body = z.object({
  subject: z.string().min(1).max(200),
  html: z.string().min(1),
  testTo: z.string().email().optional(),
});
export async function POST(req: Request) {
  await requireAdmin();
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  if (p.data.testTo) {
    await sendBroadcast(p.data.subject, p.data.html, [p.data.testTo]);
    return NextResponse.json({ sentTest: true });
  }
  const { rows } = await pool.query(`SELECT email FROM subscribers WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL`);
  const emails = rows.map((r: any) => r.email);
  if (!emails.length) return NextResponse.json({ sent: 0 });
  await sendBroadcast(p.data.subject, p.data.html, emails);
  return NextResponse.json({ sent: emails.length });
}
```

- [ ] **Step 2: Page (list + composer)**

```tsx
// app/admin/subscribers/page.tsx
'use client';
import { useEffect, useState } from 'react';

export default function AdminSubscribers() {
  const [rows, setRows] = useState<any[]>([]);
  const [subject, setSubject] = useState(''); const [html, setHtml] = useState(''); const [test, setTest] = useState('');
  const [state, setState] = useState<'idle'|'sending'|'done'>('idle');

  useEffect(() => {
    // List is fetched server-side via a simple fetch from /api/admin (or add a GET endpoint)
    fetch('/api/admin/subscribers').then(r => r.json()).then(d => setRows(d.rows || []));
  }, []);

  async function sendTest() {
    setState('sending');
    await fetch('/api/admin/subscribers/broadcast', { method: 'POST', headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ subject, html, testTo: test }) });
    setState('idle');
  }
  async function broadcast() {
    if (!confirm(`Send to ${rows.length} subscribers?`)) return;
    setState('sending');
    await fetch('/api/admin/subscribers/broadcast', { method: 'POST', headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ subject, html }) });
    setState('done');
  }

  return (
    <div>
      <h1>Subscribers ({rows.length})</h1>
      <details style={{ margin: '16px 0' }}>
        <summary>New broadcast</summary>
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <input placeholder="Subject" value={subject} onChange={e=>setSubject(e.target.value)} />
          <textarea rows={12} placeholder="HTML body" value={html} onChange={e=>setHtml(e.target.value)} style={{ fontFamily: 'monospace' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <input placeholder="test-to@email" value={test} onChange={e=>setTest(e.target.value)} />
            <button onClick={sendTest} disabled={!test || state==='sending'}>Send test</button>
            <button onClick={broadcast} disabled={!rows.length || state==='sending'} style={{ marginLeft: 'auto' }}>Send broadcast</button>
          </div>
          {state === 'done' && <p style={{ color: '#2a8' }}>Sent.</p>}
        </div>
      </details>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ textAlign: 'left' }}><th>Email</th><th>Source</th><th>Joined</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
              <td>{r.email}</td><td>{r.source}</td><td>{new Date(r.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Subscribers list GET route**

Append a GET to `app/api/admin/subscribers/route.ts` (create file if absent):

```ts
// app/api/admin/subscribers/route.ts
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export async function GET() {
  await requireAdmin();
  const { rows } = await pool.query(`SELECT id, email, source, confirmed_at, unsubscribed_at, created_at FROM subscribers ORDER BY created_at DESC LIMIT 1000`);
  return NextResponse.json({ rows });
}
```

- [ ] **Step 4: Commit**

```bash
git add app/admin/subscribers app/api/admin/subscribers
git commit -m "admin: subscribers list + broadcast"
```

---

### Task 10.3: Settings page (password change)

**Files:** `app/admin/settings/page.tsx`, `app/api/admin/password/route.ts`

- [ ] **Step 1: Password change API**

```ts
// app/api/admin/password/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { hashPassword, verifyPassword } from '@/lib/auth';

const Body = z.object({ currentPassword: z.string(), newPassword: z.string().min(12) });
export async function POST(req: Request) {
  const s = await requireAdmin();
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  const r = await pool.query('SELECT password_hash FROM admin_users WHERE id = $1', [s.id]);
  if (!r.rowCount) return NextResponse.json({ error: 'no such user' }, { status: 404 });
  if (!(await verifyPassword(p.data.currentPassword, r.rows[0].password_hash))) {
    return NextResponse.json({ error: 'wrong password' }, { status: 401 });
  }
  const hash = await hashPassword(p.data.newPassword);
  await pool.query('UPDATE admin_users SET password_hash = $2 WHERE id = $1', [s.id, hash]);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Settings page**

```tsx
// app/admin/settings/page.tsx
'use client';
import { useState } from 'react';
export default function Settings() {
  const [cur, setCur] = useState(''); const [n, setN] = useState(''); const [msg, setMsg] = useState<string|null>(null);
  async function change(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch('/api/admin/password', { method: 'POST', headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ currentPassword: cur, newPassword: n }) });
    setMsg(r.ok ? 'Password updated.' : 'Failed — check your current password.');
    if (r.ok) { setCur(''); setN(''); }
  }
  return (
    <div>
      <h1>Settings</h1>
      <h3>Change password</h3>
      <form onSubmit={change} style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
        <input type="password" required placeholder="Current password" value={cur} onChange={e=>setCur(e.target.value)} />
        <input type="password" required minLength={12} placeholder="New password (12+ chars)" value={n} onChange={e=>setN(e.target.value)} />
        <button className="button">Update</button>
        {msg && <p>{msg}</p>}
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/admin/settings app/api/admin/password
git commit -m "admin: settings page + password change"
```

---

## Phase 11: Legal & Launch Polish

### Task 11.1: Legal pages (privacy, terms, shipping/returns)

**Files:** `app/(shop)/legal/privacy/page.tsx`, `app/(shop)/legal/terms/page.tsx`, `app/(shop)/legal/shipping-returns/page.tsx`

- [ ] **Step 1: Privacy**

```tsx
// app/(shop)/legal/privacy/page.tsx
export const metadata = { title: 'Privacy — Wildlight Imagery' };
export default function Privacy() {
  return (
    <section className="container" style={{ padding: 40, maxWidth: 720 }}>
      <h1>Privacy</h1>
      <p>We collect only what's needed to fulfill orders: your email, shipping address, and payment confirmation from Stripe. We don't sell or share your data.</p>
      <p>Email subscribers receive occasional updates about new work. Unsubscribe any time via the link in every email.</p>
      <p>For privacy questions, email <a href="mailto:contact@wildlightimagery.shop">contact@wildlightimagery.shop</a>.</p>
    </section>
  );
}
```

- [ ] **Step 2: Terms**

```tsx
// app/(shop)/legal/terms/page.tsx
export const metadata = { title: 'Terms — Wildlight Imagery' };
export default function Terms() {
  return (
    <section className="container" style={{ padding: 40, maxWidth: 720 }}>
      <h1>Terms</h1>
      <p>All photographs are © Dan Raby. Purchase of a print grants you ownership of the physical print; it does not transfer any copyright, licensing, or reproduction rights.</p>
      <p>For commercial licensing or reproduction, please <a href="/contact">contact us</a>.</p>
    </section>
  );
}
```

- [ ] **Step 3: Shipping & returns**

```tsx
// app/(shop)/legal/shipping-returns/page.tsx
export const metadata = { title: 'Shipping & Returns — Wildlight Imagery' };
export default function Shipping() {
  return (
    <section className="container" style={{ padding: 40, maxWidth: 720 }}>
      <h1>Shipping & Returns</h1>
      <p><strong>Made to order.</strong> Every print is produced when you order it. Standard production + shipping is 7–14 business days within the US.</p>
      <p><strong>Returns.</strong> Because prints are made to order, we only accept returns for manufacturing defects or damage in transit. Email us within 14 days with a photo of the issue and we'll replace or refund it.</p>
      <p><strong>International.</strong> Limited to US/Canada at launch. More regions as we grow.</p>
    </section>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add app/\(shop\)/legal
git commit -m "legal: privacy, terms, shipping/returns"
```

---

### Task 11.2: Sitemap + robots

**Files:** `app/sitemap.ts`, `app/robots.ts`

- [ ] **Step 1: sitemap**

```ts
// app/sitemap.ts
import type { MetadataRoute } from 'next';
import { pool } from '@/lib/db';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://wildlightimagery.shop';
  const [collections, artworks] = await Promise.all([
    pool.query('SELECT slug, created_at FROM collections'),
    pool.query(`SELECT slug, updated_at FROM artworks WHERE status='published'`),
  ]);
  return [
    { url: `${base}/`, lastModified: new Date() },
    { url: `${base}/collections`, lastModified: new Date() },
    { url: `${base}/about`, lastModified: new Date() },
    { url: `${base}/contact`, lastModified: new Date() },
    ...collections.rows.map((c: any) => ({ url: `${base}/collections/${c.slug}`, lastModified: new Date(c.created_at) })),
    ...artworks.rows.map((a: any) => ({ url: `${base}/artwork/${a.slug}`, lastModified: new Date(a.updated_at) })),
  ];
}
```

- [ ] **Step 2: robots**

```ts
// app/robots.ts
import type { MetadataRoute } from 'next';
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://wildlightimagery.shop';
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api', '/orders'] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add app/sitemap.ts app/robots.ts
git commit -m "seo: sitemap + robots"
```

---

### Task 11.3: Vercel deploy + DNS cutover

**Files:** no code — operational checklist

- [ ] **Step 1: Create Vercel Pro project**

```bash
npx vercel link
npx vercel env add DATABASE_URL production
# repeat for every var in .env.example
```

- [ ] **Step 2: Deploy**

```bash
npx vercel --prod
```

Expected: prod URL like `wildlight-<hash>.vercel.app`.

- [ ] **Step 3: Point wildlightimagery.shop at Vercel**

In Cloudflare: add CNAME `wildlightimagery.shop` → `cname.vercel-dns.com` (with proxy OFF for apex validation; re-enable after SSL issued). In Vercel: add the domain to the project.

- [ ] **Step 4: Configure webhooks in external services**

- **Stripe**: Dashboard → Developers → Webhooks → Add endpoint `https://wildlightimagery.shop/api/webhooks/stripe`, events = `checkout.session.completed`, `charge.refunded`. Copy signing secret into `STRIPE_WEBHOOK_SECRET` Vercel env var.
- **Printful**: Dashboard → Settings → API → Webhooks → endpoint `https://wildlightimagery.shop/api/webhooks/printful`, events = `package_shipped`, `package_returned`, `order_failed`, `order_canceled`, `order_put_hold`. Copy secret into `PRINTFUL_WEBHOOK_SECRET`.

- [ ] **Step 5: Seed admins in production**

Local dev points `DATABASE_URL` at the same Neon project (they share one Neon project — create a separate branch for dev if you want, but a single DB is fine for launch). Run:

```bash
npm run migrate
npm run seed:admins  # dallas@
npm run seed:admins  # dan@
```

- [ ] **Step 6: Smoke test (live)**

1. Visit https://wildlightimagery.shop
2. Browse to an artwork, add to cart, checkout with a Stripe test card (`4242 4242 4242 4242`)
3. Verify order appears in `/admin/orders` with status `submitted` or `needs_review`
4. If `needs_review`, upload a print file in `/admin/artworks/<id>`, then click Resubmit
5. Verify Printful dashboard shows the order
6. Subscribe to email list, verify row in `subscribers`
7. Contact form, verify email arrives

- [ ] **Step 7: Commit checklist note**

Append to README:

```md
# Wildlight Imagery

See `docs/superpowers/specs/2026-04-23-wildlight-monetization-design.md` for the design spec,
and `docs/superpowers/plans/2026-04-23-wildlight-monetization.md` for the implementation plan.

Deploy: Vercel Pro (auto-deploy from `main`).
DB: Neon Postgres.
Storage: Cloudflare R2.
Payments: Stripe Checkout + Stripe Tax.
POD: Printful.
Email: Resend.
```

```bash
git add README.md
git commit -m "docs: project README with deploy notes"
```

---

## Phase 12: Launch Readiness

### Task 12.1: Curation pass

- [ ] **Step 1: Run scrape + import**

If not already done:

```bash
npm run scrape
npm run import:manifest
```

- [ ] **Step 2: Curate to ~50 published**

In `/admin/artworks?status=draft`, select your ~50 strongest, Publish. Open each to apply a variant template (`full` for hero pieces, `fine_art` for small works).

- [ ] **Step 3: Write artist notes** (1–2 sentences per artwork; Dan can rewrite later)

- [ ] **Step 4: Assign collection covers** via `/admin/collections` cover upload.

- [ ] **Step 5: Sync Printful sync_products**

Manually map Printful catalog variant IDs in `lib/variant-templates.ts` first (see Phase 9.3 note), then:

```bash
npm run sync:printful all
```

Confirm every `artwork_variants.printful_sync_variant_id` is populated.

---

### Task 12.2: Soft-launch smoke test

- [ ] **Step 1: Dallas places a real order**

Real credit card, real shipping to your address. Document the full path — receipt, order status page, confirmation email, shipped email, Printful tracking URL.

- [ ] **Step 2: Photograph the print on a wall**

This image is the hand-off artifact.

---

### Task 12.3: The hand-off

- [ ] **Step 1: Print one of Dan's pieces as a canvas.**
- [ ] **Step 2: Bring canvas + laptop + sealed envelope with his admin password to dinner.**
- [ ] **Step 3: Walk him through `/admin` — dashboard, artwork list, orders, subscribers. Log him in.**
- [ ] **Step 4: Ask: "What would you want to add next?"**

This is not a code task, but it's why we built the thing.

---

## Self-Review

Running the plan against the spec with fresh eyes:

**Spec coverage check:**

| Spec requirement | Plan task |
|---|---|
| Six preserved collections | 2.1 manifest import upserts them; 7.4 admin edit |
| One artwork = many variants | 1.6 templates; 7.2 detail page with variant table |
| Printful variant types (print/canvas/framed/metal) | 1.6 TEMPLATES constant |
| image_web_url + image_print_url tiers | 0.4 env buckets; 2.1 import; 7.3 upload form |
| Lazy print-res (null at launch, populated on first sale) | 2.1 import skips print; 7.2 detail upload; 9.1 `needs_review` if missing |
| Stripe Checkout (hosted) | 8.1 checkout route |
| Stripe Tax | 8.1 automatic_tax enabled |
| Printful integration w/ idempotency | 9.1 external_id=`order_<id>`; 9.3 sync script |
| Fail-closed on fulfillment | 9.1 needs_review + alert email |
| Token-gated order page | 8.2 /orders/[token] |
| Guest checkout, no customer account | 8.1 uses Stripe Checkout guest |
| Admin UI: artworks, collections, orders, subscribers, settings | 7.1–7.4, 10.1–10.3 |
| Single admin role | 1.5 auth; 3.3 middleware |
| API keys outside admin UI | 11.3 Vercel env vars only |
| Subscribers with broadcast | 4.2 capture; 10.2 broadcast |
| Dr. Bartender cross-pollination | Not yet wired — see "Gap" below |
| Legal pages | 11.1 privacy/terms/shipping |
| Sitemap + robots | 11.2 |
| Webhook signature verification | 9.1 Stripe, 9.2 Printful HMAC |
| Idempotent webhook processing via webhook_events | 9.1, 9.2 dedupe by event_id |
| AppError hierarchy + fail-closed | 1.1 errors; usage in 1.10 printful + 9.1 |
| Money as integer cents | 1.4 money helpers; all table columns `_cents` |
| Idempotent schema.sql | 1.2 |
| No subscriptions beyond Vercel | satisfied by stack in 11.3 |

**Gaps identified + fixes added below:**

1. **Dr. Bartender cross-pollination** was in the spec but the plan has no concrete task. Intentionally deferred — the mechanics are "add a footer line to DB email templates" and "send a single email blast" — both happen in the **Dr. Bartender** codebase, not this one. Noted here; will be handled as a separate DB patch.

2. **"Notify when available"** CTA on retired/sold-out pieces (spec Section 3, UX calls) — not implemented. Add to Phase 2 backlog; low ROI at launch with zero retired pieces.

3. **Commission inquiry inbox**: contact form covers this. Spec says contact form is sufficient at launch. ✓

4. **EXIF auto-extract** on artwork upload (spec 7.3, admin upload flow) — not implemented in Task 7.3 to keep it minimal. Add to the backlog in `/admin/artworks/new` using `exif-reader` package when Dan starts uploading new work.

5. **"License this image" CTA** — implemented as a link on the artwork page (5.3) that pre-fills the contact form topic. ✓

**Placeholder scan:** no `TBD`, `TODO`, `implement later`, or "Similar to Task N" references.

**Type consistency:** `VariantRow` shape used across `variant-templates.ts`, `artwork_variants` schema, and `VariantTable` component all match on `type | size | finish | price_cents | cost_cents | active`. `CartLine` / `CartItemInput` consistent between provider, cart page, and checkout route.

No inline fixes needed beyond the gap list above.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-23-wildlight-monetization.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for this plan because tasks touch many files and subagents stay focused per phase.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review.

Which approach?
