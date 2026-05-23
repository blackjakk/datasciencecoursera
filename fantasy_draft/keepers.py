"""Keeper logic: assign keepers, forfeit the appropriate picks."""

from __future__ import annotations

from dataclasses import dataclass

from .draft import Draft, Pick
from .players import Player


@dataclass
class Keeper:
    team_idx: int
    player_name: str
    # Round the player was selected in last year's draft. None means undrafted
    # (waiver / UDFA), in which case league rules decide the cost.
    prior_round: int | None = None


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
                f"REJECT {team.name}: no available pick in R{forfeit_round} to forfeit "
                f"for {player.name}."
            )
            continue

        target_pick.player = player
        target_pick.is_keeper = True
        team.add(player)
        team.forfeited_rounds.add(forfeit_round)
        log.append(
            f"KEEPER {team.name}: keeps {player.name} ({player.position}) "
            f"using R{forfeit_round}.{target_pick.pick_in_round} (prior R{prior})."
        )

    return log


def _find_pick(draft: Draft, team_idx: int, round_num: int) -> Pick | None:
    for pick in draft.picks:
        if pick.team_idx == team_idx and pick.round_num == round_num and pick.player is None:
            return pick
    return None
