# Admin Redesign — Sub-project 1: Design System + Shell Parity

**Date:** 2026-04-24
**Status:** Spec
**Parent:** `2026-04-24-admin-redesign-overview.md`

## Target mockup

Source of truth: `temp/wild-light-admin/wild-light-admin/project/`.

Primary references for this sub-project:

- `atelier.jsx:6–26` — Atelier color palette + font stack.
- `atelier.jsx:29–63` — `aStatusStyle` + `APill` (the pill component
  and its per-status palette).
- `atelier.jsx:65–141` — `ASidebar` + `ANavItem` (Atelier sidebar).
- `atelier.jsx:143–170` — `ATopBar` (Atelier top bar).
- `atelier.jsx:172–189` — `ABtn` (button variants).
- `atelier.jsx:486–497` — `AField` (labeled input).
- `darkroom.jsx:6–46` — Darkroom color palette + `dStatus` style map.
- `darkroom.jsx:48–70` — `DPill` + `DBtn`.
- `darkroom.jsx:72–132` — `DSidebar` (includes system-health block).
- `darkroom.jsx:134–158` — `DTopBar` (breadcrumb variant).
- `darkroom.jsx:485–496` — `DField`.
- `theme-switch.jsx` — the segmented theme switch (already implemented
  as `components/admin/AdminThemeSwitch.tsx`, verify parity).
- `Wildlight Admin.html` — open in a browser to see the intended
  visual result.

## Scope

Bring the admin design system and shell to **mockup parity in both
themes**. Zero content changes. Zero new screens. The deliverable is:
the existing dashboard looks "right" in both themes with matching
typography, spacing, and chrome when compared side-by-side with the
mockup.

Screens 2–7 (sub-projects 2–5) ride on the parity this sub-project
delivers. Any visual debt left here propagates.

## Non-goals

- No screen content rewrites. Other sub-projects own those.
- No new screens. Cmd-K content / Login chrome / broadcast composer
  all live in sub-project 5.
- No schema changes.
- No changes to `app/(shop)/*` (marketing site).
- No changes to authentication or session handling.

## Current state (what's already correct)

- `next/font/google` loads Inter (`--f-ui`), Libre Caslon Text
  (`--f-caslon`), and JetBrains Mono (`--f-mono`) at
  `app/layout.tsx:32–56`. No font work needed.
- `app/admin/admin.css` (1603 lines) defines both palettes as CSS
  custom properties under `.wl-admin-surface`, switched via
  `[data-theme='dark']`. Token names are semantic. Matches mockup
  colors closely.
- `lib/admin-theme.ts` + `components/admin/AdminThemeSwitch.tsx`
  implement cookie-backed theme persistence with SSR no-flash first
  paint. **Keep as-is** — this is better than the mockup's
  localStorage-only approach.
- `app/admin/layout.tsx:31–39` applies `data-theme` on the server.
- `components/admin/AdminSidebar.tsx` renders the Atelier sidebar
  correctly. `components/admin/AdminTopBar.tsx` renders the Atelier
  top bar. Both present in the repo.

## Gaps identified (what this sub-project fixes)

### 1. AdminTopBar lacks a right-side actions slot

Current `AdminTopBar.tsx` emits `{ title, subtitle }` and an
unconditional `<AdminThemeSwitch />` on the right. The Atelier mockup
(`atelier.jsx:143–170`) accepts a `right` slot that callers use for
contextual buttons (e.g. "Sign out" on the dashboard,
`atelier.jsx:896–898`; "+ New artwork" on the list, though the list
uses its own subhead instead).

**Fix:** Add `actions?: ReactNode` prop. Keep `<AdminThemeSwitch />`
always-rendered inside `.right`; append `actions` after it. This
preserves the theme switch in every screen.

### 2. AdminTopBar has no Darkroom breadcrumb mode

Darkroom's `DTopBar` (`darkroom.jsx:134–158`) is fundamentally
different: it renders a breadcrumb trail (e.g. `home / commerce /
orders / #2184`) in mono, rather than a `title + subtitle` block. The
current `AdminTopBar` only supports the Atelier shape.

