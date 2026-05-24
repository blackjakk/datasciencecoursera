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


def load_player_ownership_windows(
    sleeper_dir: str | Path = "data/sleeper",
) -> dict[tuple[int, str], list[tuple[int, int, int]]]:
    """For each (season, player_id), return a list of (start_wk, end_wk, rid)
    intervals tracking who actually owned the player each week.

    Used to credit FA/streaming pickups only for weeks the player was on
    that manager's roster — not the full rest-of-season (which double-counts
    when the player gets dropped or traded away).
    """
    ownership: dict[tuple[int, str], list[tuple[int, int, int]]] = {}
    for season_dir in sorted(Path(sleeper_dir).glob("league_*")):
        if not (season_dir / "league.json").exists():
            continue
        lg = json.loads((season_dir / "league.json").read_text(encoding="utf-8"))
        season = int(lg.get("season") or 0)
        if not season:
            continue
        current: dict[str, tuple[int, int]] = {}  # pid -> (rid, start_wk)
        # Seed from draft picks (whoever drafted owns from W1).
        pf = list(season_dir.glob("draft_*_picks.json"))
        if pf:
            for p in json.loads(pf[0].read_text(encoding="utf-8")):
                pid = str(p.get("player_id") or "")
                rid = int(p.get("roster_id") or 0)
                if pid and rid:
                    current[pid] = (rid, 1)
        # Walk transactions in week order.
        for tf in sorted((season_dir / "transactions").glob("week_*.json"),
                          key=lambda f: int(f.stem.split("_")[1])):
            wk = int(tf.stem.split("_")[1])
            try:
                txns = json.loads(tf.read_text(encoding="utf-8"))
            except Exception:
                continue
            txns.sort(key=lambda t: t.get("status_updated") or 0)
            for t in txns:
                if t.get("status") not in ("complete", "completed"):
                    continue
                # Process drops first (so add can overwrite cleanly).
                for pid, rid in (t.get("drops") or {}).items():
                    pid = str(pid); rid = int(rid)
                    if pid in current and current[pid][0] == rid:
                        start = current[pid][1]
                        ownership.setdefault((season, pid), []).append(
                            (start, wk - 1, rid))
                        del current[pid]
                for pid, rid in (t.get("adds") or {}).items():
                    pid = str(pid); rid = int(rid)
                    if pid in current and current[pid][0] != rid:
                        start = current[pid][1]
                        ownership.setdefault((season, pid), []).append(
                            (start, wk - 1, current[pid][0]))
                    current[pid] = (rid, wk)
        # Close open intervals at season end.
        for pid, (rid, start) in current.items():
            ownership.setdefault((season, pid), []).append((start, 17, rid))
    return ownership


def load_weekly_player_points(
    sleeper_dir: str | Path = "data/sleeper",
) -> dict[int, dict[int, dict[str, float]]]:
    """Returns {season: {week: {player_id: points}}}.

    Used by summarize_trade() to value a trade only by the points scored
    AFTER the trade week (so e.g. a W9 Daniels trade doesn't credit the
    receiver for Daniels' W1-W8 production).
    """
    out: dict[int, dict[int, dict[str, float]]] = {}
    for season_dir in sorted(Path(sleeper_dir).glob("league_*")):
        if not (season_dir / "league.json").exists():
            continue
        lg = json.loads((season_dir / "league.json").read_text(encoding="utf-8"))
        season = int(lg.get("season") or 0)
        if not season:
            continue
        out[season] = {}
        for wf in sorted((season_dir / "matchups").glob("week_*.json")):
            wk = int(wf.stem.split("_")[1])
            week_pts: dict[str, float] = {}
            for e in json.loads(wf.read_text(encoding="utf-8")):
                for pid, pts in (e.get("players_points") or {}).items():
                    if pts is not None:
                        week_pts[str(pid)] = float(pts)
            out[season][wk] = week_pts
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
    weekly_points_by_season: dict[int, dict[int, dict[str, float]]] | None = None,
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
    trade_week = int(trade.get("_week") or 1)
    # Use weekly points to only credit production AFTER the trade week.
    # Without weekly data, fall back to full season points (overstates value).
    def player_post_trade_pts(pid: str) -> float:
        if weekly_points_by_season is None:
            return season_pts.get(pid, 0.0)
        wk_data = weekly_points_by_season.get(season, {})
        # Sum trade_week through W18 to cover any late-season trades + the
        # rare Sleeper W18 entries.
        return sum(wk_data.get(w, {}).get(pid, 0.0) for w in range(trade_week, 19))

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
                pts = player_post_trade_pts(pid)
                received_players.append(f"{nm} ({pts:.0f} pts)")
                received_player_pts += pts
        for pid, src in drops.items():
            if int(src) == rid:
                meta = player_catalog.get(pid) or {}
                nm = meta.get("full_name") or f"player_{pid}"
                pts = player_post_trade_pts(pid)
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


