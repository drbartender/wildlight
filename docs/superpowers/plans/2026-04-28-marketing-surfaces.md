# Marketing Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stub home with a real marketing home, add `/portfolio` (listing + collection detail) and `/services/portraits`, polish `/about`, update Nav + Footer per the prototype, and port the marketing CSS classes — turning `wildlightimagery.shop` from a shop-with-stub-front-door into a real artist-platform funnel.

**Architecture:** Marketing pages live under `app/(shop)/*` (the route group that already exists). Shared layout primitives (Nav, Footer, Wordmark, MoodSwitch, EmailCaptureStrip, PlateCard, ArtworkGrid) move from `components/shop/` to `components/site/`. CSS is appended to `app/globals.css`. No new schema, no new API routes, no new dependencies. The contact form is reused as-is.

**Tech Stack:** Next.js 16 App Router · TypeScript · React Server Components (default) · `app/globals.css` · existing print-room design tokens.

**Spec:** `docs/superpowers/specs/2026-04-28-marketing-surfaces-design.md`

**Design contract:** `C:/Users/dalla/Downloads/Wild Light Shop/` — marketing surfaces in `screens-marketing.jsx`, CSS in `styles-marketing.css`, shared UI in `ui.jsx`. Match the prototype's structure, class names, and copy unless the spec deviates explicitly.

---

## File Structure

**Created:**
- `components/site/Nav.tsx` — promoted from `components/shop/Nav.tsx`, 4-link version (Portfolio · Portraits · Studio · Shop)
- `components/site/Footer.tsx` — promoted from `components/shop/Footer.tsx`, new column structure
- `components/site/Wordmark.tsx` — promoted from `components/shop/Wordmark.tsx`, no shape change (already uses ApertureMark)
- `components/site/MoodSwitch.tsx` — promoted from `components/shop/MoodSwitch.tsx`, label "Ink" → "Black"
- `components/site/EmailCaptureStrip.tsx` — promoted, but replaces the inline email-only form with the prototype's `wl-news` shape (eyebrow + h3 + body + form + fineprint). The plumbing (`/api/subscribe` + `subscribers` table) is unchanged.
- `components/site/PlateCard.tsx` — promoted, adds `showPrice?: boolean` (default true) and `linkBase?: string` (default `/shop/artwork`)
- `components/site/ArtworkGrid.tsx` — promoted, passes the new props through to PlateCard
- `app/(shop)/portfolio/page.tsx` — `/portfolio` listing
- `app/(shop)/portfolio/[slug]/page.tsx` — `/portfolio/[slug]` collection detail
- `app/(shop)/services/portraits/page.tsx` — `/services/portraits`

**Modified:**
- `app/(shop)/page.tsx` — stub home replaced with the real MarketingHome
- `app/(shop)/about/page.tsx` — three tail additions (services callout, newsletter strip, refined CTAs)
- `app/(shop)/layout.tsx` — imports update from `components/shop/*` → `components/site/*` for moved components
- `app/sitemap.ts` — add `/portfolio`, `/portfolio/[slug]` per collection, `/services/portraits`
- `app/globals.css` — appends ~230 lines of marketing CSS (wl-news, wlmh-*, wlpf-*, wlsv-*, wlab-*)
- All shop pages that import the promoted components — import paths updated

**Deleted:**
- `components/shop/Nav.tsx`, `Footer.tsx`, `Wordmark.tsx`, `MoodSwitch.tsx`, `EmailCaptureStrip.tsx`, `PlateCard.tsx`, `ArtworkGrid.tsx` — moved to site/

**Stays in `components/shop/`:**
- `CartProvider.tsx`, `CartCountBadge.tsx`, `OrderCard.tsx`, `StatusBadge.tsx` — shop-specific.

---

## Task 1: Atomic component promotion (shop/ → site/) + import updates

This commit touches a lot of files at once because every page that imports the moved components needs its import path updated. The atomicity means `main` is always working.

**Files:**
- Move 7 files from `components/shop/` to `components/site/` (7 promotions)
- Update every import across `app/`, `components/`, and any references

- [ ] **Step 1: Create the site/ directory and `git mv` the seven shared components**

```bash
mkdir -p components/site
git mv components/shop/Wordmark.tsx       components/site/Wordmark.tsx
git mv components/shop/MoodSwitch.tsx     components/site/MoodSwitch.tsx
git mv components/shop/Nav.tsx            components/site/Nav.tsx
git mv components/shop/Footer.tsx         components/site/Footer.tsx
git mv components/shop/EmailCaptureStrip.tsx components/site/EmailCaptureStrip.tsx
git mv components/shop/PlateCard.tsx      components/site/PlateCard.tsx
git mv components/shop/ArtworkGrid.tsx    components/site/ArtworkGrid.tsx
```

- [ ] **Step 2: Find every import that needs updating**

Run:
```bash
git grep -nE "components/shop/(Wordmark|MoodSwitch|Nav|Footer|EmailCaptureStrip|PlateCard|ArtworkGrid)"
```

Expected output: a list of all files that need patching. Capture the file list — you'll edit each in Step 3.

- [ ] **Step 3: Replace `components/shop/<Name>` with `components/site/<Name>` in each file**

For each file in the grep output, change every occurrence:

- `from '@/components/shop/Wordmark'` → `from '@/components/site/Wordmark'`
- `from '@/components/shop/MoodSwitch'` → `from '@/components/site/MoodSwitch'`
- `from '@/components/shop/Nav'` → `from '@/components/site/Nav'`
- `from '@/components/shop/Footer'` → `from '@/components/site/Footer'`
- `from '@/components/shop/EmailCaptureStrip'` → `from '@/components/site/EmailCaptureStrip'`
- `from '@/components/shop/PlateCard'` → `from '@/components/site/PlateCard'`
- `from '@/components/shop/ArtworkGrid'` → `from '@/components/site/ArtworkGrid'`

Also handle relative imports inside the moved files themselves:
- In `components/site/ArtworkGrid.tsx`, the import `from './PlateCard'` continues to work (both are in `site/` now).
- In `components/site/Nav.tsx`, imports `from './Wordmark'` and `from './MoodSwitch'` and `from './CartCountBadge'` need adjusting:
  - `./Wordmark` → `./Wordmark` ✓ (still works)
  - `./MoodSwitch` → `./MoodSwitch` ✓
  - `./CartCountBadge` → `../shop/CartCountBadge` (CartCountBadge stays in shop/)
- In `components/site/Footer.tsx`, `from './Wordmark'` and `from './EmailCaptureStrip'` continue to work (both in site/).

- [ ] **Step 4: Verify the import grep is clean**

Run:
```bash
git grep -nE "components/shop/(Wordmark|MoodSwitch|Nav|Footer|EmailCaptureStrip|PlateCard|ArtworkGrid)"
```

Expected: no output. If matches remain, fix them.

- [ ] **Step 5: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 6: Verify tests still pass**

Run: `npm test`
Expected: all tests pass (no test imports these components, but verify).

- [ ] **Step 7: Commit**

```bash
git add components/ app/
git commit -m "refactor: promote shared components to components/site/

Wordmark, MoodSwitch, Nav, Footer, EmailCaptureStrip, PlateCard,
ArtworkGrid move from components/shop/ to components/site/. Shop-specific
components (CartProvider, CartCountBadge, OrderCard, StatusBadge) stay
in shop/.

All import paths updated across app/ and components/. No behavior change."
```

---

## Task 2: Update MoodSwitch label "Ink" → "Black"

Visible label only. The data attribute stays `[data-mood='ink']` so no CSS rules need updating. Surfaces as "Black" per the prototype.

**Files:**
- Modify: `components/site/MoodSwitch.tsx`

- [ ] **Step 1: Update the label string**

Find (around line 32-35):

```tsx
const options: { key: Mood; label: string }[] = [
  { key: 'bone', label: 'Bone' },
  { key: 'ink', label: 'Ink' },
];
```

