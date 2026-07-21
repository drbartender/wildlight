# Wall & Shop — minimize panes to top chips

**Date:** 2026-07-20 (rev. after plan-review fleet + AdminTopBar reconcile)
**Surface:** `/admin/wall` (`components/admin/WallArranger.tsx`, `app/admin/admin.css`)
**Status:** Plan, reviewed. Ready to execute.

## Problem

Minimizing the Wall or Shop today only collapses it to a header bar *in place*
(via `wall-min`/`shop-min` classes on the band) — it still sits in the layout
taking room, so it never really "gets out of the way." And the Library can't be
minimized at all.

## Target model

Three panes — **The Wall**, **The Shop**, **The Library** — each independently
minimizable. A minimized pane leaves the layout entirely and becomes a **chip in
a tray at the top**; clicking the chip restores it. The still-open panes expand
to fill all the freed space.

### Current structure to build on (post-`385393d`)

`WallArranger` returns a fragment:

```tsx
<>
  <AdminTopBar title="Wall & shop" subtitle={`${wall.length} on the wall · ${shop.length} in the shop`} actions={…} />
  <div className="wl-adm-wall ws-fixed">
    {actionErr && <p className="wl-adm-wall-err" role="alert">…</p>}
    <div className="wl-adm-ws-shelves …">{wall}{shop}</div>
    <div className="wl-adm-ws-resize" …/>
    <section className="wl-adm-ws-library">…</section>
    <div aria-live="polite" className="wl-adm-sr-only" />
  </div>
</>
```

`AdminTopBar` and `.wl-adm-wall.ws-fixed` are both direct children of
`.wl-adm-main` (a flex column; the surface is `height:100vh; overflow:hidden` in
fixed-pane mode). The `.ws-fixed` div is the `flex:1; overflow:hidden` column.

### The chip tray

- Rendered as a **sibling between `<AdminTopBar>` and `<div className="wl-adm-wall
  ws-fixed">`** — i.e. a `flex: 0 0 auto` child of `.wl-adm-main`, **outside** the
  `overflow:hidden` band/library column. (This is why `clampBand` needs no
  change — the tray costs the band nothing.)
- Rendered only when `anyMin`. One chip per minimized pane, order Wall, Shop,
  Library. Each chip is a `<button>` reading `▸ The Wall · 28` (name + live
  count) that restores the pane. The **Library chip shows `Library · N selected`**
  when a bulk selection is active (see "collisions").

### Layout of the open panes (fixed-pane mode, ≥1001×≥700)

Which pieces render inside `.ws-fixed`:

| Wall | Shop | Library | Result |
|---|---|---|---|
| open | open | open | Band (Wall 3fr : Shop 2fr, capped/resizable) on top; Library below; resize handle between *(today)* |
| open | min | open | Band holds Wall only (full width); Library below; handle |
| min | open | open | Band holds Shop only (full width); Library below; handle |
| open | open | min | Band fills the whole height (no cap); no Library, no handle |
| open | min | min | Wall alone fills the whole surface; no Library, no handle |
| min | open | min | Shop alone fills the whole surface; no Library, no handle |
| min | min | open | Library fills everything; no band, no handle |
| min | min | min | Just the chip tray + a centered "All panes minimized — pick a chip above" hint |

Rules that fall out:
- `bandShown = !wallMin || !shopMin`. Band renders iff `bandShown`.
- **Resize handle** renders iff `bandShown && !libMin`.
- **Band height:** capped by `--wl-band-h` (default `min(36vh,300px)`) only when
  the Library is open; when `libMin`, the band is `flex:1; max-height:none` and
  fills the column.
- A minimized shelf is *removed* from the band (conditionally not rendered), so a
  lone open shelf is the band's `:only-child` and fills the row.

### Decisions

1. **Chip tray:** own row between AdminTopBar and the pane column (not inside it).
2. **Minimize state is session-only** (resets on reload); band height stays
   persisted in `localStorage`.
3. **No "minimize all" guard** — all three can collapse; the void shows a hint.

## Collisions with shipped code (must handle)

