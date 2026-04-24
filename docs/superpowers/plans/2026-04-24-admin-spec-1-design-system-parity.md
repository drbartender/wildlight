# Admin Spec 1 — Design System + Shell Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the admin design system and shell components to parity with the Atelier + Darkroom mockup, without touching screen content.

**Architecture:** Keep the existing approach — scoped CSS under `.wl-admin-surface` in `app/admin/admin.css`, semantic CSS custom properties per theme, cookie-backed SSR theme switching, and `Admin*`-prefixed React components under `components/admin/`. Extend the existing components to cover the mockup's missing surfaces (Darkroom breadcrumb, system-health block, sign-out in top bar, new `AdminButton`); add missing CSS tokens.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, plain CSS with custom properties, `next/font/google` (already wired).

**Source of truth:** `temp/wild-light-admin/wild-light-admin/project/atelier.jsx` and `darkroom.jsx`. Open `temp/wild-light-admin/wild-light-admin/project/Wildlight Admin.html` in a browser to see the intended result.

**Key deviation from mockup (called out up front):** The mockup hides "Sign out" in Atelier except on the dashboard. This plan always renders sign-out in the top bar, on every screen, in both themes. Rationale: user should never lose the ability to sign out. Atelier CSS can make the button visually subtle; it does not need to disappear.

---

## File structure

- **Create:** `components/admin/AdminButton.tsx` — thin wrapper around `<button className="wl-adm-btn">` with typed `primary / ghost / danger / small / icon` props. Future-proofing for screen rebuilds.
- **Modify:** `components/admin/AdminTopBar.tsx` — add `actions?: ReactNode` slot, add `breadcrumb?: string[]` prop, render sign-out button.
- **Modify:** `components/admin/AdminSidebar.tsx` — add Darkroom-only head block (W icon + mono wordmark + version), add `systemHealth?: Array<{...}>` prop + block, remove the inline sign-out button from the footer.
- **Modify:** `app/admin/layout.tsx` — pass a placeholder `systemHealth` array to `AdminSidebar`.
- **Modify:** `app/admin/admin.css` — add missing tokens (`--adm-panel2`, `--adm-hover`, `--adm-dim` under `[data-theme='dark']`), add CSS for top-bar breadcrumb, top-bar sign-out, sidebar Darkroom head, sidebar system-health block. Audit pill statuses for `draft / retired / refunded / canceled / unsub` fallback treatment.
- **No tests touched.** The project has no React-component test harness (`tests/lib/` is lib-only, see `CLAUDE.md`). All verification is manual against the mockup.

---

## Task 1: Token additions to `admin.css`

**Files:**
- Modify: `app/admin/admin.css` (light block ≈L11-39, dark block ≈L41-61)