# Seasons where the Sleeper draft data is a post-Yahoo-migration
# reconstruction. Pick-to-roster_id attribution for these years is
# unreliable in the raw Sleeper data (Yahoo-era pick trades didn't
# survive the migration). When the xlsx is available, those years are
# transparently re-attributed via cell-color → manager → roster_id.
UNRELIABLE_ATTRIBUTION_SEASONS = {2023}


def _xlsx_attribution_map(xlsx_path: str | Path) -> dict[int, dict[str, int]]:
    """Returns {year: {player_name_lower: sleeper_roster_id}} from xlsx
    cell colors. Empty dict if xlsx isn't available."""
    from pathlib import Path as _P
    xp = _P(xlsx_path)
    if not xp.exists():
        return {}
    try:
        from .xlsx_drafts import load_xlsx_drafts
        from .team_identity import all_managers
    except Exception:
        return {}
    nick_to_rid: dict[str, int] = {}
    for m in all_managers():
        if m.get("sleeper_roster_id") is None:
            continue
        for nick in m.get("xlsx_nicknames", []):
            nick_to_rid[nick.lower()] = m["sleeper_roster_id"]
        nick_to_rid.setdefault(m["canonical_name"].split()[0].lower(),
                                m["sleeper_roster_id"])
    # Dave owned rid 10 in 2023-24 before Josh took over.
    nick_to_rid.setdefault("dave", 10)
    out: dict[int, dict[str, int]] = {}
    drafts = load_xlsx_drafts(xp)
    for year, picks in drafts.items():
        by_player: dict[str, int] = {}
        for xp_pick in picks:
            rid = nick_to_rid.get(xp_pick.manager_nickname.lower())
            if rid:
                by_player[xp_pick.player_name.lower()] = rid
        out[year] = by_player
    return out


def load_draft_picks_with_points(
    sleeper_dir: str | Path = "data/sleeper",
    exclude_unreliable_attribution: bool = False,
    xlsx_path: str | Path = "data/historical/MONEY_LEAGUE.xlsx",
) -> list[dict]:
    """For every Sleeper season, join draft picks to per-player season
    total points. Returns a flat list of:

      {season, round, pick_in_round, overall_pick, roster_id, team_name,
       player_id, player_name, position, season_points, is_keeper,
       attribution_reliable}

    `attribution_reliable=False` is set for seasons in
    UNRELIABLE_ATTRIBUTION_SEASONS (currently {2023}) — those came from
    a post-Yahoo-migration reconstruction and the roster_id field does
    not reflect who actually drafted the player.

    Set `exclude_unreliable_attribution=True` to filter those out
    entirely (useful for "best drafter" or trade-scorecard analyses).
    """
    sleeper_dir = Path(sleeper_dir)
    seasons = load_all_seasons(sleeper_dir)
    xlsx_attribution = _xlsx_attribution_map(xlsx_path)
    out: list[dict] = []
    for season_dir in sorted(sleeper_dir.glob("league_*")):
        if not (season_dir / "league.json").exists():
            continue
        lg = json.loads((season_dir / "league.json").read_text(encoding="utf-8"))
        season = int(lg.get("season") or 0)
        if season not in seasons:
            continue
        # 2023 is unreliable IF we can't fix it via xlsx. When the xlsx
        # has data for this year, attribution is restored.
        season_xlsx = xlsx_attribution.get(season, {})
        attributable_via_xlsx = bool(season_xlsx)
        unreliable = (season in UNRELIABLE_ATTRIBUTION_SEASONS
                      and not attributable_via_xlsx)
        if exclude_unreliable_attribution and unreliable:
            continue
        s = seasons[season]
        pick_files = list(season_dir.glob("draft_*_picks.json"))
        if not pick_files:
            continue
        picks = json.loads(pick_files[0].read_text(encoding="utf-8"))
        reliable = not unreliable
        for p in picks:
            meta = p.get("metadata") or {}
            pid = str(p.get("player_id") or "")
            rid = int(p.get("roster_id") or 0)
            player_name = f"{meta.get('first_name','').strip()} {meta.get('last_name','').strip()}".strip()
            # Re-attribute via xlsx where available.
            xlsx_rid = season_xlsx.get(player_name.lower())
            if xlsx_rid is not None and season in UNRELIABLE_ATTRIBUTION_SEASONS:
                rid = xlsx_rid
            out.append({
                "season": season,
                "round": int(p.get("round") or 0),
                "pick_in_round": int(p.get("draft_slot") or 0),
                "overall_pick": int(p.get("pick_no") or 0),
                "roster_id": rid,
                "team_name": s["rosters"].get(rid, {}).get("team_name", f"Roster {rid}"),
                "player_id": pid,
                "player_name": player_name,
                "position": (meta.get("position") or "").upper(),
                "season_points": s["player_total_points"].get(pid, 0.0),
                "is_keeper": bool(p.get("is_keeper")),
                "attribution_reliable": reliable,
                "attribution_source": ("xlsx" if (season in UNRELIABLE_ATTRIBUTION_SEASONS
                                                   and xlsx_rid is not None)
                                       else "sleeper"),
            })
    return out
