# MONEYLEAGUE — project memory

Fantasy football analytics for Brian's (bsg5032 / bigguap69, Sleeper rid 9,
slot 6) 12-team superflex 0.5-PPR keeper league. Repo renamed from
`datasciencecoursera` → `MONEYLEAGUE` (July 2026); local dir may keep the
old name. Everything rebuilds via `scripts/refresh_all.sh` (stages:
fetch|derive|sim|reports|helper|verify). **Read docs/PIPELINE.md first.**

## Branch map
- `master` — the project (pipeline, data, docs, design system)
- `claude/football-sim-blockchain-game-b3sdq` — GitHub Pages source ONLY:
  hosts `/draft_helper/` (auto-synced from master by the weekly workflow;
  never develop here). Also carries the old gridiron-chain game, which is
  UNRELATED to this project (user-confirmed) — ignore it entirely.
- `claude/trusting-hamilton-3MNt9` — frozen pre-migration archive
- Weekly automation: `.github/workflows/weekly_refresh.yml`, Tuesdays
  ~9:23am ET — full pipeline, verify-gated push to master, PDFs to the
  `latest-artifacts` release, helper sync to Pages, movers+injury
  briefing as commit body, auto-issue on failure

## Live URLs (Pages paths are CASE-SENSITIVE; old-name paths don't redirect)
- Helper: https://blackjakk.github.io/MONEYLEAGUE/draft_helper/
- Game: https://blackjakk.github.io/MONEYLEAGUE/
- PDFs: https://github.com/blackjakk/MONEYLEAGUE/releases/tag/latest-artifacts

## Hard-won data truths (do not relearn these)
1. **The xlsx is the source of truth for pick ownership**
   (`data/historical/MONEY_LEAGUE.xlsx` cell colors). Sleeper's 2023 draft
   feed misattributes 194/204 picks (Brian entered all picks manually,
   first Sleeper year); 2024 has ~17 mismatches; 2025 is clean. Anything
   attributing historical picks joins xlsx on (round, slot) → pick_no.
2. This league enters keepers as ordinary unflagged draft picks (except
   2025+). Detect implicit keepers by ADP gap ≥1.5 rounds.
3. Sleeper's *stored historical projections* are contaminated with
   in-season knowledge — period-honest backtests use ADP only.
4. rid↔manager stable 2023-2025 except rid 10 (handoff → josh_wildboy in
   2025; config `roster_handoffs`).

## Season plumbing (2026)
- `configs/season_2026.json` — slot→rid map (predicted order; update when
  Sleeper posts the real one), my_roster_id, league dir
- Keepers lock → write `data/keepers_2026_actual.json` (same schema);
  derive prefers it over the model prediction
- Brian's keepers (predicted, optimizer-confirmed #1 of 50 sets):
  Loveland R8, Burden R9, Pierce R14, Watson R15

## Design system (July 2026 refactor — enforced, no bypassing)
`design/tokens.json` → `design/build_design.py` → generated `design/ml.css`
+ `design/tokens.py`. ALL UI (helper, 4 PDF builders, matplotlib) consumes
it. `scripts/check_design_system.py` (inside verify) fails on raw hex,
duplicate palettes, hand-edited generated files. Use the `design-review`
skill for any UI diff. Catalog: docs/DESIGN_SYSTEM.md. **Intent/aesthetic
doctrine: DESIGN.md (repo root) — read before building ANY UI**; it is
hex-free by rule (RAW HEX scan covers it) so it can't fork from tokens.

## Accessibility (July 2026 hardening — enforced)
Helper is WCAG 2.1 AA: keyboard-draftable (roving tabindex, focus
restoration in refresh()), SR live regions (#sr-clock), phone-clean at
360px (column collapse + sticky header), AA contrast both themes.
`scripts/check_a11y.py` (inside verify) guards it; use the `a11y-review`
skill for any helper/design diff. Record: docs/A11Y_AUDIT.md.

## Key analyses on record
- Backtest (`scripts/backtest_recommender.py`): tool vs real-Brian
  2023-2025 = ~break-even (+19/season). Brian already drafts QB-early
  superflex structure; tool's value = variance reduction + live facts
  (survival %, keeper costs), not superior player-picking.
- Keeper optimizer (`scripts/optimize_my_keepers.py`): predictor's set #1/50.
- Trade advisor (`scripts/trade_advisor.py`): capital table + swap pricing
  (Kyle 620 VBD capital, Ankur 136, Brian 351).
- Helper features: live Sleeper sync (GO LIVE), PRACTICE mode (bot drafts),
  CEILING mode, survival "Next✓" column, keeper-cost tags, 2-away alert.

## Conventions
- Verify gate before trusting any rebuild: `scripts/refresh_all.sh verify`
- Weekly PDFs + WEEKLY_MOVERS.md are gitignored (Releases host PDFs);
  `data/injury_snapshot.json` IS committed (week-over-week diff baseline)
- Playwright: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, launch args
  --no-sandbox --disable-dev-shm-usage
- User corrections about league history are gold — three of them each
  uncovered a real data bug. When the user contradicts the data, check
  the xlsx.
