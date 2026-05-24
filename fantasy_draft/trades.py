"""Traded-pick handling.

Reassigns ownership of specific picks in the Draft object so that downstream
logic (apply_keepers, the simulator, the recommender) sees the correct owner.

Sleeper exposes traded picks at /league/{id}/traded_picks. Each entry has the
shape:
    {
        "season": "2025",
        "round": 5,
        "roster_id": 4,             # the team that originally owned the pick
        "previous_owner_id": 4,
        "owner_id": 7,              # the team that owns it now
    }

In our model the original team_idx == roster_id - 1; this module rewrites
draft.picks[*].team_idx accordingly.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .draft import Draft


@dataclass
class TradedPick:
    season: int
    round_num: int
    original_team_idx: int     # who would have owned this by default
    new_team_idx: int          # who owns it now after the trade


def load_trades_from_sleeper_dump(
    root: str | Path,
    season: int | None = None,
) -> list[TradedPick]:
    """Read traded_picks.json from a Sleeper offline dump.

    If `season` is None, return trades for the most recent dumped league.
    """
    root = Path(root)
    # Find the league dir for the requested season (or the latest).
    chosen_dir = None
    chosen_season = -1
    for d in sorted(root.iterdir()):
        if not (d.is_dir() and d.name.startswith("league_")):
            continue
        league_path = d / "league.json"
        if not league_path.exists():
            continue
        with open(league_path, encoding="utf-8") as f:
            data = json.load(f)
        s = int(data.get("season", 0) or 0)
        if season is None:
            if s > chosen_season:
                chosen_dir, chosen_season = d, s
        elif s == season:
            chosen_dir = d
            break
    if chosen_dir is None:
        return []
    trades_path = chosen_dir / "traded_picks.json"
    if not trades_path.exists():
        return []
    with open(trades_path, encoding="utf-8") as f:
        raw = json.load(f)

    out: list[TradedPick] = []
    for t in raw:
        try:
            out.append(TradedPick(
                season=int(t.get("season", 0) or 0),
                round_num=int(t["round"]),
                original_team_idx=int(t["roster_id"]) - 1,
                new_team_idx=int(t["owner_id"]) - 1,
            ))
        except (KeyError, TypeError, ValueError):
            continue
    return out


def apply_trades(draft: Draft, trades: list[TradedPick]) -> list[str]:
    """Mutate draft.picks so that traded picks belong to the new owner.

    Each TradedPick reassigns the (first matching) pick at that round from
    original_team_idx to new_team_idx. In snake drafts each team has one
    pick per round so this is unambiguous; if the same team's same-round pick
    has been traded multiple times in a chain Sleeper's payload shows the
    final owner, so applying once suffices.

    Returns a human-readable log of which picks moved.
    """
    log: list[str] = []
    for t in trades:
        if t.original_team_idx == t.new_team_idx:
            continue  # no-op (e.g. pick returned to owner)
        if not (0 <= t.original_team_idx < len(draft.teams)
                and 0 <= t.new_team_idx < len(draft.teams)):
            continue
        for pick in draft.picks:
            if pick.team_idx == t.original_team_idx and pick.round_num == t.round_num:
                pick.team_idx = t.new_team_idx
                log.append(
                    f"TRADE: R{t.round_num} pick moved "
                    f"{draft.teams[t.original_team_idx].name} -> "
                    f"{draft.teams[t.new_team_idx].name}"
                )
                break
    return log
