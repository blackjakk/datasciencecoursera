# MONEYLEAGUE Pipeline — How to Update Anything

Single entrypoint: `scripts/refresh_all.sh`. Idempotent — re-run any stage anytime.

## Quick reference

```bash
# One-time setup on a fresh machine
pip install -r requirements.txt

# Everything (fetch -> derive -> sim -> reports -> verify). ~5 min.
scripts/refresh_all.sh

# Stages compose, run in the order given:
scripts/refresh_all.sh derive                 # skip external fetches
scripts/refresh_all.sh sim reports verify     # rebuild sim + PDFs, then check
scripts/refresh_all.sh helper                 # just the draft helper bundle
scripts/refresh_all.sh verify                 # just the invariant checks
```

`verify` runs ~25 invariant checks (17 picks/team, 2-3 QBs, traded picks
applied, all keepers placed, MC slot counts + survival quantiles, helper
bundle consistency, PDFs non-trivial). It exits non-zero on failure — run
it after ANY rebuild before trusting the outputs. Missing
`data/sleeper/players_nfl.json` (14MB, not in git) is auto-fetched by any
stage that needs it.

## Season facts live in configs/season_2026.json

Draft order (slot → roster_id), Brian's roster_id, league data dir, and
round count are read from `configs/season_2026.json` by the sim, the mock
report, and the draft-helper builder. When Sleeper posts the REAL 2026
order, edit that one file. When keepers lock, write
`data/keepers_2026_actual.json` (same schema as keepers_2026.json) — the
derive stage copies it over the model's prediction automatically.

## Keeper-scenario Monte Carlo + survival curves

`build_2026_keepers.py` also emits per-team `alternate` records (next-best
positive-net candidates). Each of the 300 MC sims samples a keeper
scenario: ~30% of the time a team swaps its weakest predicted keeper for
an alternate. The sim publishes per-player draft-position quantiles
(`survival` in mc_summary_all.json), which the draft helper renders as
"Next✓" — the probability each player survives to your next pick.

## Weekly artifacts

- PDFs are **not committed** — the weekly workflow uploads them to the
  rolling release: `releases/tag/latest-artifacts` (always current).
- The bot's commit body is `data/WEEKLY_MOVERS.md` — ADP movers of a
  round+ and keeper-prediction changes vs the prior week.
- A failed weekly run auto-opens a GitHub issue with a link to the run.

## Pipeline diagram

```
              EXTERNAL DATA
   ┌────────────────────────────────────┐
   │ fetch_sleeper.sh                    │
   │ fetch_fantasypros.py                │     LAYER 1 (manual / weekly)
   │ fetch_fantasycalc.py                │
   └─────────────┬──────────────────────┘
                 │
                 ▼
   ┌────────────────────────────────────┐
   │ build_players_csv.py                │ → data/players_2026.csv
   │ build_pick_value.py                 │ → data/pick_value.json
   │ build_2026_keepers.py               │ → data/keepers_2026.json
   │ build_manager_tendencies.py         │ → data/manager_tendencies.json     LAYER 2 (cheap, ~10s)
   │ build_historical_draft_skill.py     │ → data/historical_draft_skill.json
   └─────────────┬──────────────────────┘
                 │
                 ▼
   ┌────────────────────────────────────┐
   │ build_mock_draft_sim.py             │ → data/mock_draft_picks.json      LAYER 3 (~50s)
   │                                     │ → data/mc_summary_all.json
   └─────────────┬──────────────────────┘
                 │
                 ▼
   ┌────────────────────────────────────┐
   │ build_power_rankings.py             │ → MONEYLEAGUE_POWER_RANKINGS.pdf
   │ build_preseason_2026.py             │ → MONEYLEAGUE_2026_PRESEASON.pdf
   │ build_mock_draft_report.py          │ → MONEYLEAGUE_2026_MOCK.pdf        LAYER 4 (~1 min)
   │ build_draft_helper_data.py          │ → docs/draft_helper/data.json
   │ (re-inline standalone.html)         │ → docs/draft_helper/standalone.html
   └────────────────────────────────────┘
```

## Common scenarios

