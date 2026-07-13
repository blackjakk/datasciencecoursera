# MONEYLEAGUE — project memory

Fantasy football analytics for Brian's (bsg5032 / bigguap69, Sleeper rid 9,
slot 6) 12-team superflex 0.5-PPR keeper league. Repo renamed from
`datasciencecoursera` → `MONEYLEAGUE` (July 2026); local dir may keep the
old name. Everything rebuilds via `scripts/refresh_all.sh` (stages:
fetch|derive|sim|reports|helper|verify). **Read docs/PIPELINE.md first.**

## Branch map
- `master` — the project (pipeline, data, docs, design system)
- `claude/football-sim-blockchain-game-b3sdq` — GitHub Pages source ONLY
  (name is historical): hosts the HQ landing page (site root) +
  `/draft_helper/`, auto-synced from master by the weekly workflow; never
  develop here. Deploy = static workflow (`.github/workflows/pages.yml`
  on that branch). The old gridiron-chain game was deleted at user
  request (July 2026, commit 042055b; recoverable from branch history).
- `claude/trusting-hamilton-3MNt9` — frozen pre-migration archive
- Weekly automation: `.github/workflows/weekly_refresh.yml`, Tuesdays
  ~9:23am ET — full pipeline, verify-gated push to master, PDFs to the
  `latest-artifacts` release, helper sync to Pages, movers+injury
  briefing as commit body, auto-issue on failure

## Live URLs (Pages paths are CASE-SENSITIVE; old-name paths don't redirect)
- HQ landing: https://blackjakk.github.io/MONEYLEAGUE/ (old /hq/ redirects)
- Helper: https://blackjakk.github.io/MONEYLEAGUE/draft_helper/
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
5. Keeper seating house rule (user-confirmed, Jul 2026): if the exact
   cost round isn't owned/free, the keeper seats at the next EARLIER
   owned free round (bump-up). Nobody is ever hard-blocked while an
   earlier round is free — the cost of a missing seat is the BUMP TAX
   (earlier pick consumed), not the keeper itself.
6. Pick-trade convention (user-confirmed): trades run EQUAL COUNT both
   ways (1-for-1, 2-for-2 — e.g. R1+R17 for R3+R5); value balances via
   round quality, not pick quantity. Structure all pick asks this way.
7. The league drafts LIVE IN PERSON; rivals bring their own printed
   analysis — popular (often Reddit-sourced) rankings, and they are
   smart enough to bring SUPERFLEX/2QB versions (user-confirmed; do NOT
   assume a 1QB naivety discount). Model the room's paper as ≈ the
   FantasyPros OP consensus; the exploitable edge is where OUR
   league-specific model (VBD + keeper/contract context + this room's
   measured tendencies) disagrees with that consensus — not where
   online ADP disagrees with it.

## Season plumbing (2026)
- 2026 Sleeper league EXISTS: id `1364055104709230592` (auto-discovered
  via trade-intel scouting; 0 transactions as of Jul 2026)
- `configs/season_2026.json` — slot→rid map (predicted order; update when
  Sleeper posts the real one), my_roster_id, league dir
- Keepers lock → write `data/keepers_2026_actual.json` (same schema);
  derive prefers it over the model prediction
- Brian's keepers (predicted, optimizer-confirmed #1 of 50 sets):
  Loveland R8, Burden R9, Pierce R14, Watson R15 — Watson USER-CONFIRMED
  as kept (Jul 2026); write keepers_2026_actual.json once all four lock

## Design system (July 2026 refactor — enforced, no bypassing)
`design/tokens.json` → `design/build_design.py` → generated `design/ml.css`
+ `design/tokens.py`. ALL UI (helper, 4 PDF builders, matplotlib) consumes
it. `scripts/check_design_system.py` (inside verify) fails on raw hex,
duplicate palettes, hand-edited generated files. Use the `design-review`
skill for any UI diff. Catalog: docs/DESIGN_SYSTEM.md. **Intent/aesthetic
doctrine: DESIGN.md (repo root) — read before building ANY UI**; it is
hex-free by rule (RAW HEX scan covers it) so it can't fork from tokens.
Theme (July 2026): **The Exchange** — trading terminal (dark) + engraved
banknote (light/PDFs); gold = market state + blue-chip ONLY; GUAP labels
never replace numbers; tape is static. Contract: docs/GOAL_EXCHANGE.md.
Fonts self-hosted OFL (data/fonts/), guilloché via design/guilloche.py.
data/adp_history.csv accumulates weekly ADP (sparklines ready ~Aug).