Replace with:

```tsx
const options: { key: Mood; label: string }[] = [
  { key: 'bone', label: 'Bone' },
  { key: 'ink', label: 'Black' },
];
```

The `Mood` type and storage key stay `'ink'`. Only the user-facing label changes.

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add components/site/MoodSwitch.tsx
git commit -m "refactor: MoodSwitch label \"Ink\" → \"Black\"

User-facing label only; the data-mood attribute and storage value
stay 'ink' so no CSS rules change. Matches the design prototype's
two-state mood switcher."
```

---

## Task 3: Update PlateCard with `showPrice` + `linkBase` props

Needed by the marketing home and portfolio detail pages so prices can be hidden and links can route through `/shop/artwork/[slug]` (already the default) without coupling the component to a single context.

**Files:**
- Modify: `components/site/PlateCard.tsx`

- [ ] **Step 1: Add the two new props**

Find the existing `PlateCard` function and replace the entire file content with:

```tsx
import Image from 'next/image';
import Link from 'next/link';
import { plateNumber } from '@/lib/plate-number';

export interface PlateCardData {
  slug: string;
  title: string;
  image_web_url: string;
  year_shot?: number | null;
  location?: string | null;
  collection_title?: string | null;
  /** Minimum variant price in cents. Omit to hide the "from" line. */
  min_price_cents?: number | null;
}

export interface PlateCardProps {
  item: PlateCardData;
  /** Hide the price line on portfolio + marketing-home cards. Default true. */
  showPrice?: boolean;
  /**
   * Link target prefix. Defaults to `/shop/artwork` so cards anchor in the
   * shop's purchase flow. Pass an alternate base for portfolio-only contexts
   * if needed.
   */
  linkBase?: string;
}

