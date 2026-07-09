"""Backtest the draft recommender against Brian's real 2023-2025 drafts.

The honest test: at each of Brian's real (non-keeper) picks, ask the tool
what it would have taken from the players ACTUALLY still on the board,
using only PERIOD projections/ADP (what was knowable that August). Then
score both rosters — tool-Brian vs real-Brian — by ACTUAL season fantasy
points (Sleeper stats, half-PPR).

Board realism: other managers' picks replay exactly as they happened. If
the tool takes a player someone else later drafted in reality, that later
manager simply loses him (we only score Brian, and the perturbation is
unavoidable in any counterfactual replay).

Scoring: "best-ball" season total for a starters-shaped subset
(1 QB, 2 RB, 3 WR, 1 TE, 1 FLEX, 1 SUPERFLEX, 1 K, 1 DEF) — season-long
totals, no weekly lineup decisions. Same metric for both rosters.

Outputs data/backtest_results.json + a printed report.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.draft import Team  # noqa: E402
from fantasy_draft.league import LeagueConfig  # noqa: E402
from fantasy_draft.players import Player  # noqa: E402
from fantasy_draft.predict import score_candidates_for_team  # noqa: E402
from fantasy_draft.vbd import compute_vbd  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LEAGUE_CFG = ROOT / "configs" / "my_league.json"
OUT = ROOT / "data" / "backtest_results.json"

SEASONS = {
    2023: ("data/sleeper/league_1001657805583077376", "1001657806530957312"),
    2024: ("data/sleeper/league_1085805164784664576", "1085805164784664577"),
    2025: ("data/sleeper/league_1245039290518360064", "1245039290522550272"),
}
MY_RID = 9  # Brian, all three Sleeper seasons

STARTER_SHAPE = [  # (slots, eligible positions) for best-ball scoring
    (1, {"QB"}),
    (2, {"RB"}),
    (3, {"WR"}),
    (1, {"TE"}),
    (1, {"RB", "WR", "TE"}),          # FLEX
    (1, {"QB", "RB", "WR", "TE"}),    # SUPERFLEX
    (1, {"K"}),
    (1, {"DEF"}),
]


def load_adp_proj_curves() -> dict[str, list[float]]:
    """Positional ADP-rank -> projection curves from CLEAN 2026 preseason
    data. Used to synthesize period projections from period ADP, because
    Sleeper's stored historical 'projections' are contaminated with
    in-season knowledge (2023 Puka: proj 186 vs ADP 266 — impossible in
    August). The tool may only know what the period MARKET knew."""
    import csv
    rows = []
    with open(ROOT / "data" / "players_2026.csv", encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f)]
    curves: dict[str, list[float]] = {}
    for pos in ("QB", "RB", "WR", "TE", "K", "DEF"):
        ranked = sorted(
            (r for r in rows if r["position"] == pos and float(r["adp"]) < 999),
            key=lambda r: float(r["adp"]))
        curves[pos] = [float(r["projection"]) for r in ranked]
    return curves


def load_period_players(year: int) -> tuple[list[Player], dict[str, Player]]:
    """Player objects for the season, knowing ONLY period ADP. Projection is
    synthesized from the player's positional ADP rank via the 2026 curve."""
    raw = json.loads((ROOT / "data" / "backtest" / f"proj_{year}.json").read_text())
    curves = load_adp_proj_curves()
    entries = []
    for row in raw:
        pid = str(row.get("player_id") or (row.get("player") or {}).get("player_id") or "")
        meta = row.get("player") or {}
        stats = row.get("stats") or {}
        name = (meta.get("full_name")
                or f"{meta.get('first_name','').strip()} {meta.get('last_name','').strip()}".strip())
        pos = (meta.get("position") or "").upper()
        if not pid or not name or pos not in ("QB", "RB", "WR", "TE", "K", "DEF"):
            continue
        try:
            adp = float(stats.get("adp_2qb") or 999.0)
        except (TypeError, ValueError):
            adp = 999.0
        entries.append((pid, name, pos, meta.get("team") or "", adp))

    # Rank within position by period ADP; synthesize projections.
    by_pos_rank: dict[str, int] = defaultdict(int)
    by_pid: dict[str, Player] = {}
    players: list[Player] = []
    seen_names: set[str] = set()
    for pid, name, pos, team, adp in sorted(entries, key=lambda e: e[4]):
        if adp >= 999:
            proj = 0.0   # off the market's radar = invisible to the tool
        else:
            rank = by_pos_rank[pos]
            by_pos_rank[pos] += 1
            curve = curves.get(pos, [])
            proj = curve[min(rank, len(curve) - 1)] if curve else 0.0
        uniq = name if name not in seen_names else f"{name} ({pid})"
        seen_names.add(uniq)
        p = Player(name=uniq, position=pos, team=team, adp=adp, projection=proj)
        by_pid[pid] = p
        if proj > 0 or adp < 999:
            players.append(p)
    return players, by_pid


