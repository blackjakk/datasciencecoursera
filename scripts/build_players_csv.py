"""Regenerate data/players_2026.csv from the Sleeper projections cache.

Pipeline position: derived-data layer.
  Inputs:
    - data/sleeper/projections_2026.json (from scripts/fetch_sleeper.sh)
  Output:
    - data/players_2026.csv  (used by ~every downstream report)

The CSV uses 2QB ADP (Sleeper's adp_2qb field) because MONEYLEAGUE is
superflex — half-PPR ADP undersells top QBs by 3-6 rounds.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.projections import (  # noqa: E402
    load_projections_from_cache, write_players_csv,
)

ROOT = Path(__file__).resolve().parent.parent
PROJ_CACHE = ROOT / "data" / "sleeper_projections_2026.json"
OUT = ROOT / "data" / "players_2026.csv"


def main():
    if not PROJ_CACHE.exists():
        sys.exit(
            f"ERROR: {PROJ_CACHE} missing. Run scripts/fetch_sleeper.sh first."
        )
    players = load_projections_from_cache(PROJ_CACHE, scoring="superflex")
    write_players_csv(players, OUT)
    print(f"Wrote {OUT.relative_to(ROOT)} ({len(players)} players, "
          f"top: {players[0].name})")


if __name__ == "__main__":
    main()
