"""Keeper logic: assign keepers, forfeit the appropriate picks."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .draft import Draft, Pick
from .players import Player


@dataclass
class Keeper:
    team_idx: int
    player_name: str
    # Round the player was drafted OR kept in last year (whichever was their
    # most recent cost). None means undrafted (waiver / UDFA), in which case
    # league rules set the cost.
    prior_round: int | None = None
    # How many consecutive seasons this player has already been kept by this
    # team (including the upcoming year would make it years_kept + 1). Used to
    # enforce KeeperRules.max_years_consecutive.
    years_kept: int = 0


def apply_keepers(draft: Draft, all_players: list[Player], keepers: list[Keeper]) -> list[str]:
    """Mutates the draft: forfeits the appropriate pick for each keeper and
    places the kept player on the team's roster. Returns a list of human-readable
    log lines describing what happened (and any keepers that were rejected)."""
    rules = draft.league.keepers
    log: list[str] = []

    if not rules.enabled:
        if keepers:
            log.append("Keepers were supplied but league.keepers.enabled = False; ignoring.")
        return log

    players_by_name = {p.name.lower(): p for p in all_players}
    per_team_count: dict[int, int] = {}

    for keeper in keepers:
        team = draft.teams[keeper.team_idx]
        player = players_by_name.get(keeper.player_name.lower())
        if player is None:
            log.append(f"REJECT {team.name}: '{keeper.player_name}' not found in player pool.")
            continue

        per_team_count[keeper.team_idx] = per_team_count.get(keeper.team_idx, 0) + 1
        if per_team_count[keeper.team_idx] > rules.max_keepers_per_team:
            log.append(
                f"REJECT {team.name}: exceeds max {rules.max_keepers_per_team} keepers."
            )
            continue

        if rules.max_years_consecutive and keeper.years_kept >= rules.max_years_consecutive:
            log.append(
                f"REJECT {team.name}: {keeper.player_name} already kept "
                f"{keeper.years_kept} years (max {rules.max_years_consecutive})."
            )
            continue

        prior = keeper.prior_round
        if prior is None:
            if rules.undrafted_keeper_round is None:
                log.append(f"REJECT {team.name}: undrafted keepers not allowed for {player.name}.")
                continue
            prior = rules.undrafted_keeper_round

        forfeit_round = prior - rules.round_penalty
        if forfeit_round <= 0:
            if rules.too_early_policy == "not_eligible":
                log.append(
                    f"REJECT {team.name}: {player.name} drafted in R{prior} can't be kept "
                    f"(penalty would forfeit R{forfeit_round})."
                )
                continue
            # Otherwise: penalty applies to next year's first; we just take this
            # year's first as the cost so the team still pays a pick.
            forfeit_round = 1

        target_pick = _find_pick(draft, team.idx, forfeit_round)
        if target_pick is None:
            log.append(
                f"REJECT {team.name}: no pick at R{forfeit_round} or later available "
                f"(team doesn't own one) for {player.name}."
            )
            continue

        target_pick.player = player
        target_pick.is_keeper = True
        team.add(player)
        team.forfeited_rounds.add(target_pick.round_num)
        if target_pick.round_num != forfeit_round:
            log.append(
                f"KEEPER {team.name}: keeps {player.name} ({player.position}) using "
                f"R{target_pick.round_num}.{target_pick.pick_in_round} (natural cost R{forfeit_round} "
                f"unavailable - traded/used; walked forward; prior R{prior})."
            )
        else:
            log.append(
                f"KEEPER {team.name}: keeps {player.name} ({player.position}) "
                f"using R{forfeit_round}.{target_pick.pick_in_round} (prior R{prior})."
            )

    return log


def load_keepers_file(path: str | Path,
                      include_forced_drops: bool = False) -> list[Keeper]:
    """Load the canonical keepers file produced by scripts/build_2026_keepers.py.

    Each record has team_idx, player_name, prior_round, years_kept, status.
    Forced-drop records (yr3 cap hit) are skipped by default so the live draft
    treats those players as freely available.
    """
    records = json.loads(Path(path).read_text(encoding="utf-8"))
    out: list[Keeper] = []
    for r in records:
        if not include_forced_drops and r.get("status") == "forced_drop":
            continue
        out.append(Keeper(
            team_idx=int(r["team_idx"]),
            player_name=r["player_name"],
            prior_round=int(r["prior_round"]),
            years_kept=int(r["years_kept"]),
        ))
    return out


def _find_pick(draft: Draft, team_idx: int, start_round: int) -> Pick | None:
    """Earliest open pick the team owns at or after start_round.

    Picks traded away show up under a different team_idx and are skipped.
    Picks already used as keeper slots have player != None and are skipped.
    Returns None only if the team has no available pick from start_round
    through the end of the draft.
    """
    for r in range(start_round, draft.league.rounds + 1):
        for pick in draft.picks:
            if (pick.team_idx == team_idx
                    and pick.round_num == r
                    and pick.player is None):
                return pick
    return None
