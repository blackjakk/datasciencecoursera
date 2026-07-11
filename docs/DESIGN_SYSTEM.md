# MONEYLEAGUE design system

One design system for every UI surface in this repo: the draft helper SPA,
the four PDF report builders, and every matplotlib chart. Single source of
truth, generated artifacts, automated enforcement.

```
design/tokens.json          <- THE single source (edit this, nothing else)
design/build_design.py      <- generator
        |-> design/ml.css   <- component library + CSS vars (dark + light)
        `-> design/tokens.py<- Python constants + report_base_css() + mpl_style()
```

**The rule: ALL new UI goes through this library.** No inline hex colors, no
local palette dicts, no bespoke style blocks that duplicate a component.
`scripts/check_design_system.py` (wired into `scripts/verify_outputs.py`)
fails the build on violations, and the `design-review` skill
(`.claude/skills/design-review/SKILL.md`) blocks non-compliant UI diffs.

## Edit workflow

1. Edit `design/tokens.json` (the ONLY hand-edited file here).
2. Run `python3 design/build_design.py` — regenerates `ml.css` + `tokens.py`.
3. Commit **all three together**: `tokens.json`, `ml.css`, `tokens.py`.

Never hand-edit `ml.css` or `tokens.py` — both carry DO-NOT-EDIT headers and
the checker's DRIFT rule diffs them against a fresh regeneration on every
verify run.

## Consumer map

| Surface | How it consumes the system |
| --- | --- |
| `docs/draft_helper/index.html` | `<link rel="stylesheet" href="ml.css">` + `data-theme="dark"`; markup uses `ml-*` classes; page CSS is layout-only |
| `docs/draft_helper/standalone.html` | `scripts/build_standalone_helper.py` inlines `ml.css` at build time |
| `scripts/build_power_rankings.py` | `from design.tokens import ...` + `report_base_css()` (light theme) + `mpl_style()` |
| `scripts/build_preseason_2026.py` | same |
| `scripts/build_mock_draft_report.py` | same |
| `scripts/build_round_menu.py` | same |
| matplotlib charts (all builders) | `design.tokens.mpl_style()` registers league fonts and applies the standard chart rcParams — replaces per-script `_setup_mpl()` copies |

## Token catalog (`design/tokens.json`)

All color values below are **WCAG 2.1 AA verified** (July 2026 a11y audit,
measured ratios in the tables). Don't change a value without re-measuring —
`scratchpad`-era math lives on in docs/A11Y_AUDIT.md.

### color.position — one color per position, everywhere
`QB #dc2626 · RB #0e7490 · WR #15803d · TE #f59e0b · K #9a3412 · DEF #6b6b6b`
CSS: `--ml-pos-qb` ... `--ml-pos-def`. Python: `POS_COLORS` (includes a
`DST` alias for `DEF`). RB/WR/DEF were darkened/lightened (from
`#0891b2`/`#16a34a`/`#525252`) so badge text hits 4.5:1 — see the on-color
polarity table below before adding any badge.

### color.position_text — on-badge text polarity overrides
Text color used on a position badge/filter chip when white fails AA.
Currently only `TE: #000` (white on `#f59e0b` = 2.15 ✗, black = 9.78 ✓).
The builder defaults every other position to `#fff`.

### color.semantic — meaning colors, themed light/dark
| token | light | dark | CSS var |
| --- | --- | --- | --- |
| success | `#15803d` | `#4ade80` | `--ml-success` |
| warn | `#b45309` | `#f59e0b` | `--ml-warn` |
| danger | `#c81e1e` | `#f87171` | `--ml-danger` |
| info | `#0369a1` | `#60a5fa` | `--ml-info` |
| keeper | `#0369a1` | `#60a5fa` | `--ml-keeper` |
| focus | `#0369a1` | `#7dd3fc` | `--ml-focus` |

All semantic *text* colors are ≥4.5:1 on every surface they appear on,
including `panel2` (the previous light success/warn/danger and dark danger
failed there). `focus` drives the global `:focus-visible` ring (≥3:1
against bg/panel2 in both themes: dark 11.67/9.80, light 5.93).