def load_actual_points(year: int) -> dict[str, float]:
    raw = json.loads((ROOT / "data" / "backtest" / f"stats_{year}.json").read_text())
    out: dict[str, float] = {}
    for row in raw:
        pid = str(row.get("player_id") or "")
        pts = (row.get("stats") or {}).get("pts_half_ppr")
        if pid and pts is not None:
            out[pid] = float(pts)
    return out


def bestball_total(pids: list[str], by_pid: dict[str, Player],
                   actual: dict[str, float]) -> float:
    """Starters-shaped best-ball season total by ACTUAL points."""
    pool = []
    for pid in pids:
        p = by_pid.get(pid)
        pos = p.position if p else None
        if pos is None:
            continue
        pool.append((pos, actual.get(pid, 0.0)))
    pool.sort(key=lambda x: -x[1])
    used = [False] * len(pool)
    total = 0.0
    for count, eligible in STARTER_SHAPE:
        filled = 0
        for i, (pos, pts) in enumerate(pool):
            if filled >= count:
                break
            if not used[i] and pos in eligible:
                used[i] = True
                total += pts
                filled += 1
    return total


def tool_pick(team: Team, league: LeagueConfig, avail: list[Player],
              overall: int) -> Player:
    cands = score_candidates_for_team(team, league, avail, overall, top_n=1)
    if cands:
        return cands[0].player
    # cap-aware fallback (mirrors the simulator)
    counts = team.position_counts()
    pool = [p for p in avail if counts.get(p.position, 0) < 6]
    pool = pool or avail
    return max(pool, key=lambda p: (p.vbd, p.projection))


