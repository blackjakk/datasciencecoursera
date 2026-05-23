"""Cross-platform historical draft model and ADP-anomaly keeper detection."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

from .players import Player


@dataclass
class HistoricalDraftPick:
    """A single pick from a past draft, source-agnostic (Sleeper, Yahoo, CSV).

    Use `years_kept` only if known. ADP-anomaly detection fills `is_keeper`
    when the upstream platform didn't tag it (e.g. old Yahoo seasons).
    """

    season: int
    overall_pick: int
    round_num: int
    pick_in_round: int
    team_id: str
    team_name: str
    player_name: str
    player_position: str
    is_keeper: bool | None = None
    years_kept: int = 0  # 0 = not a keeper, 1 = first year being kept, ...
    cost_round: int | None = None  # round actually paid (= round_num for kept picks)
    source: str = "unknown"
    raw: dict = field(default_factory=dict)


def detect_keepers_by_adp(
    picks: Iterable[HistoricalDraftPick],
    players: list[Player],
    num_teams: int = 12,
    round_threshold: float = 1.5,
) -> list[HistoricalDraftPick]:
    """Flag picks where the player went notably later than ADP suggests.

    A kept player occupies the draft slot they paid for — typically multiple
    rounds later than their natural ADP because keeper cost escalates each
    year. We compare actual round to ADP-implied round and flag when actual
    is `round_threshold` or more rounds later.

    Limitation: uses current-year ADP as a proxy for the prior season's
    ADP, so rookies and breakouts can be false positives.

    Picks that already had `is_keeper` set are left alone.
    """
    by_name = {_normalize(p.name): p for p in players}
    flagged: list[HistoricalDraftPick] = []
    for pick in picks:
        if pick.is_keeper is not None:
            flagged.append(pick)
            continue
        player = by_name.get(_normalize(pick.player_name))
        if player is None or player.adp >= 999:
            pick.is_keeper = False
            flagged.append(pick)
            continue
        adp_round = max(1.0, player.adp / num_teams)
        round_gap = pick.round_num - adp_round
        pick.is_keeper = round_gap >= round_threshold
        flagged.append(pick)
    return flagged


def consolidate_years_kept(
    picks_by_season: dict[int, list[HistoricalDraftPick]],
) -> dict[int, list[HistoricalDraftPick]]:
    """Annotate each pick with `years_kept` by walking history back.

    A pick has years_kept = N if the same team has had this player flagged as a
    keeper for N consecutive seasons (including the current one). Sets
    years_kept on each pick in place and returns the same mapping.
    """
    seasons = sorted(picks_by_season.keys())
    # (season, team_id, player_name) -> years_kept
    streaks: dict[tuple[str, str], int] = {}
    for season in seasons:
        next_streaks: dict[tuple[str, str], int] = {}
        for pick in picks_by_season[season]:
            key = (pick.team_id, _normalize(pick.player_name))
            if pick.is_keeper:
                prev = streaks.get(key, 0)
                pick.years_kept = prev + 1
                next_streaks[key] = pick.years_kept
            else:
                pick.years_kept = 0
        streaks = next_streaks
    return picks_by_season


def latest_season_keepers(
    picks_by_season: dict[int, list[HistoricalDraftPick]],
    target_season: int | None = None,
) -> list[HistoricalDraftPick]:
    """Return the most recent draft's keeper picks (those a team will use as the
    basis for this year's keeper cost)."""
    if not picks_by_season:
        return []
    season = target_season if target_season is not None else max(picks_by_season)
    return [p for p in picks_by_season.get(season, []) if p.is_keeper]


def _normalize(name: str) -> str:
    return (
        name.lower()
        .replace(".", "")
        .replace("'", "")
        .replace("-", " ")
        .replace("  ", " ")
        .strip()
    )
