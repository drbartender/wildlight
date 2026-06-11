# Cutover runbook: `wildlightimagery.shop` → `wildlightimagery.com`

Taking the proof-of-concept store live on the real `.com`, **and** switching
on real payments. Written 2026-06-09 from the live DNS + code state.

This is two jobs at once:
1. **Move** the site from `.shop` to `.com` (replacing Dan's existing
   WordPress portfolio that lives on `.com` today).
2. **Go live** — switch Stripe from test mode to real money + real Printful
   fulfillment.

We do them as **separate, verifiable steps**: move the domain *first* (still
in Stripe test mode — zero risk), verify it, *then* flip on real sales.

---

## ⚠️ THE ONE RULE: do not touch Dan's email records

`wildlightimagery.com` already runs Dan's email on **ProtonMail**. DNS for the
domain is managed at **Name.com** (the registrar). When you edit DNS, change
**only the website records below**. Leave every record in this list **exactly
as it is** — deleting or editing any of them silently breaks Dan's email:

| Type  | Name                          | Value (keep as-is)                              |
|-------|-------------------------------|-------------------------------------------------|
| MX    | `@`                           | `mail.protonmail.ch` (priority 10)              |
| MX    | `@`                           | `mailsec.protonmail.ch` (priority 20)           |
| TXT   | `@`                           | `v=spf1 include:_spf.protonmail.ch ~all`        |
| TXT   | `@`                           | `protonmail-verification=54ef992cb100b1bc4677a57e0467a4e643726745` |
| TXT   | `_dmarc`                      | `v=DMARC1; p=quarantine`                         |
| CNAME | `protonmail._domainkey`       | `protonmail.domainkey.df4l2ganw7mpieew3o4cxfqtuw7exhvo…` |
| CNAME | `protonmail2._domainkey`      | `protonmail2.domainkey.df4l2ganw7mpieew3o4cxfqtuw7exh…`  |
| CNAME | `protonmail3._domainkey`      | `protonmail3.domainkey.df4l2ganw7mpieew3o4cxfqtuw7exh…`  |

After the cutover, **send a test email to and from `dan@wildlightimagery.com`**
to confirm it still works (Phase 4).

---

## What changes in DNS (the website records only)

Today the `.com` website records point at the WordPress host (`62.72.50.179`,
LiteSpeed). We repoint just these three to Vercel:

| Type  | Name     | Change from        | Change to (use the exact value Vercel shows) |
|-------|----------|--------------------|----------------------------------------------|
| A     | `@`      | `62.72.50.179`     | `216.198.79.1` (Vercel — same as `.shop` uses today) |
| CNAME | `www`    | → apex             | `cname.vercel-dns.com` |
| CNAME | `admin`  | *(new record)*     | `cname.vercel-dns.com` |

> When you add each domain in Vercel it prints the exact target to use — trust
> that over the table if they differ.

Images stay on `images.wildlightimagery.shop` (Cloudflare R2). No change — it
works regardless of the marketing domain.

---

## Phase 0 — code prep ✅ (done in this branch)

- Hardcoded `dan@wildlightimagery.shop` → `dan@wildlightimagery.com` (contact,
  services, privacy pages).
- App-URL fallbacks (`sitemap`, `robots`, `layout` metadata, studio-reminder
  cron) default to `.com` when the env var is unset.
- `scripts/r2-cors-setup.ts` now allows `admin.wildlightimagery.com`.
- Resend sender defaults moved to `.com`: `RESEND_FROM_EMAIL` →
  `contact@wildlightimagery.com` (transactional), `RESEND_BROADCAST_FROM` →
  `dan@wildlightimagery.com` (the newsletter "letter from Dan"). **Inert until
  `wildlightimagery.com` is verified as a Resend sending domain** (Phase 5) and
  the matching Vercel env vars are set — until then prod must keep the `.shop`
  env-var values so mail still sends.

> These are inert until you set the Vercel env vars and push, so nothing
> changes on the live `.shop` site before you're ready.

---

## Phase 1 — activate the money rails (no public impact; do this first, longest lead)

- [ ] **Stripe account activation.** dashboard.stripe.com → Activate account:
      business details, bank account for payouts, tax info. (Dan's to do — it's
      his identity/banking.) This can take a day; start early.
- [ ] **Stripe Tax** — confirm it's enabled in **live** mode (the checkout uses
      Stripe Tax). Add tax registrations as needed.
- [ ] **Printful billing** — a payment method (card) must be on file on the real
      Printful store, or live orders fail / go on hold. Confirm the connected
      store + `PRINTFUL_STORE_ID` is the real one.

## Phase 2 — wire `.com` into Vercel (still test mode; no public impact)

- [ ] **Add domains** in the Vercel project: `wildlightimagery.com`,
      `www.wildlightimagery.com`, `admin.wildlightimagery.com`. They'll show
      "Invalid Configuration" until DNS flips in Phase 3 — that's expected.
- [ ] **Set env vars** (Production) — see the table below.
- [ ] **Stripe TEST webhook → `.com`**: in Stripe (test mode) move/add the
      endpoint to `https://wildlightimagery.com/api/webhooks/stripe`
      (events `checkout.session.completed`, `charge.refunded`). Put its signing
      secret in `STRIPE_WEBHOOK_SECRET` (still a test `whsec_…` for now).