### color.surface — page scaffolding, themed
`bg`, `panel`, `panel2`, `border`, `border_strong`, `row`, `text`, `muted`
for both `dark` (helper) and `light` (reports). CSS vars: `--ml-bg`,
`--ml-panel`, `--ml-panel2`, `--ml-border`, `--ml-border-strong`,
`--ml-row`, `--ml-text`, `--ml-muted` — values switch automatically with
`data-theme`. Python: `SURFACE_LIGHT`, `SURFACE_DARK`.

- `border_strong` (dark `#66707d`, light `#767f8b`) is the **interactive
  control boundary** — WCAG 1.4.11 needs ≥3:1 for UI component boundaries
  (measured: dark 3.57 vs panel / 3.25 vs panel2; light 4.05 vs white /
  3.70 vs panel2). Used by `.ml-input`, `.ml-btn`, `.ml-filter`.
- `border` (subtle) stays on `.ml-panel` / `.ml-card` — **decorative
  container outlines are exempt from 1.4.11** (audit C22): panel structure
  is conveyed by headings and spacing, the border is aesthetic only. Do not
  "fix" panel borders to `border_strong`; do not use plain `border` on
  anything a user must locate to operate.
- light `muted` is `#5d6673` (was `#66707d`, which was 4.48 on `row`).

### color.highlight — row-tint overlays, themed
| token | dark | light | CSS var |
| --- | --- | --- | --- |
| target | `rgba(74,222,128,.16)` | `rgba(21,128,61,.10)` | `--ml-target-tint` |
| mine | `rgba(74,222,128,.18)` | `rgba(21,128,61,.12)` | `--ml-mine-tint` |

Used by the helper for Brian-target rows and "my pick" history rows.
Tints are intentionally subtle and therefore **must never be the only
signal** — pair with a non-color cue (the helper uses a ★ glyph / the
manager name). Python: `HIGHLIGHT`.

### color.banner / color.brand / color.chart
- banner: `warn_bg`, `warn_border` (light values; dark equivalents are baked
  into the dark block) → `--ml-banner-warn-bg`, `--ml-banner-warn-border`.
- brand: `header_a #0f766e`, `header_b #0e7490` → `--ml-brand-a`,
  `--ml-brand-b` (header gradient; darkened from `#14b8a6`/`#0891b2` so
  white text passes), plus `on_brand #ffffff` → `--ml-on-brand` — the ONLY
  text color allowed on the brand gradient, both themes (5.47 / 5.36).
  Never put `--ml-text` on the gradient (light theme renders dark-on-dark).
- chart: `grid`, `grid_strong` — matplotlib grid lines via `mpl_style()`.

### color.palette — general-purpose named colors (Python `PALETTE`)
`gold, navy, teal, emerald, orange, crimson, slate, cream, ink, gray` — for
report accents and chart series that aren't position/manager-keyed.

### color.manager — one stable brand color per franchise
17 manager ids (e.g. `brian_bigguap #1e40af`, `kyle_figgy #f59e0b`, ...).
Python: `MANAGER_COLORS`, or `mgr_color(mid)` which falls back to
`PALETTE["gray"]` for unknown/None ids. Use `mgr_color` so every chart and
report colors a franchise identically.

### typography / radius / space
- `typography.display` → `--ml-font-display` / `FONT_DISPLAY` (Bebas Neue),
  `typography.body` → `--ml-font-body` / `FONT_BODY` (Inter),
  `typography.font_dir` → TTFs registered by `mpl_style()`.
- `radius.sm/md/lg` → `--ml-r-sm/--ml-r-md/--ml-r-lg` (3/5/8px).
- `space.xs..xl` (2/4/8/12/18px) — spacing scale; use these values when a
  component needs new padding/gaps (add emission to `build_design.py` if you
  need them as CSS vars).

## Component catalog (`design/ml.css`)

Every class, with a usage snippet. All of them theme automatically.

### A11y utilities

```html
<span class="ml-visually-hidden">Draft </span>      <!-- SR-only text -->
<button class="ml-btn--bare">Bijan Robinson</button> <!-- text-look button -->
```

- **Global focus ring** — ml.css ships
  `:focus-visible { outline: 2px solid var(--ml-focus); outline-offset: 1px; }`.
  Never suppress it (`outline: none`) and never add per-component focus
  styles; every interactive element gets a visible ring for free.
