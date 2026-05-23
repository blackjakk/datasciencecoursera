"""Player data loading from CSV."""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Player:
    name: str
    position: str  # QB, RB, WR, TE, K, DEF
    team: str = ""
    adp: float = 999.0           # average draft position (lower = earlier)
    projection: float = 0.0      # season-long fantasy points projection
    bye: int = 0
    tier: int = 99
    rank_overall: int = 999      # expert overall rank
    rank_position: int = 999     # expert positional rank
    vbd: float = 0.0             # value-based-drafting score; filled by vbd.compute_vbd

    def __str__(self) -> str:
        return f"{self.name} ({self.position}-{self.team})"


def load_players(path: str | Path) -> list[Player]:
    """Load players from a CSV. Required columns: name, position.
    Optional columns: team, adp, projection, bye, tier, rank_overall, rank_position.
    Unknown columns are ignored. Missing optional columns get sensible defaults.
    """
    players: list[Player] = []
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            players.append(
                Player(
                    name=row["name"].strip(),
                    position=row["position"].strip().upper(),
                    team=row.get("team", "").strip(),
                    adp=_float(row.get("adp"), 999.0),
                    projection=_float(row.get("projection"), 0.0),
                    bye=int(_float(row.get("bye"), 0)),
                    tier=int(_float(row.get("tier"), 99)),
                    rank_overall=int(_float(row.get("rank_overall"), 999)),
                    rank_position=int(_float(row.get("rank_position"), 999)),
                )
            )
    # If rank_overall wasn't provided, fall back to ADP ordering.
    if all(p.rank_overall == 999 for p in players):
        for i, p in enumerate(sorted(players, key=lambda x: x.adp), start=1):
            p.rank_overall = i
    return players


def _float(value, default: float) -> float:
    if value is None or value == "":
        return default
    try:
        return float(value)
    except ValueError:
        return default
