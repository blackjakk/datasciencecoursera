"""Load Sleeper weekly matchup results and join to draft picks.

For each season under data/sleeper/league_*/, summarize:
  - Per-player season-total fantasy points (sum of weekly scores from
    matchups/week_*.json).
  - Per-team standings (wins/losses/fpts/fpts_against).
  - Playoff champion + final-game scores from winners_bracket.json.

The downstream analyses (position-by-round, draft ROI) join these
per-player season totals back to the draft picks so we can answer:
"for each round, which position produced the most points on average?"
"""
from __future__ import annotations

import glob
import json
from collections import defaultdict
from pathlib import Path


def load_player_catalog(sleeper_dir: str | Path = "data/sleeper") -> dict[str, dict]:
    """Returns the Sleeper /players/nfl payload (id -> player metadata).

    Cached at data/sleeper/players_nfl.json by fetch_sleeper.sh. Returns
    empty dict if missing.
    """
    p = Path(sleeper_dir) / "players_nfl.json"
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8"))


def load_season_results(season_dir: str | Path) -> dict:
    """For one season's league_<id>/ dir, return a summary dict:

      {
        'season': int,
        'league_id': str,
        'name': str,
        'num_teams': int,
        'rosters': {roster_id: {'team_name', 'wins', 'losses', 'fpts',
                                'fpts_against'}},
        'player_total_points': {player_id: total_points_across_all_weeks},
        'weekly_team_points': {(week, roster_id): points},
        'champion_roster_id': int or None,
      }
    """
    season_dir = Path(season_dir)
    league = json.loads((season_dir / "league.json").read_text(encoding="utf-8"))
    users = {u["user_id"]: u for u in json.loads((season_dir / "users.json").read_text(encoding="utf-8"))}
    rosters_raw = json.loads((season_dir / "rosters.json").read_text(encoding="utf-8"))

    rosters: dict[int, dict] = {}
    for r in rosters_raw:
        rid = int(r["roster_id"])
        owner = users.get(r.get("owner_id") or "", {})
        meta = owner.get("metadata") or {}
        team_name = (meta.get("team_name")
                     or owner.get("display_name")
                     or f"Roster {rid}")
        s = r.get("settings") or {}
        rosters[rid] = {
            "team_name": team_name,
            "wins": s.get("wins", 0),
            "losses": s.get("losses", 0),
            "ties": s.get("ties", 0),
            "fpts": s.get("fpts", 0) + (s.get("fpts_decimal", 0) or 0) / 100.0,
            "fpts_against": s.get("fpts_against", 0) + (s.get("fpts_against_decimal", 0) or 0) / 100.0,
        }

    player_total: dict[str, float] = defaultdict(float)
    weekly_team: dict[tuple[int, int], float] = {}
    matchups_dir = season_dir / "matchups"
    for wk_file in sorted(matchups_dir.glob("week_*.json")):
        week = int(wk_file.stem.split("_")[1])
        entries = json.loads(wk_file.read_text(encoding="utf-8"))
        for e in entries:
            rid = int(e["roster_id"])
            pts = float(e.get("points") or 0.0)
            if pts:
                weekly_team[(week, rid)] = pts
            for pid, p in (e.get("players_points") or {}).items():
                if p:
                    player_total[str(pid)] += float(p)

    # Champion: winners_bracket terminal game (highest round, m==1 typically).
    champion_rid = None
    wb_file = season_dir / "winners_bracket.json"
    if wb_file.exists():
        bracket = json.loads(wb_file.read_text(encoding="utf-8"))
        if bracket:
            final = max(bracket, key=lambda g: g.get("r", 0))
            champion_rid = final.get("w")

    return {
        "season": int(league.get("season") or 0),
        "league_id": str(league.get("league_id") or ""),
        "name": league.get("name") or "",
        "num_teams": int((league.get("settings") or {}).get("num_teams") or 0),
        "rosters": rosters,
        "player_total_points": dict(player_total),
        "weekly_team_points": weekly_team,
        "champion_roster_id": int(champion_rid) if champion_rid else None,
    }


def load_all_seasons(sleeper_dir: str | Path = "data/sleeper") -> dict[int, dict]:
    """Walk data/sleeper/league_*/ and return {season: load_season_results()}."""
    out: dict[int, dict] = {}
    for season_dir in sorted(Path(sleeper_dir).glob("league_*")):
        if not (season_dir / "league.json").exists():
            continue
        s = load_season_results(season_dir)
        if s["season"]:
            out[s["season"]] = s
    return out


def load_all_trades(sleeper_dir: str | Path = "data/sleeper") -> list[dict]:
    """Walk every season's transactions/week_*.json, return all completed
    trades flattened with season + week annotated. Returns a list of dicts
    keyed by the raw Sleeper schema plus '_season' and '_week'."""
    sleeper_dir = Path(sleeper_dir)
    out: list[dict] = []
    for season_dir in sorted(sleeper_dir.glob("league_*")):
        if not (season_dir / "league.json").exists():
            continue
        lg = json.loads((season_dir / "league.json").read_text(encoding="utf-8"))
        season = int(lg.get("season") or 0)
        txn_dir = season_dir / "transactions"
        if not txn_dir.exists():
            continue
        for wf in sorted(txn_dir.glob("week_*.json")):
            week = int(wf.stem.split("_")[1])
            try:
                txns = json.loads(wf.read_text(encoding="utf-8"))
            except Exception:
                continue
            for t in txns:
                if t.get("type") == "trade" and t.get("status") == "complete":
                    t = dict(t)
                    t["_season"] = season
                    t["_week"] = week
                    out.append(t)
    return out