- **Bulk selection lives inside the Library.** Minimizing the Library unmounts
  the bulk bar and its Clear/act controls while the `selected` Set persists in
  state. Handle: the **Library chip shows `Library · N selected`** when
  `selected.size > 0`, so the selection is visible and one click restores it (no
  silent strand; no forced clear).
- **`#wl-library-heading` is the focus fallback** for `restoreFocus`, `focusPos`,
  `moveToPosition`, `bulkApply`. It unmounts when `libMin`. Add a guard: those
  fallbacks focus `#wl-library-heading` **or** the Library chip (whichever is
  mounted). Give the shelf headings the same `tabIndex={-1}` id target so a
  restore can land *in* the pane.

## Implementation

### State (`WallArranger.tsx`)

- Add `const [libMin, setLibMin] = useState(false)`.
- Derived: `bandShown = !wallMin || !shopMin`, `anyMin = wallMin || shopMin || libMin`.
- `PaneChip` = module-scope presentational component (chevron + name + mono
  count, optional `note` for the selection count).
- Convert each shelf + the Library from always-render to conditional render:
  `{!wallMin && <section className="wl-adm-ws-shelf wall">…}`, same for shop; the
  Library section wrapped in `{!libMin && (…)}`.
- Each pane's header gains a minimize chevron (shelves already have one — keep it,
  it sets `wallMin`/`shopMin`; add one to the Library header setting `libMin`).
