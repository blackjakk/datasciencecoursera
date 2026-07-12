"""Pick-trade advisor: price 2026 pick swaps and map the league's capital.

Pick values are COMPOSED: max(0, redraft) + keeper option.
  redraft = mean projected VBD of players whose current superflex ADP
            lands in that round (keeper predictor's baselines), floored
            at 0 — a pick is never worth negative.
  option  = empirical 2027 keeper option value of the round (mean
            next-season keeper surplus it delivered in our 2023-24
            drafts; scripts/stash_curve.py "The Option Book").
Both components are printed so you can argue either half at the table.

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


def round_values() -> dict[int, dict[str, float]]:
    """Composed round value: max(0, redraft blind) + empirical keeper
    OPTION value (scripts/stash_curve.py — mean next-season keeper surplus
    the round delivered in our 2023-24 drafts). The redraft part keeps its
    0-floor; the option term is why a 'worthless' R14 still trades.
    Returns per round {redraft, option, total}."""
    from scripts.stash_curve import composed_round_values
    return composed_round_values()


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
        total = sum(vals[r]["total"] for r in rounds)
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
          "capitalVBD = sum of composed round values: redraft + keeper option)")
    print("\nRound values (max(0, redraft blind) + empirical keeper option):")
    print("  total:   " + " ".join(f"R{r}:{vals[r]['total']:.0f}"
                                   for r in range(1, 18)))
    print("  redraft: " + " ".join(f"R{r}:{vals[r]['redraft']:.0f}"
                                   for r in range(1, 18)))
    print("  option:  " + " ".join(f"R{r}:{vals[r]['option']:.0f}"
                                   for r in range(1, 18)))


def price_trade(give: list[int], get: list[int]) -> None:
    vals = round_values()

    def leg(r: int) -> str:
        v = vals[r]
        return (f"R{r} ({v['total']:.0f} = {v['redraft']:.0f} redraft "
                f"+ {v['option']:.0f} option)")

    gv = sum(vals[r]["total"] for r in give)
    rv = sum(vals[r]["total"] for r in get)
    g_opt = sum(vals[r]["option"] for r in give)
    r_opt = sum(vals[r]["option"] for r in get)
    print("YOU GIVE: " + ", ".join(leg(r) for r in give) + f"  = {gv:.0f} VBD")
    print("YOU GET:  " + ", ".join(leg(r) for r in get) + f"  = {rv:.0f} VBD")
    delta = rv - gv
    verdict = ("WIN" if delta > 8 else "LOSS" if delta < -8 else "≈ FAIR")
    print(f"NET: {delta:+.0f} VBD ({rv - r_opt - (gv - g_opt):+.0f} redraft, "
          f"{r_opt - g_opt:+.0f} keeper option) -> {verdict} for you")
    if any(vals[r]["option"] for r in give + get):
        print("Option component = empirical 2027 keeper surplus that round "
              "delivered in our 2023-24 drafts (scripts/stash_curve.py, "
              "The Option Book) — no longer a hand-wave.")


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
