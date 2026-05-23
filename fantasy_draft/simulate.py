"""Monte Carlo simulation of the rest of a draft.

Other teams pick via softmax over candidate scores (VBD + need + noise). Over
N sims we get an empirical probability that any given player is still on the
board at each of your future picks.

Why softmax: teams aren't perfectly rational — they reach, they hate-pick,
they panic. Temperature controls how deterministic the field is. T=0 → always
best score. T→∞ → uniform over candidates.
"""

from __future__ import annotations

import math
import random
from collections import Counter
from dataclasses import dataclass

from .draft import Draft, Team
from .league import LeagueConfig
from .players import Player
from .predict import score_candidates_for_team


@dataclass
class SimResult:
    your_pick_overall: int
    chosen_player: str            # whom you took in this sim (using same softmax)
    available_at_pick: list[str]  # who else was on the board when you picked
    available_vbd: dict[str, float]


def _snapshot_teams(draft: Draft) -> list[Team]:
    return [Team(idx=t.idx, name=t.name, roster=list(t.roster),
                 forfeited_rounds=set(t.forfeited_rounds))
            for t in draft.teams]


def _softmax_pick(
    available: list[Player],
    team: Team,
    league: LeagueConfig,
    overall_pick: int,
    temperature: float,
    top_k: int,
    rng: random.Random,
) -> Player:
    """Sample a pick from a softmax distribution over the top-K candidates."""
    candidates = score_candidates_for_team(
        team, league, available, overall_pick, top_n=top_k,
    )
    if not candidates:
        # Fallback: best available by projection/VBD.
        return max(available, key=lambda p: (p.vbd, p.projection))

    if temperature <= 1e-6:
        return candidates[0].player

    max_s = max(c.score for c in candidates)
    weights = [math.exp((c.score - max_s) / temperature) for c in candidates]
    total = sum(weights)
    probs = [w / total for w in weights]

    r = rng.random()
    acc = 0.0
    for c, p in zip(candidates, probs):
        acc += p
        if r <= acc:
            return c.player
    return candidates[-1].player


def simulate_once(
    draft: Draft,
    players: list[Player],
    my_team_idx: int,
    temperature: float = 0.35,
    top_k: int = 15,
    rng: random.Random | None = None,
) -> list[SimResult]:
    """Simulate the rest of the draft once. Returns the list of "your" picks
    seen during the sim (one entry per future pick of yours)."""
    rng = rng or random.Random()
    teams = _snapshot_teams(draft)
    # Maintain availability as an ordered list + a "removed" set, so removing
    # a single player is O(1) (mark in set) instead of O(N) rebuild. The
    # scoring step filters by membership in the set.
    drafted_names: set[str] = {p.player.name for p in draft.picks if p.player is not None}
    pool = [p for p in players if p.name not in drafted_names]
    removed: set[str] = set()

    def alive() -> list[Player]:
        if not removed:
            return pool
        return [p for p in pool if p.name not in removed]

    results: list[SimResult] = []
    for pick in draft.picks[draft.cursor:]:
        if pick.player is not None:
            removed.add(pick.player.name)
            continue
        team = teams[pick.team_idx]
        avail = alive()
        chosen = _softmax_pick(avail, team, draft.league, pick.overall,
                                temperature, top_k, rng)
        if pick.team_idx == my_team_idx:
            results.append(SimResult(
                your_pick_overall=pick.overall,
                chosen_player=chosen.name,
                available_at_pick=[p.name for p in avail],
                available_vbd={p.name: p.vbd for p in avail},
            ))
        team.roster.append(chosen)
        removed.add(chosen.name)
    return results


@dataclass
class AvailabilityReport:
    your_pick_overall: int
    n_sims: int
    # player_name -> probability that player was still available at this pick
    p_available: dict[str, float]
    # player_name -> probability you picked them in the sim (for sanity check)
    p_you_take: dict[str, float]

    def top(self, n: int = 15) -> list[tuple[str, float]]:
        return sorted(self.p_available.items(), key=lambda x: -x[1])[:n]


def availability_distribution(
    draft: Draft,
    players: list[Player],
    my_team_idx: int,
    n_sims: int = 1000,
    temperature: float = 0.35,
    top_k: int = 15,
    seed: int | None = None,
) -> list[AvailabilityReport]:
    """Run n_sims, return per-future-pick availability probabilities for you."""
    rng = random.Random(seed)
    avail_counts: dict[int, Counter] = {}
    take_counts: dict[int, Counter] = {}

    for _ in range(n_sims):
        for sr in simulate_once(draft, players, my_team_idx, temperature, top_k, rng):
            avail_counts.setdefault(sr.your_pick_overall, Counter()).update(sr.available_at_pick)
            take_counts.setdefault(sr.your_pick_overall, Counter())[sr.chosen_player] += 1

    reports: list[AvailabilityReport] = []
    for op in sorted(avail_counts):
        reports.append(AvailabilityReport(
            your_pick_overall=op,
            n_sims=n_sims,
            p_available={name: count / n_sims for name, count in avail_counts[op].items()},
            p_you_take={name: count / n_sims for name, count in take_counts[op].items()},
        ))
    return reports
