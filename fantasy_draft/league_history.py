"""Load full league history (2011-2025) combining Yahoo scraped matchups
and Sleeper offline data into a single per-manager-per-season view.

Public API:
  load_all_history() -> dict[int, dict] keyed by season, with:
    {'season': int, 'source': 'yahoo' | 'sleeper',
     'rosters': {mgr_id: {wins, losses, pf, pa, apw, apl,
                          weekly_scores: [(week, pts, opp_pts, won)],
                          high_score: (wk, pts), low_score: (wk, pts)}}}
"""
from __future__ import annotations

import glob
import json
import re
from collections import defaultdict
from pathlib import Path

from .team_identity import all_managers

ROOT = Path(__file__).resolve().parent.parent


def _yahoo_name_to_mgr() -> dict[tuple[int, str], str]:
    out: dict[tuple[int, str], str] = {}
    for m in all_managers():
        for yr, nm in (m.get("yahoo_team_names") or {}).items():
            if yr == "_note" or not nm:
                continue
            key = (int(yr), str(nm).rstrip("?").strip().lower())
            out[key] = m["id"]
    return out


def _load_yahoo_seasons() -> dict[int, dict]:
    name_to_mgr = _yahoo_name_to_mgr()
    out: dict[int, dict] = {}
    for f in sorted((ROOT / "data" / "yahoo").glob("league_*/matchups_*.json")):
        yr = int(re.search(r"matchups_(\d+)\.json", str(f)).group(1))
        j = json.loads(f.read_text())
        tid2mgr = {}
        for tid, nm in j["teams"].items():
            mid = name_to_mgr.get((yr, str(nm).rstrip("?").strip().lower()))
            if mid:
                tid2mgr[int(tid)] = mid
        per_mgr: dict[str, dict] = defaultdict(
            lambda: {"wins": 0, "losses": 0, "pf": 0.0, "pa": 0.0,
                     "apw": 0, "apl": 0, "games": 0,
                     "weekly_scores": [],
                     "high_score": (0, 0.0), "low_score": (0, 999.0)})
        for wk_str, ms in j["weeks"].items():
            wk = int(wk_str)
            if wk > 13:  # reg season only
                continue
            all_scores = []
            for m in ms:
                all_scores.append((m["team_a"], m["pts_a"]))
                all_scores.append((m["team_b"], m["pts_b"]))
            for m in ms:
                for which, opp in [("a", "b"), ("b", "a")]:
                    tid = m[f"team_{which}"]; pts = m[f"pts_{which}"]
                    opp_pts = m[f"pts_{opp}"]
                    mid = tid2mgr.get(tid)
                    if not mid:
                        continue
                    rec = per_mgr[mid]
                    rec["games"] += 1
                    rec["pf"] += pts
                    rec["pa"] += opp_pts
                    won = (m["winner"] == tid)
                    if won:
                        rec["wins"] += 1
                    elif m["winner"] is not None:
                        rec["losses"] += 1
                    rec["weekly_scores"].append((wk, pts, opp_pts, won))
                    if pts > rec["high_score"][1]:
                        rec["high_score"] = (wk, pts)
                    if pts < rec["low_score"][1] and pts > 0:
                        rec["low_score"] = (wk, pts)
                    for o_tid, o_pts in all_scores:
                        if o_tid == tid:
                            continue
                        if pts > o_pts:
                            rec["apw"] += 1
                        elif pts < o_pts:
                            rec["apl"] += 1
        out[yr] = {"season": yr, "source": "yahoo",
                    "rosters": dict(per_mgr)}
    return out


# Roster-handoff overrides: when a Sleeper roster_id changed hands
# mid-Sleeper-era, attribute the historical seasons to the previous owner.
ROSTER_HANDOFFS: dict[tuple[int, int], str] = {
    # (season, sleeper_roster_id) -> manager_id who actually owned it
    (2023, 10): "dave_aka_wang",
    (2024, 10): "dave_aka_wang",
}


