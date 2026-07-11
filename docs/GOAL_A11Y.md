# /goal — Accessibility + Responsive Hardening of the Draft Helper

**Mission**: regular, low-vision, keyboard-only, and different-device users can
all reliably complete every core action of the draft helper
(`docs/draft_helper/index.html` → generated `standalone.html`), from the
current commit, verified end-to-end in a real browser. Record issues, fixes,
and remaining risks. Ship an `a11y-review` skill + automated checks so this
never regresses.

## Core actions (the contract — every one must work for every user class)

| # | Action | Today's mechanism |
|---|--------|-------------------|
| 1 | Find a player (search + position filter) | `#search` input, `.ml-filter` buttons |
| 2 | Draft a player to the pick on the clock | click on `<tr>` in `#ptable` |
| 3 | Draft from Top Recommendations | click on `.rec` div |
| 4 | Undo last pick | `#undo` button |
| 5 | Toggle CEILING weighting | `#ceiling-btn` |
| 6 | Run / exit a PRACTICE draft | `#practice-btn` (bots pick, you pick on your clock) |
| 7 | GO LIVE Sleeper sync (enter draft ID, see status) | `#live-btn` + `prompt()` + `#live-status` |
| 8 | Know who's on the clock / when you're up (incl. 2-away alert) | `#clock`, `#next-pick`, WebAudio beep |
| 9 | Read roster / stats / recent picks | `#roster`, `#roster-stats`, `#history` |

## Standard

- WCAG 2.1 AA where measurable: contrast ≥ 4.5:1 body text / ≥ 3:1 large text
  & UI components, visible focus, no keyboard traps, status via live regions,
  form controls labelled, meaning never color-only.
- Keyboard: Tab reaches every interactive element in a sensible order; Enter/
  Space activate; Esc clears search / exits transient states; focus visible
  everywhere; drafting a player keyboard-only must work end-to-end.
- Responsive: no horizontal page scroll, no overlap/unreadable truncation at
  375×667 (phone), 768×1024 (tablet), 1280×800 (desktop); usable at 200% zoom;
  touch targets ≥ 40px on coarse pointers for primary actions.
- All styling changes flow through the design system (tokens.json →
  build_design.py → ml.css); `scripts/check_design_system.py` stays green;
  `scripts/refresh_all.sh verify` stays green.

## Phases

1. **Baseline** (orchestrator): local server, screenshots at 3 viewports,
   keyboard probe. Evidence in scratchpad.
2. **Parallel audits** (3 read-only agents): keyboard/semantics · responsive/
   zoom · contrast/low-vision. Deliverable: severity-ranked findings files
   with measured evidence. Completion: every core action examined, every
   finding has a concrete suggested fix + owner.
3. **Synthesis** (orchestrator): merge findings, resolve conflicts, freeze the
   fix contract below.
4. **Parallel fixes** (3 agents, disjoint ownership):
   - **Fix-1** owns `docs/draft_helper/index.html` only (markup, JS, page CSS).
   - **Fix-2** owns `design/` only (tokens.json + build_design.py, regenerate
     ml.css/tokens.py) + documents new components in docs/DESIGN_SYSTEM.md.
   - **Fix-3** owns `scripts/check_a11y.py` (new), the single verify hook in
     `scripts/verify_outputs.py`, and `.claude/skills/a11y-review/SKILL.md`.
   Completion per agent: its audit items fixed or explicitly deferred with a
   reason, self-verified in a real browser (Fix-1/2) or by running the checker
   on fixtures (Fix-3). Agents do NOT commit.
5. **Integration** (orchestrator): `refresh_all.sh helper && verify`,
   design-review skill on the diff.
6. **Final e2e validation** (orchestrator, real browser): complete a
   keyboard-only draft flow (search → filter → draft → undo → practice →
   ceiling → Esc), tap flows at 375/768, 200% zoom sweep, reduced-motion and
   light-theme spot checks. Screenshots as evidence.
7. **Record + ship**: docs/A11Y_AUDIT.md (issues → fixes → remaining risks),
   commit, push.

## Fix contract (shared interface, frozen before phase 4)

Fix-2 provides in ml.css; Fix-1 consumes, never defines:
- `--ml-focus` token (dark `#7dd3fc` / light `#0369a1`) + global
  `:focus-visible { outline: 2px solid var(--ml-focus); outline-offset: 1px }`
- `.ml-visually-hidden` utility (SR-only text)
- `@media (prefers-reduced-motion: reduce)` kills `ml-pulse` animation
- contrast-corrected token values (audit C decides which)
- `.ml-btn`/`.ml-filter` touch-target sizing under `(pointer: coarse)`

Fix-1 page-scope-only rules stay in index.html `<style>` (layout/media
queries), zero raw hex, zero new colors.

## Definition of done

- All 9 core actions completable: mouse, keyboard-only, 375px touch, 200% zoom.
- verify gate green (incl. new a11y checks) · design checker green.
- a11y-review skill exists and documents how to re-run the validation.
- docs/A11Y_AUDIT.md records every issue found, its fix commit, and remaining
  risks. Committed and pushed.
