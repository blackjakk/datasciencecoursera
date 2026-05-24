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
    # Injury annotations sourced from Sleeper's player catalog. When set on a
    # late-ADP player, marks them as a candidate "stash" pick — draft cheap
    # now, keep next year at a discounted forfeit round.
    injury_status: str = ""      # Healthy / Questionable / Out / IR / NA / ...
    injury_body_part: str = ""
    injury_notes: str = ""
    age: int = 0                 # 0 = unknown

    def __str__(self) -> str:
        return f"{self.name} ({self.position}-{self.team})"


def load_players(path: str | Path) -> list[Player]:
    """Load players from a CSV. Required columns: name, position.
    Optional columns: team, adp, projection, bye, tier, rank_overall, rank_position.
    Unknown columns are ignored. Missing optional columns get sensible defaults.
    """
    players: list[Player] = []
    with open(path, newline="", encoding="utf-8") as f:
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


def enrich_with_injuries(players: list[Player],
                          sleeper_catalog_path: str | Path = "data/sleeper/players_nfl.json") -> int:
    """Pull injury_status / body_part / notes from the Sleeper player catalog
    onto matching Player objects (name + position match). Returns the number
    of players flagged with a non-empty injury_status."""
    import json
    p = Path(sleeper_catalog_path)
    if not p.exists():
        return 0
    catalog = json.loads(p.read_text(encoding="utf-8"))
    by_name: dict[tuple[str, str], dict] = {}
    for pid, entry in catalog.items():
        nm = entry.get("full_name")
        pos = entry.get("position")
        if not nm or not pos:
            continue
        by_name[(nm.lower(), pos)] = entry
    n = 0
    for pl in players:
        e = by_name.get((pl.name.lower(), pl.position))
        if not e:
            continue
        # Age is always copied across so the stash filter can use it.
        try:
            pl.age = int(e.get("age") or 0)
        except (TypeError, ValueError):
            pl.age = 0
        st = (e.get("injury_status") or "").strip()
        if st and st not in ("Healthy",):
            pl.injury_status = st
            pl.injury_body_part = (e.get("injury_body_part") or "").strip()
            pl.injury_notes = (e.get("injury_notes") or "").strip()
            n += 1
    return n


# Stash bets pay off NEXT year, not this one — so old players are bad
# stashes even if injured today. Position-specific age cliffs roughly
# match where fantasy production drops off.
_STASH_AGE_CAP = {"RB": 28, "WR": 30, "TE": 31, "QB": 35}


def is_stash_candidate(p: Player,
                        late_round_adp_floor: float = 120.0) -> bool:
    """Late-ADP player with a serious injury — the kind people draft cheap
    now to keep next year at a discounted forfeit round. Old players are
    excluded since the stash is a bet on NEXT season's production."""
    if p.position not in _STASH_AGE_CAP:
        return False
    if p.adp < late_round_adp_floor:
        return False
    # Age cutoff: only enforce when we actually know the age (>0).
    if p.age and p.age > _STASH_AGE_CAP[p.position]:
        return False
    status = (p.injury_status or "").upper()
    if status in ("IR", "OUT", "PUP", "SUSP", "SUSPENDED"):
        return True
    if status == "QUESTIONABLE" and ("SURGERY" in (p.injury_notes or "").upper()
                                      or "ACL" in (p.injury_body_part or "").upper()):
        return True
    return False
