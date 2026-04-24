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

## Design invariant (added 2026-04-24, after subs 1 & 2 shipped)

Atelier and Darkroom are **independent visual languages** over the
same data. Do not propose convergence changes — the disparity is a
feature. Dashboard bars vs line+gradient; serif vs mono-only; round
pills vs square mono-lowercase pills; editorial grids vs tabular
panels. Every remaining spec describes each theme's treatment
separately. "Parity" in those specs means "each theme matches its
own mockup target."

## Decomposition (updated)

Each row is one spec → plan → implementation → merge cycle. Subs 1
and 2 are shipped. Subs 3, 4, 5a, 5b, 5c, and Shop-Polish are
independent once sub 1 is merged and can run in any order.

| # | Sub-project | Status | Depends on | Scope |
|---|---|---|---|---|
| 1 | **Design system + shell parity** | ✅ shipped | — | `admin.css` tokens, fonts via `next/font`, `AdminSidebar` / `AdminTopBar` / `AdminPill` / `AdminField` / `AdminButton`. See `2026-04-24-admin-spec-1-design-system-parity.md`. |
| 2 | **Artworks AI-draft + bulk actions** | ✅ shipped | 1 | `POST /api/admin/artworks/[id]/ai-draft`, `lib/exif.ts`, `lib/ai-draft.ts`, edit-page button, list-page bulk actions. Hardening in commits `df95a77..bfb2335`. See `2026-04-24-admin-spec-2-artworks-ai-draft-and-bulk.md`. |
| 3 | **Orders + `order_events` timeline** | spec | 1 | New `order_events` append-only ledger; writes from Stripe + Printful + refund + resubmit + new admin-note endpoint; timeline reads from the ledger; per-skin list + detail layouts. See `2026-04-24-admin-spec-3-orders-and-events.md`. |
| 4 | **Dashboard** | spec | 1 | Each skin matches its own mockup. Atelier keeps bars; Darkroom gets line+gradient, 5-wide KPI with `needs_review`, top-artworks panel with units/$ toggle. See `2026-04-24-admin-spec-4-dashboard.md`. |
| 5a | **Subscribers + broadcast composer + History** | spec | 1 | New `broadcast_log` table; composer writes on send (real Resend); `GET /api/admin/subscribers/broadcasts` drives History; per-skin composer + history layouts. See `2026-04-24-admin-spec-5a-subscribers-and-broadcasts.md`. |
| 5b | **Settings + live integration health** | spec | 1 | New `GET /api/admin/integrations/health`; replaces sub-1's placeholder; `admin_users.role` column; per-skin Settings layouts. See `2026-04-24-admin-spec-5b-settings-and-integration-health.md`. |
| 5c | **Collections + Login** | spec | 1 | Per-skin renderings of Collections (card grid vs mono panel) + Login (paper+serif vs mono+teal). ⌘K real search explicitly deferred. See `2026-04-24-admin-spec-5c-collections-and-login.md`. |
| 6 | **Cross-screen Darkroom polish** | reserve — no spec | 1–5 | Open only if regressions surface during 3/4/5. Not written speculatively. |
| — | **Shop-Polish** (outside the admin ladder) | spec | — | Four small shop items: image-dimensions backfill, `/orders/[token]` shared StatusBadge, `published_at` column + home "Latest" fix, mood switch mobile compact. See `2026-04-24-shop-polish.md`. |

## Absorbed from HANDOFF

The 2026-04-24 print-room-redesign HANDOFF flagged deferred items.
They are absorbed as follows:

- `order_events` timeline → Spec 3.
- `broadcast_log` + History tab → Spec 5a.
- Live integration health (replaces Spec 1's placeholder) → Spec 5b.
- Real ⌘K search → **deferred** explicitly in Spec 5c. Revisit when
  catalog > ~30 artworks.
- `image_width` / `image_height` backfill → Shop-Polish.
- `/orders/[token]` status pill → Shop-Polish.
- Home "Latest" season (`published_at` column) → Shop-Polish.
- Mood switch mobile compact → Shop-Polish.
- Admin light/dark flicker on old browsers → not specced. Triage if
  reported.

## Out of scope

- No new admin auth flows.
- No routing changes under `app/admin/*`.
- No new webhook kinds. Existing Stripe + Printful handlers gain
  event writes (Spec 3); nothing else changes.

## Rollout

Each spec merges to `main` independently after its own review and
local smoke-test. No staging gate — the admin is Dan-only. Specs 3,
4, 5a, 5b, 5c, and Shop-Polish can run in any order or in parallel
worktrees.
