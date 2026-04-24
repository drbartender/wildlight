# Admin Redesign — Overview & Decomposition

**Date:** 2026-04-24
**Status:** Roadmap approved, sub-project specs to follow

## What this is

An anchor document for the full admin UI redesign specified in the
"Wildlight Admin — Two Directions" mockup at
`temp/wild-light-admin/wild-light-admin/project/`. That mockup is a
fully-realized dual-theme admin shell (Atelier — warm editorial light,
Darkroom — dark terminal-style workbench) covering every existing admin
screen plus a handful of new ones.

The scope is too large for a single spec → plan → implementation cycle.
This document decomposes it into sub-projects with a defined order and
architecture, and each sub-project gets its own spec + plan + merge
cycle.

## Source of truth

The canonical design lives in `temp/wild-light-admin/wild-light-admin/project/`
in the working directory. **Every sub-project spec must reference these
files directly and treat them as the design contract** — current admin
code is a prior iteration, not the target. When in doubt, the mockup
wins.

Files:

- `atelier.jsx` (916 lines) — Atelier theme, all 8 screens + login +
  cmd-K. Direction A: warm paper bg, deep-green accent, Libre Caslon
  serif for display, Inter body, JetBrains Mono numerics.
- `darkroom.jsx` (969 lines) — Darkroom theme, same screens. Direction
  B: dark neutral workbench, mono for IDs/numerics, sans body, single
  teal accent, denser layouts.
- `theme-switch.jsx` — segmented theme-switch component with
  localStorage persistence via a custom-event.
- `mock-data.js` — representative mock data (artworks, collections,
  orders, subscribers, revenue history) for the screens. Shape of this
  data is informative for what each screen needs from the server.
- `Wildlight Admin.html` — the shell that renders `<ThemedAdmin>`,
  which switches between the two themes. The separate `Atelier` /
  `Darkroom` artboards are reference views only; the intended product
  is a single admin with a theme switch.

### Using the mockup as reference

Each sub-project spec must:

1. Name the specific mockup functions it targets (e.g. `AArtworksList`
   and `DArtworksList` in `atelier.jsx` / `darkroom.jsx`) with line
   ranges.
2. Call out any intentional deviations from the mockup with rationale,
   up front. Silent deviations are not acceptable.
3. Define its "done" criteria against side-by-side comparison with the
   mockup rendered in a browser (open `Wildlight Admin.html` locally
   to see what the result should look like).

## Constraints

- Dan is unavailable as an author or reviewer. He is only on the hook
  for uploading hi-def files at sale time.
- The current admin at `app/admin/*` already has routing and data
  plumbing (API routes, the `AdminField` / `AdminPill` / `AdminTopBar`
  / `VariantTable` components, the auth middleware). The redesign
  rebuilds the UI on top of that plumbing — no new routes, no schema
  changes.
- Public site (`app/(shop)/*`) is owned by a parallel effort in a
  different session. This work does not touch shop components, shop
  layout, or shop styling.

## Current state

A prior iteration of this work exists in the repo. Relevant pieces:

- `app/admin/admin.css` — 1603 lines. Scoped under `.wl-admin-surface`.
  Defines both Atelier (default) and Darkroom palettes as CSS custom
  properties, switched via `[data-theme='dark']`. Semantic token names
  (`--adm-ink`, `--adm-rule`, `--adm-paper`, etc.).
- `components/admin/AdminThemeSwitch.tsx` — segmented switch backed by
  a `wl_admin_theme` cookie (one year) + localStorage. SSR reads the
  cookie via `lib/admin-theme.readAdminTheme()` so first paint has the
  correct theme (no flash).
- `components/admin/AdminSidebar.tsx`, `AdminTopBar.tsx`,
  `AdminPill.tsx`, `AdminField.tsx`, `AdminCmdK.tsx`, `VariantTable.tsx`
  — the shell component set.
- `app/admin/layout.tsx` — applies `data-theme` on the server, renders
  sidebar + cmd-K + children.
- Screens: dashboard, artworks list + detail + new, collections,
  orders list + detail, subscribers, settings — all exist in rough
  form with `wl-adm-*` classes.

The redesign is a **parity pass against the mockup**, not a rewrite.
Most of the scaffolding is correct; most screens need layout and
detail work to reach mockup fidelity, plus the new features the
mockup introduces (broadcast composer, integrations panel, cmd-K
command list, "apply template" bulk action, etc.).

## Architecture

### Keep the existing conventions

- Admin styles stay scoped under `.wl-admin-surface` in
  `app/admin/admin.css`. No per-component styled-jsx or CSS modules
  unless a specific component's complexity demands it.
- Theme switching stays cookie-backed via `lib/admin-theme.ts` — SSR
  no-flash rendering is already correct, do not regress it.
- Components stay under `components/admin/` with the `Admin*` prefix
  (no new `shell/` folder).
- New per-screen sub-components live under `components/admin/<screen>/`
  when a screen grows beyond a single file.

### Tokens

`admin.css` already exposes a semantic token vocabulary. New tokens
that the mockup requires (e.g. a Darkroom-specific teal accent, a
Darkroom-specific mono-first sidebar variant, typography scale steps)
are added to `admin.css` in sub-project 1 as part of the design-system
gap work.

