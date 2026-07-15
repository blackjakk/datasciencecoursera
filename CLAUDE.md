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
8. Room social map (user-provided, Jul 2026): Troy=Bills fan, Eric=Jets,
   Figgy=Packers, Lem=Seahawks, Brian="Jets" (ironic quotes), everyone
   else ≈ Eagles fans; nearly all Penn State alumni except Donnie. BUT
   measured: NO fan/alumni price premium exists — PSU alumni reach
   +1.36 vs +1.32 baseline (n=12; Saquon went at/below market 3x in a
   PSU-Eagles room), and drafted-team clusters do NOT match stated
   fandom (Bills-fan Troy drafts zero Bills). Do not model a fan tax;
   the room drafts mercenary. Caveat: team-at-draft tests need
   historical rosters (players_nfl.json carries CURRENT team only —
   burned once on Bigsby JAX→PHI). Live test pending: 2026 PSU rookie
   class (Allar/Singleton) + Tyler Warren (Figgy paid +1.8 in 2025).
9. Keeper contract rules (user-confirmed, Jul 2026): cost escalates 2
   rounds/yr, MAX 3 consecutive years kept, R1/R2 forfeits ineligible —
   and the 3-year clock FOLLOWS THE PLAYER; it does NOT reset on trade.
   An expiring keeper is therefore a pure rental to any acquirer. 2027
   expiry board (from 2026 predicted keeps): Trevor loses Collins+
   Achane+Puka simultaneously, coop loses McBride+Jamo — half the
   league holds ≥1 expiring asset; Brian holds ZERO (all fresh) and a
   full 2027 pick set (the currency forced sellers want).

## Season plumbing (2026)
- 2026 Sleeper league EXISTS: id `1364055104709230592` (auto-discovered
  via trade-intel scouting; 0 transactions as of Jul 2026)
- `configs/season_2026.json` — slot→rid map (predicted order; update when
  Sleeper posts the real one), my_roster_id, league dir
- Keepers lock → write `data/keepers_2026_actual.json` (same schema);
  derive prefers it over the model prediction
