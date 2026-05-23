#!/usr/bin/env bash
# Dump the Sleeper endpoints we need to data/sleeper/ so we can process them
# offline. Walks previous_league_id to also grab past seasons.
#
# Usage:
#   scripts/fetch_sleeper.sh                 # uses configs/my_sleeper.json
#   scripts/fetch_sleeper.sh <league_id>
#
# Then: git add data/sleeper/ && git commit -m "sleeper dump"

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT_DIR/data/sleeper"
mkdir -p "$OUT_DIR"

if [ $# -ge 1 ]; then
    LEAGUE_ID="$1"
else
    LEAGUE_ID="$(python -c "import json; print(json.load(open('$ROOT_DIR/configs/my_sleeper.json'))['league_id'])")"
fi

API="https://api.sleeper.app/v1"

get() {
    local url="$1"
    local out="$2"
    echo "  -> $out"
    curl -sS --fail "$url" -o "$out"
}

# Players catalog: ~5MB, refresh weekly at most.
PLAYERS_FILE="$OUT_DIR/players_nfl.json"
if [ ! -f "$PLAYERS_FILE" ] || [ "$(find "$PLAYERS_FILE" -mtime +7 -print 2>/dev/null)" ]; then
    echo "[players] fetching NFL player catalog..."
    get "$API/players/nfl" "$PLAYERS_FILE"
else
    echo "[players] cached at $PLAYERS_FILE (less than 7 days old)"
fi

# Walk season history.
current="$LEAGUE_ID"
seen=()
seasons_walked=0
MAX_SEASONS=8

while [ -n "$current" ] && [ "$current" != "0" ] && [ "$current" != "null" ]; do
    # de-dupe
    for s in "${seen[@]:-}"; do
        if [ "$s" = "$current" ]; then
            echo "[stop] already saw $current"
            current=""
            break
        fi
    done
    [ -z "$current" ] && break
    seen+=("$current")
    seasons_walked=$((seasons_walked + 1))

    SEASON_DIR="$OUT_DIR/league_$current"
    mkdir -p "$SEASON_DIR"
    echo "[league $current] -> $SEASON_DIR/"

    LEAGUE_FILE="$SEASON_DIR/league.json"
    get "$API/league/$current" "$LEAGUE_FILE"
    get "$API/league/$current/users"         "$SEASON_DIR/users.json"
    get "$API/league/$current/rosters"       "$SEASON_DIR/rosters.json"
    get "$API/league/$current/drafts"        "$SEASON_DIR/drafts.json"
    get "$API/league/$current/traded_picks"  "$SEASON_DIR/traded_picks.json" || true

    # For each draft in the season, pull picks.
    python - <<PY
import json, os
drafts = json.load(open(os.path.join("$SEASON_DIR", "drafts.json")))
ids = [d["draft_id"] for d in drafts if d.get("draft_id")]
open(os.path.join("$SEASON_DIR", "_draft_ids.txt"), "w").write("\n".join(ids))
PY

    while read -r DRAFT_ID; do
        [ -z "$DRAFT_ID" ] && continue
        get "$API/draft/$DRAFT_ID"       "$SEASON_DIR/draft_${DRAFT_ID}.json"
        get "$API/draft/$DRAFT_ID/picks" "$SEASON_DIR/draft_${DRAFT_ID}_picks.json"
    done < "$SEASON_DIR/_draft_ids.txt"

    # Step backward via previous_league_id.
    current="$(python -c "import json; d=json.load(open('$LEAGUE_FILE')); print(d.get('previous_league_id') or '')")"

    if [ "$seasons_walked" -ge "$MAX_SEASONS" ]; then
        echo "[stop] reached MAX_SEASONS=$MAX_SEASONS"
        break
    fi
done

echo
echo "Done. Walked $seasons_walked season(s)."

# --- Projections (api.sleeper.com, different host than api.sleeper.app) ----
SEASON_NOW="$(date +%Y)"
PROJ_FILE="$OUT_DIR/projections_${SEASON_NOW}.json"
if [ ! -f "$PROJ_FILE" ] || [ "$(find "$PROJ_FILE" -mtime +7 -print 2>/dev/null)" ]; then
    echo
    echo "[projections] fetching season ${SEASON_NOW} projections..."
    PROJ_URL="https://api.sleeper.com/projections/nfl/${SEASON_NOW}?season_type=regular&order_by=adp_half_ppr"
    for POS in QB RB WR TE K DEF; do
        PROJ_URL="${PROJ_URL}&position[]=${POS}"
    done
    if curl -sS --fail "$PROJ_URL" -o "$PROJ_FILE"; then
        echo "  -> $PROJ_FILE"
    else
        echo "  [warn] projections fetch failed; you can rerun later."
    fi
fi

echo
echo "Now: git add data/sleeper/ && git commit -m 'sleeper dump' && git push"
