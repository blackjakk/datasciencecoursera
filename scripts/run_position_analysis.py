"""Compute "which position is best to draft in round R?" from real
Sleeper history (2023-2025).

For each (round, position) bucket, find the mean season-points scored by
players drafted at that combination. Then pick the position with the
highest mean per round -- that's the position with the best historical
ROI at that draft slot.

Writes data/position_by_round.json for the web app's analytics tab.
"""
from __future__ import annotations

import json
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.results import load_draft_picks_with_points

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "position_by_round.json"

POSITIONS = ("QB", "RB", "WR", "TE", "K", "DEF")


def main() -> None:
    picks = load_draft_picks_with_points(ROOT / "data" / "sleeper")
    if not picks:
        sys.exit("ERROR: no Sleeper draft picks found under data/sleeper/. "
                 "Run scripts/fetch_sleeper.sh first.")

    seasons_covered = sorted({p["season"] for p in picks})

    # Bucket points by (round, position).
    buckets: dict[tuple[int, str], list[float]] = defaultdict(list)
    for p in picks:
        if p["position"] in POSITIONS and p["round"]:
            buckets[(p["round"], p["position"])].append(p["season_points"])

    max_round = max(r for r, _ in buckets) if buckets else 0

    by_round_position: dict[int, dict[str, dict]] = {}
    for rnd in range(1, max_round + 1):
        per_pos: dict[str, dict] = {}
        for pos in POSITIONS:
            vals = buckets.get((rnd, pos), [])
            if not vals:
                continue
            per_pos[pos] = {
                "n": len(vals),
                "mean": round(statistics.mean(vals), 1),
                "median": round(statistics.median(vals), 1),
                "min": round(min(vals), 1),
                "max": round(max(vals), 1),
            }
        by_round_position[rnd] = per_pos

    # Best position per round (highest mean, with at least 2 samples to
    # be meaningful).
    best_per_round: list[dict] = []
    for rnd in range(1, max_round + 1):
        per_pos = by_round_position.get(rnd, {})
        candidates = [(pos, d) for pos, d in per_pos.items() if d["n"] >= 2]
        if not candidates:
            continue
        candidates.sort(key=lambda kv: -kv[1]["mean"])
        best_pos, best_d = candidates[0]
        runner = candidates[1] if len(candidates) > 1 else (None, {"mean": 0})
        best_per_round.append({
            "round": rnd,
            "best_position": best_pos,
            "mean_points": best_d["mean"],
            "n_samples": best_d["n"],
            "advantage_over_2nd": round(best_d["mean"] - runner[1]["mean"], 1) if runner[0] else None,
            "second_best": runner[0],
        })

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seasons_covered": seasons_covered,
        "n_picks": len(picks),
        "by_round_position": {str(k): v for k, v in by_round_position.items()},
        "best_position_per_round": best_per_round,
    }

    OUT.write_text(json.dumps(payload, indent=2))
    print(f"Wrote {OUT.relative_to(ROOT)}")
    print(f"  Seasons: {seasons_covered}  |  picks: {len(picks)}")
    print(f"\n  Best position per round (mean season points):")
    for row in best_per_round[:10]:
        adv = f" (+{row['advantage_over_2nd']:.0f} vs {row['second_best']})" if row.get("advantage_over_2nd") else ""
        print(f"    R{row['round']:>2}: {row['best_position']:<3} = {row['mean_points']:.1f} pts (n={row['n_samples']}){adv}")


if __name__ == "__main__":
    main()