def summarize_trade(
    trade: dict,
    roster_team_name: dict[int, str],
    player_catalog: dict[str, dict],
    player_total_points_by_season: dict[int, dict[str, float]],
    pick_value_blind: dict[int, float],
) -> list[dict]:
    """Per-roster summary of a single trade.

    For each roster involved, returns a row with: team name, players
    received (+ their season pts), picks received (+ pick value), players
    given (+ season pts), picks given (+ pick value), net VBD delta.

    The `season pts` and `pick value` are valued in the context of the
    SEASON the trade occurred (e.g. a 2023 trade values picks via that
    year's pick chart and players via their 2023 season production).
    """
    season = trade.get("_season")
    rosters = trade.get("roster_ids") or []
    adds = trade.get("adds") or {}
    drops = trade.get("drops") or {}
    picks = trade.get("draft_picks") or []
    season_pts = player_total_points_by_season.get(season, {})

    rows: list[dict] = []
    for rid in rosters:
        rid = int(rid)
        team_name = roster_team_name.get(rid, f"Roster {rid}")
        received_players, given_players = [], []
        received_pick_value, given_pick_value = 0.0, 0.0
        received_player_pts, given_player_pts = 0.0, 0.0

        for pid, dest in adds.items():
            if int(dest) == rid:
                meta = player_catalog.get(pid) or {}
                nm = meta.get("full_name") or f"player_{pid}"
                pts = season_pts.get(pid, 0.0)
                received_players.append(f"{nm} ({pts:.0f} pts)")
                received_player_pts += pts
        for pid, src in drops.items():
            if int(src) == rid:
                meta = player_catalog.get(pid) or {}
                nm = meta.get("full_name") or f"player_{pid}"
                pts = season_pts.get(pid, 0.0)
                given_players.append(f"{nm} ({pts:.0f} pts)")
                given_player_pts += pts
        for p in picks:
            rnd = int(p.get("round") or 0)
            pv = pick_value_blind.get(rnd, 0.0)
            if int(p.get("owner_id") or 0) == rid:
                received_pick_value += pv
                yr = p.get("season") or "?"
                received_players.append(f"{yr} R{rnd} (~{pv:+.0f} VBD)")
            elif int(p.get("previous_owner_id") or 0) == rid:
                given_pick_value += pv
                yr = p.get("season") or "?"
                given_players.append(f"{yr} R{rnd} (~{pv:+.0f} VBD)")

        net = (received_player_pts + received_pick_value) - (given_player_pts + given_pick_value)
        rows.append({
            "season": season,
            "week": trade.get("_week"),
            "team": team_name,
            "received": ", ".join(received_players) or "—",
            "given": ", ".join(given_players) or "—",
            "received_value": round(received_player_pts + received_pick_value, 1),
            "given_value": round(given_player_pts + given_pick_value, 1),
            "net": round(net, 1),
        })
    return rows


def load_draft_picks_with_points(
    sleeper_dir: str | Path = "data/sleeper",
) -> list[dict]:
    """For every Sleeper season, join draft picks to per-player season
    total points. Returns a flat list of:

      {season, round, pick_in_round, overall_pick, roster_id, team_name,
       player_id, player_name, position, season_points, is_keeper}
    """
    sleeper_dir = Path(sleeper_dir)
    seasons = load_all_seasons(sleeper_dir)
    out: list[dict] = []
    for season_dir in sorted(sleeper_dir.glob("league_*")):
        if not (season_dir / "league.json").exists():
            continue
        lg = json.loads((season_dir / "league.json").read_text(encoding="utf-8"))
        season = int(lg.get("season") or 0)
        if season not in seasons:
            continue
        s = seasons[season]
        pick_files = list(season_dir.glob("draft_*_picks.json"))
        if not pick_files:
            continue
        picks = json.loads(pick_files[0].read_text(encoding="utf-8"))
        for p in picks:
            meta = p.get("metadata") or {}
            pid = str(p.get("player_id") or "")
            rid = int(p.get("roster_id") or 0)
            out.append({
                "season": season,
                "round": int(p.get("round") or 0),
                "pick_in_round": int(p.get("draft_slot") or 0),
                "overall_pick": int(p.get("pick_no") or 0),
                "roster_id": rid,
                "team_name": s["rosters"].get(rid, {}).get("team_name", f"Roster {rid}"),
                "player_id": pid,
                "player_name": f"{meta.get('first_name','').strip()} {meta.get('last_name','').strip()}".strip(),
                "position": (meta.get("position") or "").upper(),
                "season_points": s["player_total_points"].get(pid, 0.0),
                "is_keeper": bool(p.get("is_keeper")),
            })
    return out
