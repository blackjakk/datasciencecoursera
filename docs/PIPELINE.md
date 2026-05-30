# MONEYLEAGUE Pipeline — How to Update Anything

Single entrypoint: `scripts/refresh_all.sh`. Idempotent — re-run any stage anytime.

## Quick reference

```bash
# Everything (fetch -> derive -> sim -> reports + helper). ~3-5 min.
scripts/refresh_all.sh

# Skip slow external fetches (use cached Sleeper/FP/FC data).
scripts/refresh_all.sh derive

# Just the simulator + mock board (after derive).
scripts/refresh_all.sh sim

# Just the PDFs + draft helper (assumes derived data is fresh).
scripts/refresh_all.sh reports

# Just the draft helper bundle (cheap; do this when projections shift).
scripts/refresh_all.sh helper
```

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
   │ build_mock_draft_sim.py             │ → /tmp/mock_draft_picks.json       LAYER 3 (~30s)
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
| `build_mock_draft_sim.py` | players, keepers, tendencies, traded picks | `mock_draft_picks.json` (1 greedy sim) + `mc_summary_all.json` (50 MC sims) |

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
- `standalone.html` — same as index.html but with `data.json` inlined; useful for htmlpreview.github.io or `file://` loading

Refresh: `scripts/refresh_all.sh helper`. URL bar state survives refresh.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `FileNotFoundError: data/sleeper/players_nfl.json` | `curl -sS https://api.sleeper.app/v1/players/nfl -o data/sleeper/players_nfl.json` |
| `data/sleeper_projections_2026.json missing` | `scripts/refresh_all.sh fetch` (or just `scripts/fetch_sleeper.sh`) |
| PDF render fails with playwright errors | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` should be set; reinstall: `playwright install chromium` |
| Wrong keepers showing in mock | Manually edit `data/keepers_2026.json` then `refresh_all.sh sim reports` |
| Mock board has reaches | Display sim uses `DISPLAY_TEMPERATURE=0.0` (greedy). Change in `build_mock_draft_sim.py` if needed. |
