"""Value-Based Drafting (VBD): each player's projected season points minus
the projection of the worst startable player at their position.

Why this beats ADP:
- ADP comes from public leagues; if yours uses superflex or 2QB, public ADP
  drastically undervalues QBs. VBD uses YOUR league's starter math.
- After keepers are removed, the replacement-level player at each position
  shifts (because fewer top players remain to fill the same starter slots).
  `compute_vbd_post_keepers` accounts for this directly.
"""

from __future__ import annotations

from .league import LeagueConfig
from .players import Player


# How flex slots split across positions in a typical draft. Tuned for redraft
# behaviour; override per-league if you have a stronger prior.
FLEX_SHARES: dict[str, dict[str, float]] = {
    "FLEX":       {"RB": 0.55, "WR": 0.40, "TE": 0.05},
    "WR_RB_FLEX": {"RB": 0.50, "WR": 0.50},
    "WR_TE_FLEX": {"WR": 0.75, "TE": 0.25},
    "SUPERFLEX":  {"QB": 0.85, "RB": 0.05, "WR": 0.08, "TE": 0.02},
    "OP":         {"QB": 0.85, "RB": 0.05, "WR": 0.08, "TE": 0.02},
}


def compute_replacement_ranks(
    league: LeagueConfig,
    flex_shares: dict[str, dict[str, float]] | None = None,
) -> dict[str, int]:
    """For each position, return the rank (1-indexed) at which replacement
    level sits across the whole league.

    A 1QB + 1 SUPERFLEX 12-team league: QB replacement ≈ rank 12 + 0.85*12 ≈ 22.
    A 1QB redraft league: QB replacement ≈ rank 12.
    """
    shares = flex_shares or FLEX_SHARES
    direct = {"QB", "RB", "WR", "TE", "K", "DEF"}
    per_team: dict[str, float] = {}

    for slot in league.starters:
        if slot.name in direct:
            per_team[slot.name] = per_team.get(slot.name, 0.0) + slot.count
        elif slot.name in shares:
            for pos, frac in shares[slot.name].items():
                per_team[pos] = per_team.get(pos, 0.0) + slot.count * frac
        # IDP and other unknown slots: ignore for offensive VBD.

    return {pos: max(1, int(round(league.num_teams * count)))
            for pos, count in per_team.items() if count > 0}


def compute_vbd(
    players: list[Player],
    league: LeagueConfig,
    replacement_ranks: dict[str, int] | None = None,
) -> dict[str, float]:
    """Annotate each player's `vbd` field. Returns the replacement projection
    used per position so callers can inspect the cliff."""
    if replacement_ranks is None:
        replacement_ranks = compute_replacement_ranks(league)

    by_pos: dict[str, list[Player]] = {}
    for p in players:
        by_pos.setdefault(p.position, []).append(p)
    for pos in by_pos:
        by_pos[pos].sort(key=lambda x: -x.projection)

    replacement_proj: dict[str, float] = {}
    for pos, plist in by_pos.items():
        rank = replacement_ranks.get(pos, len(plist))
        if rank <= len(plist):
            replacement_proj[pos] = plist[rank - 1].projection
        elif plist:
            replacement_proj[pos] = plist[-1].projection
        else:
            replacement_proj[pos] = 0.0

    for p in players:
        p.vbd = p.projection - replacement_proj.get(p.position, 0.0)

    return replacement_proj


def compute_vbd_post_keepers(
    players: list[Player],
    league: LeagueConfig,
    keeper_names: set[str] | list[str] | None = None,
) -> tuple[list[Player], dict[str, float]]:
    """Recompute VBD after removing keepers from the pool.

    Keepers reduce the *available* count at each position, which pulls the
    replacement player deeper into the rankings. Equivalent to:
        adjusted_rank = max(1, replacement_rank - keepers_at_position)
    applied to the remaining (non-keeper) pool sorted by projection.

    Returns (available_players, per-position replacement projection).
    """
    keeper_set = {_norm(n) for n in (keeper_names or set())}
    available = [p for p in players if _norm(p.name) not in keeper_set]

    base_ranks = compute_replacement_ranks(league)

    keepers_by_pos: dict[str, int] = {}
    for p in players:
        if _norm(p.name) in keeper_set:
            keepers_by_pos[p.position] = keepers_by_pos.get(p.position, 0) + 1

    adjusted_ranks = {
        pos: max(1, base_ranks[pos] - keepers_by_pos.get(pos, 0))
        for pos in base_ranks
    }

    replacement_proj = compute_vbd(available, league, adjusted_ranks)
    return available, replacement_proj


def _norm(name: str) -> str:
    return (
        name.lower()
        .replace(".", "")
        .replace("'", "")
        .replace("-", " ")
        .strip()
    )
