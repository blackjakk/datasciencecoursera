"""Run the historical analyses against MONEY_LEAGUE.xlsx and write
data/historical_insights.json for the web app and the report.

Outputs three sections:
  1. retention_by_position: yr1->yr2 and yr2->yr3 keeper rates per position.
  2. post_cap_dropoff: what happens to capped (yr3) players the year after.
  3. forced_drops_2026: this year's 3 forced drops + a redraft-round
     prior built from the post-cap distribution.

Run with:
    python3 scripts/run_analysis.py
"""

from __future__ import annotations

import glob
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.analysis import (
    keeper_retention_by_position,
    post_cap_dropoff,
)

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "data" / "historical" / "MONEY_LEAGUE.xlsx"
KEEPERS_2026 = ROOT / "data" / "keepers_2026.json"
PROJ_2026 = ROOT / "data" / "sleeper_projections_2026.json"
OUT = ROOT / "data" / "historical_insights.json"


def _position_lookup() -> list[dict]:
    """Build a position-lookup list combining the most-recent Sleeper draft
    picks + 2026 projections.

    The analysis functions only need {'metadata': {'first_name', 'last_name',
    'position'}}, so we cast both sources into that shape. The 2026
    projections file is gitignored (regeneratable via scripts/fetch_sleeper.sh)
    -- absence is a hard error.
    """
    picks: list[dict] = []
    pick_files = glob.glob(str(ROOT / "data" / "sleeper" / "league_*" / "draft_*_picks.json"))
    if not pick_files:
        print("WARN: no Sleeper draft picks found under data/sleeper/league_*/. "
              "Position lookup will fall back to '?' for older players. "
              "Run scripts/fetch_sleeper.sh.", file=sys.stderr)
    else:
        # Pick the picks file from the most-recent season by reading league.json.
        # Lexicographic ordering on league_id is coincidentally correct today
        # but breaks the moment a league is re-keyed.
        def _season_for(picks_path: str) -> int:
            league_path = Path(picks_path).parent / "league.json"
            try:
                return int(json.loads(league_path.read_text(encoding="utf-8")).get("season") or 0)
            except (FileNotFoundError, ValueError):
                return 0
        latest = max(pick_files, key=_season_for)
        with open(latest, encoding="utf-8") as f:
            picks.extend(json.load(f))

    if not PROJ_2026.exists():
        sys.exit(f"ERROR: {PROJ_2026.relative_to(ROOT)} missing -- run "
                 f"scripts/fetch_sleeper.sh to regenerate it.")
    with open(PROJ_2026, encoding="utf-8") as f:
        proj = json.load(f)
    for r in proj:
        p = r.get("player") or {}
        fn, ln, pos = p.get("first_name"), p.get("last_name"), p.get("position")
        if fn and ln and pos:
            picks.append({"metadata": {"first_name": fn, "last_name": ln, "position": pos}})
    return picks


def _retention_for_json(ret: dict) -> dict:
    out: dict = {}
    for pos in ("QB", "RB", "WR", "TE"):
        d = ret.get(pos) or {}
        out[pos] = {
            "yr1_count": d.get("yr1_count", 0),
            "yr1_to_yr2_pct": d.get("yr1_to_yr2_pct"),
            "yr2_count": d.get("yr2_count", 0),
            "yr2_to_yr3_pct": d.get("yr2_to_yr3_pct"),
            "hit_cap_count": d.get("hit_cap_count", 0),
        }
    return out


def _dropoff_for_json(drop: list[dict]) -> dict:
    fates = Counter(d["fate"] for d in drop)
    earlier = [d for d in drop if d["fate"] == "redrafted_earlier"]
    # Distribution of redraft round for those who came back EARLIER.
    earlier_rounds = sorted(d["next_year_round"] for d in earlier if d["next_year_round"])
    examples = sorted(
        ({"year": d["capped_year"], "player": d["player"], "position": d["position"],
          "kept_round": d["kept_at_round"], "next_year_round": d["next_year_round"]}
         for d in earlier),
        key=lambda r: (-r["year"], r["next_year_round"]),
    )[:15]
    return {
        "total_capped": len(drop),
        "fates": dict(fates),
        "earlier_round_distribution": earlier_rounds,
        "examples_redrafted_earlier": examples,
    }


def _forced_drops_2026(dropoff: dict) -> list[dict]:
    """For each of this year's forced-drops, attach a prior on where they're
    likely to be re-drafted, using the historical post-cap distribution."""
    records = json.loads(KEEPERS_2026.read_text(encoding="utf-8"))
    forced = [r for r in records if r.get("status") == "forced_drop"]
    fates = dropoff["fates"]
    total = dropoff["total_capped"] or 1
    rounds = dropoff["earlier_round_distribution"]
    median = rounds[len(rounds) // 2] if rounds else None
    return [
        {
            "player": r["player_name"],
            "position": r.get("position", "?"),
            "prior_round": r["prior_round"],
            "historical_redraft_earlier_pct": round(100 * fates.get("redrafted_earlier", 0) / total, 1),
            "historical_undrafted_pct": round(100 * fates.get("undrafted_next_year", 0) / total, 1),
            "median_earlier_round": median,
        }
        for r in forced
    ]


def main() -> None:
    if not XLSX.exists():
        sys.exit(f"ERROR: {XLSX.relative_to(ROOT)} missing -- this is the "
                 f"source of truth for keeper history.")
    if not KEEPERS_2026.exists():
        sys.exit(f"ERROR: {KEEPERS_2026.relative_to(ROOT)} missing -- run "
                 f"scripts/build_2026_keepers.py first.")

    pos_picks = _position_lookup()
    retention = keeper_retention_by_position(XLSX, pos_picks)
    dropoff_raw = post_cap_dropoff(XLSX, pos_picks)

    dropoff = _dropoff_for_json(dropoff_raw)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": str(XLSX.relative_to(ROOT)),
        "retention_by_position": _retention_for_json(retention),
        "post_cap_dropoff": dropoff,
        "forced_drops_2026": _forced_drops_2026(dropoff),
    }

    OUT.write_text(json.dumps(payload, indent=2))
    print(f"Wrote {OUT.relative_to(ROOT)}")
    r = payload["retention_by_position"]
    print(f"  QB yr1->yr2: {r['QB']['yr1_to_yr2_pct']}% (n={r['QB']['yr1_count']})")
    print(f"  RB yr1->yr2: {r['RB']['yr1_to_yr2_pct']}% (n={r['RB']['yr1_count']})")
    print(f"  WR yr1->yr2: {r['WR']['yr1_to_yr2_pct']}% (n={r['WR']['yr1_count']})")
    print(f"  TE yr1->yr2: {r['TE']['yr1_to_yr2_pct']}% (n={r['TE']['yr1_count']})")
    print(f"  Post-cap fates: {payload['post_cap_dropoff']['fates']}")
    print(f"  Forced drops tagged for 2026: {len(payload['forced_drops_2026'])}")


if __name__ == "__main__":
    main()
