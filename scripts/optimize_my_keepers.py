"""Optimize BRIAN'S keeper set, not just predict it.

The predictor picks his top-4 individual net-VBD keepers, but keepers
interact: three WR keepers force an RB/QB-heavy draft, and R14/R15 keeper
costs eat the very rounds where rookie stashes live. The only honest way
to compare sets is to SIMULATE the whole draft under each one.

For every subset (size 2-4) of Brian's eligible keeper candidates:
  - other 11 teams keep their predicted sets
  - Brian keeps the scenario set (forfeit-round collisions re-resolved)
  - run N Monte Carlo sims (same seed list per scenario — paired
    comparison, so scenario deltas aren't sim noise)
  - score Brian's finished roster: starters-shaped projected points

Prints the top sets vs the predictor's default. Writes
data/keeper_optimizer_results.json.
"""
from __future__ import annotations

import json
import random
import sys
from itertools import combinations
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.build_mock_draft_sim import (  # noqa: E402
    KEEPERS_JSON, MC_TEMPERATURE, MY_RID, PREDICTED_SLOT_TO_RID, TOP_K,
    apply_keeper_set, build_skeleton, load_inputs, load_tendencies,
    simulate_full_draft_with_tendencies, _norm,
)
from fantasy_draft.team_identity import manager_for_sleeper_roster  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "keeper_optimizer_results.json"

N_SIMS = 24
SET_SIZES = (2, 3, 4)

STARTER_SHAPE = [
    (1, {"QB"}), (2, {"RB"}), (3, {"WR"}), (1, {"TE"}),
    (1, {"RB", "WR", "TE"}), (1, {"QB", "RB", "WR", "TE"}),
    (1, {"K"}), (1, {"DEF"}),
]


def starters_proj(roster_names: list[str], proj_by_name: dict[str, tuple]) -> float:
    pool = sorted(
        (proj_by_name[n] for n in roster_names if n in proj_by_name),
        key=lambda t: -t[1])
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


def resolve_collisions(scenario: list[dict]) -> list[dict]:
    """Re-derive effective forfeit rounds for THIS combination (the stored
    effective rounds were computed for the predictor's default set). League
    rule: two keepers can't share a round — lower-value keeper bumps UP
    (more expensive). Brian owns exactly one pick per round in 2026."""
    out = []
    used: set[int] = set()
    for k in sorted(scenario, key=lambda k: -(k.get("raw_vbd") or 0)):
        r = k["forfeit_round"]
        while r >= 1 and r in used:
            r -= 1
        if r < 1:
            continue  # no pick left to pay with — keeper can't be kept
        used.add(r)
        out.append({**k, "effective_forfeit_round": r})
    return out


def main():
    league, players = load_inputs()
    proj_by_name = {p.name: (p.position, p.projection) for p in players}
    all_keepers = json.loads(KEEPERS_JSON.read_text())
    others = [k for k in all_keepers
              if k.get("status") == "carryover" and k["roster_id"] != MY_RID]
    mine = [k for k in all_keepers
            if k["roster_id"] == MY_RID
            and k.get("status") in ("carryover", "alternate")]
    rid_to_slot = {rid: slot for slot, rid in PREDICTED_SLOT_TO_RID.items()}
    my_team_idx = rid_to_slot[MY_RID] - 1

    mgr_expected, league_first = load_tendencies()
    team_idx_to_mgr = {}
    for slot, rid in PREDICTED_SLOT_TO_RID.items():
        m = manager_for_sleeper_roster(rid)
        if m:
            team_idx_to_mgr[slot - 1] = m["id"]

    # Paired seeds: every scenario sees the same random draft-worlds.
    seed_rng = random.Random(99)
    seeds = [seed_rng.randint(0, 10**9) for _ in range(N_SIMS)]

    scenarios = []
    for size in SET_SIZES:
        scenarios.extend(combinations(range(len(mine)), size))
    default_idx = tuple(i for i, k in enumerate(mine)
                        if k.get("status") == "carryover")
    print(f"{len(mine)} candidates, {len(scenarios)} scenarios × {N_SIMS} sims "
          f"(default = predictor's {len(default_idx)}-keeper set)\n")

    results = []
    for combo in scenarios:
        scenario = resolve_collisions([mine[i] for i in combo])
        totals = []
        for seed in seeds:
            draft = build_skeleton(league)
            apply_keeper_set(draft, players, others + scenario)
            rng = random.Random(seed)
            full = simulate_full_draft_with_tendencies(
                draft, players, my_team_idx,
                temperature=MC_TEMPERATURE, top_k=TOP_K, rng=rng,
                mgr_expected=mgr_expected, league_first=league_first,
                team_idx_to_mgr=team_idx_to_mgr,
            )
            roster = [fp.player_name for fp in full
                      if fp.team_idx == my_team_idx]
            totals.append(starters_proj(roster, proj_by_name))
        mean = sum(totals) / len(totals)
        results.append({
            "keepers": [f"{k['player_name']} (R{k['effective_forfeit_round']})"
                        for k in scenario],
            "combo": list(combo),
            "is_default": combo == default_idx,
            "mean_starters_proj": round(mean, 1),
            "n_keep": len(scenario),
        })
        tag = "  <-- PREDICTOR DEFAULT" if combo == default_idx else ""
        print(f"  {mean:7.1f}  keep {len(scenario)}: "
              f"{', '.join(r.split(' (')[0] for r in results[-1]['keepers'])}{tag}")

    results.sort(key=lambda r: -r["mean_starters_proj"])
    OUT.write_text(json.dumps(results, indent=2))

    default = next(r for r in results if r["is_default"])
    best = results[0]
    print(f"\n{'='*70}")
    print("TOP 5 KEEPER SETS (mean projected starter pts across paired sims):")
    for r in results[:5]:
        tag = "  <-- PREDICTOR DEFAULT" if r["is_default"] else ""
        print(f"  {r['mean_starters_proj']:7.1f}  {', '.join(r['keepers'])}{tag}")
    print(f"\nPredictor default ranks #{results.index(default)+1} "
          f"of {len(results)} "
          f"({default['mean_starters_proj']:.1f} vs best {best['mean_starters_proj']:.1f}, "
          f"delta {best['mean_starters_proj']-default['mean_starters_proj']:+.1f})")
    print(f"Wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
