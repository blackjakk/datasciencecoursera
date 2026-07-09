"""Per-team keeper habits from MONEY_LEAGUE.xlsx, with real team names
attached.

The xlsx column layout doesn't tell us which team owns which column --
columns are draft-slot ordered for each year, and draft slot doesn't
stay constant across years. We attach team names by matching the
column's keeper picks against the current Sleeper rosters: a team-col
that kept "George Kittle" in 2025 maps to the Sleeper roster that
currently has George Kittle (Barry Sandals).

Writes data/team_tendencies.json for the web app's tab 6.
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.analysis import load_full_grid
from fantasy_draft.xlsx_history import load_all_keepers, normalize_name

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "data" / "historical" / "MONEY_LEAGUE.xlsx"
SLEEPER_2025 = ROOT / "data" / "sleeper" / "league_1245039290518360064"
OUT = ROOT / "data" / "team_tendencies.json"

POSITIONS = ("QB", "RB", "WR", "TE", "K", "DEF")


def _build_player_position_lookup() -> dict[str, str]:
    """norm_name -> position from Sleeper player catalog."""
    cat_path = ROOT / "data" / "sleeper" / "players_nfl.json"
    out: dict[str, str] = {}
    if not cat_path.exists():
        return out
    cat = json.loads(cat_path.read_text(encoding="utf-8"))
    for p in cat.values():
        pos = p.get("position") or ""
        if pos not in POSITIONS:
            continue
        nm = p.get("full_name") or (
            f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
            if p.get("first_name") else None
        )
        if nm:
            out[normalize_name(nm)] = pos
    return out


def _build_xlsx_col_to_team(year: int = 2025) -> dict[int, str]:
    """For one xlsx year, return {column: team_name} by matching that
    column's keeper player(s) to the current Sleeper roster owners.

    Uses the current (2025) Sleeper rosters as the source of team names.
    If a column has multiple keepers, take the majority match.
    """
    # Load 2025 Sleeper rosters -> {team_name: set(player_norm_names)}
    users = {u["user_id"]: u for u in json.loads((SLEEPER_2025 / "users.json").read_text(encoding="utf-8"))}
    rosters = json.loads((SLEEPER_2025 / "rosters.json").read_text(encoding="utf-8"))
    cat = json.loads((ROOT / "data" / "sleeper" / "players_nfl.json").read_text(encoding="utf-8"))

    team_to_players: dict[str, set[str]] = {}
    for r in rosters:
        owner = users.get(r.get("owner_id") or "", {})
        meta = owner.get("metadata") or {}
        team_name = meta.get("team_name") or owner.get("display_name") or f"Roster {r['roster_id']}"
        player_norms: set[str] = set()
        for pid in (r.get("players") or []):
            p = cat.get(str(pid)) or {}
            nm = p.get("full_name") or (
                f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
                if p.get("first_name") else None
            )
            if nm:
                player_norms.add(normalize_name(nm))
        team_to_players[team_name] = player_norms

    # Walk xlsx year's keepers and tally per column.
    keepers_by_year = load_all_keepers(XLSX)
    yr_keepers = keepers_by_year.get(year, [])
    col_to_team: dict[int, str] = {}
    for col in {k.column for k in yr_keepers}:
        col_players = [normalize_name(k.player_name) for k in yr_keepers if k.column == col]
        # Score each candidate team by how many of this col's keepers are on their roster.
        scores = Counter()
        for team, roster_norms in team_to_players.items():
            scores[team] = sum(1 for p in col_players if p in roster_norms)
        best_team, best_score = scores.most_common(1)[0] if scores else (None, 0)
        if best_score > 0:
            col_to_team[col] = best_team
        else:
            col_to_team[col] = f"col_{col}"
    return col_to_team


def main() -> None:
    if not XLSX.exists():
        sys.exit(f"ERROR: {XLSX.relative_to(ROOT)} missing.")
    if not (SLEEPER_2025 / "rosters.json").exists():
        sys.exit(f"ERROR: {SLEEPER_2025.relative_to(ROOT)}/rosters.json missing. "
                 f"Run scripts/fetch_sleeper.sh first.")

    pos_lookup = _build_player_position_lookup()
    col_to_team = _build_xlsx_col_to_team(year=2025)

    # Walk the full grid year-by-year and accumulate stats per column,
    # then aggregate by team via col_to_team.
    # NOTE: This uses 2025 column->team mapping for ALL years. Draft slots
    # shift year-to-year, so cross-year aggregation is approximate -- it
    # really shows "the team currently using col C in 2025" not "the team
    # who owned col C in 2017". We'll surface 2025 only as the most-actionable
    # view and note the caveat.

    grid = load_full_grid(XLSX)
    keepers_by_year = load_all_keepers(XLSX)

    # Per-team aggregate (using current 2025 column->team mapping).
    team_stats: dict[str, dict] = defaultdict(lambda: {
        "team_name": "",
        "seasons_in_league": 0,
        "total_keepers": 0,
        "keeper_rounds": [],
        "position_counts": Counter(),
        "yr3_caps_hit": 0,
        "seasons_active": set(),
    })

    for year, keepers in keepers_by_year.items():
        # Only attribute to teams if the year's xlsx column matches the 2025
        # mapping AND we have a non-default team name. Otherwise fall back
        # to "col_X" so we don't misattribute.
        # For simplicity we use 2025's mapping. Older years will sometimes
        # map to a different person at the same column slot.
        if year == 2025:
            this_year_col_to_team = col_to_team
        else:
            this_year_col_to_team = _build_xlsx_col_to_team(year=year) if year >= 2023 else {}

        for k in keepers:
            team = this_year_col_to_team.get(k.column) or f"col_{k.column}_pre-sleeper"
            entry = team_stats[team]
            entry["team_name"] = team
            entry["total_keepers"] += 1
            entry["keeper_rounds"].append(k.round_num)
            pos = pos_lookup.get(normalize_name(k.player_name), "?")
            entry["position_counts"][pos] += 1
            if k.years_kept == 3:
                entry["yr3_caps_hit"] += 1
            entry["seasons_active"].add(year)

    teams_out = []
    for team, e in team_stats.items():
        seasons = len(e["seasons_active"])
        rounds = e["keeper_rounds"]
        # Most-kept position (excluding '?').
        mk = sorted([(p, n) for p, n in e["position_counts"].items() if p != "?"],
                     key=lambda x: -x[1])
        most_kept_pos = mk[0][0] if mk else None
        teams_out.append({
            "team_name": team,
            "seasons_in_league": seasons,
            "total_keepers": e["total_keepers"],
            "avg_keepers_per_year": round(e["total_keepers"] / seasons, 2) if seasons else 0,
            "avg_keeper_round": round(sum(rounds) / len(rounds), 1) if rounds else None,
            "yr3_caps_hit": e["yr3_caps_hit"],
            "most_kept_position": most_kept_pos,
            "position_counts": {p: e["position_counts"][p] for p in POSITIONS},
        })

    # Sort: real teams (mapped via Sleeper) first, then pre-Sleeper col_X buckets.
    teams_out.sort(key=lambda t: (t["team_name"].startswith("col_"), -t["total_keepers"]))

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": str(XLSX.relative_to(ROOT)),
        "note": ("Team names attached via 2023+ Sleeper rosters. Pre-2023 "
                 "xlsx years use draft-slot columns that don't cleanly map "
                 "to current teams, so those records bucket as 'col_N_pre-sleeper'."),
        "teams": teams_out,
    }

    OUT.write_text(json.dumps(payload, indent=2))
    print(f"Wrote {OUT.relative_to(ROOT)}")
    real = [t for t in teams_out if not t["team_name"].startswith("col_")]
    print(f"  Real teams: {len(real)}  |  legacy col buckets: {len(teams_out) - len(real)}")
    for t in real[:5]:
        print(f"  {t['team_name']:<32} total={t['total_keepers']}  "
              f"avgR={t['avg_keeper_round']}  most-kept={t['most_kept_position']}")


if __name__ == "__main__":
    main()