## Accessibility (July 2026 hardening — enforced)
Helper is WCAG 2.1 AA: keyboard-draftable (roving tabindex, focus
restoration in refresh()), SR live regions (#sr-clock), phone-clean at
360px (column collapse + sticky header), AA contrast both themes.
`scripts/check_a11y.py` (inside verify) guards it; use the `a11y-review`
skill for any helper/design diff. Record: docs/A11Y_AUDIT.md.

## Research Desk (July 2026 — the analyst layer, 11 sections)
`data/MONEYLEAGUE_RESEARCH_DESK.pdf`, assembled by
`scripts/build_research_desk.py` from fragments in `data/research/`
(contract: docs/GOAL_RESEARCH.md — one <section>, ml classes, no hex;
goal docs: GOAL_RESEARCH.md, GOAL_OPTIONS.md). Caches: `data/scouting/`
(trade intel, cache-first, `--refresh-current`), `data/league_history/`
(matchups). Findings ON RECORD:
- Trade Ledger (PAR-graded): Josh is the real shark (+188 PAR); Troy's
  raw +288 was QB volume; BRIAN grades PAR fish (−187 over 12 deals).
- 2025 Autopsy verdict: ROSTER STRENGTH killed 2025 (optimal PF 364 below
  median); lineup-setting −12 vs median (rank 4/12); luck +1.3 wins.
  Consistent with backtest: drafting fine → edge is deals + rosters.
- Option Book (`scripts/stash_curve.py`, empirical 2023-24): late picks
  carry real 2027 keeper option value — R9 +30 (50% hit), R7 +17, R17
  +13; composed_round_values() = max(0,redraft)+option feeds advisor,
  squeeze, helper SIM.
- Market screen: MODEL vs THE ROOM'S PAPER is the edge (truth #7); edges
  carry reach% (survival to Brian's seat) — Bowers top reachable edge.
- Pick Squeeze: bump rule (truth #5) + negative-tail curve ⇒ keeper
  seats ~free; pick market that matters is R1-R8.
- Keeper sensitivity: no rival declaration hurts Brian; upside if coop
  keeps Rodriguez over Darnold (+7.6) or Tim keeps Monangai (+4.9).
- Survival calibration (period-honest 2025): Brier 0.10 vs 0.23 base
  (+56% skill); 60-80% band realizes ~58% — pad it.
- Timing Study doctrine: sell mid-season (W6-10, +33/deal), buy at the
  deadline (−2.7 ≈ free); contender-buyers lose in EVERY window.
- Champion Profile (`scripts/build_champion_profile.py`, auto-folds new
  seasons once bracket decides): champs avg +230 keeper VBD vs field +14
  (runners −6 — keeper surplus is CHAMPION fuel); every ring carried a
  ≥5-round-discount keeper built from a late pick/waiver the year before
  (Puka R13, Achane R8, McBride R15, ARSB R13, Etienne R10); 2QB-by-R6
  → 67% playoff rate vs 38% (3/3 champs; shape = one elite + one solid,
  both R1+R2-QB starts finished bottom-two); finalists' title trades
  land W6-10 (lose the trade on paper, win the title); waiver-point
  share is a LOSING signal (field 32% vs champs 11%); wins don't
  separate finalists from playoff-outs — PF does (champs #1,#1,#4).
- Benchmark corpus (out-of-sample validation, July 2026): 13 owner-free
  MONEYLEAGUE-format league-seasons (6th Floor Crew, Ciely-Style 12tm;
  Warren 10tm) found by snowball crawl through rivals' leaguemates;
  cached data/scouting/benchmark/ (cache-first fetcher; grow corpus by
  appending _corpus.json). Verdicts (9 gradable): keeper VBD REPLICATES
  (champs 211 vs field 73), waiver-share REPLICATES, champ PF rank
  REPLICATES (mean 2.4); trade share MIXED (outside rooms barely
  trade); 2QB-by-R6 FAILS outside (43% vs 50%, negative in BOTH size
  classes) → the QB edge prices THIS room's QB-late minority, not a
  superflex law.
- Stack Screen (XI, `build_keeper_stack_screen.py`, + line in weekly
  movers briefing): preseason keeper surplus is a COIN FLIP for titles
  (champs ranked 6/9/1 preseason; 12-league backtest percentile ~49);
  the "title watch" shape (rank-1 surplus ≥120 + proven majority) went
  1-for-3 (2025 Trevor hit; 2024 coop same shape missed) ≈ 4x base
  rate, not a crown. 2026 predicted: WATCH FIRES ON TREVOR AGAIN
  (Puka/Achane/Collins/Fields, 167 vs Kyle 127; Brian 7th at 55).
  Auto-regrades on real declarations when keepers_2026_actual.json
  lands (derive copies it over keepers_2026.json).

## Key analyses on record
- Backtest (`scripts/backtest_recommender.py`): tool vs real-Brian
  2023-2025 = ~break-even (+19/season). Brian already drafts QB-early
  superflex structure; tool's value = variance reduction + live facts
  (survival %, keeper costs), not superior player-picking.
- Keeper optimizer (`scripts/optimize_my_keepers.py`): predictor's set #1/50.
- Trade advisor (`scripts/trade_advisor.py`): swap pricing now prints
  redraft + keeper-option components (Option Book).
- Helper features: live Sleeper sync (GO LIVE), PRACTICE (market-anchored
  bots), CEILING, Next✓ survival, SIM column (= recs brain incl. 2027
  option term R10+), sortable order book, movers tape + Δwk, LEAGUE
  PORTFOLIOS (auto-follows the clock), saves (Ctrl+S/Save As/Open, dirty
  dot), reset board (Back restores via pushState), full interaction
  states (skeleton/empty/error/aria-disabled/receipts).

## Deploy mechanics (hard-won)
- Pages = STATIC workflow on the hosting branch (assembles _site: hq/ →
  root, draft_helper/); pushing files to the branch ≠ live until its
  workflow runs. Manual sync = temp worktree of the hosting branch, write
  files, push (cd OUT of a worktree before `git worktree remove`).
- Release PDFs republish via workflow_dispatch of weekly_refresh.yml
  (MCP actions_run_trigger). Weekly runs push to master → expect races:
  fetch + rebase + regenerate + force-with-lease the feature branch.
- Session proxy blocks unauthenticated api.github.com and release-asset
  downloads — use the GitHub MCP tools instead of curl for those.

## Conventions
- Verify gate before trusting any rebuild: `scripts/refresh_all.sh verify`
- Weekly PDFs + WEEKLY_MOVERS.md are gitignored (Releases host PDFs);
  `data/injury_snapshot.json` IS committed (week-over-week diff baseline)
- Playwright: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, launch args
  --no-sandbox --disable-dev-shm-usage
- User corrections about league history are gold — three of them each
  uncovered a real data bug. When the user contradicts the data, check
  the xlsx.
