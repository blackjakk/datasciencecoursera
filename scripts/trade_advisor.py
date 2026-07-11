"""Pick-trade advisor: price 2026 pick swaps and map the league's capital.

Pick values are FORWARD-LOOKING: mean projected VBD of players whose
current superflex ADP lands in that round (same baselines the keeper
predictor uses) — not historical hit rates.

Usage:
  # League capital table (who owns what, who's surplus/deficient)
  python3 scripts/trade_advisor.py

  # Price a swap: you GIVE picks, you GET picks
  python3 scripts/trade_advisor.py --give R3 R7 --get R2 R12

  # Rounds can carry an owner label for readability (ignored in math)
  python3 scripts/trade_advisor.py --give R4 --get eric:R3
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

ROOT = Path(__file__).resolve().parent.parent


def round_values() -> dict[int, float]:
    """Mean projected VBD of players with ADP in each round (forward-looking
    opportunity cost). Reuses the keeper predictor's ADP baselines."""
    from scripts.build_2026_keepers import _load_adp_baselines
    blind, _pos = _load_adp_baselines()
    # Fill gaps + floor at 0 (a pick is never worth negative — you can
    # always take the best available or a stash).
    return {r: max(0.0, blind.get(r, 0.0)) for r in range(1, 18)}


def parse_picks(tokens: list[str]) -> list[int]:
    out = []
    for t in tokens:
        t = t.split(":")[-1].upper().lstrip("R")
        out.append(int(t))
    return out


def capital_table() -> None:
    helper = json.loads((ROOT / "docs" / "draft_helper" / "data.json").read_text())
    vals = round_values()
    mgrs = {m["team_idx"]: m["id"] for m in helper["managers"]}

    owned: dict[str, list[int]] = defaultdict(list)
    for s in helper["schedule"]:
        owned[mgrs[s["team_idx"]]].append(s["round"])

    print(f"{'':22}" + "".join(f"{r:>4}" for r in range(1, 18)) + f"  {'capitalVBD':>11}")
    rows = []
    for mgr, rounds in owned.items():
        counts = defaultdict(int)
        for r in rounds:
            counts[r] += 1
        total = sum(vals[r] for r in rounds)
        rows.append((total, mgr, counts))
    for total, mgr, counts in sorted(rows, reverse=True):
        cells = "".join(
            f"{counts.get(r, 0) if counts.get(r, 0) != 1 else '·':>4}"
            if counts.get(r, 0) != 1 else f"{'·':>4}"
            for r in range(1, 18))
        # show count when != 1, dot when exactly 1, 0 when none
        cells = ""
        for r in range(1, 18):
            c = counts.get(r, 0)
            cells += f"{('·' if c == 1 else c):>4}"
        print(f"{mgr:<22}{cells}  {total:>11.0f}")
    print("\n(· = owns exactly its own pick; numbers = extra/missing; "
          "capitalVBD = sum of forward-looking round values)")
    print("\nRound values (mean projected VBD at that round's ADP):")
    print("  " + "  ".join(f"R{r}:{vals[r]:.0f}" for r in range(1, 18)))


def price_trade(give: list[int], get: list[int]) -> None:
    vals = round_values()
    gv = sum(vals[r] for r in give)
    rv = sum(vals[r] for r in get)
    print("YOU GIVE: " + ", ".join(f"R{r} ({vals[r]:.0f})" for r in give)
          + f"  = {gv:.0f} VBD")
    print("YOU GET:  " + ", ".join(f"R{r} ({vals[r]:.0f})" for r in get)
          + f"  = {rv:.0f} VBD")
    delta = rv - gv
    verdict = ("WIN" if delta > 8 else "LOSS" if delta < -8 else "≈ FAIR")
    print(f"NET: {delta:+.0f} VBD -> {verdict} for you")
    # Keeper-league wrinkle: later picks carry 2027 keeper option value
    # (cost = round - 2). Flag when the trade moves stash rounds.
    stash_gained = [r for r in get if r >= 10]
    stash_lost = [r for r in give if r >= 10]
    if stash_gained or stash_lost:
        print("Keeper-league note: R10+ picks double as 2027 stash slots "
              f"(gain {len(stash_gained)}, lose {len(stash_lost)}) — worth "
              "a few extra VBD beyond the number above.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--give", nargs="+", default=[],
                    help="picks you give, e.g. R3 R7 or eric:R3")
    ap.add_argument("--get", nargs="+", default=[],
                    help="picks you receive")
    args = ap.parse_args()
    if args.give or args.get:
        price_trade(parse_picks(args.give), parse_picks(args.get))
    else:
        capital_table()


if __name__ == "__main__":
    main()
