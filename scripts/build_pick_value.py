"""Build empirical pick-value chart from historical Sleeper drafts.

For each (round, position) combination across all completed Sleeper
seasons, compute the mean VBD actually delivered by players drafted at
that slot. "VBD" here uses each season's own replacement levels (based
on the league's roster config), then averages across seasons.

Outputs data/pick_value.json with two views:

  by_round (position-blind):
    {round: {mean_vbd, mean_points, n_samples}}
    Use for trade evaluation -- a R5 pick is worth ~X VBD regardless of
    the position the team eventually drafts there.

  by_round_position (position-aware):
    {round: {QB: {mean_vbd, mean_points, n}, RB: {...}, ...}}
    Use for keeper evaluation -- a keeper QB at R5 cost should be
    compared to "what did R5 QBs typically deliver" not the round-blind
    average.
"""
from __future__ import annotations

import json
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.results import load_all_seasons, load_draft_picks_with_points  # noqa: E402
from fantasy_draft.sleeper_offline import league_from_offline  # noqa: E402
from fantasy_draft.vbd import compute_replacement_ranks  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "pick_value.json"
POSITIONS = ("QB", "RB", "WR", "TE", "K", "DEF")


def _replacement_points_for_season(picks_for_season: list[dict],
                                    replacement_ranks: dict[str, int]) -> dict[str, float]:
    """For each position, find the replacement-level points by ranking that
    season's drafted players by season_points and taking the Nth one where
    N is the replacement rank for that position."""
    by_pos: dict[str, list[float]] = defaultdict(list)
    for p in picks_for_season:
        if p["position"] in POSITIONS and p["season_points"]:
            by_pos[p["position"]].append(p["season_points"])
    out: dict[str, float] = {}
    for pos, pts_list in by_pos.items():
        pts_list.sort(reverse=True)  # best first
        rank = replacement_ranks.get(pos, len(pts_list))
        if rank <= len(pts_list):
            out[pos] = pts_list[rank - 1]
        elif pts_list:
            out[pos] = pts_list[-1]
        else:
            out[pos] = 0.0
    return out


def main():
    picks = load_draft_picks_with_points(ROOT / "data" / "sleeper")
    if not picks:
        sys.exit("ERROR: no Sleeper picks under data/sleeper/. Run "
                 "scripts/fetch_sleeper.sh first.")
    seasons_covered = sorted({p["season"] for p in picks})

    # Use the most-recent league config for the replacement-rank model
    # (consistent across years; should be fine since the league hasn't
    # changed roster format).
    cfg = league_from_offline(str(ROOT / "data" / "sleeper"))
    replacement_ranks = compute_replacement_ranks(cfg)
    print(f"Replacement ranks: {replacement_ranks}")

    # Per-season replacement points.
    per_season_picks: dict[int, list[dict]] = defaultdict(list)
    for p in picks:
        per_season_picks[p["season"]].append(p)

    repl_by_season: dict[int, dict[str, float]] = {}
    for season, season_picks in per_season_picks.items():
        repl_by_season[season] = _replacement_points_for_season(season_picks, replacement_ranks)

    # Compute VBD for each pick.
    for p in picks:
        repl = repl_by_season.get(p["season"], {}).get(p["position"], 0.0)
        p["vbd"] = p["season_points"] - repl

    # Aggregate position-blind by round.
    by_round: dict[int, dict] = {}
    rounds = sorted({p["round"] for p in picks if p["round"]})
    for rnd in rounds:
        bucket = [p for p in picks if p["round"] == rnd
                  and p["position"] in POSITIONS]
        if not bucket:
            continue
        vbds = [p["vbd"] for p in bucket]
        pts = [p["season_points"] for p in bucket]
        by_round[rnd] = {
            "mean_vbd": round(statistics.mean(vbds), 1),
            "median_vbd": round(statistics.median(vbds), 1),
            "mean_points": round(statistics.mean(pts), 1),
            "n_samples": len(bucket),
        }

    # Aggregate position-aware (round, position).
    by_round_position: dict[int, dict[str, dict]] = {}
    for rnd in rounds:
        per_pos: dict[str, dict] = {}
        for pos in POSITIONS:
            bucket = [p for p in picks if p["round"] == rnd
                      and p["position"] == pos]
            if not bucket:
                continue
            per_pos[pos] = {
                "mean_vbd": round(statistics.mean(p["vbd"] for p in bucket), 1),
                "mean_points": round(statistics.mean(p["season_points"] for p in bucket), 1),
                "n_samples": len(bucket),
            }
        by_round_position[rnd] = per_pos

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seasons_covered": seasons_covered,
        "n_picks": len(picks),
        "replacement_ranks_used": replacement_ranks,
        "by_round": {str(k): v for k, v in by_round.items()},
        "by_round_position": {str(k): v for k, v in by_round_position.items()},
    }
    OUT.write_text(json.dumps(payload, indent=2))
    print(f"\nWrote {OUT.relative_to(ROOT)} with {len(by_round)} rounds covered.")
    print(f"\nPosition-blind pick value (mean VBD per round):")
    for rnd in rounds:
        d = by_round[rnd]
        print(f"  R{rnd:>2}: mean VBD {d['mean_vbd']:>+6.1f}  "
              f"(median {d['median_vbd']:>+6.1f}, "
              f"mean pts {d['mean_points']:>6.1f}, n={d['n_samples']})")


if __name__ == "__main__":
    main()