- `.ml-visually-hidden` — standard clip pattern; text readable by screen
  readers, invisible on screen. Use it for SR-only labels, live-region
  text, and expanding abbreviations.
- `.ml-btn--bare` — resets a `<button>` to inherit surrounding text style
  (background/border/padding stripped, `font: inherit`, `cursor: pointer`).
  Use it to make table-row / card content a real focusable button without
  changing its look (draft-a-player rows, rec cards).

### Media adaptations (baked into ml.css — no page CSS needed)

- `@media (prefers-reduced-motion: reduce)` — kills the `ml-pulse`
  animation on `.ml-btn--on`, `.ml-clock--me`, `.ml-clock--soon`; the solid
  background-color state still conveys the status.
- `@media (pointer: coarse)` — touch targets: `.ml-btn`/`.ml-filter` and
  `.ml-input` get `min-height: 40px` (+ `8px 12px` padding on buttons);
  `.ml-table td` gains vertical padding so rows are tappable (~40px).
- Font sizes are **rem** (root-16px equivalents of the old px values:
  0.875/0.8125/0.75/0.6875/0.625/0.5625rem) so browser/OS text-size
  settings actually scale the UI. Exception: `.ml-table--compact` keeps
  `7.6pt` — print/PDF density is a physical-unit context.

### On-color text polarity (measured — pick from this table, never guess)

Whether text on a colored chip is white or black is decided by measured
contrast, per theme. The builder emits these; light-theme flips are
`[data-theme="light"]` overrides.

| Surface | dark theme | light theme | measured (dark / light) |
| --- | --- | --- | --- |
| QB `#dc2626` | white | white | 4.83 (black fails 4.35) |
| RB `#0e7490`, WR `#15803d`, K `#9a3412`, DEF `#6b6b6b` | white | white | 5.36 / 5.02 / 7.31 / 5.33 |
| TE `#f59e0b` (badge + filter) | **black** | **black** | 9.78 (white fails 2.15) |
| keeper (`#60a5fa` / `#0369a1`) | **black** | **white** | 8.26 (white fails 2.54) / 5.93 (black fails 3.54) |
| rookie (warn: `#f59e0b` / `#b45309`) | **black** | **white** | 9.78 / 5.02 (black fails 4.18) |
| injury + `.ml-btn--on` (danger: `#f87171` / `#c81e1e`) | **black** | **white** | 7.59 / 5.74 |
| `.ml-filter.active` + `.ml-clock--me` (success: `#4ade80` / `#15803d`) | **black** | **white** | 12.05 / 5.02 (black fails 4.19) |
| `.ml-clock--soon` (warn) | **black** | **white** | 9.78 / 5.02 |
| brand gradient (header, `.ml-clock`, `.ml-btn--hdr`) | `--ml-on-brand` (white) | `--ml-on-brand` (white) | 5.47–9.7 |

Adding a new badge/chip? Compute both polarities against its background in
BOTH themes (4.5:1 for the ≤16px badge text) and add a
`color.position_text` entry or a light-theme override in the builder
accordingly.

### Layout primitives
```html
<section class="ml-panel">
  <h2>Available players</h2>        <!-- panel h2 auto-styles as a label -->
  ...
</section>
<span class="ml-h-label">Round 3</span>   <!-- same label style, anywhere -->
<div class="ml-card">Pick 3.07 — Brian</div>  <!-- compact bordered card -->
<h1 class="ml-display">MONEYLEAGUE</h1>   <!-- display font + tracking -->
```

### Badges & chips
```html
<span class="ml-badge ml-badge--qb">QB</span>   <!-- --rb --wr --te --k --def --dst -->
<span class="ml-badge ml-badge--keeper">KEEPER</span>
<span class="ml-badge ml-badge--rookie">R</span>
<span class="ml-badge ml-badge--injury">Q</span>
<span class="ml-pos-wr">Ja'Marr Chase</span>    <!-- position-colored text: ml-pos-{qb,rb,wr,te,k,def} -->
<span class="ml-stat">ADP <strong>12.4</strong></span>  <!-- muted stat chip -->
```