- [ ] **Printful webhook → `.com`**: re-register at
      `https://wildlightimagery.com/api/webhooks/printful?token=<PRINTFUL_WEBHOOK_SECRET>`
      (token unchanged), events `package_shipped`, `package_returned`,
      `order_failed`, `order_canceled`, `order_put_hold`.
- [ ] **Re-run R2 CORS** so the admin uploader works on the new admin host:
      `npx dotenv -e .env.local -- tsx scripts/r2-cors-setup.ts --apply`
- [ ] **Push the branch + deploy.**

### Env vars (Vercel → Production)

| Var | Set to | Note |
|-----|--------|------|
| `NEXT_PUBLIC_APP_URL` | `https://wildlightimagery.com` | |
| `APP_URL` | `https://wildlightimagery.com` | |
| `ADMIN_HOST` | `admin.wildlightimagery.com` | moves admin to the new subdomain |
| `STRIPE_SECRET_KEY` | *test key for now* (`sk_test_…`) | swap to `sk_live_…` in Phase 4 |
| `STRIPE_PUBLISHABLE_KEY` | *test key for now* (`pk_test_…`) | swap in Phase 4 |
| `STRIPE_WEBHOOK_SECRET` | *test endpoint `whsec_…`* | swap in Phase 4 |
| `STRIPE_TEST_MODE_UNTIL` | **blank** | must be empty so a live key actually goes live |
| `R2_PUBLIC_BASE_URL` | `https://images.wildlightimagery.shop` | **unchanged** |
| `RESEND_FROM_EMAIL` / `RESEND_BROADCAST_FROM` | keep `.shop` for now | code defaults are `.com` (`contact@` / `dan@`) but only send once Resend verifies `.com` — Phase 5 |

> How "live" is decided: the app reads `testMode` from the key prefix. While
> `STRIPE_SECRET_KEY` starts with `sk_test_`, Printful only **drafts** orders
> (never prints/ships) and alerts are silenced — so the whole `.com` site is
> safe to exercise before real money is on.

## Phase 3 — flip DNS (the public cutover; minutes of propagation)

- [ ] In **Name.com DNS**, change the three website records (A `@`, CNAME `www`,
      add CNAME `admin`) per the table above. **Touch nothing email-related.**
- [ ] In **Vercel**, wait for SSL to issue on all three `.com` domains, then set
      `wildlightimagery.com` as the **primary** domain and configure
      `wildlightimagery.shop` (apex + www) to **redirect** to it.
- [ ] Old WordPress host: **leave it running** for now as a fallback. DNS no
      longer points to it; don't cancel until Phase 5.

## Phase 4 — verify, then switch on real sales

Verify on `.com` **while still in test mode** (Stripe test card `4242 4242 4242 4242`):
- [ ] Homepage, shop, an artwork page, cart, checkout all load on
      `https://wildlightimagery.com`.
- [ ] A test checkout completes → order/confirmation page renders → confirmation
      email arrives.
- [ ] Admin reachable at `https://admin.wildlightimagery.com` and login works.
- [ ] **Email test:** send to + from `dan@wildlightimagery.com` — confirms
      ProtonMail survived the DNS change.
- [ ] `https://wildlightimagery.com/sitemap.xml` and `/robots.txt` show `.com`.

Then **go live**:
- [ ] Create the **LIVE** Stripe webhook at
      `https://wildlightimagery.com/api/webhooks/stripe` (same two events); copy
      its `whsec_…`.
- [ ] In Vercel set `STRIPE_SECRET_KEY=sk_live_…`, `STRIPE_PUBLISHABLE_KEY=pk_live_…`,
      `STRIPE_WEBHOOK_SECRET=<live whsec>`. Redeploy.
- [ ] **One real purchase** with a real card on `.com` → confirm: Stripe shows a
      live payment, Printful creates a **real** order (not a draft), confirmation
      email arrives. Then **refund** it in Stripe.
- [ ] Submit `wildlightimagery.com` + its sitemap to Google Search Console (the
      old WP site already uses Google Site Kit — add the new domain so indexing
      transfers; the `.shop`→`.com` redirects preserve link equity).

## Phase 5 — cleanup (days later, once confident)

- [ ] Decommission the old WordPress hosting (or just let it lapse — DNS no
      longer points there).
- [ ] Verify `wildlightimagery.com` as a Resend sending domain, then set the
      Vercel env vars `RESEND_FROM_EMAIL=contact@wildlightimagery.com` and
      `RESEND_BROADCAST_FROM=dan@wildlightimagery.com` (the code already defaults
      to these). Resend adds records on a `send.` subdomain — does **not**
      conflict with Proton's apex records. Until this is done, leave the Vercel
      vars on their verified `.shop` values so transactional + newsletter mail
      keeps sending.

---

## Rollback

If anything looks wrong after the DNS flip: in **Name.com DNS** set the apex `A`
back to `62.72.50.179` and `www` back to the apex — the WordPress site returns
within minutes. Email was never touched, so it's unaffected either way.