- Brian's keepers: predictor says Loveland R8, Burden R9, Pierce R14,
  Watson R15 — Watson USER-CONFIRMED (Jul 2026). BUT the tax-aware
  optimizer (regression tax from the keep-side book, Jul 2026) drops
  that set to #5/50; its best set is KEEP 2 ONLY: Burden R9 + Watson
  R15 (+15 proj pts) — Loveland (TE −25 tax, fair price) and Pierce
  (free-round fair price, the worst historical tier) grade as ceremony
  keeps; drafting fresh at R8/R14 is better. Decide at lock; write
  keepers_2026_actual.json with whatever Brian declares. Jordan Love is
  INELIGIBLE (years_kept=3, at the cap — user-confirmed): in
  keepers_2026.json, status forced_drop MEANS ineligible, never a
  testable keep (he re-enters the draft pool at market ~R4)

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
  seats ~free; pick market that matters is R1-R8. + SEAT MARKET (Jul 15,
  user-prompted): natural pairs by spare+barter fit — a full pick set ≠
  monopoly; Donnie (spare R3, missing R13/R14 = Tim's doubles) undercuts
  Brian on BOTH of Tim's seats (Brian ranks #5/#4). Check "my rank"
  before opening any seat negotiation.
- Desk hygiene (Jul 15 cleanup): assembler strips each fragment's own
  <h2> (numbered desk titles canonical; fragments keep h2 standalone);
  market screen leads with MODEL vs PAPER (edge before context);
  dossier cards carry AT THE DRAFT TABLE fingerprint lines (shared
  renderer with the Room Card).
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
- YAHOO-ERA DECADE LAYER (Jul 2026, user-prompted): xlsx holds draft
  boards 2015-2022 (8 more drafts; format CONSTANT — 2.2-2.8 QBs/team
  every year since 2015); name_aliases.py resolves league dialect at
  93-96%. manager_tendencies.json gains decade_history (per-owner QB
  timing/rookie/age over 11 drafts): Troy QB2 median R10 STABLE 11 yrs,
  Lem R4 stable early-QB, eric_m 21% rookies, Figgy punt long-run but
  volatile (IQR 6). Dossiers carry DECADE BOOK lines. DECADE CHECK on
  champion QB shape: only 4/11 recorded champs had 2QB-by-R6 and 3 of
  4 are Sleeper-era (Figgy won 2016 at R1+R8, coop 2017 at R9+R10) —
  CONFOUND: Yahoo rounds include unflagged keepers at cost (late "QB2"
  may be kept elite), so it refutes early QB SPENDING as law, not QB
  capital. Verdict everywhere now: 2QB-by-R6 = current-regime room
  exploit, revocable. YAHOO API BACKFILL LANDED (Jul 15): user's OLD
  Yahoo app (GroupMe-bot era, registered redirect
  groupmebotlmao5.herokuapp.com/auth — dead redirect is fine, code
  reads from address bar) carried the fantasy scope the new app
  couldn't get; yahoo_backfill.yml (one-shot workflow_dispatch, auth
  code as input, no token stored) archived 51 league-seasons raw to
  data/yahoo/ (30MB): moneyleague EVERY season 2011-2022 (8tm→10tm→
  12tm growth) + Brian's other leagues (Bean Counters, Playoffs?,
  Ruffians...). build_yahoo_history.py normalizes standings →
  data/league_history/yahoo_era.json; VALIDATED: 12/12 champions match
  KNOWN_CHAMPIONS, 0 unmatched team names. FINDINGS: adjustment null
  now DEFINITIVE (n=103 transitions: burned dQB2 3.66 vs fine 3.39);
  CHAMPION PF LAW over 15 titles — median PF rank #1, 8/15 were the
  top scorer, 11/15 top-3 (exceptions: ankur '22 heist at PF#7, figgy
  '12 at #5/8); TIM career = 7 bottom-half PF in 2017-24 BUT 2025
  PF#4 w/ 10 wins — rehabilitated, not a soft touch. Old cookie-scraper
  output also already committed (data/yahoo/league_*: matchups/trades
  per league-year, from a pre-compaction session) — reconcile someday.
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
- Stack Screen (XI, `build_keeper_stack_screen.py`, + lines in weekly
  movers briefing; also carries the EXPIRY BOARD — truth #9 rental
  shelf, forced-seller flags Trevor 3 / coop 2, W9-11 buy window): preseason keeper surplus is a COIN FLIP for titles
  (champs ranked 6/9/1 preseason; 12-league backtest percentile ~49);
  the "title watch" shape (rank-1 surplus ≥120 + proven majority) went
  1-for-3 (2025 Trevor hit; 2024 coop same shape missed) ≈ 4x base
  rate, not a crown. NOTE: coop = rid 12 (displays wvw5022 AND
  BigDickNicholas across seasons — display names change, manager ids
  don't). v2 adds WAR CHEST (keepers at market + live picks,
  trades applied, keeper seats consumed) — user-prompted fix: surplus
  alone ignored total capital. 2026 predicted: watch fires on Trevor
  (surplus #1, 167, 100% proven) BUT he's war chest #8 (355) having
  shipped R1+R2; war-chest leader is FIGGY (629 — 3 R1s, no keepers);
  Brian surplus #7 / war #7 (406). 2025 champ was #1 in BOTH; 2026
  Trevor is NOT the 2025 configuration. Champ war ranks 6/3/1 (mildly
  better signal than surplus 6/9/1). Auto-regrades on real declarations
  when keepers_2026_actual.json lands.

## Key analyses on record
- Backtest (`scripts/backtest_recommender.py`): tool vs real-Brian
  2023-2025 = ~break-even (+19/season). Brian already drafts QB-early
  superflex structure; tool's value = variance reduction + live facts
  (survival %, keeper costs), not superior player-picking.
- Keeper optimizer (`scripts/optimize_my_keepers.py`): now applies the
  keep-side regression tax to Brian's kept players (rivals untaxed —
  they don't price with our book). Taxed verdict: Burden+Watson
  2-keeper set #1/50; predictor's 4-set drops to #5 (−15).
- Keep-side tier book (in Option Book VI, `stash_curve.py`): 541
  keepers, 12 league-seasons. All keeper profit = locked discount −
  regression tax (QB 0 / RB 14 / WR 14 / TE 25; alpha vs own ADP).
  7+ rd discounts +50/keeper (76% hit); <4 rds discount = ceremony
  (73% of all keeps, ~0 EV); fair-price R14-17 keeps are the WORST
  tier (−34, 21% hit); discounted QBs the best cell (+36, no tax);
  kept TEs underperform their price by −28.
- Trade advisor (`scripts/trade_advisor.py`): swap pricing now prints
  redraft + keeper-option components (Option Book).
- Owner fingerprints (Jul 2026, in manager_tendencies.json + sim + bots
  + dossier-grade cards): robust method = MEDIAN positional reach with
  ADP<216 cap (mean poisoning: one undrafted dart once faked a +5.7
  "coop RB tax"), keepers excluded + rookie/yr2 shares + age. Durable
  reads: ankur RB +2.5, figgy TE +2.7, donnie TE +1.9, troy drafts OLD
  (27.9, 2% rookies), eric_m rookies 30%, trevor most disciplined
  (+0.3; QB −0.7), troy/trevor get QBs under market. MC sim tilts by
  these (survival curves room-aware); practice bots too. Market
  anchors BOTH ways (user-caught: Mendoza, rookie QB stash ADP R10,
  free-fell to R17 because candidates are VBD-ranked): sim injects
  top-3 market FALLERS (≥2 rds past ADP) into every bot's candidate
  set + symmetric reach penalty (>1.5 rds ahead of market); helper
  bots got stronger fall-catch + R10+ stash term. Mendoza now R12.
  ADJUSTMENT TEST (user-proposed "scared-off" drift, Jul 2026): burned
  owners (bottom-4 PF) change next-year strategy NO more than baseline
  — dQB2 4.0 vs 4.6 rds, dRook 0.07 vs 0.09, dReach 0.78 vs 0.66 over
  22 transitions; Figgy finished DEAD LAST 2024 punting QB and punted
  QB again (dQB2=1). Do NOT model scared-off drift; the room repeats.
  This is WHY the 2QB-by-R6 edge persists here (the QB-late minority
  doesn't learn) and why fingerprints stay valid after bad years.
  User refinement (surprise-conditional: expected burns teach nothing):
  direction AGREES — surprise burns (rich war chest, bottom-4 PF) moved
  QB timing 5.3 rds vs 3.2 for expected burns; Figgy'24 = expected burn,
  changed nothing — but the FINE control churns 5.6 rds naturally, so
  n=3 signal < noise floor; still no drift term (retest after 2026).
  Byproduct: TIM = serial SURPRISE-burner (war #5→PF11 '23, war #4→PF11
  '24) — good capital, bad rosters, the other autopsy case. Trade
  counterparty, not a threat: his players outrun his standings.
  Injury layer (user refinement #2, value-weighted early-capital weeks
  missed): explains Trevor'24 no-change (20% hurt) and reveals coop'23
  "surprise" burn was a 36% injury wipeout — but Figgy'24 (7% = healthy,
  dead last, changed nothing) breaks even the full attribution model:
  the room's non-adjustment is habit, not rationality. 2025 was a
  BLOODBATH (median 21% vs 12-15%): Troy 38 / Figgy 29 / coop 29 /
  Brian 24 (Tim only 8 — no excuse, strengthens serial-underperformer
  read). All burned-2025 owners have the injury excuse ⇒ maximum
  strategy persistence in 2026; Brian's autopsy verdict survives but
  his true 2025 talent gap was smaller than standings said.
- Draft-day artifacts: MONEYLEAGUE_ROOM_CARD.pdf (1-page banknote crib
  sheet: room fingerprints, reachable edges, let-them-pay, keeper math,
  forward market; build_room_card.py, in release uploads). Keeper lock
  = 5-min runbook: docs/KEEPER_LOCK.md + lock_keepers.py validator
  (template data/keepers_2026_actual.TEMPLATE.json; enforces cap/floor/
  bump/ownership; then refresh derive sim reports verify).
- Helper features: live Sleeper sync (GO LIVE), PRACTICE (market-anchored
  bots + measured owner-fingerprint tilts), CEILING, Next✓ survival, SIM column (= recs brain incl. 2027
  option term R10+), sortable order book, movers tape + Δwk, LEAGUE
  PORTFOLIOS (auto-follows the clock), saves (Ctrl+S/Save As/Open, dirty
  dot), reset board (Back restores via pushState), full interaction
  states (skeleton/empty/error/aria-disabled/receipts).

## Deploy mechanics (hard-won)
- Pages = STATIC workflow on the hosting branch (assembles _site: hq/ →
  root, draft_helper/); pushing files to the branch ≠ live until its
  workflow runs. GITHUB_TOKEN pushes NEVER trigger it (GitHub loop
  guard) — the weekly sync silently served a stale site for days until
  weekly_refresh gained an explicit `gh workflow run pages.yml`
  dispatch (workflow_dispatch IS exempt from the token restriction).
  Also: data/backtest (41MB, gitignored) is fetched on demand by
  scripts/fetch_backtest_data.py — CI died for 3 days on its absence
  (issues #2-#10). Verify a triggered run's CONCLUSION, not the queue. Manual sync = temp worktree of the hosting branch, write
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