**Fix:** Accept an optional `breadcrumb?: string[]` prop. When
present, render the Darkroom breadcrumb shape regardless of theme
*except* use CSS to show the `title + subtitle` treatment in Atelier
and the breadcrumb trail in Darkroom.

Implementation approach — emit both DOM shapes and hide one per theme
via CSS. This keeps the component API simple for callers (they
provide both `title` and `breadcrumb`; each theme picks the right
one). Rejected: branching component selection by theme at runtime
(would re-trigger SSR-vs-client mismatches, and the theme is already
a DOM attribute).

Callers that don't provide a `breadcrumb` fall back to synthesizing
one from the page path in the top-bar CSS (under Darkroom only). We
prefer explicit props over path-parsing.

### 3. AdminSidebar is missing the Darkroom system-health block

Darkroom's `DSidebar` (`darkroom.jsx:112–124`) renders below the nav:

```
SYSTEM
● stripe      live
● printful    ok
● resend      ok
● webhooks    1 failing   (red)
```

Current `AdminSidebar` has no such block. This is Darkroom-only in
the mockup; Atelier's sidebar is cleaner and omits it.

**Fix:** Extend `AdminSidebar` to accept an optional `systemHealth?:
Array<{ key: string; state: 'ok' | 'warn' | 'error'; note: string }>`
prop. Render it in a dedicated section below the nav. Hide the whole
block in Atelier via CSS (`.wl-admin-surface:not([data-theme='dark'])
.wl-adm-system-health { display: none; }`) — it's Darkroom-only.

Feeding this prop requires a small query. The parent layout already
does the `needs_review` count query; in a follow-up we can extend it
to check integration health. For sub-project 1, feed the sidebar a
hardcoded "all ok" set as a placeholder so the block renders but
doesn't yet reflect live state. Wiring real health checks is a
follow-up, not a blocker.

### 4. AdminSidebar Darkroom head differs

Darkroom's `DSidebar` header (`darkroom.jsx:83–89`) shows a `W` icon
square + `wildlight` mono wordmark + `v2.4` version chip, not
`Wildlight / Imagery · Studio`.

**Fix:** Render both treatments and hide/show per theme via CSS. The
`Wildlight` serif wordmark already exists; add the `W` square + mono
wordmark + version chip as a sibling, hidden in Atelier and shown in
Darkroom. Version string reads from `package.json` via a build-time
constant (e.g. `NEXT_PUBLIC_APP_VERSION`) — or hard-coded for now
with a TODO.

### 5. AdminSidebar footer differs between themes

Atelier footer (`atelier.jsx:109–115`): round green avatar with serif
initials + user block. No sign-out button.

Darkroom footer (`darkroom.jsx:126–129`): small square mono avatar +
email only. No sign-out button.

Current footer has a sign-out button inline. The button is useful
but neither mockup theme shows it.

