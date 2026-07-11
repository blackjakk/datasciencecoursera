"""Append this week's ADP snapshot to data/adp_history.csv.

One row per (date, player) for players with ADP < 250 — the price-history
dataset behind Exchange sparklines and Δwk trends. Idempotent per date:
re-running on the same day replaces that day's rows instead of duplicating.
Runs in the weekly workflow right after the fetch layer; ~15 KB/week.
"""
from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLAYERS = ROOT / "data" / "players_2026.csv"
HISTORY = ROOT / "data" / "adp_history.csv"
ADP_CUTOFF = 250.0


def main() -> None:
    today = date.today().isoformat()
    with PLAYERS.open() as f:
        snap = [
            (today, r["name"], r["position"], r["adp"])
            for r in csv.DictReader(f)
            if r.get("adp") and float(r["adp"]) < ADP_CUTOFF
        ]

    rows: list[tuple[str, str, str, str]] = []
    if HISTORY.exists():
        with HISTORY.open() as f:
            rows = [tuple(r) for r in csv.reader(f) if r and r[0] != "date"
                    and r[0] != today]

    rows.extend(snap)
    with HISTORY.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date", "name", "position", "adp"])
        w.writerows(rows)
    print(f"adp_history: +{len(snap)} rows for {today} "
          f"({len(rows)} total, {HISTORY.stat().st_size/1024:.0f} KB)")


if __name__ == "__main__":
    main()