| Want to… | Run |
|---|---|
| Refresh latest projections + rebuild everything | `refresh_all.sh` |
| Just-published FantasyPros update | `refresh_all.sh fetch` then `refresh_all.sh derive sim reports` |
| Manually edit a keeper override | edit `data/keepers_2026.json` → `refresh_all.sh sim reports` |
| Try a different sim seed | edit `N_SIMS`/seeds in `build_mock_draft_sim.py` → `refresh_all.sh sim reports` |
| Refresh just the draft helper for live use | `refresh_all.sh helper` |
| Roll over to next season (e.g. 2027) | See [Year rollover](#year-rollover) below |

## What each script does

### Layer 1 — fetches

| Script | What it pulls | Cache file |
|---|---|---|
| `fetch_sleeper.sh` | League state, drafts, rosters, transactions, matchups, projections | `data/sleeper/league_*/*` + `data/sleeper_projections_2026.json` + `data/sleeper/players_nfl.json` |
| `fetch_fantasypros.py` | 38-expert superflex half-PPR consensus | `data/rankings_fantasypros.json` |
| `fetch_fantasycalc.py` | Trade values + 30-day trends | `data/rankings_fantasycalc.json` |

### Layer 2 — derived data

| Script | Inputs | Output | Why |
|---|---|---|---|
| `build_players_csv.py` | `sleeper_projections_2026.json` | `players_2026.csv` | Superflex (adp_2qb) ADP + projections in one CSV |
| `build_pick_value.py` | Sleeper draft history | `pick_value.json` | Empirical per-round VBD baseline |
| `build_2026_keepers.py` | rosters + xlsx + projections + pick_value | `keepers_2026.json` | Predicts top-4 keepers per team (3-year cap, R-2 penalty, K/DEF excluded) |
| `build_manager_tendencies.py` | 3 yrs of Sleeper drafts | `manager_tendencies.json` | Per-manager first-pick round vs league avg (Lem early DEF etc.) |
| `build_historical_draft_skill.py` | Historical drafts + nflverse stats | `historical_draft_skill.json` | Per-manager draft VBD per season |

### Layer 3 — simulator

| Script | Inputs | Output |
|---|---|---|
| `build_mock_draft_sim.py` | players, keepers, tendencies, traded picks | `mock_draft_picks.json` (1 greedy sim) + `mc_summary_all.json` (300 MC sims) |

### Layer 4 — final artifacts

| Script | Inputs | Output |
|---|---|---|
| `build_power_rankings.py` | All-time history + recent stats | `MONEYLEAGUE_POWER_RANKINGS.pdf` |
| `build_preseason_2026.py` | keepers + skill scores + xlsx | `MONEYLEAGUE_2026_PRESEASON.pdf` |
| `build_mock_draft_report.py` | mock picks + MC summary + chart data | `MONEYLEAGUE_2026_MOCK.pdf` |
| `build_draft_helper_data.py` | players + keepers + tendencies + traded picks + FP overlay | `docs/draft_helper/data.json` |
| (inline) | index.html + data.json | `docs/draft_helper/standalone.html` |

## Year rollover (2027 and beyond)

The pipeline has these year-specific anchors. Update them when moving to a new season:

1. **`configs/my_sleeper.json`** — change `league_id` to the new season's Sleeper ID
2. **Run `fetch_sleeper.sh`** — it walks `previous_league_id` automatically; everything else stays
3. **Filenames with `2026`** — find/replace 2026 → 2027:
   - `data/players_2026.csv` → `_2027`
   - `data/sleeper_projections_2026.json` → `_2027`
   - `data/keepers_2026.json` → `_2027`
   - `data/MONEYLEAGUE_2026_*.pdf` → `_2027`
   - References inside `build_*_2026.py` and `build_mock_draft_sim.py`
4. **`PREDICTED_SLOT_TO_RID`** in `build_mock_draft_report.py` + `build_mock_draft_sim.py` + `build_draft_helper_data.py` — update to new season's draft order
5. **`FP url year=2026`** in `fetch_fantasypros.py` → 2027

After rollover: `scripts/refresh_all.sh` rebuilds everything from scratch.

## Live draft (draft helper)

Lives at `docs/draft_helper/`:
- `index.html` — single-page draft assistant (fetches `data.json`)
- `data.json` — players + keepers + schedule + tendencies
- `standalone.html` — same as index.html but with `data.json` inlined
  (built by `scripts/build_standalone_helper.py`, which fails loudly if
  index.html's structure drifts); use for htmlpreview.github.io or `file://`

Refresh: `scripts/refresh_all.sh helper`. URL bar state survives refresh.

### LIVE mode (draft-day auto-sync)

Press **GO LIVE** in the header and paste the Sleeper draft ID (the long
number in the draft room URL). The helper then:

1. Pulls the REAL draft order + traded picks from Sleeper and rebuilds the
   schedule — the predicted order and predicted keeper placements are
   discarded in favor of live truth (keepers arrive through the picks feed).
2. Polls `api.sleeper.app/v1/draft/<id>/picks` every 15 seconds and marks
   picks automatically — no manual clicking.
3. Unknown deep-bench players are synthesized into the pool so the sync
   never wedges on a name mismatch.

The draft ID is remembered in the browser (localStorage); if the page
reloads mid-draft, press GO LIVE again and it reconnects. Verified
end-to-end against the complete 2025 draft (204/204 picks matched,
attribution + Brian's roster + slot remap all correct).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `FileNotFoundError: data/sleeper/players_nfl.json` | `curl -sS https://api.sleeper.app/v1/players/nfl -o data/sleeper/players_nfl.json` |
| `data/sleeper_projections_2026.json missing` | `scripts/refresh_all.sh fetch` (or just `scripts/fetch_sleeper.sh`) |
| PDF render fails with playwright errors | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` should be set; reinstall: `playwright install chromium` |
| Wrong keepers showing in mock | Manually edit `data/keepers_2026.json` then `refresh_all.sh sim reports` |
| Mock board has reaches | Display sim uses `DISPLAY_TEMPERATURE=0.0` (greedy). Change in `build_mock_draft_sim.py` if needed. |

## Analysis tools (run on demand)

- `scripts/backtest_recommender.py` — replay 2023-2025 real drafts, tool
  vs real-Brian, scored by actual season points. Period-honest (ADP-only
  knowledge, implicit-keeper detection). → data/backtest_results.json
- `scripts/optimize_my_keepers.py` — simulate the full draft under every
  keeper-set combination (paired-seed MC) and rank them.
  → data/keeper_optimizer_results.json

## Data provenance warning: 2023 Sleeper draft feed

2023 was the league's first Sleeper season. Brian (commissioner) entered
all 204 picks himself, placed by ROUND for keeper-cost tracking, then
allocated players to the correct rosters afterward. Consequences:

- `picked_by` is Brian's user_id on every 2023 pick — meaningless.
- `roster_id` reflects the entry slot, not the real owner — wrong on
  194/204 picks. NEVER use Sleeper roster attribution for 2023.
- Round placement and board order ARE trustworthy (that was the point
  of the manual entry).
- Real pick ownership lives in the MONEY_LEAGUE.xlsx cell-color overlay
  (`fantasy_draft/xlsx_drafts.py`), which is the league's source of
  truth. 2024 has ~17 attribution mismatches (traded picks); 2025 is
  fully clean and has real is_keeper flags.

Anything attributing historical picks to managers must join xlsx
ownership on (round, slot) — see backtest_recommender.py and
build_manager_tendencies.py for the pattern.

## Draft-prep tools (July 2026 additions)

- **Injury watch** — part of the weekly briefing: diffs injury statuses
  for ADP<200 players + all keepers vs data/injury_snapshot.json
  (committed baseline), flags changes with [KEEPER] tags.
- **CEILING mode** (helper button) — re-weights recommendations toward
  boom/bust upside: FantasyPros expert disagreement (rank std) + youth.
  For when you're drafting for 90th-percentile outcomes, not medians.
- **PRACTICE mode** (helper button) — full mock drafts in-browser
  against the tendency-modeled league bots (softmax T=0.25, needs +
  caps + per-manager tendencies). Pauses on your clock; final roster
  graded against your Monte Carlo quartiles. Never touches real state.
- **scripts/trade_advisor.py** — league pick-capital table and pick-swap
  pricing with forward-looking round values:
  `python3 scripts/trade_advisor.py --give R3 R7 --get R2 R12`
