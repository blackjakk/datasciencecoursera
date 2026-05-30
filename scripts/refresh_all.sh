#!/usr/bin/env bash
# MONEYLEAGUE data + report pipeline orchestrator.
#
# Rebuilds every artifact from current data. Idempotent — safe to re-run.
#
# Usage:
#   scripts/refresh_all.sh              # everything: fetch + derive + sim + reports
#   scripts/refresh_all.sh derive       # skip external fetches (faster)
#   scripts/refresh_all.sh sim          # only simulator + mock PDF
#   scripts/refresh_all.sh reports      # only PDFs (assumes derived data is fresh)
#   scripts/refresh_all.sh helper       # only draft helper bundle
#
# Pipeline (dependency order):
#
#   LAYER 1 — External fetches (rarely change; manual triggers)
#     fetch_sleeper.sh           -> data/sleeper/*
#     fetch_fantasypros.py       -> data/rankings_fantasypros.json
#     fetch_fantasycalc.py       -> data/rankings_fantasycalc.json
#
#   LAYER 2 — Derived data (cheap; safe to re-run anytime)
#     build_players_csv.py       -> data/players_2026.csv
#     build_pick_value.py        -> data/pick_value.json
#     build_2026_keepers.py      -> data/keepers_2026.json
#     build_manager_tendencies.py-> data/manager_tendencies.json
#     build_historical_draft_skill.py -> data/historical_draft_skill.json
#
#   LAYER 3 — Simulator (slow ~30s; needs derived data)
#     build_mock_draft_sim.py    -> /tmp/mock_draft_picks.json
#                                   data/mc_summary_all.json
#
#   LAYER 4 — Reports (slow ~30s each; need everything upstream)
#     build_power_rankings.py    -> data/MONEYLEAGUE_POWER_RANKINGS.pdf
#     build_preseason_2026.py    -> data/MONEYLEAGUE_2026_PRESEASON.pdf
#     build_mock_draft_report.py -> data/MONEYLEAGUE_2026_MOCK.pdf
#     build_draft_helper_data.py -> docs/draft_helper/data.json
#     (regenerate standalone.html from index.html + data.json)
#
set -euo pipefail
cd "$(dirname "$0")/.."

STAGE="${1:-all}"
log() { printf "\n\033[1;36m▶ %s\033[0m\n" "$1"; }
skip() { printf "\n\033[2m  (skip: %s)\033[0m\n" "$1"; }

# ---------- LAYER 1: external fetches ----------
do_fetch() {
  log "Fetch Sleeper (league + projections + transactions)"
  scripts/fetch_sleeper.sh
  log "Fetch FantasyPros consensus rankings"
  python3 scripts/fetch_fantasypros.py
  log "Fetch FantasyCalc trade values"
  python3 scripts/fetch_fantasycalc.py
}

# ---------- LAYER 2: derived data ----------
do_derive() {
  log "Rebuild players_2026.csv from Sleeper projections"
  python3 scripts/build_players_csv.py
  log "Rebuild empirical pick-value chart"
  python3 scripts/build_pick_value.py
  log "Predict 2026 keepers"
  python3 scripts/build_2026_keepers.py
  log "Extract per-manager draft tendencies"
  python3 scripts/build_manager_tendencies.py
  log "Compute historical draft skill"
  python3 scripts/build_historical_draft_skill.py
}

# ---------- LAYER 3: simulator ----------
do_sim() {
  log "Run mock draft sim + Monte Carlo (50 sims)"
  python3 scripts/build_mock_draft_sim.py
}

# ---------- LAYER 4: reports ----------
do_reports() {
  log "Render Power Rankings PDF"
  python3 scripts/build_power_rankings.py
  log "Render 2026 Preseason GUAP Rankings PDF"
  python3 scripts/build_preseason_2026.py
  log "Render 2026 Mock Draft PDF"
  python3 scripts/build_mock_draft_report.py
  do_helper
}

# ---------- Draft helper ----------
do_helper() {
  log "Refresh draft helper data bundle"
  python3 scripts/build_draft_helper_data.py
  log "Rebuild standalone.html (data inlined)"
  python3 -c "
from pathlib import Path
html = Path('docs/draft_helper/index.html').read_text()
data = Path('docs/draft_helper/data.json').read_text()
needle = 'const DATA_URL = \"data.json\";\nlet DATA = null;'
replacement = f'const EMBEDDED_DATA = {data};\nconst DATA_URL = null;\nlet DATA = null;'
html = html.replace(needle, replacement)
old_init = '''(async function init() {
  const resp = await fetch(DATA_URL);
  DATA = await resp.json();
  loadStateFromURL();         // first restore any user picks from URL
  applyKeepersAtStart();      // then place all remaining keepers
  recomputeCursor();          // cursor = first slot without a player
  refresh();'''
new_init = '''(async function init() {
  DATA = EMBEDDED_DATA;
  loadStateFromURL();
  applyKeepersAtStart();
  recomputeCursor();
  refresh();'''
html = html.replace(old_init, new_init)
out = Path('docs/draft_helper/standalone.html')
out.write_text(html)
print(f'Wrote {out} ({len(html):,} bytes)')
"
  # Mirror into football-sim branch's draft_helper/ for htmlpreview hosting
  if [ -d "draft_helper" ]; then
    cp docs/draft_helper/*.html docs/draft_helper/data.json draft_helper/
    echo "Synced to draft_helper/ (football-sim branch path)"
  fi
}

case "$STAGE" in
  all)      do_fetch; do_derive; do_sim; do_reports ;;
  fetch)    do_fetch ;;
  derive)   do_derive ;;
  sim)      do_sim ;;
  reports)  do_reports ;;
  helper)   do_helper ;;
  *)        echo "unknown stage: $STAGE"; exit 1 ;;
esac

log "Done. ($STAGE)"
