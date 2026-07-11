---
name: a11y-review
description: Review UI changes for MONEYLEAGUE draft-helper accessibility (WCAG 2.1 AA, keyboard, responsive, contrast). Use whenever a diff touches docs/draft_helper/, design/ (tokens.json, build_design.py, ml.css), or any UI-rendering builder (scripts/build_power_rankings.py, build_preseason_2026.py, build_mock_draft_report.py, build_round_menu.py) — and whenever the user asks about accessibility, keyboard support, screen readers, contrast, touch targets, zoom, or mobile layout.
---

# Accessibility review

The draft helper (`docs/draft_helper/index.html` → generated
`standalone.html`) must stay completable for regular, low-vision,
keyboard-only, and touch/phone users. The July 2026 hardening
(docs/GOAL_A11Y.md, docs/A11Y_AUDIT.md) fixed this end-to-end; your job is
to verify a diff cannot regress it. Companion skill: `design-review`
(run both when a diff touches design/).

## Core actions (the contract — every one must work for every user class)

| # | Action | Mechanism |
|---|--------|-----------|
| 1 | Find a player (search + position filter) | `#search` input, `.ml-filter` buttons |
| 2 | Draft a player to the pick on the clock | row-draft `<button>` in `#ptable` rows (row click also works) |
| 3 | Draft from Top Recommendations | `.rec` buttons |
| 4 | Undo last pick | `#undo` button |
| 5 | Toggle CEILING weighting | `#ceiling-btn` (aria-pressed) |
| 6 | Run / exit a PRACTICE draft | `#practice-btn` (bots pick, you pick on your clock) |
| 7 | GO LIVE Sleeper sync (enter draft ID, see status) | `#live-btn` + `prompt()` + `#live-status` (role=status) |
| 8 | Know who's on the clock / when you're up (incl. 2-away alert) | `#clock`, `#next-pick`, `#sr-clock` live region, WebAudio beep |
| 9 | Read roster / stats / recent picks | `#roster`, `#roster-stats`, `#history` |

## Severity rubric

- **Blocker**: a core action above becomes impossible or unreliable for some
  user class (keyboard-only, screen reader, low-vision, 375px touch, 200%
  zoom). Examples: a draft control rendered as a click-only `<div>`; a status
  change with no live region; text/fill pair < 4.5:1 for small text; page
  gains horizontal scroll at 375px; focus lost to BODY after a re-render.
- **Request changes**: an accessibility affordance weakened but the action
  still completable (missing aria-pressed on a new toggle, hover-only title
  carrying load-bearing info, touch target < 40px, new animation not gated
  on prefers-reduced-motion).
- **Approve** only when the static checker passes AND the manual pass below
  shows every touched core action still works.

## Procedure

### 1. Static checker first (blocking)

```
python3 scripts/check_a11y.py
```

Must exit 0. Rule groups: STRUCTURE, ARIA, RESPONSIVE (index.html),
CSS (design/ml.css), CONTRAST (tokens.json + generated ml.css, WCAG ratios).
Useful flags:

```
python3 scripts/check_a11y.py --only contrast --ratios   # every pair + ratio
python3 scripts/check_a11y.py --only aria                # one group
python3 scripts/check_a11y.py --fixture-selftest         # if you suspect the checker
```

Any violation is a **block**. Do not weaken a checker assertion to make a
diff pass — the assertions encode the audit findings (scratchpad audits
A/B/C; docs/A11Y_AUDIT.md). It also runs inside
`python3 scripts/verify_outputs.py` as "a11y compliance".

### 2. Manual browser pass (Playwright)

Serve the helper and drive Chromium headless. Setup that works in this
environment:

```bash
cd docs/draft_helper && python3 -m http.server 8877 &   # server
```

```python
from playwright.sync_api import sync_playwright
import glob
exe = glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")[0]
pw = sync_playwright().start()
browser = pw.chromium.launch(
    executable_path=exe,
    args=["--no-sandbox", "--disable-dev-shm-usage"])
page = browser.new_page(viewport={"width": 1280, "height": 800})
page.goto("http://localhost:8877/index.html")
page.wait_for_selector("#ptable-body tr")
```