def backtest_year(year: int, league: LeagueConfig) -> dict:
    ldir, did = SEASONS[year]
    picks = sorted(
        json.loads((ROOT / ldir / f"draft_{did}_picks.json").read_text()),
        key=lambda p: p["pick_no"])
    players, by_pid = load_period_players(year)
    compute_vbd(players, league)
    actual = load_actual_points(year)
    name_to_pid = {p.name: pid for pid, p in by_pid.items()}

    tool_team = Team(idx=0, name="tool-brian")
    taken: set[str] = set()          # player NAMES off the board
    tool_pids: list[str] = []
    real_pids: list[str] = []
    decisions = []

    # Keepers are owned BEFORE the draft — remove them from the pool up
    # front, not at their slot's pick number. This league enters keepers as
    # ordinary picks WITHOUT the is_keeper flag (Amon-Ra "drafted" at pick
    # 147 in 2023 with ADP 27 = Donnie's keeper at its R13 cost), so we
    # also detect implicit keepers with the repo's ADP-gap rule: actual
    # round 1.5+ rounds later than the ADP-implied round.
    implicit_keeper_picks: set[int] = set()
    for pk in picks:
        kp = by_pid.get(str(pk["player_id"]))
        explicit = bool(pk.get("is_keeper"))
        implicit = False
        if not explicit and kp is not None and kp.adp < 999:
            adp_round = max(1.0, kp.adp / 12.0)
            implicit = (pk["round"] - adp_round) >= 1.5
        if explicit or implicit:
            implicit_keeper_picks.add(pk["pick_no"])
            if kp is not None:
                taken.add(kp.name)

    for pk in picks:
        pid = str(pk["player_id"])
        p = by_pid.get(pid)
        is_brian = pk["roster_id"] == MY_RID
        is_keeper = pk["pick_no"] in implicit_keeper_picks

        if is_brian:
            real_pids.append(pid)
            if is_keeper or p is None:
                # keepers weren't decisions; unknown players can't be replayed
                tool_pids.append(pid)
                if p:
                    tool_team.add(p)
                    taken.add(p.name)
                continue
            avail = [x for x in players if x.name not in taken]
            choice = tool_pick(tool_team, league, avail, pk["pick_no"])
            tool_team.add(choice)
            taken.add(choice.name)
            # HONESTY GUARD: Brian's real pick also leaves the board in
            # tool-world (the field would have taken him soon after).
            # Without this, the tool scoops real-Brian's own hits later at
            # a discount (e.g. Gibbs at R14 in 2023) — a fantasy. This is
            # conservative: it can only shrink the tool's edge.
            taken.add(p.name)
            cpid = name_to_pid[choice.name]
            tool_pids.append(cpid)
            md = pk.get("metadata") or {}
            decisions.append({
                "overall": pk["pick_no"],
                "round": pk["round"],
                "actual_pick": f"{md.get('first_name','')} {md.get('last_name','')}".strip(),
                "actual_pos": (md.get("position") or "").upper(),
                "actual_season_pts": round(actual.get(pid, 0.0), 1),
                "tool_pick": choice.name,
                "tool_pos": choice.position,
                "tool_season_pts": round(actual.get(cpid, 0.0), 1),
            })
        else:
            if p is not None:
                taken.add(p.name)

    tool_total = bestball_total(tool_pids, by_pid, actual)
    real_total = bestball_total(real_pids, by_pid, actual)
    return {
        "year": year,
        "tool_bestball": round(tool_total, 1),
        "real_bestball": round(real_total, 1),
        "edge": round(tool_total - real_total, 1),
        "decisions": decisions,
    }


def main():
    league = LeagueConfig.load(LEAGUE_CFG)
    results = [backtest_year(y, league) for y in SEASONS]
    OUT.write_text(json.dumps(results, indent=2))

    print(f"{'='*74}")
    print("BACKTEST: tool-Brian vs real-Brian (best-ball starters, ACTUAL points)")
    print(f"{'='*74}")
    for r in results:
        sign = "+" if r["edge"] >= 0 else ""
        print(f"\n{r['year']}: tool {r['tool_bestball']:.0f} vs real "
              f"{r['real_bestball']:.0f}  ({sign}{r['edge']:.0f})")
        diffs = sorted(r["decisions"],
                       key=lambda d: -(d["tool_season_pts"] - d["actual_season_pts"]))
        print("  biggest tool wins:")
        for d in diffs[:3]:
            print(f"    R{d['round']:>2}: tool {d['tool_pick']} "
                  f"({d['tool_season_pts']:.0f}) vs you {d['actual_pick']} "
                  f"({d['actual_season_pts']:.0f})")
        print("  biggest tool misses:")
        for d in diffs[-3:]:
            print(f"    R{d['round']:>2}: tool {d['tool_pick']} "
                  f"({d['tool_season_pts']:.0f}) vs you {d['actual_pick']} "
                  f"({d['actual_season_pts']:.0f})")
    total_edge = sum(r["edge"] for r in results)
    print(f"\n{'='*74}")
    print(f"3-season edge: {total_edge:+.0f} best-ball points "
          f"({total_edge/3:+.0f}/season)")
    print(f"Wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