### Buttons & inputs
```html
<button class="ml-btn">Undo</button>
<button class="ml-btn ml-btn--hdr">Practice</button>   <!-- on-gradient header button -->
<button class="ml-btn ml-btn--on">REC ON</button>      <!-- danger + pulse -->
<input class="ml-input" type="search" placeholder="Search players">
<button class="ml-filter active">ALL</button>          <!-- filter chip; .active = success -->
<button class="ml-filter ml-filter--qb active">QB</button>  <!-- position-colored active state: ml-filter--{qb,rb,wr,te,k,def} -->
```

### Status & clock
```html
<div class="ml-clock">Pick 3.07</div>
<div class="ml-clock ml-clock--me">YOU'RE UP</div>     <!-- green + pulse -->
<div class="ml-clock ml-clock--soon">2 away</div>      <!-- amber + pulse -->
<td class="ml-sv-hi">92%</td>  <!-- survival tiers: ml-sv-hi / ml-sv-mid / ml-sv-lo -->
```
(`ml-pulse` is the shared keyframe animation behind `--on`, `--me`, `--soon`.)

### Tables
```html
<table class="ml-table"> ... </table>              <!-- sticky headers, row rules -->
<table class="ml-table ml-table--compact"> ... </table>  <!-- 7.6pt print density -->
```

### Banners & notes
```html
<div class="ml-banner">Ceiling mode uses 85th-percentile projections.</div>
<div class="ml-banner ml-banner--warn">3 keepers still unconfirmed.</div>
<p class="ml-note">Values as of July 11.</p>
<span class="ml-urgent">On the clock!</span>
```

## Python API (`design/tokens.py`, generated)

```python
from design.tokens import (
    POS_COLORS, MANAGER_COLORS, PALETTE,          # dicts of hex strings
    SEMANTIC_LIGHT, SEMANTIC_DARK,                 # themed meaning colors
    SURFACE_LIGHT, SURFACE_DARK, HIGHLIGHT, BANNER, BRAND, CHART,
    FONT_DISPLAY, FONT_BODY, FONT_DIR,
    mgr_color,          # mgr_color(manager_id) -> stable hex, gray fallback
    report_base_css,    # ml.css + light report defaults; append layout-only rules
    mpl_style,          # fonts + standard chart rcParams; call before plotting
)
```

Report builders: `html = f"<style>{report_base_css()}{PAGE_CSS}</style>..."`
where `PAGE_CSS` contains layout only. Charts: call `mpl_style()` once before
creating figures (idempotent).

## Enforcement

`python3 scripts/check_design_system.py` (also run by
`scripts/verify_outputs.py` as the "design system compliance" check):

- **RAW HEX** — no `#rgb`/`#rrggbb` literals in the helper or the 4 report
  builders. Only `var(--ml-x, #hex)` fallbacks, quoted SVG data-URI favicons,
  and comments are exempt.
- **DUPLICATE PALETTES** — no `POS_COLORS` / `MANAGER_COLORS` / `PALETTE`
  dict literals in any `scripts/*.py`; import from `design.tokens`.
- **DRIFT** — `ml.css` / `tokens.py` must equal a fresh regeneration from
  `tokens.json` (catches hand-edits and forgotten regens).
- **HELPER LINK** — `index.html` must link `ml.css` and carry `data-theme`.

`--fixture-selftest` validates the scanner itself; `--only <rule>` runs one
rule. The `design-review` skill applies the human-judgment half (component
usage, both themes, contrast, Playwright coverage) and blocks on any checker
failure.

## Adding a new component (checklist for strangers)

1. New color/radius/spacing? Add it to `design/tokens.json` first.
2. Add the component's CSS to `build_css()` in `design/build_design.py`
   using only `var(--ml-*)` references (name it `ml-<thing>`, modifiers as
   `ml-<thing>--<variant>`).
3. `python3 design/build_design.py`; commit tokens.json + ml.css + tokens.py.
4. Document it here (catalog snippet above).
5. If interactive: add Playwright coverage.
6. `python3 scripts/check_design_system.py` must pass — if you needed a raw
   hex anywhere outside `design/`, you skipped step 1.