def _load_sleeper_seasons() -> dict[int, dict]:
    """Reuse existing Sleeper loader for 2023-2025."""
    from .results import load_all_seasons
    from .team_identity import manager_for_sleeper_roster

    def mgr_for_rid_in_season(rid: int, season: int) -> dict | None:
        if (season, rid) in ROSTER_HANDOFFS:
            mid = ROSTER_HANDOFFS[(season, rid)]
            for m in all_managers():
                if m["id"] == mid:
                    return m
        return manager_for_sleeper_roster(rid)

    out: dict[int, dict] = {}
    seasons = load_all_seasons(ROOT / "data" / "sleeper")
    # Read matchup files for actual W/L
    for ld in (ROOT / "data" / "sleeper").glob("league_*"):
        li_path = ld / "league.json"
        if not li_path.exists():
            continue
        season = int(json.loads(li_path.read_text()).get("season", 0))
        if not season:
            continue
        per_mgr: dict[str, dict] = defaultdict(
            lambda: {"wins": 0, "losses": 0, "pf": 0.0, "pa": 0.0,
                     "apw": 0, "apl": 0, "games": 0,
                     "weekly_scores": [],
                     "high_score": (0, 0.0), "low_score": (0, 999.0)})
        sd = seasons.get(season, {})
        # All-play + scoring from weekly_team_points
        wkpts: dict[int, dict[int, float]] = defaultdict(dict)
        for (rid, wk), pts in sd.get("weekly_team_points", {}).items():
            if wk <= 13:
                wkpts[wk][rid] = pts
        # W/L from matchup files
        mdir = ld / "matchups"
        for wf in sorted(mdir.glob("week_*.json")):
            wk = int(wf.stem.replace("week_", ""))
            if wk > 13:
                continue
            ms = json.loads(wf.read_text())
            by_mid: dict = defaultdict(list)
            for m in ms:
                mid = m.get("matchup_id")
                if mid is not None:
                    by_mid[mid].append(m)
            for mid, pair in by_mid.items():
                if len(pair) != 2:
                    continue
                if not all(p.get("points") is not None for p in pair):
                    continue
                pair.sort(key=lambda p: -p["points"])
                w, l = pair[0], pair[1]
                for side, opp_side in [(w, l), (l, w)]:
                    rid = side["roster_id"]
                    pts = side["points"]
                    opp_pts = opp_side["points"]
                    m = mgr_for_rid_in_season(rid, season)
                    if not m:
                        continue
                    mgr_id = m["id"]
                    rec = per_mgr[mgr_id]
                    rec["games"] += 1
                    rec["pf"] += pts
                    rec["pa"] += opp_pts
                    won = pts > opp_pts
                    if pts != opp_pts:
                        if won:
                            rec["wins"] += 1
                        else:
                            rec["losses"] += 1
                    rec["weekly_scores"].append((wk, pts, opp_pts, won))
                    if pts > rec["high_score"][1]:
                        rec["high_score"] = (wk, pts)
                    if pts < rec["low_score"][1] and pts > 0:
                        rec["low_score"] = (wk, pts)
        # All-play
        for wk, scores in wkpts.items():
            for rid, pts in scores.items():
                m = mgr_for_rid_in_season(rid, season)
                if not m:
                    continue
                mgr_id = m["id"]
                for o_rid, o_pts in scores.items():
                    if o_rid == rid:
                        continue
                    if pts > o_pts:
                        per_mgr[mgr_id]["apw"] += 1
                    elif pts < o_pts:
                        per_mgr[mgr_id]["apl"] += 1
        out[season] = {"season": season, "source": "sleeper",
                        "rosters": dict(per_mgr),
                        "champion": sd.get("champion_roster_id")}
    return out


def load_all_history() -> dict[int, dict]:
    """Returns {year: season_data} for 2011-2025."""
    out = _load_yahoo_seasons()
    out.update(_load_sleeper_seasons())
    return out
