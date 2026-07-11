# Accessibility & Responsive Audit — Draft Helper (July 2026)

Goal, method, and per-agent briefs: `docs/GOAL_A11Y.md`. Three parallel
read-only audits (keyboard/semantics, responsive/zoom, contrast/low-vision)
against the live app in real Chromium, then three parallel fixes with
disjoint ownership, then independent end-to-end validation. Regression
guard: `scripts/check_a11y.py` (runs inside `verify_outputs.py`) + the
`a11y-review` skill.

## What was broken (52 findings: 19 keyboard/semantics, 11 responsive, 22 contrast)

**Blockers — a core action impossible for some user class**
- Drafting a player was mouse-only: 0 of 200 player rows and 0 of 3
  recommendation cards were keyboard-reachable (click-only `<tr>`/`<div>`).
- Every re-render (`refresh()` after each pick, undo, filter, and each 15s
  live poll) destroyed focus to `<body>`.
- Screen-reader users were never told they're on the clock: no live regions
  anywhere; the 2-away alert was a WebAudio beep + color pulse only.
- Phone (375px) had 50px page-level horizontal scroll — the 8-column table
  (min-content 391px) escaped its overflow-y-only scroller — and the Next✓
  survival column (the tool's headline live fact) was 100% off-screen; the
  clock scrolled away (non-sticky header) and recommendations started at
  y=849 in a 667px viewport.
- Shipped dark theme contrast failures: header title 2.07:1 on the brand
  gradient, TE badge white-on-amber 2.15:1, RB 3.68:1, WR 3.30:1, injury
  badge 3.76:1, live-status 2.17:1, interactive borders 1.15:1 (search box
  effectively invisible to low vision), drafted-row styling at 2.08:1.
  Light theme (used by all PDF reports): success/warn text ~3:1, clock
  rendered dark-on-dark 2.30:1, keeper badge 3.54:1.

**Majors/minors (selection)**: zero `:focus` styles; no `aria-pressed` on
7 filters + 3 toggles; unlabeled search; load-bearing hover-only tooltips;
unexplained single-letter badges (R / K / Q); color-only meaning on "your
pick" rows, target rows, warned recs; no `<h1>`; undo button inside an
`<h2>`; touch targets 24–28px; all px fonts (browser text-size setting was
a no-op); `ml-pulse` ignoring `prefers-reduced-motion`.

Full evidence (measured ratios, selectors, screenshots, probe scripts) is
in the session scratchpad audits; the durable encoding of every finding is
the assertion set in `scripts/check_a11y.py` (61 violations against
pre-fix HEAD, 0 after).

## What was fixed (commits on `claude/intelligent-tesla-DD2eF`)

**`docs/draft_helper/index.html`** — keyboard & structure & phone layout:
- Name cells are real `ml-btn--bare row-draft` buttons; recs are
  `<button class="rec">`; roving tabindex makes the 200-row list ONE tab
  stop (Arrow↑↓/Home/End move, Enter/Space draft).
- Focus-restoration contract in `refresh()`: same player → same visual
  index → `#search`; never `<body>` (verified across draft, rec-draft,
  undo, live-poll).
- `role="status"` on `#live-status`/`#next-pick`; visually-hidden
  `#sr-clock` announces "You're on the clock" / "2 picks until you're up"
  transitions; `document.title` gains "⏰ you're up ·" / "⏰ 2 away ·"
  prefixes (beep kept).
- `aria-pressed` on filters + CEILING; search `aria-label`; explicit
  cross-browser Esc-clears-search; th expansions for Next✓/VBD; full
  injury words + Rookie/Keeper labels on badges; " (your pick)" and
  "★ — fills roster need" replace color-only meaning; `<h1>`; undo out of
  the heading; labelled scroll region.
- Phone: Team/Age/Proj collapse ≤480px (Pos/Name/VBD/ADP/Next✓ fit 375 and
  360 with single-line rows), sticky header ≤900px, 50vh scroller, clock+
  recs panel ordered above the player pool, `min-width:0` + `overflow-x`
  guards.

**`design/` (tokens.json → build_design.py → ml.css/tokens.py)** — c51e63d:
- Brand darkened (#0f766e/#0e7490) + `--ml-on-brand`; RB #0e7490, WR
  #15803d, DEF #6b6b6b; light success #15803d / warn #b45309; danger
  #f87171 dark / #c81e1e light; light muted #5d6673; `--ml-border-strong`
  on all interactive controls; theme-aware badge text polarity (TE black
  both themes; keeper/rookie/injury/active flip per theme — polarity table
  in `docs/DESIGN_SYSTEM.md`).
- A11y layer: global `:focus-visible` ring (`--ml-focus`),
  `.ml-visually-hidden`, `.ml-btn--bare`, `prefers-reduced-motion` kill
  for `ml-pulse`, `(pointer: coarse)` 40px touch sizing, px→rem fonts.

**Regression guard** — a4bab44: `scripts/check_a11y.py` (structure/aria/
responsive/css/contrast groups, fixture selftest, data-driven contrast
pairs) wired into `verify_outputs.py`; `.claude/skills/a11y-review/SKILL.md`
documents the full re-validation recipe.

## Validation performed

- Static: `check_a11y.py` 0 violations, `check_design_system.py` green,
  full `verify_outputs.py` green (26 invariants + both compliance gates).
- Real-browser e2e (independent of the fix agents): 40 checks — complete
  keyboard-only flow (Tab → search → Esc → Arrow rows → Enter drafts the
  focused player → focus lands on next row → rec-button draft → undo),
  ARIA states + `#sr-clock`/title transitions at 2-away and on-the-clock,
  no horizontal scroll at 1280/768/375/360 with column collapse + sticky
  header verified, 200%-zoom analog clean, `ml-pulse` off under reduced
  motion, light-theme clock readable, practice mode keyboard-only
  enter→draft→exit. Contrast re-proven from final tokens (90 checks).

## Remaining risks / accepted trade-offs

1. **Screen-reader testing was heuristic**: real AT (NVDA/VoiceOver) was
   not run — semantics follow ARIA specs and were probed via computed
   roles/attributes in Chromium only. Firefox/Safari not tested (Esc
   handler was made explicit to remove the known Chromium-only behavior).
2. **`aria-live` timing**: `#sr-clock` announces transitions only (by
   design, to avoid chatter); a user who tabs away mid-transition relies
   on the `document.title` prefix.
3. **★ target glyph density**: early in a draft most rows are "fills
   roster need" (need logic is broad on an empty roster) — pre-existing
   logic, previously invisible at 7% tint; self-prunes as slots fill.
4. **K/TE chip boundaries** vs dark panel remain 2.46/2.15 (advisory —
   the badge *text* passes; chips are decorative color redundancy).
5. **Practice-bot randomness** means grading flows aren't pixel-stable;
   e2e asserts state, not screenshots, for those paths.
6. **PDF surfaces** consume the retuned light tokens (better ratios) but
   only `build_round_menu.py` was re-rendered as proof; the other three
   PDFs regenerate on the next weekly run.
7. 9–10px badge type was lifted via rem but remains small; a future pass
   could floor badges at 0.6875rem.
