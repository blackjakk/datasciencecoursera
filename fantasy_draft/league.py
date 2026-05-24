"""League configuration: roster slots, scoring, keeper rules."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping

# Slot name -> set of player positions eligible to fill it.
SLOT_ELIGIBILITY: dict[str, frozenset[str]] = {
    "QB": frozenset({"QB"}),
    "RB": frozenset({"RB"}),
    "WR": frozenset({"WR"}),
    "TE": frozenset({"TE"}),
    "K": frozenset({"K"}),
    "DEF": frozenset({"DEF", "DST"}),
    "FLEX": frozenset({"RB", "WR", "TE"}),
    "WR_RB_FLEX": frozenset({"RB", "WR"}),
    "WR_TE_FLEX": frozenset({"WR", "TE"}),
    "SUPERFLEX": frozenset({"QB", "RB", "WR", "TE"}),
    "OP": frozenset({"QB", "RB", "WR", "TE"}),  # offensive player flex, alias
    "BENCH": frozenset({"QB", "RB", "WR", "TE", "K", "DEF", "DST"}),
    "IDP_FLEX": frozenset({"DL", "LB", "DB"}),
    "DL": frozenset({"DL"}),
    "LB": frozenset({"LB"}),
    "DB": frozenset({"DB"}),
}


@dataclass(frozen=True)
class RosterSlot:
    name: str
    count: int

    @property
    def eligible(self) -> frozenset[str]:
        if self.name not in SLOT_ELIGIBILITY:
            raise ValueError(f"Unknown slot '{self.name}'. Add it to SLOT_ELIGIBILITY.")
        return SLOT_ELIGIBILITY[self.name]


@dataclass
class ScoringRules:
    """Per-stat scoring used to break ties / rank players when projections exist."""

    passing_yards: float = 0.04
    passing_td: float = 4.0
    interception: float = -2.0
    rushing_yards: float = 0.1
    rushing_td: float = 6.0
    receiving_yards: float = 0.1
    receiving_td: float = 6.0
    reception: float = 1.0  # PPR by default; set 0.5 for half-PPR, 0.0 for standard
    fumble_lost: float = -2.0


@dataclass
class KeeperRules:
    """Rules for a keeper league."""

    enabled: bool = False
    max_keepers_per_team: int = 0
    # If a player was drafted/kept in round R last year, you forfeit your pick
    # in round (R - round_penalty) this year. Default of 2 matches user's league.
    round_penalty: int = 2
    # Players acquired off waivers / undrafted last year typically cost a fixed
    # round. None means "not allowed to keep undrafted players".
    undrafted_keeper_round: int | None = None
    # If forfeited round would be <= 0 (e.g. kept a 1st-rounder), what happens?
    # "forfeit_next_year_first" or "not_eligible".
    too_early_policy: str = "not_eligible"
    # A player can be kept by the same team for at most this many consecutive
    # seasons. 0 disables the cap.
    max_years_consecutive: int = 0


@dataclass
class LeagueConfig:
    name: str = "My League"
    num_teams: int = 12
    rounds: int = 16
    snake: bool = True
    roster: list[RosterSlot] = field(default_factory=list)
    scoring: ScoringRules = field(default_factory=ScoringRules)
    keepers: KeeperRules = field(default_factory=KeeperRules)
    # R1 pick order as team_idx values (0-indexed). When set, slot N goes to
    # draft_order[N-1]. Snake reversal applies as usual. When None, default to
    # range(num_teams) so slot == team_idx + 1.
    draft_order: list[int] | None = None

    @property
    def starters(self) -> list[RosterSlot]:
        return [s for s in self.roster if s.name != "BENCH"]

    @property
    def bench_size(self) -> int:
        return sum(s.count for s in self.roster if s.name == "BENCH")

    @property
    def total_roster_size(self) -> int:
        return sum(s.count for s in self.roster)

    def position_demand(self) -> dict[str, int]:
        """Total starter demand per position (treating flex slots as +1 to each
        eligible position). Used by the predictor to weight scarcity."""
        demand: dict[str, int] = {}
        for slot in self.starters:
            for pos in slot.eligible:
                demand[pos] = demand.get(pos, 0) + slot.count
        return demand

    @classmethod
    def from_dict(cls, data: Mapping) -> "LeagueConfig":
        roster = [RosterSlot(name=s["name"], count=int(s["count"])) for s in data.get("roster", [])]
        scoring = ScoringRules(**data.get("scoring", {}))
        keepers = KeeperRules(**data.get("keepers", {}))
        do = data.get("draft_order")
        return cls(
            name=data.get("name", "My League"),
            num_teams=int(data.get("num_teams", 12)),
            rounds=int(data.get("rounds", 16)),
            snake=bool(data.get("snake", True)),
            roster=roster,
            scoring=scoring,
            keepers=keepers,
            draft_order=[int(x) for x in do] if do else None,
        )

    @classmethod
    def load(cls, path: str | Path) -> "LeagueConfig":
        with open(path, encoding="utf-8") as f:
            return cls.from_dict(json.load(f))


def standard_superflex_12() -> LeagueConfig:
    """1 QB, 2 RB, 3 WR, 1 TE, 1 FLEX, 1 SUPERFLEX, K, DEF, 6 bench."""
    return LeagueConfig(
        name="Superflex 12-team",
        num_teams=12,
        rounds=15,
        roster=[
            RosterSlot("QB", 1),
            RosterSlot("RB", 2),
            RosterSlot("WR", 3),
            RosterSlot("TE", 1),
            RosterSlot("FLEX", 1),
            RosterSlot("SUPERFLEX", 1),
            RosterSlot("K", 1),
            RosterSlot("DEF", 1),
            RosterSlot("BENCH", 6),
        ],
    )


def two_qb_12() -> LeagueConfig:
    """2 QB, 2 RB, 3 WR, 1 TE, 1 FLEX, K, DEF, 6 bench."""
    return LeagueConfig(
        name="2QB 12-team",
        num_teams=12,
        rounds=15,
        roster=[
            RosterSlot("QB", 2),
            RosterSlot("RB", 2),
            RosterSlot("WR", 3),
            RosterSlot("TE", 1),
            RosterSlot("FLEX", 1),
            RosterSlot("K", 1),
            RosterSlot("DEF", 1),
            RosterSlot("BENCH", 6),
        ],
    )


def standard_1qb_12() -> LeagueConfig:
    """1 QB, 2 RB, 3 WR, 1 TE, 1 FLEX, K, DEF, 6 bench."""
    return LeagueConfig(
        name="Standard 1QB 12-team",
        num_teams=12,
        rounds=15,
        roster=[
            RosterSlot("QB", 1),
            RosterSlot("RB", 2),
            RosterSlot("WR", 3),
            RosterSlot("TE", 1),
            RosterSlot("FLEX", 1),
            RosterSlot("K", 1),
            RosterSlot("DEF", 1),
            RosterSlot("BENCH", 6),
        ],
    )
