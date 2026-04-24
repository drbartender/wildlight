# Admin Redesign — Sub-project 5c: Collections + Login

**Date:** 2026-04-24
**Status:** Spec
**Parent:** `2026-04-24-admin-redesign-overview.md`

## Design invariant

Atelier Collections is an editorial 3-column card grid with the
cover image, serif title, italic serif tagline, artwork count, slug,
and an Edit button — gallery feel. Darkroom Collections is an 8-column
mono panel table with drag handles, inline-editable tagline, artwork
count, and row-inline `edit · hide` actions — workbench feel. Login
Atelier is a paper form with serif wordmark and green primary; Login
Darkroom is a mono panel with a teal `W` square + `admin · v2.4` chip
+ `→ sign in` primary + system-status strip. Preserve all of that
disparity.

## Target mockup

- `atelier.jsx:499–528` — `ACollections`. 3-column card grid; card
  has 16:9 cover, serif title, right-aligned mono `#order`, italic
  serif tagline, `N artworks`, slug in mono, small ghost `Edit`.
  Dashed `+ New collection` placeholder tile closes out the grid.
- `darkroom.jsx:498–539` — `DCollections`. Single panel table with
  `drag to reorder` hint. Columns: `ord` (handles + number), `cover`
  (36×24 thumbnail), `title` (ink), `tagline` (inline-editable
  input), `slug` (muted `/slug`), `artworks` (right teal), actions
  (`edit · hide`).
- `atelier.jsx:799–822` — `ALogin`. 360px centered form. Serif
  `Wildlight` wordmark + uppercase mono `IMAGERY · STUDIO`. Card with
  `AField` email + password + "Remember this studio" checkbox + green
  primary `Sign in`. Footer `Trouble signing in? Contact Dallas.`
- `darkroom.jsx:856–877` — `DLogin`. 340px form. Teal `W` square +
  mono `wildlight` + `admin · v2.4`. Top-right strip: `● all systems
  ok` (teal). Panel with mono `DField`s + teal `→ sign in` primary.
  Footer `// session expires after 7d inactivity`.
- Open `Wildlight Admin.html` locally.

## Scope

1. **Collections page per skin** — two different renderings of the
   same data: card grid (Atelier) vs. table (Darkroom).
2. **Login page per skin** — two different shells around the same
   form fields.
3. **Light CSS migration** as callers move to `AdminButton` where
   it's the natural fit (e.g. Collections Edit, Login Sign in).

## Non-goals

- No drag-and-drop wiring on Darkroom — ordering stays via
  `display_order` in the DB. The Darkroom `⋮⋮` handles render but
  aren't interactive this spec. Flag with a tooltip `"ordering is
  read-only in this pass"`.
- No new collection CRUD flows. Create / Edit flows already exist.
- No auth / session changes. Login only gets a chrome pass.
- No `last_login` / `session expiry` wiring for Login's "7d"
  footer. It's informative copy, not a live timer.
- No ⌘K real search. Explicit deferral — revisit when the catalog
  exceeds ~30 artworks.

## Current state

- `app/admin/collections/page.tsx` — existing collections admin
  page, currently one DOM shape for both skins. Split per skin.
- `app/login/page.tsx` + `app/login/layout.tsx` — existing login.
  Currently mostly Atelier-shaped; add Darkroom shell.
- `lib/admin-theme.ts` — cookie read helper for SSR no-flash.

## Layout per skin

### `/admin/collections` — Atelier (`ACollections`)

- `padding: 28`, `grid-template-columns: repeat(3, 1fr), gap: 16`.
- Each collection card: 8px radius, rule border, paper card.
  - Cover: `aspect-ratio: 16/9`, `object-fit: cover`, `paperAlt`
    fallback background.
  - Body padding 16px:
    - Serif 20px title, right-aligned mono `#{display_order}`.
    - Italic serif 13px muted tagline.
    - Row: `{count} artworks` sans + `/slug` mono muted + ghost small
      `Edit` button.
- Trailing `+ New collection` tile: 1px dashed rule border, 8px
  radius, centered muted sans label. Clicks to the create flow.

### `/admin/collections` — Darkroom (`DCollections`)

- `padding: 16`. One panel:
  - Panel header strip (mono): `collections` ink + `[N]` muted +
    `· drag to reorder` muted + right-aligned small primary `+ new`.
  - Mono table. Columns:
    - `ord` (40px): `⋮⋮` handle + number, muted.
    - `cover` (60px): 36×24 thumbnail, 2px radius.
    - `title` (ink).
    - `tagline` (ink2): rendered as an inline input with
      `border: 1px solid transparent` to match mockup's editable
      look — but NOT wired to a save endpoint this spec. Show a
      `readOnly` attribute and note-in-UI `// inline-edit coming
      later` in the panel footer.
    - `slug` (muted): `/slug`.
    - `artworks` (right, teal): count of published artworks.
    - actions: `edit · hide` row-inline text buttons in muted; on
      hover, ink. `edit` navigates to the existing edit flow;
      `hide` is a no-op this spec (render a tooltip).

### `/login` — Atelier (`ALogin`)

- Centered 360px form. Paper background.
- Wordmark stack:
  - `Wildlight` serif 28px ink.
  - `IMAGERY · STUDIO` uppercase mono 10px, tracked, muted.
- Card (8px radius, rule border, 24px padding):
  - `AField` Email + Password.
  - Row: `<input type="checkbox" checked /> Remember this studio`
    muted sans 12px.
  - Green primary `Sign in` button (full-width).
- Footer muted: `Trouble signing in? Contact Dallas.`

### `/login` — Darkroom (`DLogin`)

- Centered 340px form. `D.bg` background, mono default.
- Top row:
  - 28×28 teal `W` square (3px radius, bg-text) — reuse
    `.wl-adm-sidebar-head .darkroom-head .icon` styling.
  - `wildlight` mono 13px tracked.
  - `admin · v2.4` mono 9px muted.
  - Right-aligned `● all systems ok` teal 10px. (Data-driven from
    the `/api/admin/integrations/health` endpoint once Spec 5b
    lands — for this spec, hardcode `all systems ok` unless 5b has
    already merged.)
- Panel (4px radius, rule border, 20px padding):
  - `DField` email + password.
  - Teal primary `→ sign in` button (full-width, mono 12px).
- Footer muted: `// session expires after 7d inactivity`.

## Implementation notes

- Keep both DOM shapes in the same component file and hide by
  `[data-theme]` attribute, matching the pattern used by
  `AdminTopBar` in sub-project 1. No runtime theme branching in JS.
- `/login/layout.tsx` already loads `admin.css`; CSS only needs the
  new `.wl-adm-login-*` rules.

## Testing

No automated tests. Manual visual parity pass against the mockup in
both skins.

## Rollout

Single PR. No schema migration.

## Deferred — explicit non-shipping note

⌘K real search (searching artworks / orders / subscribers from the
command palette) is deliberately **not** part of this spec. The
existing static `AdminCmdK` stays. Revisit when the catalog exceeds
~30 artworks or a specific "I can't find an order" need emerges.

## Exit criteria

- Atelier Collections renders as a 3-column card grid with serif +
  italic tagline treatment.
- Darkroom Collections renders as a single mono panel table with
  drag handles (non-interactive), inline-edit-styled tagline
  (`readOnly`), and row actions.
- Atelier Login renders the paper + serif + green flow.
- Darkroom Login renders the mono + teal + status-strip flow.
- Sign-in works on both skins.
- No regression: hitting `/login` while authenticated still
  redirects to `/admin`.