- Remove the `wall-min`/`shop-min` classes from the band `<div>` (a minimized
  shelf isn't in the band anymore); add `data-lib-min={libMin}` for the fill.

### Render (fragment)

```tsx
<>
  <AdminTopBar … />
  {anyMin && (
    <div className="wl-adm-ws-tray" role="group" aria-label="Minimized panes">
      {wallMin && <PaneChip label="The Wall" count={wall.length} onExpand={() => restore('wall')} />}
      {shopMin && <PaneChip label="The Shop" count={shop.length} onExpand={() => restore('shop')} />}
      {libMin  && <PaneChip label="Library"  count={counts.all}
                   note={selected.size ? `${selected.size} selected` : undefined}
                   onExpand={() => restore('lib')} />}
    </div>
  )}
  <div className="wl-adm-wall ws-fixed">
    {actionErr && <p className="wl-adm-wall-err" role="alert">…</p>}
    {bandShown && (
      <div className="wl-adm-ws-shelves" data-lib-min={libMin} style={{ '--wl-band-h': … }}>
        {!wallMin && <section className="wl-adm-ws-shelf wall" …>…</section>}
        {!shopMin && <section className="wl-adm-ws-shelf shop" …>…</section>}
      </div>
    )}
    {bandShown && !libMin && <div className="wl-adm-ws-resize" …>…</div>}
    {!libMin && <section className="wl-adm-ws-library">… chevron in head …</section>}
    {!bandShown && libMin && <div className="wl-adm-ws-void">All panes minimized — pick a chip above.</div>}
    <div aria-live="polite" className="wl-adm-sr-only" />
  </div>
</>
```

- **Focus is post-commit.** Because minimize/restore mounts/unmounts in the same
  commit as the click, move focus in a `requestAnimationFrame` (reuse the
  `settle`/`focusPos` pattern): on minimize → focus the new chip; on restore →
  focus the restored pane's heading. `restore(pane)` sets the min flag false and
  schedules the focus.

### CSS (`app/admin/admin.css`, fixed-pane block)

- Band fill when Library minimized — **scoped inside the media query** so it wins:
  `.wl-adm-wall.ws-fixed .wl-adm-ws-shelves[data-lib-min="true"] { flex: 1 1 auto; max-height: none; }`
- Lone shelf fills the row: `.wl-adm-wall.ws-fixed .wl-adm-ws-shelf:only-child { flex: 1 1 0; }`
  (redundant in flex mode but harmless; needed as the hook below).
- **Wide-but-short (grid regime, base rule):** a lone shelf in the 3fr:2fr grid
  doesn't fill — add `.wl-adm-ws-shelves:has(> .wl-adm-ws-shelf:only-child) { grid-template-columns: 1fr; }`
  (base rule, outside the media query).
- New `.wl-adm-ws-tray { flex: 0 0 auto; display: flex; gap: 8px; flex-wrap: wrap;
  padding: … }` and `.wl-adm-ws-chip` (pill button: chevron + name + mono count +
  optional note; hover/focus-visible ring; text/bg contrast ≥4.5 in both themes —
  use `--adm-ink`/`--adm-card`, not `--adm-muted`).
- `.wl-adm-ws-void` (centered muted hint).
- **Delete** the now-dead `.wl-adm-wall.ws-fixed .wl-adm-ws-shelves.wall-min …`
  and `.shop-min …` reclaim rules (confirmed used nowhere else).

### Accessibility

- Minimize chevrons keep `aria-expanded={false}`; chips are labeled `<button>`s in
  a labeled group. (They are NOT a programmatic `aria-controls` pair — the region
  doesn't exist while minimized — so rely on clear labels, don't claim a link.)
- Focus: minimize → chip; restore → pane heading (never the chevron that re-hides
  it). Give the two shelf headings a focusable `tabIndex={-1}` target like the
  Library's `#wl-library-heading`.

## Commit breakdown (3 reviewable commits)

1. **Tray + libMin + conditional render** — add `PaneChip`, the tray, `libMin`
   and its Library chevron; convert all three panes from collapse-in-place to
   conditional-render wired to chip-restore; delete the `.wall-min`/`.shop-min`
   rules. Atomic (removing in-place collapse before the chip exists would strand
   a pane). Verify: minimize/restore each pane, space reclaimed.
2. **Layout reclaim** — `data-lib-min` band fill, `:only-child` solo width (+ the
   grid-collapse for wide-short), resize-handle gating, the void hint. Verify the
   8 combos + resize + no Library clip.
3. **Focus + a11y polish** — post-commit focus moves, the vanishing-fallback
   guard, chip/heading contrast, keyboard round-trip.

## Verification (browser, `/dev-preview/wall` harness)

Measure geometry + focus for the states in the table, plus:
1–8. Each row of the layout table (widths/heights; handle presence; no Library clip when band maxed).
9. Restore each pane from its chip → returns to the right place; focus lands in the pane (heading), minimize lands on the chip.
10. **Chip counts are live** while minimized: minimize the Shop, add a photo to it from the Library pill/bulk → the Shop chip count updates.
11. **Bulk under Library-min:** select N, minimize Library → chip shows `Library · N selected`; restore → bar + selection intact.
12. **All-three-min** → tray + void hint, no broken/empty read.
13. Chip + heading contrast light AND dark; keyboard round-trip (chevron → chip → heading).
14. Reload resets all three min states (session-only); band height persists.
15. Regression: tiles 104px no overlap; Library tiles fill columns; **type-to-reorder** (position badge focus); bulk bar; resize handle + persist.
16. Wide-but-short (≥1001×<700) and ≤1000px stacked: minimize still removes a pane + shows a chip; lone shelf fills (grid-collapse).

## Out of scope

Persisting minimize state; a collapse-all/expand-all control; touch-drag.

## Review pass (2026-07-20, plan fleet — fidelity · feasibility · decomposition/UX)

Model confirmed faithful to the ask with no scope creep; UX agent found no
blockers and confirmed the "arrange the wall, minimize Shop + Library → Wall gets
full width + full height" value. Folded in: tray placed OUTSIDE the `.ws-fixed`
column (resolves both the clampBand-clip and tray-placement blockers, and matches
the AdminTopBar restructure); completed the 8-combo table; the bulk-selection-
under-Library-min strand (chip shows the count); vanishing `#wl-library-heading`
focus fallback; `[data-lib-min]` specificity scoped in the media query;
wide-but-short grid lone-shelf fill; `:only-child` instead of a `solo` prop;
post-commit focus; restore-to-heading; the all-three void hint; the 3-commit
breakdown; and the expanded verification (type-to-reorder, live chip counts,
bulk-under-min, reload, band persist). Confirmed correct: deleting the
`.wall-min`/`.shop-min` reclaim rules.
