# DESIGN.md — how MONEYLEAGUE should look

Read this BEFORE building or changing any UI (helper, PDF builders, charts).
It is the intent layer of the design system:

| Layer | File | Question it answers |
|---|---|---|
| Values | `design/tokens.json` (→ generated `ml.css`/`tokens.py`) | what exact color/size |
| Catalog | `docs/DESIGN_SYSTEM.md` | what components/API exist |
| **Intent** | **this file** | which to choose, and why |
| Law | `scripts/check_design_system.py` + `check_a11y.py` | what gets blocked |
| Review | `design-review` + `a11y-review` skills | the judgment pass |

**This file never states a color value.** Reference tokens by name
(`--ml-danger`, `position.TE`); the RAW HEX check scans this file and fails
the build on any hex literal here. If intent and tokens seem to disagree,
tokens win — then fix whichever is wrong in its own layer.

## The aesthetic: a draft terminal

This is a Bloomberg terminal for a 12-team keeper league, not a marketing
site. Screens are read under clock pressure, at a desk or on a phone in a
draft room. Everything follows from that:

1. **Data is the interface.** Numbers and names are the heroes; chrome
   recedes. If a decoration competes with a fact, the decoration loses.
2. **Color is meaning, never decoration.** Every hue on screen encodes
   something (position, urgency, ownership). A color with no meaning is
   visual noise — leave it out.
3. **Flat.** Separation comes from surface steps (`bg → panel → panel2`)
   and 1px borders — never drop shadows, never glassmorphism.
4. **Motion means urgency.** The only animation is `ml-pulse`, and it means
   "act now" (you're up / 2 away / live). Nothing else moves. Reduced-motion
   users get the same state via solid color.
5. **Dense, with rhythm.** Draft decisions need many facts per screen-inch;
   density is a feature. Rhythm comes from the `space.*` tokens, not
   eyeballed padding.
6. **Accessibility is part of the look.** The focus ring, 40px touch
   targets, text-carrying-meaning — these are design, not compliance
   afterthoughts. docs/A11Y_AUDIT.md is part of this system's history.

## Color doctrine

- **Position hues are identity.** QB/RB/WR/TE/K/DEF each own their hue
  (`color.position`) everywhere — helper table, PDF cards, matplotlib
  series. Never reuse a position hue to mean anything else, and never
  introduce a second hue for the same position.
- **Traffic-light semantics are reserved for actionability.**
  `--ml-success` = safe / can wait / mine. `--ml-warn` = coin flip /
  2-away / rookie risk. `--ml-danger` = now-or-never / injury / LIVE.
  Don't spend these on anything that isn't a call to judgment.
- `--ml-info` / `--ml-keeper` (blue) = factual annotation, never urgency.
- The brand gradient exists **only** on the app header / report mastheads,
  and the only text color on it is `--ml-on-brand`.
- `--ml-muted` is for secondary facts (team, ADP, round tags); primary
  facts get `--ml-text`. If you're unsure, it's primary.
- Tint overlays (`--ml-target-tint`, `--ml-mine-tint`) are never the sole
  signal — always pair a glyph or text (★, "(your pick)").
- New on-color text? Use the measured polarity table in
  docs/DESIGN_SYSTEM.md; never guess white-vs-black.

## Type

Two families, ever: `--ml-font-display` (Bebas Neue — uppercase, tracked)
for mastheads and PDF headlines only; `--ml-font-body` (Inter) for
everything else. No third font, no italic-as-brand.

The scale is rem-based (root-16px equivalents), smallest to largest:

| Step | rem | Use |
|---|---|---|
| micro | 0.5625 | keeper/rookie/injury mini-badges — legacy floor, no new uses |
| badge | 0.625 | position badges |
| meta | 0.6875 | secondary facts, panel h2 labels, table headers |
| control | 0.75 | buttons, filters, clock |
| table | 0.8125 | data rows |
| body | 0.875 | prose, inputs |

Rules: emphasis by **weight**, not size; panel headings are small
uppercase muted labels (the `ml-panel > h2` style), never large type — big
type is reserved for the one `<h1>`/masthead per page and for hero numbers
in PDFs. Nothing new below the meta step.

## Space, radius, elevation

- Spacing only from `space.*`: `xs` hairline gaps, `sm` chip padding,
  `md` component padding, `lg` panel gaps/grid gutters, `xl` page margins.
- Radius: `--ml-r-sm` chips/badges, `--ml-r-md` controls/cards,
  `--ml-r-lg` panels. No pill buttons, no circles.
- Elevation: none. Border hierarchy instead — `--ml-border` for decorative
  container outlines, `--ml-border-strong` for anything a user must locate
  to operate (inputs, buttons, filters). Never promote panel borders to
  strong "for looks", never demote a control border to subtle.

## Component decision rules

- **Panel** (`ml-panel` + h2): a top-level region of the screen. **Card**
  (`ml-card`): one repeated record (a pick, a round). **Banner**: inline
  context line; `--warn` variant only when the reader should act.
  **Badge**: a categorical fact; never clickable. **Filter** (`ml-filter`):
  mutually exclusive chip set, `aria-pressed` required. **Table**
  (`ml-table`): anything with ≥3 aligned facts — no div-grids pretending.
- Every interactive element is a real `<button>`/`<input>`; text-look
  actions use `ml-btn--bare`. Click-only divs/rows are banned (a11y gate).
- New UI = existing components composed by page-level **layout** CSS.
  Page CSS never restyles a component and never contains a color. If a
  composition recurs on a second surface, promote it to a component
  (tokens → builder → catalog).

## Device & mode behavior

- Dark theme is the live tool; light theme is print/PDF. Every change must
  hold in both (the theme toggle and `report_base_css()` share tokens).
- Phone: collapse **facts** before shrinking **type** (the helper drops
  Team/Age/Proj columns at ≤480px rather than going below the meta step);
  the decision context (clock, recs) stays above the fold; the header
  sticks. Keep this pattern for any future dense view.
- Coarse pointers get 40px targets; reduced-motion kills the pulse — both
  baked into ml.css; don't reimplement per page.

## Off-brand (reject on sight)

Drop shadows · gradients anywhere but the masthead · pill buttons ·
decorative icons or emoji in chrome (emoji in *status text* is fine) ·
a new hue for a new feature (map it to existing semantics) · color-only
meaning · centered numbers in tables (left text, right numerics) ·
headings that outweigh the data · a hex value outside `design/tokens.json`.