The mockup's Darkroom palette uses three tokens we don't yet expose: `panel2` (#1b1f25), `hover` (#20252c), `dim` (#4a4d51). They're referenced in the Darkroom mockup for secondary panels (table header rows, hover states, disabled/dim text). Also add Atelier analogues where none exist.

- [ ] **Step 1: Read the current token blocks**

```
Open app/admin/admin.css and find the block starting at `.wl-admin-surface {` (around line 10) and the dark override block starting `.wl-admin-surface[data-theme='dark'] {` (around line 41).
```

- [ ] **Step 2: Add three tokens to the default (Atelier) block**

Edit `app/admin/admin.css`, at the end of the `.wl-admin-surface {` declaration block (just before the closing `}` at around line 39), add:

```css
  --adm-panel-2: #efeae0;       /* Atelier: same as paper-alt, alias for semantic name parity */
  --adm-hover: #f1ede3;         /* Atelier: subtle hover tint on ink surfaces */
  --adm-dim: #b4ac9b;           /* Atelier: further-muted text */
```

- [ ] **Step 3: Add three tokens to the Darkroom block**

Edit `app/admin/admin.css`, at the end of the `.wl-admin-surface[data-theme='dark'] {` block (just before its closing `}` at around line 61), add:

```css
  --adm-panel-2: #1b1f25;
  --adm-hover: #20252c;
  --adm-dim: #4a4d51;
```

- [ ] **Step 4: Verify dev server compiles**

Run:
```bash
npm run dev
```

Open `http://localhost:3000/admin`. Should render with no console errors. Screen should look identical (we only added unused tokens).

Kill the dev server (Ctrl-C) before moving on.

- [ ] **Step 5: Commit**

```bash
git add app/admin/admin.css
git commit -m "admin: add --adm-panel-2 / --adm-hover / --adm-dim tokens in both themes"
```

---

## Task 2: Extract `AdminButton` component

**Files:**
- Create: `components/admin/AdminButton.tsx`

The mockup uses a button with `primary / ghost / danger / small / icon` variants in dozens of places (`ABtn` in `atelier.jsx:172-189`, `DBtn` in `darkroom.jsx:59-70`). Current admin uses inline `<button className="wl-adm-btn ...">` everywhere. We'll add the component; we won't migrate call sites yet (that happens in later sub-projects as their screens get rebuilt).

The `.wl-adm-btn` CSS in `app/admin/admin.css:396-456` already supports `.small`, `.primary`, `.ghost`, `.danger` modifiers. This component just emits the right className.

- [ ] **Step 1: Create the component**

Write `components/admin/AdminButton.tsx`:

```tsx
'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'danger';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: Variant;
  small?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

export function AdminButton({
  variant,
  small,
  icon,
  children,
  type = 'button',
  ...rest
}: Props) {
  const parts = ['wl-adm-btn'];
  if (small) parts.push('small');
  if (variant) parts.push(variant);
  return (
    <button {...rest} type={type} className={parts.join(' ')}>
      {icon}
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run:
```bash
npm run typecheck
```

Expected: no errors. If there are errors, they're from elsewhere in the codebase (check `git diff HEAD` for anything unexpected) — fix or revert.

- [ ] **Step 3: Commit**

```bash
git add components/admin/AdminButton.tsx
git commit -m "admin: add AdminButton component wrapping .wl-adm-btn"
```

---

## Task 3: `AdminTopBar` — add `actions` slot + render sign-out

**Files:**
- Modify: `components/admin/AdminTopBar.tsx` (full rewrite, it's 44 lines)
- Modify: `app/admin/admin.css` (add sign-out styles in top bar)

The top bar needs: (a) an optional `actions` slot so pages can put contextual buttons next to the theme switch (referenced in mockup `atelier.jsx:143-170` via its `right` prop), and (b) a sign-out button rendered unconditionally (this is the deviation from the mockup called out above).

- [ ] **Step 1: Rewrite `AdminTopBar.tsx`**

Replace the entire contents of `components/admin/AdminTopBar.tsx` with:

```tsx
'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AdminThemeSwitch } from './AdminThemeSwitch';

interface Props {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function AdminTopBar({ title, subtitle, actions }: Props) {
  const router = useRouter();

  function openCmdK() {
    const opener = (
      window as unknown as { __wlAdminOpenCmdk?: () => void }
    ).__wlAdminOpenCmdk;
    if (opener) opener();
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="wl-adm-topbar">
      <div className="title-group">
        {subtitle && <div className="sub">{subtitle}</div>}
        <h1>{title}</h1>
      </div>
      <button type="button" className="wl-adm-search" onClick={openCmdK}>
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </svg>
        <span className="placeholder">Search artworks, orders…</span>
        <kbd>⌘K</kbd>
      </button>
      <div className="right">
        {actions}
        <AdminThemeSwitch />
        <button
          type="button"
          className="wl-adm-topbar-signout"
          onClick={signOut}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Add sign-out styling in `admin.css`**

Open `app/admin/admin.css`. Find the `.wl-adm-topbar .right { ... }` block (around line 308-312). Immediately after its closing `}`, add:

```css
.wl-adm-topbar-signout {
  background: transparent;
  border: 1px solid transparent;
  color: var(--adm-muted);
  font-family: inherit;
  font-size: 12px;
  padding: 5px 10px;
  border-radius: var(--adm-radius-md);
  cursor: pointer;
}
.wl-adm-topbar-signout:hover {
  background: var(--adm-card);
  color: var(--adm-red);
  border-color: var(--adm-rule);
}
.wl-admin-surface[data-theme='dark'] .wl-adm-topbar-signout {
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  font-size: 11px;
  text-transform: lowercase;
}
```

- [ ] **Step 3: Verify typecheck**

Run:
```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Manual check in browser**

Start the dev server:
```bash
npm run dev
```

Open `http://localhost:3000/admin`. Confirm:
- Sign-out button appears on the right side of the top bar, after the theme switch.
- Clicking it logs out (redirects to `/login`).
- Nothing else is visually different yet (sidebar sign-out still present; we remove that in Task 6).

Kill dev server.

- [ ] **Step 5: Commit**

```bash
git add components/admin/AdminTopBar.tsx app/admin/admin.css
git commit -m "admin: AdminTopBar accepts actions slot + renders sign-out button"
```

---

## Task 4: `AdminTopBar` — Darkroom breadcrumb mode

**Files:**
- Modify: `components/admin/AdminTopBar.tsx`
- Modify: `app/admin/admin.css` (add `.wl-adm-topbar-crumbs` rules)

Darkroom (`darkroom.jsx:134-158`) renders a breadcrumb trail (`home / commerce / orders / #2184`) instead of the Atelier `title + subtitle` block. Strategy: emit both DOM shapes, hide one per theme via CSS. When no `breadcrumb` prop is provided, Darkroom falls back to `[title]` so the top bar is never empty.

- [ ] **Step 1: Extend `AdminTopBar.tsx` with breadcrumb rendering**

In `components/admin/AdminTopBar.tsx`:

1. Add `breadcrumb?: string[]` to `Props`:

```tsx
interface Props {
  title: string;
  subtitle?: string;
  breadcrumb?: string[];
  actions?: ReactNode;
}
```

2. Destructure it:

```tsx
export function AdminTopBar({ title, subtitle, breadcrumb, actions }: Props) {
```

3. Between the existing `<div className="title-group">` and `<button className="wl-adm-search">`, insert the breadcrumb nav:

```tsx
      <nav
        className="wl-adm-topbar-crumbs"
        aria-label="Breadcrumb"
      >
        {(breadcrumb ?? [title]).map((b, i, arr) => (
          <span key={i} className={i === arr.length - 1 ? 'current' : ''}>
            {b}
            {i < arr.length - 1 && <span className="sep">/</span>}
          </span>
        ))}
      </nav>
```

After this step the component renders both the title-group AND the breadcrumb nav; next step hides one per theme via CSS.

- [ ] **Step 2: Add breadcrumb CSS + theme-based visibility**

In `app/admin/admin.css`, after the `.wl-adm-topbar h1` block (around line 302-307), add:

```css
.wl-adm-topbar-crumbs {
  display: none;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 6px;
  color: var(--adm-ink-2);
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  font-size: 12px;
}
.wl-adm-topbar-crumbs .sep {
  color: var(--adm-dim);
  margin-left: 6px;
}
.wl-adm-topbar-crumbs .current {
  color: var(--adm-ink);
}
.wl-admin-surface[data-theme='dark'] .wl-adm-topbar-crumbs {
  display: flex;
}
.wl-admin-surface[data-theme='dark'] .wl-adm-topbar .title-group {
  display: none;
}
```

Also, the Darkroom top bar in the mockup has denser padding. Add this override right below:

```css
.wl-admin-surface[data-theme='dark'] .wl-adm-topbar {
  padding: 8px 16px;
  align-items: center;
}
```

- [ ] **Step 3: Verify typecheck**

Run:
```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Manual check — Atelier still looks correct**

Start the dev server:
```bash
npm run dev
```

Open `http://localhost:3000/admin`. Confirm Atelier shows `OVERVIEW / Today · [date]` + big serif title as before (title-group visible; breadcrumb nav hidden).

- [ ] **Step 5: Manual check — Darkroom shows breadcrumb**

In the same tab, click the Darkroom switch in the top bar. Confirm:
- Top bar becomes denser (8px vertical padding).
- Title-group disappears.
- Breadcrumb nav appears with the word "Overview" (since no breadcrumb prop is passed, it falls back to `[title]`).
- Theme switch + sign-out still visible on the right.

Kill dev server.

- [ ] **Step 6: Commit**

```bash
git add components/admin/AdminTopBar.tsx app/admin/admin.css
git commit -m "admin: AdminTopBar renders Darkroom breadcrumb via dual-DOM + CSS"
```

---

## Task 5: `AdminSidebar` — Darkroom head (W icon + mono wordmark + version)

**Files:**
- Modify: `components/admin/AdminSidebar.tsx`
- Modify: `app/admin/admin.css` (Darkroom head styles)

The Darkroom sidebar header (`darkroom.jsx:83-89`) shows a small `W` square + `wildlight` mono wordmark + `v2.4` version chip. Atelier keeps its existing serif `Wildlight / Imagery · Studio`. We emit both; CSS hides per theme.

Version string: hard-coded `v2.4` for now (matches mockup). TODO: wire to `package.json` in a later pass.

- [ ] **Step 1: Update `AdminSidebar.tsx` header JSX**

In `components/admin/AdminSidebar.tsx`, find the current header block (around lines 112-115):

```tsx
      <div className="wl-adm-sidebar-head">
        <div className="wordmark">Wildlight</div>
        <div className="sub">Imagery · Studio</div>
      </div>
```

Replace it with:

```tsx
      <div className="wl-adm-sidebar-head">
        <div className="atelier-head">
          <div className="wordmark">Wildlight</div>
          <div className="sub">Imagery · Studio</div>
        </div>
        <div className="darkroom-head">
          <div className="icon" aria-hidden="true">W</div>
          <div className="wordmark">wildlight</div>
          <div className="version">v2.4</div>
        </div>
      </div>
```

- [ ] **Step 2: Add CSS for both head variants**

In `app/admin/admin.css`, find the `.wl-adm-sidebar-head {` block (around line 116-118). Replace it and the child rules for `.wordmark` and `.sub` (lines 116-138) with:

```css
.wl-adm-sidebar-head {
  padding: 22px 20px 18px;
  border-bottom: 1px solid var(--adm-rule);
}
.wl-admin-surface[data-theme='dark'] .wl-adm-sidebar-head {
  padding: 14px 14px 12px;
}
.wl-adm-sidebar-head .atelier-head { display: block; }
.wl-adm-sidebar-head .darkroom-head { display: none; }
.wl-admin-surface[data-theme='dark'] .wl-adm-sidebar-head .atelier-head {
  display: none;
}
.wl-admin-surface[data-theme='dark'] .wl-adm-sidebar-head .darkroom-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Atelier head */
.wl-adm-sidebar-head .atelier-head .wordmark {
  font-family: var(--f-caslon), 'Libre Caslon Text', Georgia, serif;
  font-size: 18px;
  letter-spacing: 0.02em;
  line-height: 1;
  color: var(--adm-ink);
}
.wl-adm-sidebar-head .atelier-head .sub {
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.22em;
  color: var(--adm-muted);
  margin-top: 4px;
  text-transform: uppercase;
}

/* Darkroom head */
.wl-adm-sidebar-head .darkroom-head .icon {
  width: 22px;
  height: 22px;
  border-radius: 3px;
  background: var(--adm-green);
  color: var(--adm-paper);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}
.wl-adm-sidebar-head .darkroom-head .wordmark {
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.12em;
  color: var(--adm-ink);
}
.wl-adm-sidebar-head .darkroom-head .version {
  margin-left: auto;
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  font-size: 9px;
  color: var(--adm-muted);
}
```

Note: the first block above replaces the original `.wl-adm-sidebar-head` + `.wl-adm-sidebar-head .wordmark` + `.wl-admin-surface[data-theme='dark'] .wl-adm-sidebar-head .wordmark` + `.wl-adm-sidebar-head .sub` rules. Delete all four originals.

- [ ] **Step 3: Verify typecheck**

Run:
```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Manual check both themes**

Start the dev server:
```bash
npm run dev
```

Open `http://localhost:3000/admin`. Confirm:
- **Atelier:** sidebar head looks identical to before — `Wildlight` serif wordmark + `IMAGERY · STUDIO` mono subtitle.
- **Darkroom:** sidebar head becomes denser with a small green `W` square, lowercase mono `wildlight`, and `v2.4` version chip on the right.

Kill dev server.

- [ ] **Step 5: Commit**

```bash
git add components/admin/AdminSidebar.tsx app/admin/admin.css
git commit -m "admin: AdminSidebar shows Darkroom head (W icon + mono + version)"
```

---

## Task 6: `AdminSidebar` — system-health block + footer cleanup

**Files:**
- Modify: `components/admin/AdminSidebar.tsx`
- Modify: `app/admin/layout.tsx`
- Modify: `app/admin/admin.css` (add `.wl-adm-system-health` rules; remove `.wl-adm-signout`)

Two changes together because they're mutually-consistent: Darkroom's sidebar grows a system-health block, and the footer sheds its sign-out button (already moved to the top bar in Task 3).

System-health data is a hard-coded placeholder in this sub-project — wiring real health checks is Spec 5's job.

- [ ] **Step 1: Add `systemHealth` prop and render the block**

In `components/admin/AdminSidebar.tsx`:

1. Extend the `Props` interface:

```tsx
interface Props {
  needsReview: number;
  email: string;
  systemHealth?: Array<{ key: string; state: 'ok' | 'warn' | 'error'; note: string }>;
}
```

2. Destructure it:

```tsx
export function AdminSidebar({ needsReview, email, systemHealth }: Props) {
```

3. Inside `<nav className="wl-adm-sidebar-nav">`, after the Account nav group (i.e. after the `{ACCOUNT.map((n) => (<Item ... />))}` block, which is the last item at around lines 126-129), add the health block:

```tsx
        {systemHealth && systemHealth.length > 0 && (
          <>
            <div className="wl-adm-sidebar-group second">System</div>
            <div className="wl-adm-system-health">
              {systemHealth.map((h) => (
                <div key={h.key} className={`row state-${h.state}`}>
                  <span className="dot" aria-hidden="true" />
                  <span className="key">{h.key}</span>
                  <span className="note">{h.note}</span>
                </div>
              ))}
            </div>
          </>
        )}
```

- [ ] **Step 2: Remove the inline sign-out from the sidebar footer**

Still in `components/admin/AdminSidebar.tsx`:

1. Delete the `useRouter` import (line 4). Change:

```tsx
import { usePathname, useRouter } from 'next/navigation';
```

to:

```tsx
import { usePathname } from 'next/navigation';
```

2. Delete `const router = useRouter();` and the whole `signOut` function (around lines 98-108). The remaining function body keeps the `path`, `orders`, and `initials` consts.

3. In the JSX, delete the `<button type="button" className="wl-adm-signout" onClick={signOut}>sign out</button>` element (around line 142-144). The footer now ends after the `<div className="who">` block.

- [ ] **Step 3: Remove `.wl-adm-signout` CSS from `admin.css`**

Open `app/admin/admin.css`. Delete the two rules at lines 253-267:

```css
.wl-adm-signout {
  background: transparent;
  /* ...all properties... */
}
.wl-adm-signout:hover {
  /* ... */
}
```

(Lines 253-267 inclusive.)

- [ ] **Step 4: Add CSS for the system-health block**

In `app/admin/admin.css`, after the `.wl-adm-sidebar-foot` rules (around line 268), add:

```css
/* ─────── SYSTEM HEALTH (Darkroom-only block, Atelier hides it) ─────── */

.wl-adm-system-health {
  padding: 0 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
}
.wl-adm-system-health .row {
  padding: 3px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--f-mono), 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--adm-ink-2);
}
.wl-adm-system-health .dot {
  width: 6px;
  height: 6px;
  border-radius: 6px;
  background: var(--adm-green);
  flex-shrink: 0;
}
.wl-adm-system-health .row.state-warn .dot {
  background: var(--adm-amber);
}
.wl-adm-system-health .row.state-error .dot {
  background: var(--adm-red);
}
.wl-adm-system-health .row.state-error .note {
  color: var(--adm-red);
}
.wl-adm-system-health .key {
  flex: 1;
}
.wl-adm-system-health .note {
  font-size: 10px;
  color: var(--adm-muted);
}

/* Atelier: hide the whole block */
.wl-admin-surface:not([data-theme='dark']) .wl-adm-system-health,
.wl-admin-surface:not([data-theme='dark']) .wl-adm-sidebar-nav > .wl-adm-sidebar-group.second:has(+ .wl-adm-system-health) {
  display: none;
}
```

Note the second selector: it also hides the "System" group label in Atelier using `:has()`. If the lint/CSS toolchain doesn't support `:has()` (Next 16 + modern browsers do), the alternative is to render the "System" label inside `.wl-adm-system-health` and delete this compound selector.

- [ ] **Step 5: Pass a placeholder `systemHealth` from the layout**

In `app/admin/layout.tsx`, find the render of `<AdminSidebar />` (around line 33). Change:

```tsx
<AdminSidebar needsReview={needsReview} email={session.email} />
```

to:

```tsx
<AdminSidebar
  needsReview={needsReview}
  email={session.email}
  systemHealth={[
    { key: 'stripe', state: 'ok', note: 'live' },
    { key: 'printful', state: 'ok', note: 'ok' },
    { key: 'resend', state: 'ok', note: 'ok' },
    { key: 'webhooks', state: 'ok', note: 'ok' },
  ]}
/>
```

- [ ] **Step 6: Verify typecheck**

Run:
```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 7: Manual check both themes**

Start the dev server:
```bash
npm run dev
```

Open `http://localhost:3000/admin`. Confirm:
- **Atelier:** sidebar footer no longer has a sign-out button — just the avatar + user block. System-health block is hidden.
- **Darkroom:** sidebar shows a "SYSTEM" group label with 4 rows (stripe/printful/resend/webhooks, all with green dots) below the nav. Footer is avatar + email only.
- Sign out still works from the top bar (tested in Task 3).

Kill dev server.

- [ ] **Step 8: Commit**

```bash
git add components/admin/AdminSidebar.tsx app/admin/layout.tsx app/admin/admin.css
git commit -m "admin: AdminSidebar gains system-health block, sign-out moves to top bar"
```

---

## Task 7: `AdminPill` — fill in missing status styles

**Files:**
- Modify: `app/admin/admin.css` (pill `draft`, `retired`, `refunded`, `canceled`, `unsub` rules)

The current pill CSS (`admin.css:491-530`) handles `published / shipped / delivered / active` (green), `paid / pending` (amber), `submitted / fulfilled / resubmitting` (blue), and `needs_review` (red). It leaves `draft`, `retired`, `refunded`, `canceled`, `unsub` on the default fallback. The mockup (see `atelier.jsx:30-45` and `darkroom.jsx:30-45`) treats these as muted / de-emphasized.

- [ ] **Step 1: Add muted status rules to the pill CSS**

In `app/admin/admin.css`, find the `.wl-adm-pill[data-status='needs_review']` block (around lines 524-530). Immediately after its closing `}`, add:

```css
.wl-adm-pill[data-status='draft'],
.wl-adm-pill[data-status='retired'],
.wl-adm-pill[data-status='refunded'],
.wl-adm-pill[data-status='canceled'],
.wl-adm-pill[data-status='unsub'] {
  background: var(--adm-chip-track);
  color: var(--adm-ink-2);
}
.wl-adm-pill[data-status='draft'] .dot,
.wl-adm-pill[data-status='retired'] .dot,
.wl-adm-pill[data-status='refunded'] .dot,
.wl-adm-pill[data-status='canceled'] .dot,
.wl-adm-pill[data-status='unsub'] .dot {
  background: var(--adm-muted);
}
.wl-admin-surface[data-theme='dark'] .wl-adm-pill[data-status='draft'],
.wl-admin-surface[data-theme='dark'] .wl-adm-pill[data-status='retired'],
.wl-admin-surface[data-theme='dark'] .wl-adm-pill[data-status='refunded'],
.wl-admin-surface[data-theme='dark'] .wl-adm-pill[data-status='canceled'],
.wl-admin-surface[data-theme='dark'] .wl-adm-pill[data-status='unsub'] {
  background: var(--adm-panel-2);
  color: var(--adm-muted);
}
```

- [ ] **Step 2: Manual check on artworks list**

Start the dev server:
```bash
npm run dev
```

Open `http://localhost:3000/admin/artworks`. The list has artworks in `draft` and (likely) `retired` states. Confirm both pills render with a muted sand-colored chip (Atelier) or dark panel (Darkroom) — distinct from the `published` green.

If the DB has no `draft` or `retired` artworks, seed one manually via SQL:

```bash
psql "$DATABASE_URL" -c "UPDATE artworks SET status='draft' WHERE id = (SELECT id FROM artworks ORDER BY id LIMIT 1);"
```

Then reload the page. Revert with:

```bash
psql "$DATABASE_URL" -c "UPDATE artworks SET status='published' WHERE id = (SELECT id FROM artworks ORDER BY id LIMIT 1);"
```

Kill dev server.

- [ ] **Step 3: Commit**

```bash
git add app/admin/admin.css
git commit -m "admin: muted pill styles for draft/retired/refunded/canceled/unsub"
```

---

## Task 8: End-to-end smoke test against the mockup

**Files:**
- None modified. Pure verification.

Open the mockup in a browser and compare side-by-side with the running admin.

- [ ] **Step 1: Open the mockup**

In your OS file explorer or via the shell, open:

```
temp/wild-light-admin/wild-light-admin/project/Wildlight Admin.html
```

in a browser. It renders three artboards side-by-side:
- "Wildlight Admin — switchable theme" — the combined shell with the theme switch
- "Atelier — light reference"
- "Darkroom — dark reference"

- [ ] **Step 2: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 3: Compare the Overview (dashboard) screen**

Open `http://localhost:3000/admin` in a second browser window, side-by-side with the mockup. Work through both themes:

**Atelier checklist:**
- Sidebar head: serif "Wildlight" + uppercase mono "IMAGERY · STUDIO"
- Sidebar nav: three groups (Catalog / Commerce / Account), active item has paper bg + left/inset stroke
- Sidebar footer: round green avatar + user block, no sign-out button
- No system-health section
- Top bar: uppercase mono subtitle + large serif title, ⌘K search pill, theme switch, subtle "Sign out" button on the right

**Darkroom checklist (switch themes via the top-bar toggle):**
- Sidebar head: green `W` square + lowercase mono "wildlight" + `v2.4` version chip on the right
- Sidebar nav: same groups, but active item shows a left teal rule
- Sidebar gains a SYSTEM block with four rows (stripe/printful/resend/webhooks, green dots, note text on the right)
- Top bar: breadcrumb nav (single crumb "Overview") replaces the title-group; denser padding
- Theme switch + lowercase "sign out" on the right

Expected discrepancies (NOT to fix in this sub-project — they're later sub-projects' scope):
- The dashboard content (KPI cards, sparkline, needs-review, recent orders, catalog stats) may not match the mockup exactly. That's Spec 4's job.
- Artworks list, order list, etc. content styling — later sub-projects.

- [ ] **Step 4: Compare the Artworks list screen**

Navigate to `http://localhost:3000/admin/artworks`. Verify:
- Same sidebar + top-bar chrome as Overview, in both themes.
- Pills on the rows render in theme-appropriate style (rounded in Atelier, mono-lowercase in Darkroom).
- "draft" or "retired" pills (if any rows match) render muted, not default.

Content discrepancies vs mockup list are Spec 2's scope — do not address here.

- [ ] **Step 5: Functional checks**

- [ ] Sign out works from both themes (click, lands on `/login`).
- [ ] Theme switch persists across a full-page reload (Ctrl-R).
- [ ] Theme switch persists across tabs (open `/admin/artworks` in a new tab — starts in the same theme).
- [ ] `⌘K` / `Ctrl-K` opens the command palette (verifies `__wlAdminOpenCmdk` wiring still intact).

- [ ] **Step 6: If anything is broken**

If any sidebar/topbar/pill item looks visually wrong vs the mockup checklist above, go back to the relevant task, fix, and re-commit. Do not patch around the issue with inline style overrides on specific screens.

If functional checks fail (sign-out doesn't navigate, theme doesn't persist, cmd-K doesn't open), revert to the offending task and debug there.

- [ ] **Step 7: Kill dev server, confirm clean tree**

```bash
git status
```

Expected output: clean working tree, branch ahead of `origin/main` by 7 commits (Tasks 1-7). No uncommitted changes.

---

## Exit criteria

All of these must be true before declaring the plan complete:

1. `npm run typecheck` passes with no errors.
2. Dev server starts, `/admin` loads in both themes.
3. Atelier theme: no visual regression vs pre-plan state for screens other than those the plan touches.
4. Darkroom theme: breadcrumb top bar, system-health sidebar block, `W`/mono/version head, mono+lowercase pills, dense padding — all match the `Wildlight Admin.html` reference.
5. Sign out works from the top bar on every admin route, in both themes.
6. Theme switch persists (cookie + localStorage) across reloads and new tabs.
7. 7 clean commits on the branch (one per task).

## Out of scope reminders

These are **deliberately not done** here and belong to later sub-projects:

- Dashboard KPI styling, revenue chart vs mockup — Spec 4.
- Artworks list bulk-action buttons, AI-draft — Spec 2.
- Artwork detail fields / variant table polish — Spec 2.
- Orders list/detail content + needs-review callout — Spec 3.
- Collections, Subscribers broadcast composer, Settings panels, Cmd-K command content, Login chrome — Spec 5.
- Wiring real integration health checks (replacing the placeholder) — Spec 5.
- Migrating existing `<button className="wl-adm-btn">` call sites to `<AdminButton>` — each sub-project does this for the screens it touches.
