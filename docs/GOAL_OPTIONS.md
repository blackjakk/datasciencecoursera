# /goal — OPTION VALUE + sensitivity + established-analysis upgrades

**Mission**: (A) price late picks' keeper OPTION value (the gap today's
analysis proved: expected redraft value of R10+ is ≤0 yet Watson-class
stashes are the league's best assets) and wire it into the trade advisor,
pick squeeze, and the helper's SIM; (B) keeper-declaration sensitivity —
which rival decisions swing Brian's draft most; (C) three upgrades to
established analyses (screen reachability, position-adjusted ledger
grading, survival-calibration backtest). All research outputs follow the
fragment contract in docs/GOAL_RESEARCH.md (one <section>, ml classes,
zero raw hex, json+html into data/research/).

## Shared facts
- Empirical round curve (blind, _load_adp_baselines in
  scripts/build_2026_keepers.py): R1 107 … R9 1.3, R10+ NEGATIVE. Floor at
  0 for forgone-value math (established in build_pick_squeeze.py).
- League history for empirical option value: xlsx-attributed drafts
  2023-25 (scripts/build_manager_tendencies.py shows the join),
  data/backtest/ has period stats+ADP per season
  (scripts/backtest_recommender.py shows loading). Keeper rule: cost =
  draft round − 2 (R1/R2 ineligible), waiver = R15, 3-yr cap.
- Survival quantiles: data/mc_summary_all.json "survival" (11-pt per
  player) + helper players carry svq; Brian = roster_id 9, slot 6.
- Keeper scenario machinery: scripts/build_mock_draft_sim.py
  (sample_keeper_set, KEEPER_SWAP_PROB) and
  scripts/optimize_my_keepers.py (paired-seed comparisons) — REUSE.

## Ownership (disjoint; nobody commits; orchestrator wires desk/verify/hex)

| Agent | Owns exactly |
|---|---|
| S1 option core | `scripts/stash_curve.py` NEW (module: empirical per-round option value + per-player stash scores + cached data/research/stash_curve.json/.html fragment "The Option Book"), `scripts/trade_advisor.py` (round values gain option component), the round_value in `scripts/build_pick_squeeze.py` |
| S2 helper SIM | `docs/draft_helper/index.html`, `scripts/build_draft_helper_data.py` (per-player stash_score + per-round option weights into data.json; SIM gains the option term for R10+; hidden th expansion updated) |
| S3 sensitivity | `scripts/build_keeper_sensitivity.py` NEW + data/research/keeper_sensitivity.json/.html |
| S4 upgrades | `scripts/build_market_screen.py` (reachability column), `scripts/build_trade_ledger.py` (position-adjusted grading), `scripts/backtest_survival_calibration.py` NEW + data/research/survival_calibration.json/.html |

## Specs

S1 — Option Book:
- Empirical curve: for each draft round r (2023+2024 drafts, xlsx-attributed,
  keepers excluded), find players drafted in r; option payoff = NEXT season
  keeper surplus they'd have delivered = max(0, next_season_VBD −
  blind_floor(r−2)); average INCLUDING zeros → option_value[r] (2025 draft
  has no 2026 outcomes yet — exclude, say so). Waiver adds are out of scope
  (different acquisition channel).
- Per-player 2026 stash score (for S2 + fragment): breakout proxy already
  in CEILING mode (fp_std, years_exp≤2, age) normalized 0..1.
- Fragment: the stash curve table (round, option value, n, hit rate = share
  with payoff>0, best historical hit per round e.g. "R14 2024 → Watson"),
  plus Brian's late picks annotated with top-3 stash candidates likely
  available (svq ≥50% at his pick). Fineprint: two seasons of data, wide
  error bars — a prior, not a price.
- trade_advisor.py: round value becomes max(0, redraft) + option_value[r];
  print both components. pick_squeeze round_value likewise (import from
  your module; keep its 0-floor for the redraft part).

S2 — contract-aware SIM:
- build_draft_helper_data.py embeds per-player `stash` (0..1, S1's formula
  — implement the same formula locally, do NOT import S1's module into the
  data builder if it creates fetch-time coupling; formula is 6 lines) and
  a `stash_curve` round→option-VBD map (read data/research/stash_curve.json
  if present, else omit and the helper degrades gracefully).
- simScore() adds: if round ≥ 10 and stash data present:
  + stash × option_value[round]. This REPLACES the ad-hoc late-round
  rookie/age bonuses (round ≥14 +15/+8) — one principled term instead.
  Update the SIM th hidden expansion ("…plus 2027 stash option value in
  the late rounds"). Recs stay = simScore (one brain).
- Gates: check_a11y + hex + standalone anchors + keyboard e2e + recs
  parity (recs #1 == SIM sort #1 on the clock) + phone. The SIM column
  test tolerance: values change, mechanics must not.

S3 — keeper-declaration sensitivity:
- For each rival ALTERNATE keeper decision that is genuinely uncertain
  (teams with alternates; flip = alternate kept instead of the lowest-net
  carryover, or alternate dropped), run paired-seed sims (reuse
  build_mock_draft_sim functions; ~24 seeds like optimize_my_keepers) of
  Brian's expected roster total under flip vs base. Report top swings:
  "if Kyle keeps Otton instead of X, your expected total moves ±N".
- Fragment: ranked table of declarations worth probing + fineprint
  (predictions; paired seeds; ±noise band from seed variance).
- Runtime budget: keep ≤ ~10 min (limit to top ~10 uncertain flips by
  |net_vbd difference|).

S4 — three upgrades:
1. market_screen: "sheets sleep" rows gain reach% — survival at Brian's
   nearest pick AT/AFTER the player's paper round (svq from helper
   data.json); an edge you can't reach isn't an edge — sort by
   gap × reach. Movers summary lines updated too.
2. trade_ledger: grade swings in points ABOVE REPLACEMENT per position
   (weekly points minus that week's positional replacement level ≈ the
   12th-best starter week... use a simple fixed per-position weekly
   replacement from season data; document choice). Keeps QB volume from
   dominating. Re-emit fragment; keep raw-points as a secondary column.
3. backtest_survival_calibration.py: period-honest 2025 world (reuse
   backtest_recommender's loaders): build the 2025 board ADP-only, run the
   MC survival for Brian's 2025 slot, then compare predicted
   P(available at his picks) vs what ACTUALLY happened in the real 2025
   draft (xlsx-attributed). Output calibration buckets (predicted 0-20%,
   …, 80-100% vs realized frequency) + Brier score. Fragment: calibration
   table + honest verdict line.

## Hard constraints
- Fragment contract (GOAL_RESEARCH.md); zero raw hex anywhere; nobody
  touches verify_outputs.py / refresh_all.sh / build_research_desk.py /
  check_design_system.py (orchestrator wires all four).
- S1 and S4 both touch different functions of build_pick_squeeze.py? NO —
  only S1 touches it (round_value). S4 touches market_screen +
  trade_ledger only. S2 alone touches helper files.
- Report real numbers in summaries (curve values, hit rates, biggest
  sensitivity swing, calibration verdict).

## Orchestrator after landing
Wire new fragments into desk SECTIONS (VI. The Option Book, VII. Keeper
Sensitivity, VIII. Survival Calibration), verify fragment list, hex scan
for new scripts, pipeline order (stash curve BEFORE pick_squeeze +
helper data; sensitivity + calibration after sim), rebuild all, full
verify, e2e helper, commit, push master, republish release.
