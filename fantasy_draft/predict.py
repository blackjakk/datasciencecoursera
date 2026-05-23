"""Predict what the next team will pick.

Heuristic: combine player value (low ADP / high projection) with the team's
positional need (unfilled starter slots, weighted by scarcity). Returns ranked
candidates so the UI can show top-N suggestions, not just one.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .draft import Draft, Team
from .league import LeagueConfig
from .players import Player


@dataclass
class Candidate:
    player: Player
    score: float
    value_score: float
    need_score: float
    reason: str


# Weights tuned to give a sensible blend; users can override via predict_pick(...).
DEFAULT_VALUE_WEIGHT = 1.0
DEFAULT_NEED_WEIGHT = 0.6
# Once starter slots are filled, BPA (best player available) takes over.
BENCH_NEED_WEIGHT = 0.15


def _value_score(player: Player, current_overall_pick: int, league: LeagueConfig) -> float:
    """Higher = better value relative to where we are in the draft.

    Reach penalty: picking a player far before their ADP costs value.
    Steal bonus: picking a player whose ADP has passed gains value.
    """
    adp = player.adp if player.adp < 999 else current_overall_pick + 24
    # Sigmoid-ish: ADP relative to current pick, normalized by a round's worth.
    round_size = max(league.num_teams, 1)
    delta = (current_overall_pick - adp) / round_size  # +ve = steal, -ve = reach
    adp_component = 1.0 / (1.0 + math.exp(-delta))  # 0..1
    # Projection component (normalized loosely): not all CSVs have projections,
    # so we fall back to a flat 0.5 when missing.
    if player.projection > 0:
        proj_component = min(player.projection / 350.0, 1.0)
    else:
        # Use rank_overall as a stand-in.
        proj_component = max(0.0, 1.0 - player.rank_overall / 300.0)
    return 0.6 * adp_component + 0.4 * proj_component


def _need_score(player: Player, team: Team, league: LeagueConfig) -> tuple[float, str]:
    needs = team.needs(league)
    pos_need = needs.get(player.position, 0.0)
    if pos_need > 0:
        return pos_need, f"fills starter need at {player.position} (need={pos_need:.1f})"
    # Starters filled at this position: small bench bonus, scaled by how scarce
    # the position is league-wide.
    demand = league.position_demand().get(player.position, 1)
    return BENCH_NEED_WEIGHT * (demand / league.num_teams), "bench depth"


def score_candidates(
    draft: Draft,
    available: list[Player],
    team_idx: int,
    overall_pick: int,
    value_weight: float = DEFAULT_VALUE_WEIGHT,
    need_weight: float = DEFAULT_NEED_WEIGHT,
    top_n: int = 10,
) -> list[Candidate]:
    team = draft.teams[team_idx]
    candidates: list[Candidate] = []
    for player in available:
        if not _position_legal_for_team(player, team, draft.league):
            continue
        v = _value_score(player, overall_pick, draft.league)
        n, reason = _need_score(player, team, draft.league)
        score = value_weight * v + need_weight * n
        candidates.append(Candidate(player=player, score=score, value_score=v, need_score=n, reason=reason))
    candidates.sort(key=lambda c: c.score, reverse=True)
    return candidates[:top_n]


def predict_pick(
    draft: Draft,
    available: list[Player],
    team_idx: int,
    overall_pick: int,
) -> Candidate | None:
    ranked = score_candidates(draft, available, team_idx, overall_pick, top_n=1)
    return ranked[0] if ranked else None


def _position_legal_for_team(player: Player, team: Team, league: LeagueConfig) -> bool:
    """Don't recommend Ks/DEFs until late, and don't recommend more of a position
    than the team could conceivably roster."""
    pos = player.position
    counts = team.position_counts()
    # Hard cap: don't stash 4 QBs in a 1QB league.
    demand = league.position_demand().get(pos, 0)
    bench_cushion = max(1, league.bench_size // 3)
    if counts.get(pos, 0) >= demand + bench_cushion:
        return False
    return True
