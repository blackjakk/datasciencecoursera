"""Predict 2026 keepers — version 2, using Sleeper's explicit is_keeper flag
as the dominant signal (it's the truth, not a heuristic).

Strategy:
  - 2025 is_keeper:true players are the BASELINE prediction for 2026 (a team
    has already shown they value these enough to pay the keeper cost; they'll
    almost certainly keep them again unless: years_kept hits 3-year cap, or
    the new forfeit round would be <= 0).
  - For teams that kept <4 in 2025, predict their next keepers from their
    roster of R3+ players (R1/R2 can't be kept under "not_eligible" policy).
"""
from __future__ import annotations
import json
from collections import defaultdict
from pathlib import Path

PICKS_FILE = Path("data/sleeper/league_1245039290518360064/draft_1245039290522550272_picks.json")
NUM_TEAMS = 12
ROUNDS = 17
ROUND_PENALTY = 2
MAX_KEEPERS = 4

picks = json.loads(PICKS_FILE.read_text(encoding="utf-8"))
by_team: dict[int, list[dict]] = defaultdict(list)
for p in picks:
    by_team[p["roster_id"]].append(p)

print("=" * 92)
print(f"PREDICTED 2026 KEEPERS  ({MAX_KEEPERS} per team max)")
print(f"Confirmed 2025 keepers (is_keeper flag) shown first; bubble candidates below.")
print("=" * 92)

total_explicit_keepers = 0
for team_id in sorted(by_team):
    roster = by_team[team_id]

    # The 2025 keepers (Sleeper-tagged).
    keepers_2025 = [p for p in roster if p.get("is_keeper")]
    keepers_2025.sort(key=lambda p: p["pick_no"])  # best first

    # Forecast each 2025 keeper's 2026 status.
    confirmed_2026 = []
    aged_out = []
    for p in keepers_2025:
        new_forfeit = p["round"] - ROUND_PENALTY
        if new_forfeit <= 0:
            aged_out.append((p, new_forfeit))
        else:
            confirmed_2026.append((p, new_forfeit))

    # Identify bubble candidates (non-keepers from R3+) sorted by pick number
    # (lower pick = better player).
    bubble = [p for p in roster
              if not p.get("is_keeper")
              and p["round"] >= 3
              and p["metadata"]["position"] != "DEF"]
    bubble.sort(key=lambda p: p["pick_no"])

    n_slots_remaining = MAX_KEEPERS - len(confirmed_2026)

    print(f"\n--- ROSTER {team_id} ---")
    print(f"   {'Player':<26} {'Pos':<3} {'2025 Pick':<10} {'2026 Cost':<10} {'Source'}")

    for p, new_forfeit in confirmed_2026:
        name = f'{p["metadata"]["first_name"]} {p["metadata"]["last_name"]}'.strip()
        print(f" K {name:<26} {p['metadata']['position']:<3} "
              f"R{p['round']:>2}.{p['draft_slot']:<6} "
              f"R{new_forfeit:>2}.??     2025 keeper -> kept again")
        total_explicit_keepers += 1

    for p, new_forfeit in aged_out:
        name = f'{p["metadata"]["first_name"]} {p["metadata"]["last_name"]}'.strip()
        print(f" X {name:<26} {p['metadata']['position']:<3} "
              f"R{p['round']:>2}.{p['draft_slot']:<6} "
              f"AGE-OUT    forfeit R{new_forfeit} - too early")

    if n_slots_remaining > 0 and bubble:
        print(f"   ... has {n_slots_remaining} slot(s) open. Likely additions:")
        for p in bubble[:n_slots_remaining + 2]:
            name = f'{p["metadata"]["first_name"]} {p["metadata"]["last_name"]}'.strip()
            new_forfeit = p["round"] - ROUND_PENALTY
            print(f" ? {name:<26} {p['metadata']['position']:<3} "
                  f"R{p['round']:>2}.{p['draft_slot']:<6} "
                  f"R{new_forfeit:>2}.??     bubble (best non-keeper at R3+)")

# Summary
print("\n" + "=" * 92)
print(f"Total confirmed 2026 keepers (= 2025 keepers staying): {total_explicit_keepers} / 48 max")
print("\nKey:")
print("  K = confirmed: was 2025 keeper, keep cost rolls to R-2; almost certainly kept again")
print("  X = aged-out: was 2025 keeper but new cost would be <= R0; cannot keep")
print("  ? = bubble candidate for team that kept <4 in 2025")
print("\nCaveats:")
print("  - Can't see years_kept history (need 2024 draft) -> can't enforce 3-year cap")
print("  - Without projections, can't differentiate among bubble candidates by value")
print("  - Doesn't account for waiver pickups not in 2025 draft (need /league/rosters)")