export function PlateCard({
  item,
  showPrice = true,
  linkBase = '/shop/artwork',
}: PlateCardProps) {
  const plate = plateNumber(item.slug);
  const fromStr =
    showPrice && item.min_price_cents != null && item.min_price_cents > 0
      ? `$${Math.floor(item.min_price_cents / 100)}+`
      : null;

  const subParts = [item.collection_title, item.year_shot, item.location]
    .filter((v): v is string | number => v != null && v !== '')
    .map(String);

  return (
    <Link
      href={`${linkBase}/${item.slug}`}
      className="wl-plate-card"
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <div className="wl-plate-frame">
        <span className="wl-plate-no">{plate}</span>
        <div className="wl-plate-img">
          <Image
            src={item.image_web_url}
            alt={item.title}
            fill
            sizes="(max-width: 480px) 100vw, (max-width: 900px) 50vw, 25vw"
            style={{ objectFit: 'cover' }}
          />
        </div>
      </div>
      <div className="wl-plate-meta">
        <div className="wl-plate-title">{item.title}</div>
        {fromStr && <div className="wl-plate-price">{fromStr}</div>}
        {subParts.length > 0 && (
          <div className="wl-plate-sub">{subParts.join(' · ')}</div>
        )}
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Update ArtworkGrid to pass props through**

Replace `components/site/ArtworkGrid.tsx` entirely:

```tsx
import { PlateCard, type PlateCardData } from './PlateCard';

export type GridItem = PlateCardData;

export interface ArtworkGridProps {
  items: GridItem[];
  showPrice?: boolean;
  linkBase?: string;
  /** Optional override for the wrapping element's class. */
  className?: string;
}

export function ArtworkGrid({
  items,
  showPrice = true,
  linkBase = '/shop/artwork',
  className = 'wl-plates',
}: ArtworkGridProps) {
  return (
    <div className={className}>
      {items.map((i) => (
        <PlateCard
          key={i.slug}
          item={i}
          showPrice={showPrice}
          linkBase={linkBase}
        />
      ))}
    </div>
  );
}
```

The `className` prop lets the marketing home pass `wl-plates wlmh-plates-6` (the prototype's 3-column grid override) without duplicating markup.

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0. Existing callers pass only `items` — new props default safely.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all 57 pass.

- [ ] **Step 5: Commit**

```bash
git add components/site/PlateCard.tsx components/site/ArtworkGrid.tsx
git commit -m "refactor: PlateCard + ArtworkGrid accept showPrice + linkBase props

Adds optional showPrice (default true) and linkBase (default
/shop/artwork) so marketing-home and portfolio-detail pages can
hide prices and remain on /shop/artwork links without context
coupling. ArtworkGrid passes both through, plus an optional
className for grid-style overrides."
```

---

## Task 4: Replace EmailCaptureStrip with the prototype's `wl-news` shape

The current `EmailCaptureStrip` is an inline two-element form (email + button). The prototype's `wl-news` is a full-width strip with eyebrow + headline + body + form + fineprint, used in three places (marketing home, about tail, future journal end).

**Files:**
- Modify: `components/site/EmailCaptureStrip.tsx`

- [ ] **Step 1: Replace the file content**

```tsx
'use client';
import { useState } from 'react';

export interface EmailCaptureStripProps {
  source?: string;
  /**
   * Eyebrow text above the headline. Defaults to the marketing-home tone.
   */
  eyebrow?: string;
  /** Headline (h3). Defaults to the marketing-home tone. */
  headline?: string;
  /** Body paragraph. Defaults to the marketing-home tone. */
  body?: string;
}

export function EmailCaptureStrip({
  source = 'footer',
  eyebrow = 'Notes from the field',
  headline = 'Quarterly notes, in your inbox.',
  body = 'New chapters, new prints, occasional limited editions. Sent quarterly — never more.',
}: EmailCaptureStripProps) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>(
    'idle',
  );

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

  if (state === 'done') {
    return (
      <p className="wl-email-capture-ok">
        Thank you — we&apos;ll be in touch sparingly.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="wl-news">
      <div className="wl-news-copy">
        <span className="wl-eyebrow">{eyebrow}</span>
        <h3>{headline}</h3>
        <p>{body}</p>
      </div>
      <div className="wl-news-form">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@studio.com"
          aria-label="Email address"
        />
        <button
          className="wl-btn primary"
          type="submit"
          disabled={state === 'loading'}
        >
          {state === 'loading' ? 'Subscribing…' : 'Subscribe →'}
        </button>
        <span className="wl-news-fine">
          Unsubscribe in one click. We never share your address.
        </span>
        {state === 'error' && (
          <span className="wl-news-fine" style={{ color: 'var(--s-red)' }}>
            Could not subscribe — please try again.
          </span>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0. Existing callers (`<EmailCaptureStrip />` with no props or `source="..."`) continue to work — all new props are optional.

- [ ] **Step 3: Commit**

```bash
git add components/site/EmailCaptureStrip.tsx
git commit -m "refactor: EmailCaptureStrip renders the wl-news layout

Replaces the inline email+button form with the prototype's
full-width newsletter strip — eyebrow, headline, body, form,
fineprint. The /api/subscribe plumbing is unchanged. New optional
props (eyebrow, headline, body) let callers tune the copy per
placement; defaults match the marketing-home + about tail tone."
```

---

## Task 5: Update Nav to 4-link layout (Portfolio · Portraits · Studio · Shop)

**Files:**
- Modify: `components/site/Nav.tsx`

- [ ] **Step 1: Update the LINKS array**

Find the existing `LINKS` array and replace:

```tsx
const LINKS: LinkSpec[] = [
  { href: '/shop', label: 'Index', match: (p) => p === '/shop' || p === '/' },
  {
    href: '/shop/collections',
    label: 'Collections',
    match: (p) => p.startsWith('/shop/collections') || p.startsWith('/shop/artwork'),
  },
  { href: '/about', label: 'Studio', match: (p) => p.startsWith('/about') },
  {
    href: '/contact',
    label: 'Commission',
    match: (p) => p.startsWith('/contact'),
  },
];
```

with:

```tsx
const LINKS: LinkSpec[] = [
  {
    href: '/portfolio',
    label: 'Portfolio',
    match: (p) => p.startsWith('/portfolio'),
  },
  {
    href: '/services/portraits',
    label: 'Portraits',
    match: (p) => p.startsWith('/services/portraits'),
  },
  { href: '/about', label: 'Studio', match: (p) => p.startsWith('/about') },
  {
    href: '/shop',
    label: 'Shop',
    match: (p) => p.startsWith('/shop'),
  },
];
```

The Wordmark continues to link to `/` (line 87 area) — unchanged.

- [ ] **Step 2: Verify the Nav renders without TypeScript errors**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Smoke check in dev**

Start `npm run dev` if not running. Navigate to `http://localhost:3000/`. Confirm the four nav links read: Portfolio · Portraits · Studio · Shop. Confirm clicking the wordmark goes to `/`.

(Other tests follow once the destination pages exist — Tasks 7-9.)

- [ ] **Step 4: Commit**

```bash
git add components/site/Nav.tsx
git commit -m "refactor: Nav links — Portfolio · Portraits · Studio · Shop

Replaces the prior shop-flavored nav (Index/Collections/Studio/
Commission) with the marketing-site layout: Portfolio (/portfolio),
Portraits (/services/portraits), Studio (/about), Shop (/shop). The
Wordmark continues to link home (/). Commission moves to footer-only;
existing /contact?reason=commission routing is preserved."
```

---

## Task 6: Update Footer columns

The prototype's footer has three link columns: Shop · Studio · Care. Restructured from the current three columns to add Portraits under Studio and reorganize the Care column.

**Files:**
- Modify: `components/site/Footer.tsx`

- [ ] **Step 1: Replace the file content**

```tsx
import Link from 'next/link';
import { Wordmark } from './Wordmark';
import { EmailCaptureStrip } from './EmailCaptureStrip';

export function Footer() {
  return (
    <footer className="wl-footer">
      <div className="top">
        <div>
          <Wordmark size={24} />
          <p className="tag">
            A small, considered selection of fine-art photography by Dan Raby.
            Added sparingly. Printed to order.
          </p>
          <div className="capture">
            <EmailCaptureStrip
              source="footer"
              eyebrow="A quiet letter"
              headline="The next chapter, in your inbox."
              body="New work, the occasional studio note, and first look at limited editions before they list. No more than once a month."
            />
          </div>
        </div>
        <div>
          <div className="h">Shop</div>
          <Link className="link" href="/shop/collections">
            Collections
          </Link>
          <Link className="link" href="/shop">
            Index of plates
          </Link>
          <Link className="link" href="/contact?reason=corporate-gift">
            Gift a print
          </Link>
        </div>
        <div>
          <div className="h">Studio</div>
          <Link className="link" href="/about">
            About Dan
          </Link>
          <Link className="link" href="/services/portraits">
            Portraits
          </Link>
          <Link className="link" href="/contact?reason=commission">
            Commissions
          </Link>
          <Link className="link" href="/contact?reason=license">
            Licensing
          </Link>
          <Link className="link" href="/contact">
            Contact
          </Link>
        </div>
        <div>
          <div className="h">Care</div>
          <Link className="link" href="/legal/shipping-returns">
            Shipping &amp; returns
          </Link>
          <Link className="link" href="/legal/terms">
            Terms
          </Link>
          <Link className="link" href="/legal/privacy">
            Privacy
          </Link>
        </div>
      </div>
      <div className="fine">
        <span>
          © {new Date().getFullYear()} Wildlight Imagery · Aurora, Colorado
        </span>
        <span>Archival · Printed to order · Shipped worldwide</span>
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add components/site/Footer.tsx
git commit -m "refactor: Footer — add Portraits + Contact links to Studio column

Studio column gains Portraits (→ /services/portraits) and Contact
(→ /contact). The footer's EmailCaptureStrip now renders with
\"A quiet letter\" eyebrow + headline matching the prototype. Other
columns (Shop, Care) unchanged."
```

---

## Task 7: Append marketing CSS to `app/globals.css`

Ports the prototype's `styles-marketing.css` into the project's existing globals. The CSS uses tokens already defined in `:root` and `[data-mood='ink']` — no token additions needed.

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Append the marketing CSS block**

Add the following at the end of `app/globals.css` (preserving everything before it):

```css

/* ─── MARKETING SURFACES ─────────────────────────────────────────
 * Classes for the marketing home, portfolio, services/portraits,
 * and the about-tail additions. Sourced from the prototype at
 * Wild Light Shop/styles-marketing.css. Uses only existing tokens.
 */

/* Newsletter strip (shared) */
.wl-news {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 56px;
  align-items: center;
  padding: 48px 56px;
  background: var(--paper-2);
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  position: relative;
}
.wl-news::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -1px;
  height: 2px;
  background: linear-gradient(
    90deg,
    var(--s-red),
    var(--s-orange),
    var(--s-yellow),
    var(--s-green),
    var(--s-teal),
    var(--s-blue),
    var(--s-magenta)
  );
  opacity: 0.55;
}
.wl-news-copy .wl-eyebrow { display: block; margin-bottom: 12px; }
.wl-news h3 {
  font-family: var(--f-display);
  font-size: 38px;
  line-height: 1.05;
}
.wl-news p {
  font-family: var(--f-serif);
  font-size: 16px;
  color: var(--ink-2);
  line-height: 1.55;
  max-width: 460px;
  margin-top: 8px;
}
.wl-news-form { display: flex; flex-direction: column; gap: 10px; }
.wl-news-form input {
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--rule-strong);
  padding: 14px 0;
  font: 400 18px var(--f-serif);
  color: var(--ink);
  outline: none;
}
.wl-news-form input::placeholder { color: var(--ink-4); }
.wl-news-form .wl-btn { align-self: flex-start; }
.wl-news-fine {
  font: 500 10px var(--f-mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-3);
  margin-top: 4px;
}

/* Marketing home */
.wlmh-meta-link {
  color: inherit;
  border-bottom: 1px solid var(--rule-strong);
  transition: border-color 160ms;
}
.wlmh-meta-link:hover { border-color: var(--ink); }

.wlmh-field { padding-bottom: 56px; }
.wlmh-plates-6 { grid-template-columns: repeat(3, 1fr) !important; }
.wlmh-field-cta { margin-top: 40px; text-align: center; }

.wlmh-bigcta {
  display: inline-block;
  font-family: var(--f-display);
  font-style: italic;
  font-size: 24px;
  color: var(--ink);
  border-bottom: 1px solid var(--ink);
  padding-bottom: 4px;
  transition: color 160ms, border-color 160ms;
  cursor: pointer;
}
.wlmh-bigcta:hover { color: var(--s-orange); border-color: var(--s-orange); }

.wlmh-studio {
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  gap: 64px;
  align-items: center;
  padding: 80px 56px;
  background: var(--paper-2);
  border-bottom: 1px solid var(--rule);
}
.wlmh-studio-portrait { position: relative; }
.wlmh-studio-portrait img {
  aspect-ratio: 4/5;
  width: 100%;
  object-fit: cover;
  border: 1px solid var(--rule);
  filter: saturate(0.96);
}
.wlmh-studio-portrait .cap {
  margin-top: 12px;
  font: 500 10.5px var(--f-mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-3);
  display: flex;
  justify-content: space-between;
}
.wlmh-studio-body .wl-eyebrow { display: block; margin-bottom: 20px; }
.wlmh-studio-body h2 {
  font-family: var(--f-display);
  font-size: clamp(48px, 5.5vw, 80px);
  line-height: 1;
  margin-bottom: 28px;
}
.wlmh-studio-body h2 em { font-style: italic; color: var(--ink-2); }
.wlmh-studio-body p {
  font-family: var(--f-serif);
  font-size: 18px;
  line-height: 1.6;
  color: var(--ink-2);
  max-width: 560px;
  margin-bottom: 16px;
}
.wlmh-studio-actions { margin-top: 24px; }

.wlmh-find {
  padding: 96px 56px;
  background: var(--paper-3);
  border-bottom: 1px solid var(--rule);
}
.wlmh-find-inner { max-width: 720px; }
.wlmh-find .wl-eyebrow { display: block; margin-bottom: 20px; }
.wlmh-find h2 {
  font-family: var(--f-display);
  font-size: clamp(56px, 6vw, 88px);
  line-height: 0.98;
  margin-bottom: 24px;
}
.wlmh-find h2 em { font-style: italic; color: var(--ink-2); }
.wlmh-find p {
  font-family: var(--f-serif);
  font-size: 19px;
  line-height: 1.6;
  color: var(--ink-2);
  max-width: 560px;
  margin-bottom: 32px;
}
.wlmh-find-actions { display: flex; gap: 10px; flex-wrap: wrap; }

/* Portfolio */
.wlpf-noprice .wl-plate-meta { grid-template-columns: 1fr; }
.wlpf-footnote {
  padding: 24px 56px 64px;
  display: flex;
  gap: 16px;
  align-items: baseline;
  color: var(--ink-3);
}
.wlpf-footnote .wl-mono {
  font: 500 10.5px var(--f-mono);
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.wlpf-footnote p {
  font-family: var(--f-serif);
  font-style: italic;
  font-size: 15px;
}

/* Services / Portraits */
.wlsv-hero {
  padding: 80px 56px 64px;
  border-bottom: 1px solid var(--rule);
  position: relative;
}
.wlsv-hero::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  background: linear-gradient(
    90deg,
    var(--s-red),
    var(--s-orange),
    var(--s-yellow),
    var(--s-green),
    var(--s-teal),
    var(--s-blue),
    var(--s-magenta)
  );
  opacity: 0.45;
}
.wlsv-hero .wl-eyebrow { display: block; margin-bottom: 24px; }
.wlsv-hero h1 {
  font-family: var(--f-display);
  font-size: clamp(64px, 7vw, 112px);
  line-height: 0.96;
  letter-spacing: -0.015em;
}
.wlsv-hero h1 em { font-style: italic; color: var(--ink-2); }
.wlsv-hero .lede {
  font-family: var(--f-serif);
  font-size: 20px;
  line-height: 1.55;
  color: var(--ink-2);
  max-width: 620px;
  margin-top: 28px;
}

.wlsv-offer {
  padding: 64px 56px 32px;
  border-bottom: 1px solid var(--rule);
}
.wlsv-offer-h {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 24px;
  align-items: center;
  margin-bottom: 36px;
}
.wlsv-offer-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  border-top: 1px solid var(--rule);
}
.wlsv-offer-card {
  padding: 32px 28px 28px;
  border-right: 1px solid var(--rule);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.wlsv-offer-card:last-child { border-right: 0; }
.wlsv-offer-no {
  font: 500 10.5px var(--f-mono);
  letter-spacing: 0.2em;
  color: var(--ink-3);
}
.wlsv-offer-card h3 {
  font-family: var(--f-display);
  font-size: 36px;
  line-height: 1;
}
.wlsv-offer-card h3 em { font-style: italic; color: var(--ink-3); }
.wlsv-offer-card p {
  font-family: var(--f-serif);
  font-size: 15.5px;
  line-height: 1.6;
  color: var(--ink-2);
}

.wlsv-inquire {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 64px;
  padding: 80px 56px;
}
.wlsv-inquire-body h2 {
  font-family: var(--f-display);
  font-size: clamp(40px, 4.5vw, 64px);
  line-height: 1;
  margin-bottom: 20px;
}
.wlsv-inquire-body h2 em { font-style: italic; color: var(--ink-2); }
.wlsv-inquire-body p {
  font-family: var(--f-serif);
  font-size: 18px;
  line-height: 1.55;
  color: var(--ink-2);
  max-width: 480px;
  margin-bottom: 32px;
}
.wlsv-inquire-side .block {
  padding: 18px 0;
  border-top: 1px solid var(--rule);
}
.wlsv-inquire-side .block:last-child { border-bottom: 1px solid var(--rule); }
.wlsv-inquire-side .block h4 {
  font: 500 10.5px var(--f-mono);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-3);
  margin-bottom: 6px;
}
.wlsv-inquire-side .block p {
  font-family: var(--f-serif);
  font-size: 15px;
  color: var(--ink-2);
}

/* About — tail callout */
.wlab-callout {
  padding: 56px 56px;
  border-top: 1px solid var(--rule);
  background: var(--paper-2);
}
.wlab-callout-inner {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 32px;
  align-items: center;
}
.wlab-callout-inner .wl-eyebrow {
  display: block;
  margin-bottom: 12px;
}
.wlab-callout-inner p {
  font-family: var(--f-display);
  font-size: 32px;
  line-height: 1.2;
  max-width: 720px;
}
.wlab-callout-inner p em { font-style: italic; color: var(--ink-2); }

/* Mobile responsive */
@media (max-width: 640px) {
  .wlmh-plates-6 { grid-template-columns: 1fr 1fr !important; }
  .wlmh-studio { grid-template-columns: 1fr; gap: 32px; padding: 40px 20px; }
  .wlmh-studio-body h2 { font-size: 44px; }
  .wlmh-studio-body p { font-size: 16px; }
  .wlmh-find { padding: 56px 20px; }
  .wlmh-find h2 { font-size: 48px; }
  .wl-news { grid-template-columns: 1fr; gap: 20px; padding: 32px 20px; }
  .wl-news h3 { font-size: 28px; }

  .wlpf-footnote {
    padding: 16px 20px 40px;
    flex-direction: column;
    gap: 8px;
  }

  .wlsv-hero { padding: 40px 20px 32px; }
  .wlsv-hero h1 { font-size: 52px; }
  .wlsv-hero .lede { font-size: 17px; }
  .wlsv-offer { padding: 32px 20px 16px; }
  .wlsv-offer-grid { grid-template-columns: 1fr; }
  .wlsv-offer-card {
    border-right: 0;
    border-bottom: 1px solid var(--rule);
    padding: 24px 0;
  }
  .wlsv-offer-card:last-child { border-bottom: 0; }
  .wlsv-inquire { grid-template-columns: 1fr; gap: 32px; padding: 40px 20px; }
  .wlsv-inquire-body h2 { font-size: 36px; }

  .wlab-callout { padding: 32px 20px; }
  .wlab-callout-inner { grid-template-columns: 1fr; gap: 16px; }
  .wlab-callout-inner p { font-size: 24px; }
}
```

- [ ] **Step 2: Verify dev server still loads CSS without errors**

If dev server is running, refresh any page. Check browser devtools console — no CSS parse errors.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "feat(css): port marketing surfaces classes to globals

Adds wl-news, wlmh-*, wlpf-*, wlsv-*, wlab-* classes from the
Wild Light Shop prototype's styles-marketing.css. Uses only the
existing print-room tokens (paper, ink, rule, spectrum). Mobile
responsive blocks ported as media queries (the prototype used
.wl-viewport.mobile for its preview frame; production uses
@media (max-width: 640px))."
```

---

## Task 8: Marketing home — replace the stub at `/`

**Files:**
- Modify: `app/(shop)/page.tsx`

- [ ] **Step 1: Replace the stub with the real marketing home**

Replace the entire file content with:

```tsx
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { pool } from '@/lib/db';
import { ArtworkGrid, type GridItem } from '@/components/site/ArtworkGrid';
import { EmailCaptureStrip } from '@/components/site/EmailCaptureStrip';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Wildlight Imagery — Aurora, Colorado',
  description:
    'Fine-art photography by Dan Raby. A small, considered selection of prints — added sparingly, printed to order, shipped archival.',
};

interface PlateRow extends GridItem {}

interface CountsRow {
  n: number;
  latest: string | null;
}

function seasonOf(date: Date): string {
  const m = date.getUTCMonth();
  const y = date.getUTCFullYear();
  const yy = `'${String(y).slice(2)}`;
  if (m === 11 || m <= 1) return `Winter ${m === 11 ? `'${String(y + 1).slice(2)}` : yy}`;
  if (m <= 4) return `Spring ${yy}`;
  if (m <= 7) return `Summer ${yy}`;
  return `Fall ${yy}`;
}

export default async function MarketingHome() {
  const [countsRes, platesRes] = await Promise.all([
    pool.query<CountsRow>(
      `SELECT COUNT(*)::int AS n, MAX(published_at)::text AS latest
       FROM artworks WHERE status='published'`,
    ),
    pool.query<PlateRow>(
      `SELECT a.slug,
              a.title,
              a.image_web_url,
              a.year_shot,
              a.location,
              c.title AS collection_title,
              (SELECT MIN(price_cents) FROM artwork_variants v
                 WHERE v.artwork_id = a.id AND v.active = TRUE) AS min_price_cents
       FROM artworks a
       LEFT JOIN collections c ON c.id = a.collection_id
       WHERE a.status = 'published'
       ORDER BY a.display_order, a.id
       LIMIT 6`,
    ),
  ]);

  const count = countsRes.rows[0]?.n ?? 0;
  const latestRaw = countsRes.rows[0]?.latest ?? null;
  const latestLabel = latestRaw ? seasonOf(new Date(latestRaw)) : '—';
  const plates = platesRes.rows;

  return (
    <div className="wl-mhome">
      {/* 1. Hero */}
      <section className="wl-masthead">
        <div className="wl-masthead-intro">
          <span className="wl-eyebrow">Wildlight Imagery · Aurora, Colorado</span>
          <h1>
            Exploring <em>my light</em>
            <br /> for as long as I<br /> can remember.
          </h1>
        </div>
        <div className="wl-masthead-side">
          <div>
            <b>Est.</b> 2004
          </div>
          <div>
            <b>Plates on file</b>{' '}
            <Link href="/portfolio" className="wlmh-meta-link">
              {String(count).padStart(3, '0')} →
            </Link>
          </div>
          <div>
            <b>Latest</b> {latestLabel}
          </div>
          <div style={{ marginTop: 8 }}>
            Printed to order ·<br />
            shipped archival
          </div>
        </div>
      </section>

      {/* 2. From the field */}
      <section className="wl-sheet wlmh-field">
        <header className="wl-sheet-h">
          <h2>
            From the field<em>.</em>
          </h2>
          <div className="wl-rule"></div>
          <span className="count">Recently added</span>
        </header>
        {plates.length > 0 ? (
          <ArtworkGrid
            items={plates}
            showPrice={false}
            linkBase="/shop/artwork"
            className="wl-plates wlmh-plates-6"
          />
        ) : (
          <p
            style={{
              color: 'var(--ink-3)',
              fontFamily: 'var(--f-serif)',
              fontSize: 17,
              padding: '40px 0',
            }}
          >
            No published works yet. Check back soon.
          </p>
        )}
        <div className="wlmh-field-cta">
          <Link className="wlmh-bigcta" href="/portfolio">
            Browse the full portfolio →
          </Link>
        </div>
      </section>

      {/* 3. From the studio */}
      <section className="wlmh-studio">
        <div className="wlmh-studio-portrait">
          <div style={{ position: 'relative', aspectRatio: '4/5' }}>
            <Image
              src="/dan-portrait.jpg"
              alt="Dan Raby in the studio"
              fill
              sizes="(max-width: 640px) 100vw, 40vw"
              style={{ objectFit: 'cover' }}
            />
          </div>
          <div className="cap">
            <span>Dan Raby, at the studio</span>
            <span>Aurora, CO</span>
          </div>
        </div>
        <div className="wlmh-studio-body">
          <span className="wl-eyebrow">From the studio</span>
          <h2>
            A note from <em>Dan</em>.
          </h2>
          <p>
            My father handed me a camera when I was a child and I never put it
            down. I&apos;m a photographic rebel — I take the rules I learned at
            the Colorado Institute of Art and then do something else. Let&apos;s
            try this and see what happens.
          </p>
          <p>
            I am always trying something different photographically — working
            beyond what I know, looking for the light in unusual places. But I
            can also use what I know and stay true to the customer&apos;s
            requirements. Working together to create the perfect shot.
          </p>
          <div className="wlmh-studio-actions">
            <Link className="wlmh-bigcta" href="/about">
              Read Dan&apos;s letter →
            </Link>
          </div>
        </div>
      </section>

      {/* 4. Newsletter */}
      <section className="wlmh-news-section">
        <EmailCaptureStrip
          source="marketing-home"
          eyebrow="Notes from the field"
          headline="Quarterly notes, in your inbox."
          body="New chapters, new prints, occasional limited editions. Sent quarterly — never more."
        />
      </section>

      {/* 5. Find a print */}
      <section className="wlmh-find">
        <div className="wlmh-find-inner">
          <span className="wl-eyebrow">The shop</span>
          <h2>
            Printed to order,
            <br /> <em>shipped archival.</em>
          </h2>
          <p>
            A small, considered selection of fine-art prints. Choose the size,
            paper, and frame that suits your wall — printed in Aurora, Colorado,
            and shipped worldwide.
          </p>
          <div className="wlmh-find-actions">
            <Link className="wl-btn primary" href="/shop">
              Visit the shop →
            </Link>
            <Link className="wl-btn ghost" href="/shop/collections">
              Browse collections
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Smoke check**

In dev, hit `http://localhost:3000/` — render five sections. Top: hero. Below: "From the field" with 6 plate cards. Below: "From the studio" portrait + letter excerpt. Below: newsletter strip. Bottom: "Find a print" with two CTA buttons.

The "Plates on file" link in the hero side should navigate to `/portfolio` (which doesn't exist yet — Task 9 builds it). For now it'll 404; verify it'll resolve once Task 9 lands.

- [ ] **Step 4: Commit**

```bash
git add app/\(shop\)/page.tsx
git commit -m "feat: real marketing home replaces the stub at /

Five-section marketing home per the prototype: hero (with Plates
on file → /portfolio), From the field (6 recent plates, no prices,
linking to /shop/artwork/[slug]), From the studio (portrait +
letter excerpt → /about), newsletter strip, Find a print CTA → /shop.

Server component, revalidate=60. Reuses the existing recent-plates
+ counts queries from the prior shop home."
```

---

## Task 9: `/portfolio` — listing

**Files:**
- Create: `app/(shop)/portfolio/page.tsx`

- [ ] **Step 1: Create the file**

```tsx
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { pool } from '@/lib/db';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'The portfolio — Wildlight Imagery',
  description:
    'Six chapters of light, ongoing. Twenty years of looking, gathered into collections.',
};

interface CollectionRow {
  slug: string;
  title: string;
  tagline: string | null;
  cover_image_url: string | null;
  display_order: number;
  n: number;
}

interface CountsRow {
  total: number;
  latest: string | null;
}

function seasonOf(date: Date): string {
  const m = date.getUTCMonth();
  const y = date.getUTCFullYear();
  const yy = `'${String(y).slice(2)}`;
  if (m === 11 || m <= 1) return `Winter ${m === 11 ? `'${String(y + 1).slice(2)}` : yy}`;
  if (m <= 4) return `Spring ${yy}`;
  if (m <= 7) return `Summer ${yy}`;
  return `Fall ${yy}`;
}

export default async function PortfolioIndex() {
  const [collsRes, countsRes] = await Promise.all([
    pool.query<CollectionRow>(
      `SELECT c.slug, c.title, c.tagline, c.cover_image_url, c.display_order,
              COALESCE(COUNT(a.id) FILTER (WHERE a.status = 'published'), 0)::int AS n
       FROM collections c
       LEFT JOIN artworks a ON a.collection_id = c.id
       GROUP BY c.id
       ORDER BY c.display_order, c.id`,
    ),
    pool.query<CountsRow>(
      `SELECT COUNT(*)::int AS total, MAX(published_at)::text AS latest
       FROM artworks WHERE status='published'`,
    ),
  ]);

  const collections = collsRes.rows;
  const total = countsRes.rows[0]?.total ?? 0;
  const latestRaw = countsRes.rows[0]?.latest ?? null;
  const latestLabel = latestRaw ? seasonOf(new Date(latestRaw)) : '—';

  return (
    <div>
      <header className="wl-cindex-head">
        <div>
          <span className="wl-eyebrow">
            The portfolio · {collections.length} chapters
          </span>
          <h1>
            The portfolio<em>.</em>
          </h1>
          <p>
            Twenty years of looking, gathered into collections — each a chapter
            in a longer letter about how I see.
          </p>
        </div>
        <div className="wl-masthead-side">
          <div>
            <b>Chapters</b> {String(collections.length).padStart(2, '0')}
          </div>
          <div>
            <b>Plates</b> {String(total).padStart(3, '0')}
          </div>
          <div>
            <b>Updated</b> {latestLabel}
          </div>
        </div>
      </header>
      <div className="wl-cindex-list">
        {collections.map((c, i) => (
          <Link
            key={c.slug}
            href={`/portfolio/${c.slug}`}
            className="wl-cindex-row"
          >
            <span className="no">CH · {String(i + 1).padStart(2, '0')}</span>
            <span className="title">{c.title.replace(/^The /, '')}</span>
            <span className="tagline">{c.tagline ?? ''}</span>
            <span className="count">
              {c.n} {c.n === 1 ? 'plate' : 'plates'}
            </span>
            <span className="thumb">
              {c.cover_image_url && (
                <Image
                  src={c.cover_image_url}
                  alt={c.title}
                  width={72}
                  height={72}
                  style={{ objectFit: 'cover' }}
                />
              )}
            </span>
          </Link>
        ))}
      </div>
      <div className="wlpf-footnote">
        <span className="wl-mono">Footnote</span>
        <p>Photojournalism work — coming back when the archive lands.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Smoke check**

In dev, hit `http://localhost:3000/portfolio`. Six rows render (one per collection). Each row links to `/portfolio/[slug]` (which doesn't exist yet — Task 10 builds). Footer footnote about photojournalism appears.

- [ ] **Step 4: Commit**

```bash
git add app/\(shop\)/portfolio/page.tsx
git commit -m "feat: /portfolio listing — six chapters of work

Server component listing all collections with chapter numbers,
taglines, plate counts, and cover thumbnails. Each row links
to /portfolio/[slug]. Footnote announces deferred photojournalism
chapter."
```

---

## Task 10: `/portfolio/[slug]` — collection detail

**Files:**
- Create: `app/(shop)/portfolio/[slug]/page.tsx`

- [ ] **Step 1: Create the file**

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { pool } from '@/lib/db';
import { ArtworkGrid, type GridItem } from '@/components/site/ArtworkGrid';

export const revalidate = 60;

interface CollectionRow {
  id: number;
  slug: string;
  title: string;
  tagline: string | null;
  display_order: number;
}

interface PlateRow extends GridItem {}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const r = await pool.query<{ title: string; tagline: string | null }>(
    'SELECT title, tagline FROM collections WHERE slug = $1',
    [slug],
  );
  const c = r.rows[0];
  if (!c) return { title: 'Collection not found' };
  return {
    title: `${c.title} — Wildlight Imagery`,
    description: c.tagline ?? undefined,
  };
}

export default async function PortfolioDetail({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const collRes = await pool.query<CollectionRow>(
    'SELECT id, slug, title, tagline, display_order FROM collections WHERE slug = $1',
    [slug],
  );
  const collection = collRes.rows[0];
  if (!collection) notFound();

  const [worksRes, ordRes] = await Promise.all([
    pool.query<PlateRow>(
      `SELECT a.slug,
              a.title,
              a.image_web_url,
              a.year_shot,
              a.location,
              c.title AS collection_title
       FROM artworks a
       LEFT JOIN collections c ON c.id = a.collection_id
       WHERE a.collection_id = $1 AND a.status = 'published'
       ORDER BY a.display_order, a.id`,
      [collection.id],
    ),
    pool.query<{ idx: number }>(
      `SELECT (display_order)::int AS idx
       FROM collections WHERE slug = $1`,
      [slug],
    ),
  ]);

  // 1-indexed chapter number: the collection's position by display_order.
  const allOrders = await pool.query<{ slug: string }>(
    'SELECT slug FROM collections ORDER BY display_order, id',
  );
  const chapterNumber = allOrders.rows.findIndex((r) => r.slug === slug) + 1;

  const works = worksRes.rows;
  const yearRange = (() => {
    const ys = works
      .map((w) => w.year_shot)
      .filter((y): y is number => typeof y === 'number');
    if (ys.length === 0) return 'Various';
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    return min === max ? String(min) : `${min}–${max}`;
  })();

  return (
    <div>
      <header className="wl-coll-head">
        <Link href="/portfolio" className="back">
          ← The portfolio
        </Link>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: 40,
          }}
        >
          <div>
            <div className="wl-eyebrow" style={{ marginBottom: 16 }}>
              Chapter {String(chapterNumber).padStart(2, '0')} of{' '}
              {String(allOrders.rows.length).padStart(2, '0')}
            </div>
            <h1>
              {collection.title.replace(/^The /, '')}
              <em>.</em>
            </h1>
            {collection.tagline && <p className="tag">{collection.tagline}</p>}
          </div>
          <div className="wl-masthead-side">
            <div>
              <b>Plates</b> {String(works.length).padStart(2, '0')}
            </div>
            <div>
              <b>Year</b> {yearRange}
            </div>
            <div>
              <b>Buy</b>{' '}
              <Link href="/shop" className="wlmh-meta-link">
                In the shop →
              </Link>
            </div>
          </div>
        </div>
      </header>
      {works.length > 0 ? (
        <ArtworkGrid
          items={works}
          showPrice={false}
          linkBase="/shop/artwork"
          className="wl-coll-grid wlpf-noprice"
        />
      ) : (
        <p
          style={{
            color: 'var(--ink-3)',
            fontFamily: 'var(--f-serif)',
            fontSize: 17,
            padding: '40px 56px',
          }}
        >
          No plates published in this chapter yet.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Smoke check**

In dev, hit `http://localhost:3000/portfolio/the-night` (or whichever published collection slug exists). Header shows "Chapter NN of MM" eyebrow, collection title, tagline, side metadata (Plates count, Year range, "Buy: In the shop →"). Grid below shows the collection's published plates with no prices. Each plate links to `/shop/artwork/[slug]`.

Hit `/portfolio/does-not-exist` → 404.

- [ ] **Step 4: Commit**

```bash
git add app/\(shop\)/portfolio/\[slug\]/page.tsx
git commit -m "feat: /portfolio/[slug] — collection detail (no prices)

Chapter eyebrow, collection title + tagline, year-range derived
metadata, plates grid via ArtworkGrid with showPrice=false. Plates
link to /shop/artwork/[slug] for purchase. 404s on unknown slug."
```

---

## Task 11: `/services/portraits` — service info page

**Files:**
- Create: `app/(shop)/services/portraits/page.tsx`

- [ ] **Step 1: Create the file**

```tsx
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Portrait photography — Wildlight Imagery',
  description:
    'Headshots, families, and editorial commissions by Dan Raby. Studio + on-location, in Denver and Aurora.',
};

const offerings = [
  {
    no: 'I',
    title: 'Studio Sessions',
    body:
      "Headshots, family portraits, and product work shot in a controlled studio environment in Aurora. We talk through what you have in mind, then I do my best to find the version of you that the camera doesn't usually catch.",
  },
  {
    no: 'II',
    title: 'On-Location Sessions',
    body:
      'Outdoors, in your home, at the office, or anywhere the light is doing something interesting. Denver and the Front Range; further afield by arrangement. Working together to create the perfect shot.',
  },
  {
    no: 'III',
    title: 'Editorial & Commercial',
    body:
      "For publications, businesses, and brands. I can stay true to a brief, a brand book, or an art director's vision — and bring my own eye when you want one. Let's try this and see what happens.",
  },
];

export default function PortraitsService() {
  return (
    <div className="wl-portraits">
      <section className="wlsv-hero">
        <span className="wl-eyebrow">Services</span>
        <h1>
          Portrait photography
          <br /> by <em>Dan Raby.</em>
        </h1>
        <p className="lede">
          Headshots, families, and editorial commissions. Studio +
          on-location, in Denver and Aurora — and wherever else the work
          calls for.
        </p>
      </section>

      <section className="wlsv-offer">
        <div className="wlsv-offer-h">
          <span className="wl-eyebrow">What we offer</span>
          <div className="wl-rule" />
        </div>
        <div className="wlsv-offer-grid">
          {offerings.map((o) => (
            <div key={o.no} className="wlsv-offer-card">
              <span className="wlsv-offer-no">{o.no}</span>
              <h3>
                {o.title}
                <em>.</em>
              </h3>
              <p>{o.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="wlsv-inquire">
        <div className="wlsv-inquire-body">
          <h2>
            Tell Dan what you have in <em>mind.</em>
          </h2>
          <p>
            Every commission begins with a short conversation. Drop a note
            about the shoot you&apos;re imagining and Dan will reply, usually
            within a day.
          </p>
          <Link
            className="wl-btn primary"
            href="/contact?reason=commission&topic=portraits"
          >
            Tell Dan what you have in mind →
          </Link>
        </div>
        <div className="wlsv-inquire-side">
          <div className="block">
            <h4>Direct</h4>
            <p>
              dan@wildlightimagery.shop
              <br />
              720.363.9430
            </p>
          </div>
          <div className="block">
            <h4>Studio</h4>
            <p>
              Aurora, Colorado
              <br />
              By appointment only
            </p>
          </div>
          <div className="block">
            <h4>Hours</h4>
            <p>
              Mon–Fri, most afternoons
              <br />
              Weekends in the field
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Smoke check**

In dev, hit `http://localhost:3000/services/portraits`. Three sections render: hero with rainbow underline, "What we offer" with three offering cards (I/II/III), inquire section with main CTA + direct/studio/hours sidebar.

Click "Tell Dan what you have in mind →" — lands on `/contact?reason=commission&topic=portraits` with the form pre-populated for portraits-flavored commission.

- [ ] **Step 4: Commit**

```bash
git add app/\(shop\)/services/portraits/page.tsx
git commit -m "feat: /services/portraits — service info + inquire CTA

Hero (with spectrum hairline), three offering cards (Studio Sessions,
On-Location, Editorial & Commercial), and an inquire section that
routes to /contact?reason=commission&topic=portraits. No sample
photos — Dan's portrait corpus isn't in the database yet; the page
is content-light by design with the contact CTA as the lever."
```

---

## Task 12: `/about` polish — three tail additions

**Files:**
- Modify: `app/(shop)/about/page.tsx`

- [ ] **Step 1: Read the existing file to see where the additions go**

Open `app/(shop)/about/page.tsx`. The existing component renders `<section className="wl-about">…</section>` containing the side portrait + letter. The tail additions go AFTER that section's closing tag, inside a wrapping fragment.

- [ ] **Step 2: Replace the file content**

```tsx
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { EmailCaptureStrip } from '@/components/site/EmailCaptureStrip';

export const metadata: Metadata = { title: 'Studio — Wildlight Imagery' };

// Dan's letter — verbatim from the studio. Paragraphs split on blank lines only;
// no edits to words, punctuation, or capitalization. Keep it that way.
const LETTER: string[] = [
  `My name is Dan Raby I am the owner and Chief photographer here at Wildlight Imagery.  We work in Aurora Colorado which is an outlier of Denver Colorado in the USA. We work in many different styles of photography but we specialize in Portrait Photography,  Fine Art Photography, and  Freelance Photojournalism.`,
  `as for me personally, I have been a photographer exploring my light for as long as I can remember. My father handed me a camera when I was but a child and I never put it down.  I studied photography at The Colorado Institute of Art. There I learned accepted techniques and photographic rules. I learned the right way to capture light and record my world.  Since then I have practiced and honed my craft but being a typical normal photographer isn't where my passion lies.`,
  `I am always trying something different photographically.  I usually try and work beyond what I know and look for the light in unusual places. I like to consider myself a photographic rebel. Taking those well established photographic rules, that I learned in school,  and doing something else. Experimenting with new techniques constantly trying to find different ways to get the best image. Let's try this and see what happens.`,
  `But I also can use what I know and stay true to the customer requirements. Working together to create the perfect shot. I look forward to seeing what we can do for you!`,
];

export default function AboutPage() {
  return (
    <>
      <section className="wl-about">
        <div className="side">
          <div className="portrait">
            <Image
              src="/dan-portrait.jpg"
              alt="Dan Raby"
              fill
              sizes="(max-width: 900px) 100vw, 50vw"
              priority
              style={{ objectFit: 'cover' }}
            />
          </div>
          <div className="caption">
            <span>Dan Raby, at the studio</span>
            <span>Aurora, CO</span>
          </div>
        </div>

        <div className="letter">
          <span
            className="wl-eyebrow"
            style={{ display: 'inline-flex', marginBottom: 24 }}
          >
            A letter from the chief photographer
          </span>
          <h1>
            My name is <em>Dan Raby</em>.
          </h1>

          {LETTER.map((p, i) => (
            <p key={i}>{p}</p>
          ))}

          <div className="sig">— Dan</div>
          <div className="sig-sub">
            Chief Photographer · Wildlight Imagery
          </div>

          <div style={{ marginTop: 40, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link className="wl-btn primary" href="/shop">
              Visit the shop →
            </Link>
            <Link className="wl-btn ghost" href="/portfolio">
              Browse the portfolio
            </Link>
          </div>
        </div>
      </section>

      {/* Tail addition #1 — services callout */}
      <section className="wlab-callout">
        <div className="wlab-callout-inner">
          <div>
            <span className="wl-eyebrow">Also from the studio</span>
            <p>
              Wildlight also offers <em>portrait photography</em> for headshots,
              families, and editorial commissions.
            </p>
          </div>
          <Link className="wlmh-bigcta" href="/services/portraits">
            Learn more →
          </Link>
        </div>
      </section>

      {/* Tail addition #2 — newsletter strip */}
      <section className="wlmh-news-section">
        <EmailCaptureStrip
          source="about-tail"
          eyebrow="Notes from the field"
          headline="Quarterly notes from the field."
          body="New chapters, new prints, occasional limited editions. Sent quarterly — never more."
        />
      </section>
    </>
  );
}
```

The letter content is unchanged (verbatim from current file). Three additions at the tail: signature subtitle line, refined dual-CTA (Visit shop / Browse portfolio), the services callout block, and the newsletter strip.

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Smoke check**

In dev, hit `http://localhost:3000/about`. Letter renders verbatim. After the letter: signature line, two CTA buttons (Visit shop + Browse portfolio), then a callout strip with "Wildlight also offers portrait photography...", then the newsletter strip.

The "Browse the collections" link from before is replaced by "Browse the portfolio →" → `/portfolio`.

- [ ] **Step 4: Commit**

```bash
git add app/\(shop\)/about/page.tsx
git commit -m "feat: /about polish — services callout, newsletter, refined CTAs

Dan's letter content unchanged (verbatim). Adds tail blocks per
the prototype: signature subtitle, dual CTA (shop + portfolio
replacing the prior single \"Browse the collections\"), services
callout pointing at /services/portraits, and a newsletter strip
with about-tail copy."
```

---

## Task 13: Update `app/sitemap.ts` with marketing URLs

**Files:**
- Modify: `app/sitemap.ts`

- [ ] **Step 1: Replace the file content**

```tsx
import type { MetadataRoute } from 'next';
import { pool } from '@/lib/db';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://wildlightimagery.shop').replace(/\/$/, '');

  try {
    const [collections, artworks] = await Promise.all([
      pool.query<{ slug: string; created_at: Date }>(
        'SELECT slug, created_at FROM collections',
      ),
      pool.query<{ slug: string; updated_at: Date }>(
        `SELECT slug, updated_at FROM artworks WHERE status='published'`,
      ),
    ]);
    return [
      // Marketing
      { url: `${base}/`, lastModified: new Date() },
      { url: `${base}/portfolio`, lastModified: new Date() },
      { url: `${base}/services/portraits`, lastModified: new Date() },
      { url: `${base}/about`, lastModified: new Date() },
      { url: `${base}/contact`, lastModified: new Date() },
      // Shop
      { url: `${base}/shop`, lastModified: new Date() },
      { url: `${base}/shop/collections`, lastModified: new Date() },
      // Per-collection portfolio + shop
      ...collections.rows.flatMap((c) => [
        {
          url: `${base}/portfolio/${c.slug}`,
          lastModified: c.created_at,
        },
        {
          url: `${base}/shop/collections/${c.slug}`,
          lastModified: c.created_at,
        },
      ]),
      // Per-artwork shop pages
      ...artworks.rows.map((a) => ({
        url: `${base}/shop/artwork/${a.slug}`,
        lastModified: a.updated_at,
      })),
    ];
  } catch {
    return [
      { url: `${base}/`, lastModified: new Date() },
      { url: `${base}/portfolio`, lastModified: new Date() },
      { url: `${base}/services/portraits`, lastModified: new Date() },
      { url: `${base}/about`, lastModified: new Date() },
      { url: `${base}/contact`, lastModified: new Date() },
      { url: `${base}/shop`, lastModified: new Date() },
      { url: `${base}/shop/collections`, lastModified: new Date() },
    ];
  }
}
```

- [ ] **Step 2: Verify in dev**

```bash
curl -s http://localhost:3000/sitemap.xml | grep -E "(portfolio|services|shop)" | head -20
```

Expected output includes: `/portfolio`, `/portfolio/[each-collection-slug]`, `/services/portraits`, `/shop`, `/shop/collections`, `/shop/collections/[each]`, `/shop/artwork/[each]`.

- [ ] **Step 3: Commit**

```bash
git add app/sitemap.ts
git commit -m "feat: sitemap — add /portfolio, /portfolio/[slug], /services/portraits

Marketing URLs now indexed alongside shop URLs. Each published
collection emits both /portfolio/[slug] (browse) and
/shop/collections/[slug] (purchase) entries."
```

---

## Task 14: Final manual verification

**Files:** None (operational verification).

This task does not produce a commit; verifies the sub-project end-to-end.

- [ ] **Step 1: Restart dev server fresh**

Stop any running dev server. Run `npm run dev`. Wait until ready.

- [ ] **Step 2: Walk every page**

Open in a browser:
- `http://localhost:3000/` — five-section marketing home; hero "Plates on file → /portfolio" link works; recent plates link to `/shop/artwork/[slug]`; "Browse the full portfolio →" goes to `/portfolio`; "Read Dan's letter →" goes to `/about`; newsletter accepts an email; "Visit the shop →" goes to `/shop`.
- `http://localhost:3000/portfolio` — six chapter rows; thumbnails render; "Footnote · Photojournalism work…" appears at bottom; each row links to `/portfolio/[slug]`.
- `http://localhost:3000/portfolio/the-night` (or any published collection) — chapter eyebrow, title, tagline, plate count + year range + "Buy: In the shop →"; plates render without prices; each plate links to `/shop/artwork/[slug]`.
- `http://localhost:3000/services/portraits` — hero, three offering cards, inquire CTA; clicking the CTA pre-fills `/contact?reason=commission&topic=portraits`.
- `http://localhost:3000/about` — Dan's letter unchanged; signature; two CTA buttons; services callout; newsletter strip.
- `http://localhost:3000/contact` — unchanged from prior; reason routing still works.

- [ ] **Step 3: Walk every shop page (regression check)**

- `http://localhost:3000/shop` — masthead + plates index renders.
- `http://localhost:3000/shop/cart` — empty state OK.
- Add an item from `/shop/artwork/[slug]` to cart.
- `http://localhost:3000/shop/cart` — line item visible.
- `http://localhost:3000/shop/checkout` — Stripe form mounts.
- `http://localhost:3000/shop/collections` — collection index.
- `http://localhost:3000/shop/collections/the-night` — collection detail.

- [ ] **Step 4: Mood switching**

On `/`, toggle Bone ↔ Black via the nav switcher. Refresh. Mood persists. Cross-navigate to `/portfolio` and `/shop` — mood persists across pages.

- [ ] **Step 5: Mobile responsive sanity**

Open devtools, toggle to a 375px-wide viewport.
- `/` — hero stacks; "From the field" plate grid drops to 2 columns; "From the studio" stacks portrait above body; newsletter strip stacks.
- `/portfolio` — listing rows readable.
- `/services/portraits` — three offering cards stack vertically; inquire side-rail stacks below body.

- [ ] **Step 6: Sitemap**

```bash
curl -s http://localhost:3000/sitemap.xml | grep -c "<loc>"
```

Expected: count > 13 (5 marketing + 2 shop static + 6 portfolio detail + 6 shop-collection detail + N artwork pages).

- [ ] **Step 7: Type + tests final pass**

```bash
npm run typecheck && npm test
```

Expected: exit 0; all 57 tests pass.

If any step fails, file a fix commit before declaring SP#2 done.

---

## Self-Review

**Spec coverage:**
- ✓ Marketing home — Task 8
- ✓ /portfolio listing — Task 9
- ✓ /portfolio/[slug] — Task 10
- ✓ /services/portraits — Task 11
- ✓ /about polish — Task 12
- ✓ /contact unchanged — no task needed (intentional)
- ✓ Component promotion to components/site/ — Task 1
- ✓ PlateCard + ArtworkGrid extension — Task 3
- ✓ EmailCaptureStrip prototype shape — Task 4
- ✓ Nav 4-link layout — Task 5
- ✓ Footer column refactor — Task 6
- ✓ MoodSwitch label rename — Task 2
- ✓ Marketing CSS port — Task 7
- ✓ Sitemap update — Task 13
- ✓ Manual verification — Task 14

**Out of scope per spec (intentional gaps):**
- Three shop home variants (Letter/Plate/Folio) — separate sub-project, not SP#2.
- Mood expansion (ivory, slate) — separate design-system sub-project.
- Density modes — separate design-system sub-project.
- Film grain overlay — separate design-system sub-project.
- Photojournalism portfolio category — deferred until content exists.
- /services/commissions, /services/licensing — existing /contact?reason=… routing is sufficient.

**Placeholder scan:** No "TBD", "TODO", or unfilled details remain. Each task has the actual code to write.

**Type consistency:** `PlateCard` props (`item`, `showPrice`, `linkBase`) used consistently across Tasks 3, 8, 10. `ArtworkGrid` accepts the same props plus `className` (Task 3) and is called with the same props in Tasks 8 and 10. `EmailCaptureStrip` props (`source`, `eyebrow`, `headline`, `body`) used consistently across Tasks 4, 6, 8, 12.
