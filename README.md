# Wildlight Imagery

Fine art photography storefront for Dan Raby. Next.js 16 + Postgres + Stripe + Printful on Vercel.

- **Spec:** [`docs/superpowers/specs/2026-04-23-wildlight-monetization-design.md`](docs/superpowers/specs/2026-04-23-wildlight-monetization-design.md)
- **Plan:** [`docs/superpowers/plans/2026-04-23-wildlight-monetization.md`](docs/superpowers/plans/2026-04-23-wildlight-monetization.md)

## Stack

| Concern | Service |
|---|---|
| Framework | Next.js 16 App Router · TypeScript · React 19 |
| Hosting | Vercel Pro |
| Database | Neon Postgres (raw SQL via `pg`) |
| Storage | Cloudflare R2 (public bucket for web images, private for print files) |
| Payments | Stripe Checkout Sessions + Stripe Tax |
| POD | Printful (v1 API) |
| Email | Resend (transactional + broadcasts) |
| Errors | Sentry |

## Local dev

```bash
cp .env.example .env.local    # fill in DATABASE_URL, R2_*, STRIPE_*, etc.
npm install
npm run migrate               # apply lib/schema.sql to the DB
npm run seed:admins           # create an admin user (run twice for dallas + dan)
npm run dev                   # localhost:3000
```

Scripts:

| Command | Purpose |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `start` | Production build + serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests |
| `npm run migrate` | Apply `lib/schema.sql` (idempotent) |
| `npm run seed:admins` | Add/update an admin user (interactive) |
| `npm run scrape` | Crawl wildlightimagery.com gallery images into `scraped/` |
| `npm run import:manifest` | Upload scraped images to R2 + seed draft artworks |
| `npm run sync:printful <id \| all>` | Create Printful sync_products for artwork(s) |

## Deploy

- Production auto-deploys from `main` on push to Vercel.
- Env vars are set in Vercel dashboard; see `.env.example` for the full list.
- Stripe webhook endpoint: `https://wildlightimagery.shop/api/webhooks/stripe` (events: `checkout.session.completed`, `charge.refunded`).
- Printful webhook endpoint: `https://wildlightimagery.shop/api/webhooks/printful` (events: `package_shipped`, `package_returned`, `order_failed`, `order_canceled`, `order_put_hold`).

## Architecture notes

- **Money** lives as integer cents everywhere; `lib/money.ts` is the single source of truth for formatting and rounding.
- **Webhooks** are signature-verified, idempotent-per-`event_id` via the `webhook_events` table, and fail-closed (any Printful error marks the order `needs_review` + alerts admins rather than silently dropping).
- **Admin UI** has a single role; API keys and env vars are NOT editable in the UI — rotate via Vercel dashboard.
- **Image tiers**: `image_web_url` (R2 public, 1600–2000px) for catalog display, `image_print_url` (R2 private, full resolution) for Printful fulfillment. The print URL is nullable — artworks can be published before a print file is ready, and orders that arrive for prints without files are held in `needs_review`.
