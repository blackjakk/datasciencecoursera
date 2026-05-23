"""Predict which N keepers each team will retain.

Decision model (from first principles):
- Each team owns a set of players drafted last year (and optionally picked up
  off waivers). They get to keep up to K of them. For each player they choose
  to keep, they forfeit their pick in round (prior_round - round_penalty).
- A rational team keeps the players where:
      net_value = player_VBD - expected_VBD_at_forfeit_round
  is highest, subject to the max-years-consecutive cap.
- The "expected VBD at round R" is the median VBD of the players typically
  drafted in round R — i.e. what a team can realistically get back by NOT
  keeping the player and using that pick instead.

This is deterministic given (a) each team's roster + per-player prior_round,
and (b) a current-year VBD curve. Confidence drops smoothly with rank.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .history import HistoricalDraftPick
from .league import LeagueConfig
from .players import Player


@dataclass
class KeeperPrediction:
    team_id: str
    team_name: str
    player_name: str
    position: str
    prior_round: int
    forfeit_round: int
    years_kept: int
    player_vbd: float
    expected_vbd_at_forfeit: float
    net_value: float
    confidence: float  # 0..1


def expected_vbd_curve(
    players: list[Player],
    league: LeagueConfig,
) -> dict[int, float]:
    """For each round, the median VBD of players typically drafted in that round."""
    sorted_players = sorted(players, key=lambda p: -p.vbd)
    n = league.num_teams
    curve: dict[int, float] = {}
    for r in range(1, league.rounds + 1):
        chunk = sorted_players[(r - 1) * n : r * n]
        if not chunk:
            curve[r] = 0.0
            continue
        vbds = sorted(p.vbd for p in chunk)
        curve[r] = vbds[len(vbds) // 2]
    return curve


def _normalize(name: str) -> str:
    return (
        name.lower()
        .replace(".", "")
        .replace("'", "")
        .replace("-", " ")
        .strip()
    )


def predict_team_keepers(
    team_roster: list[HistoricalDraftPick],
    players_with_vbd: list[Player],
    league: LeagueConfig,
    max_keepers: int = 4,
    vbd_curve: dict[int, float] | None = None,
) -> list[KeeperPrediction]:
    """Rank a single team's keeper options. Returns ALL eligible candidates
    ordered by net_value descending; the top `max_keepers` are the predicted
    keepers but the rest are useful context (bubble decisions).
    """
    rules = league.keepers
    if vbd_curve is None:
        vbd_curve = expected_vbd_curve(players_with_vbd, league)

    by_name = {_normalize(p.name): p for p in players_with_vbd}
    candidates: list[KeeperPrediction] = []

    for pick in team_roster:
        player = by_name.get(_normalize(pick.player_name))
        if player is None:
            continue
        # Years-kept cap.
        if rules.max_years_consecutive and pick.years_kept >= rules.max_years_consecutive:
            continue

        forfeit_round = pick.round_num - rules.round_penalty
        if forfeit_round <= 0:
            if rules.too_early_policy != "forfeit_next_year_first":
                continue
            forfeit_round = 1  # crude approximation; cost still applied

        expected_vbd = vbd_curve.get(forfeit_round, 0.0)
        net = player.vbd - expected_vbd
        candidates.append(
            KeeperPrediction(
                team_id=pick.team_id,
                team_name=pick.team_name,
                player_name=player.name,
                position=player.position,
                prior_round=pick.round_num,
                forfeit_round=forfeit_round,
                years_kept=pick.years_kept,
                player_vbd=player.vbd,
                expected_vbd_at_forfeit=expected_vbd,
                net_value=net,
                confidence=0.0,
            )
        )

    candidates.sort(key=lambda c: -c.net_value)

    # Soft confidence via softmax over the top (max_keepers + 4) net_values.
    # Sharper temperature -> the top few converge to 1.0.
    if candidates:
        window = candidates[: max_keepers + 4]
        net_values = [c.net_value for c in window]
        temp = max(10.0, _stdev(net_values) * 0.6)
        max_v = max(net_values)
        weights = [math.exp((v - max_v) / temp) for v in net_values]
        total = sum(weights)
        for c, w in zip(window, weights):
            c.confidence = w / total

    return candidates


def predict_keepers_for_league(
    last_draft: list[HistoricalDraftPick],
    players_with_vbd: list[Player],
    league: LeagueConfig,
    max_keepers: int = 4,
) -> dict[str, list[KeeperPrediction]]:
    """Predict keepers for every team that appeared in last year's draft.

    Returns {team_id: [KeeperPrediction sorted by net_value desc]}.
    """
    by_team: dict[str, list[HistoricalDraftPick]] = {}
    for pick in last_draft:
        by_team.setdefault(pick.team_id, []).append(pick)

    curve = expected_vbd_curve(players_with_vbd, league)
    return {
        team_id: predict_team_keepers(roster, players_with_vbd, league,
                                       max_keepers=max_keepers, vbd_curve=curve)
        for team_id, roster in by_team.items()
    }


def _stdev(xs: list[float]) -> float:
    if len(xs) < 2:
        return 1.0
    m = sum(xs) / len(xs)
    return (sum((x - m) ** 2 for x in xs) / (len(xs) - 1)) ** 0.5