**Fix:** Keep sign-out, but move it to the top bar's `actions` slot
(see gap #1). That's where the Atelier reference puts it on the
dashboard (`atelier.jsx:896–898`). Footer then cleanly matches both
mockups: avatar + user block, no extra button.

### 6. AdminPill needs Darkroom mono-lowercase styling

Darkroom's `DPill` (`darkroom.jsx:48–57`) renders in mono, lowercase,
with a square small corner radius and no leading dot. Atelier's
`APill` (`atelier.jsx:49–63`) is a rounded pill with a dot and
label-case text.

Current `AdminPill` renders `<span class="wl-adm-pill" data-status>`
with a `<span class="dot">`. Need to verify CSS handles both shapes:
Atelier shape is the default; Darkroom should hide the dot, switch
to mono, lowercase, and shrink the border radius.

**Fix:** Audit the existing `.wl-adm-pill` + `[data-theme='dark']
.wl-adm-pill` rules in `admin.css`. Extend or add to match mockup.
Spot-check every status in `LABELS` (`AdminPill.tsx:1–17`) against
`aStatusStyle` (`atelier.jsx:29–47`) and `dStatus`
(`darkroom.jsx:29–46`) — they must cover the same set.

### 7. Shared button needs an AdminButton component

Both mockups use a `Button` with variants (`primary`, `ghost`,
`danger`, `small`). Current admin uses inline `<button
className="wl-adm-btn ...">` everywhere — functional, but means
styling lives only in CSS and inconsistency creeps in.

**Fix:** Extract `components/admin/AdminButton.tsx` that renders
`<button className="wl-adm-btn ${small ? 'small' : ''} ${primary ?
'primary' : ''} ${danger ? 'danger' : ''} ${ghost ? 'ghost' : ''}">`.
Accepts `icon?: ReactNode`, `children`, `onClick`, `type`, `as?:
'button' | 'link'` for link-shaped buttons. Do not break callers —
existing `<button className="wl-adm-btn">` continues to work. New
code uses `<AdminButton>`; existing sites get migrated as each
sub-project passes through its screen.

### 8. Token audit: Darkroom accents

Check `admin.css` `[data-theme='dark']` block (lines 41–61) against
`darkroom.jsx:6–27`:

- Current has `--adm-green: #8fb98a` (Darkroom teal) ✓
- Current has `--adm-green-soft: #1d2920` (tealBg) ✓
- Current has `--adm-amber`, `--adm-red`, `--adm-blue` matching
  Darkroom values
- Missing: `--adm-panel2` (`#1b1f25`), `--adm-hover` (`#20252c`),
  `--adm-dim` (`#4a4d51`). Darkroom uses these for secondary panels
  and disabled text.
- Missing: Atelier `--adm-amber`, `--adm-red`, `--adm-blue`,
  `--adm-green-soft`, `--adm-amber-soft`, `--adm-red-soft`,
  `--adm-blue-soft` — verify these exist under the default block.

**Fix:** Add the missing tokens to both theme blocks. No names change;
just additions.

## Implementation order

1. Token audit + additions to `admin.css`.
2. `AdminButton` extraction (no rewrites of existing call sites).
3. `AdminTopBar` `actions` slot.
4. `AdminTopBar` Darkroom breadcrumb dual-DOM treatment.
5. `AdminSidebar` Darkroom head (W icon + mono wordmark + version
   chip).
6. `AdminSidebar` system-health block (placeholder data for now).
7. `AdminSidebar` footer cleanup (remove inline sign-out; let the
   dashboard pass it through `AdminTopBar.actions`).
8. `AdminPill` CSS audit against both mockup palettes.
9. Smoke-test: load `/admin` in the browser, switch themes, verify
   chrome matches mockup side-by-side. Spot-check on `/admin/artworks`
   too — any obvious chrome regression gets patched before merge.

## Testing

Unit tests are low-leverage here — these are visual changes. Strategy:

- One Vitest test per changed component: given props, snapshot or
  assert key rendered elements exist. Not a rendering fidelity test.
- Manual visual parity pass: open `Wildlight Admin.html` and the
  running dev server side-by-side, switch themes, compare.

No end-to-end test.

## Rollout

Single PR. No feature flag — admin is Dan-only and pre-release.
If the parity pass breaks a screen cosmetically mid-review,
subsequent sub-projects will fix it as they rebuild their screens.
Breaking a screen functionally is not acceptable — tokens and shell
changes must not regress behavior.

## Open questions

1. **Version string for the Darkroom sidebar head.** Read from
   `package.json` at build time via `NEXT_PUBLIC_APP_VERSION`, or
   hard-code `v2.4` like the mockup? Default to hard-coded for now,
   TODO to wire `package.json` later.
2. **System-health block data source.** Sub-project 1 uses a
   hardcoded placeholder. Wiring real checks (`stripe.ping`,
   `printful.status`, etc.) is a follow-up sub-project or folded
   into Spec 5 (Settings has an integrations panel with the same
   information).

## Exit criteria

- Dashboard renders in Atelier without visual regression, matching
  the Atelier mockup within the limits of the existing screen content.
- Dashboard renders in Darkroom with correct chrome: mono breadcrumb
  top bar, system-health block in sidebar, W icon + version head,
  mono+lowercase pills.
- Theme switch flips both chromes cleanly, no flash.
- `AdminButton` exists and is at least one caller migrated (the
  smoke-test site).
- `admin.css` has all tokens both mockups reference.
- No screen is broken functionally.
