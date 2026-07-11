---
name: design-review
description: Review UI changes for MONEYLEAGUE design-system compliance. Use whenever a diff touches docs/draft_helper/, the report builders (scripts/build_power_rankings.py, build_preseason_2026.py, build_mock_draft_report.py, build_round_menu.py), design/, or any HTML/CSS/matplotlib styling — and whenever the user asks to review UI, styling, colors, a new page, or a new report.
---

# Design-system review

Every UI surface in this repo consumes ONE design system, single-sourced from
`design/tokens.json`. Your job is to verify a UI diff cannot drift from it.
Reference: `docs/DESIGN_SYSTEM.md`.

## Procedure

1. **Run the enforcement check first**:

   ```
   python3 scripts/check_design_system.py
   ```

   It must exit 0. Any RAW HEX, DUPLICATE PALETTE, DRIFT, or HELPER LINK
   violation is an automatic **block** — do not rationalize exceptions.
   (`--fixture-selftest` sanity-checks the scanner itself if you suspect it.)

2. **Components and variables only.** Read the diff. All new HTML/CSS must be
   built from `ml-*` classes (`.ml-panel`, `.ml-card`, `.ml-badge--*`,
   `.ml-btn`, `.ml-table`, `.ml-filter`, `.ml-banner`, ...) and `--ml-*`
   custom properties. Python report code must import from `design.tokens`
   (`POS_COLORS`, `MANAGER_COLORS`, `PALETTE`, `report_base_css()`,
   `mpl_style()`), never define its own colors or style blocks. Page-specific
   CSS is for layout only — no color values in it.

3. **Both themes render.** Confirm the change looks correct in the dark theme
   (draft helper, `data-theme="dark"`) and the light theme (PDF reports use
   `data-theme="light"` semantics via `report_base_css()`). If the diff adds
   theme-dependent styling, check it defines values for both blocks in
   `ml.css` (via tokens, not literals).

4. **New colors/spacing go through tokens.** Any genuinely new color, radius,
   or spacing value must be added to `design/tokens.json`, then regenerated
   with `python3 design/build_design.py`, and all three files
   (`tokens.json`, `ml.css`, `tokens.py`) committed together. A value inlined
   directly into a consumer file — even once, even "temporarily" — is a
   **block**. A hand-edit to generated `ml.css` or `tokens.py` (the DO NOT
   EDIT headers) is a **block**; the DRIFT check will also catch it.

5. **Contrast.** For every new foreground/background pair introduced (badge
   text on position colors, text on banners, chart labels), verify WCAG-ish
   contrast: aim for >= 4.5:1 for body text, >= 3:1 for large/bold text and
   UI glyphs. Compute the WCAG contrast ratio with a short inline Python
   snippet (relative luminance of both hexes from `design/tokens.json`), or
   compare against the established pairs in `design/ml.css` (white text on
   position colors, black text on `--ml-success`/`--ml-warn`).

6. **Playwright coverage.** Any new interactive element in the draft helper
   (button, filter, toggle, input, clickable row) needs a Playwright
   click-through covering it (see the helper verification flows: init,
   pick, undo, search, filter, mode toggles). No coverage = request changes.

## Verdict rules

- **Block** on: any raw hex in a consumer file, any duplicate palette dict,
  any hand-edit to generated files, `check_design_system.py` exit != 0,
  missing `ml.css` link or `data-theme` on the helper.
- **Request changes** on: bypassing `ml-*` components with bespoke CSS that
  duplicates an existing component, missing Playwright coverage, unverified
  contrast on new pairs, only-one-theme styling.
- **Approve** only when the check passes and every item above is satisfied.
