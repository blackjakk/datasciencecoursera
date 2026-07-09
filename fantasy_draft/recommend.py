"""Opportunity-cost recommender for your draft pick.

The core idea: don't pick the player with the highest VBD right now. Pick the
one that maximizes the *expected sum of VBDs* across all your remaining picks.

For each top-K candidate at your current pick:
  1. Force-take that player at this slot.
  2. Run N Monte Carlo sims of the remainder of the draft (other teams sample
     via softmax, your future picks take best-VBD-with-need each turn).
  3. Average total VBD added to your roster across sims.

The candidate with the highest expected total VBD wins. The runner-up's
shortfall is the opportunity cost of NOT picking the best one.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from .draft import Draft, Pick, Team
from .league import LeagueConfig
from .players import Player
from .predict import score_candidates_for_team
from .simulate import _snapshot_teams, _softmax_pick


@dataclass
class Recommendation:
    player: Player
    expected_total_vbd: float        # avg over sims, summed across your remaining picks
    immediate_vbd: float             # this player's VBD
    expected_future_vbd: float       # avg sum of VBDs of your future picks
    p_alternatives_survive: dict[str, float] = None  # other top candidates' availability next pick


def _simulate_with_forced_pick(
    draft: Draft,
    players: list[Player],
    my_team_idx: int,
    forced_player: Player,
    temperature: float,
    your_temperature: float,
    top_k: int,
    rng: random.Random,
) -> tuple[float, list[str]]:
    teams = _snapshot_teams(draft)
    drafted = {p.player.name for p in draft.picks if p.player is not None}
    pool = [p for p in players if p.name not in drafted]
    removed: set[str] = set()

    my_total_vbd = 0.0
    my_taken: list[str] = []
    forced_used = False

    for pick in draft.picks[draft.cursor:]:
        if pick.player is not None:
            removed.add(pick.player.name)
            continue
        team = teams[pick.team_idx]
        avail = pool if not removed else [p for p in pool if p.name not in removed]
        if pick.team_idx == my_team_idx and not forced_used:
            chosen = forced_player
            forced_used = True
        elif pick.team_idx == my_team_idx:
            chosen = _softmax_pick(avail, team, draft.league, pick.overall,
                                    your_temperature, top_k, rng)
        else:
            chosen = _softmax_pick(avail, team, draft.league, pick.overall,
                                    temperature, top_k, rng)
        if pick.team_idx == my_team_idx:
            my_total_vbd += chosen.vbd
            my_taken.append(chosen.name)
        team.roster.append(chosen)
        removed.add(chosen.name)

    return my_total_vbd, my_taken


def recommend(
    draft: Draft,
    players: list[Player],
    my_team_idx: int,
    top_k_candidates: int = 8,
    n_sims_per_candidate: int = 150,
    temperature: float = 0.35,
    your_temperature: float = 0.15,
    seed: int | None = None,
) -> list[Recommendation]:
    """Rank your current pick's candidates by expected total VBD."""
    rng = random.Random(seed)
    pick = draft.on_the_clock
    if pick is None or pick.team_idx != my_team_idx:
        raise RuntimeError("recommend() should be called when you're on the clock.")

    drafted = {p.player.name for p in draft.picks if p.player is not None}
    available = [p for p in players if p.name not in drafted]
    candidates = score_candidates_for_team(
        draft.teams[my_team_idx], draft.league, available, pick.overall,
        top_n=top_k_candidates,
    )

    recs: list[Recommendation] = []
    for c in candidates:
        totals: list[float] = []
        for _ in range(n_sims_per_candidate):
            total, _ = _simulate_with_forced_pick(
                draft, players, my_team_idx, c.player,
                temperature, your_temperature, top_k=12, rng=rng,
            )
            totals.append(total)
        avg = sum(totals) / len(totals)
        recs.append(Recommendation(
            player=c.player,
            expected_total_vbd=avg,
            immediate_vbd=c.player.vbd,
            expected_future_vbd=avg - c.player.vbd,
        ))

    recs.sort(key=lambda r: -r.expected_total_vbd)
    return recs