### Typography

Inter + Libre Caslon Text + JetBrains Mono. Current state: check
whether these fonts are loaded. If not, sub-project 1 adds them via
Next.js `next/font/google` in the admin layout.

### Component boundary

- `AdminTopBar` today: emits `title` + `subtitle`. Mockup's Atelier
  top bar also includes a `⌘K` search trigger and right-side `actions`
  slot; Darkroom top bar is a breadcrumb. Sub-project 1 brings
  `AdminTopBar` to parity and adds theme-aware breadcrumb rendering.
- `AdminSidebar` today: check what it renders. Darkroom variant has a
  system-health block and a compact mono layout; Atelier has nav
  groups ("Catalog" / "Commerce" / "Account"). Sub-project 1 brings
  both to parity.
- `AdminPill`, `AdminField`, `VariantTable` — likely minor polish, not
  rewrites.
- `AdminCmdK` today: exists but content/commands may differ from the
  mockup. Gap work falls to sub-project 5.

### Deletion discipline

Each sub-project that replaces a screen or component deletes the
unique CSS rules it owned in `admin.css`. `admin.css` should not
grow unboundedly — it should shrink or stay flat as sub-projects
consolidate patterns into tokens.

## Decomposition

Each row is one spec → plan → implementation → merge cycle. Order
matters for the first two; the rest can parallelize once the shell
lands.

| # | Sub-project | Depends on | Scope |
|---|---|---|---|
| 1 | **Design system + shell parity** | — | Audit `admin.css` tokens against both mockup palettes and fill gaps. Verify/add `next/font` for Inter, Libre Caslon, JetBrains Mono. Bring `AdminSidebar`, `AdminTopBar`, `AdminPill`, `AdminField` to mockup parity in both themes. Smoke-test on the current dashboard to confirm the shell renders correctly under both themes. |
| 2 | **Artworks list + detail parity** | 1 | Compare current `app/admin/artworks/page.tsx` and `app/admin/artworks/[id]/page.tsx` against `AArtworksList` / `AArtworkDetail` + `DArtworksList` / `DArtworkDetail`. Fill gaps. Absorbs the AI-draft + bulk-action work (see "Absorbed work" below). |
| 3 | **Orders list + detail parity** | 1 | Compare current `app/admin/orders/*` against `AOrdersList` / `AOrderDetail` + `DOrdersList` / `DOrderDetail`. Needs-review alert with resubmit/refund actions, timeline, customer/ship/payment/printful sidebar cards. |
| 4 | **Dashboard parity** | 1 | Compare current `app/admin/page.tsx` against `ADashboard` / `DDashboard`. The current dashboard is close in structure but lacks the Darkroom chart treatment (line + gradient fill instead of bars), the "top artworks" panel, and the Darkroom 5-wide KPI strip including `needs_review`. |
| 5 | **Collections + Subscribers + Settings + Cmd-K + Login parity** | 1 | `ACollections`/`DCollections`, `ASubscribers`/`DSubscribers` (list + broadcast composer + history), `ASettings`/`DSettings` (password + integrations + env_vars + admins), `ACmdK`/`DCmdK`, `ALogin`/`DLogin`. Subscribers broadcast composer is a net-new screen; mail send plumbing decided in Spec 5. |
| 6 | **Cross-screen Darkroom polish** | 1–5 | Only if the Darkroom theme needs screen-specific fixes beyond what tokens cover. Likely empty if sub-project 1 does its job. |

Sub-projects 2–5 can run in parallel branches once sub-project 1 is
merged. Each gets its own worktree if desired.

## Absorbed work

The earlier "Admin: AI-draft Metadata + Bulk Actions" spec (written
and then deleted this morning) is absorbed into sub-project 2. Its
design — `POST /api/admin/artworks/[id]/ai-draft`, `lib/exif.ts`,
edit-page "Draft with AI" button, list-page bulk actions — becomes a
feature section in the Artworks spec rather than a standalone
deliverable. Nothing is lost; it just moves.

## Out of scope for this redesign

- Public shop UI. Handled in the parallel session.
- Database schema changes. None required.
- New admin auth flows beyond what exists.
- Email sending infrastructure. The Subscribers broadcast composer UI
  is in scope; whether "Send to N subscribers" actually delivers mail
  is a Spec 5 decision based on what plumbing already exists.
- Routing changes. Existing `app/admin/*` routes stay.

## Open questions (resolved per-spec, not here)

- No-flash theme hydration: inline script in `<head>` reading
  localStorage before first paint, or accept a frame of flash? Decide
  in Spec 2 (design system).
- Cmd-K search target: static command list only, or search artworks/
  orders/subscribers? Decide in Spec 6.
- Broadcast composer's "Send" button wiring: real send via existing
  Resend integration, or UI-only for now with a TODO. Decide in Spec 5.

## Rollout

Each sub-project merges to `main` independently after its own review
and local smoke-test. No staging gate — the admin is Dan-only and any
regression is reversible.

The Atelier theme must work end-to-end at every merge point.
Darkroom is allowed to be cosmetically rough mid-series; if tokens
are well-chosen it will follow for free. Sub-project 6 exists as a
safety net.