(If `/opt/pw-browsers` is empty: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
python3 -m playwright install chromium`.)

Run each probe below; screenshot evidence into the scratchpad.

**a. Keyboard-only draft flow** (core actions 1-4 end-to-end):

```python
page.keyboard.press("Tab")            # repeat until #search is focused
# type a name, then Escape must clear the search and restore all rows
page.fill("#search", "bijan"); page.keyboard.press("Escape")
assert page.eval_on_selector("#search", "e => e.value") == ""
# Tab into the player list, ArrowDown moves between rows,
# Enter on a row-draft button drafts that player
page.focus(".player-list-scroll")
page.keyboard.press("ArrowDown"); page.keyboard.press("Enter")
# after ANY draft/undo/filter/live-poll re-render:
assert page.evaluate("document.activeElement.tagName") != "BODY"
```

Focus must be visible at every stop (the `--ml-focus` outline) and never
trapped. Also Tab to a rec button and Enter-draft from it, then `#undo`.

**b. Viewport sweep** — no page-level horizontal scroll at any breakpoint:

```python
for w, h in [(1280, 800), (768, 1024), (375, 667)]:
    page.set_viewport_size({"width": w, "height": h})
    assert page.evaluate(
        "document.documentElement.scrollWidth"
        " === document.documentElement.clientWidth"), f"hscroll at {w}"
```

At 375: Pos/Name/VBD/ADP/Next✓ columns visible (Team/Age/Proj collapse),
header sticky, rows tappable.

**c. 200% zoom analog** — 640×400 viewport (layout-equal to 1280×800 @
200%): same scrollWidth == clientWidth assertion, no overlapped/clipped
text, clock visible.

**d. Reduced motion**:

```python
ctx = browser.new_context(reduced_motion="reduce")
# drive to on-the-clock state; .ml-clock--me / .ml-btn--on must have
assert page.evaluate(
    "getComputedStyle(document.querySelector('#clock')).animationName"
) in ("none",)
```

**e. ARIA spot checks**:

```python
assert page.get_attribute("#ceiling-btn", "aria-pressed") in ("true", "false")
page.click("#ceiling-btn")   # value must flip
assert page.get_attribute("#live-status", "role") == "status"
assert page.get_attribute("#next-pick", "role") == "status"
assert page.get_attribute("#sr-clock", "role") == "status"
# every .ml-filter carries aria-pressed and exactly one is "true"
```

Drive the sim to 2-away and your pick: `#sr-clock` text must change
(the SR announcement) in addition to the color/beep.

### 3. Judge the diff

- New interactive element? It must be a real `<button>`/`<input>` (or have
  full key handling + role), be reachable by Tab, show focus, and expose
  state via aria-pressed / live regions. Click-only divs are a **block**.
- New text/fill color pair? It must come from tokens and pass 4.5:1 (3:1 for
  UI boundaries) — `--only contrast --ratios` shows the shipped pairs; add
  genuinely new pairs to `COMPONENT_CLASSES` / `_token_pairs()` in
  scripts/check_a11y.py so they stay guarded.
- New always-on animation? Must be inside the prefers-reduced-motion kill.
- Hover-only `title` as the sole carrier of load-bearing info is a
  **request changes** (needs aria-label / visually-hidden text).

## What to do on failure (ownership contract — docs/GOAL_A11Y.md)

- Page markup, JS behavior, layout/media queries → fix in
  `docs/draft_helper/index.html` only (page CSS = layout only, zero raw hex).
- Token values, component styles (badges, filters, clock, focus ring,
  `.ml-visually-hidden`, touch sizing, reduced-motion) → fix in
  `design/tokens.json` and/or `design/build_design.py`, then regenerate:
  `python3 design/build_design.py`. **Never hand-edit `design/ml.css` or
  `design/tokens.py`** — the design checker's DRIFT rule blocks it.
- After any fix: rerun `python3 scripts/check_a11y.py`,
  `python3 scripts/check_design_system.py`, and the helper stage
  (`scripts/refresh_all.sh helper`) so `standalone.html` and the deployed
  copies pick up the change; finish with `scripts/refresh_all.sh verify`.
