"""Draft state: teams, roster fills, pick order (snake or linear)."""

from __future__ import annotations

from dataclasses import dataclass, field

from .league import LeagueConfig, SLOT_ELIGIBILITY
from .players import Player


@dataclass
class Pick:
    overall: int       # 1-indexed overall pick number
    round_num: int     # 1-indexed
    pick_in_round: int # 1-indexed
    team_idx: int
    player: Player | None = None
    is_keeper: bool = False


@dataclass
class Team:
    idx: int
    name: str
    roster: list[Player] = field(default_factory=list)
    forfeited_rounds: set[int] = field(default_factory=set)  # from keepers

    def add(self, player: Player) -> None:
        self.roster.append(player)

    def position_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for p in self.roster:
            counts[p.position] = counts.get(p.position, 0) + 1
        return counts

    def slots_remaining(self, league: LeagueConfig) -> dict[str, int]:
        """How many of each *starter* slot are still unfilled, greedily fitting
        the current roster into the most-restrictive eligible slot first."""
        remaining = {slot.name: slot.count for slot in league.starters}
        # Fill most-restrictive slots first (smallest eligibility set).
        ordered_slots = sorted(
            league.starters,
            key=lambda s: (len(SLOT_ELIGIBILITY[s.name]), s.name),
        )
        roster_pool = list(self.roster)
        for slot in ordered_slots:
            eligible = SLOT_ELIGIBILITY[slot.name]
            for _ in range(slot.count):
                match = next((p for p in roster_pool if p.position in eligible), None)
                if match is None:
                    break
                roster_pool.remove(match)
                remaining[slot.name] -= 1
        return remaining

    def needs(self, league: LeagueConfig) -> dict[str, float]:
        """Per-position 'need' score: how badly this team needs another player
        at each position to fill starters. Flex/superflex slots count partially
        toward each eligible position, weighted by realistic usage (FLEX
        almost always goes to RB/WR, rarely TE; SUPERFLEX almost always QB).

        Uses fantasy_draft.vbd.FLEX_SHARES as the empirical share-by-position
        table. Without it, equal-share splitting gave TE the same 33% of FLEX
        as RB — so a team that keeper-rostered a top TE still registered
        meaningful TE need and would reach on TE2 in early rounds.

        Superflex scarcity: in leagues that start 2 QBs (i.e. QB is eligible
        for a flex-like slot), teams with fewer than 3 QBs still register a
        non-zero QB need even after starters are filled — protects against the
        backup-QB injury risk.
        """
        from .vbd import FLEX_SHARES
        slots_left = self.slots_remaining(league)
        need: dict[str, float] = {}
        for slot_name, count in slots_left.items():
            if count <= 0:
                continue
            eligible = SLOT_ELIGIBILITY[slot_name]
            if slot_name in FLEX_SHARES:
                # Empirical share per position rather than equal split.
                for pos, share in FLEX_SHARES[slot_name].items():
                    need[pos] = need.get(pos, 0.0) + count * share
            elif len(eligible) > 1:
                # Unknown multi-position slot: fall back to equal split.
                weight = count / len(eligible)
                for pos in eligible:
                    need[pos] = need.get(pos, 0.0) + weight
            else:
                pos = next(iter(eligible))
                need[pos] = need.get(pos, 0.0) + count

        # Superflex scarcity bonus: in 2-QB-start leagues, teams under 3 QBs
        # still register meaningful QB need (injury insurance / position
        # scarcity premium).
        is_superflex_league = any(
            "QB" in SLOT_ELIGIBILITY.get(s.name, frozenset()) and
            len(SLOT_ELIGIBILITY[s.name]) > 1
            for s in league.starters
        )
        if is_superflex_league:
            qb_count = self.position_counts().get("QB", 0)
            if qb_count < 3:
                need["QB"] = need.get("QB", 0.0) + (3 - qb_count) * 0.25
        return need


@dataclass
class Draft:
    league: LeagueConfig
    teams: list[Team]
    picks: list[Pick] = field(default_factory=list)
    cursor: int = 0  # index into self.picks

    @classmethod
    def new(cls, league: LeagueConfig, team_names: list[str] | None = None) -> "Draft":
        if team_names is None:
            team_names = [f"Team {i + 1}" for i in range(league.num_teams)]
        if len(team_names) != league.num_teams:
            raise ValueError(
                f"Got {len(team_names)} team names but league has {league.num_teams} teams."
            )
        teams = [Team(idx=i, name=n) for i, n in enumerate(team_names)]
        picks = _build_pick_order(league)
        return cls(league=league, teams=teams, picks=picks)

    @property
    def on_the_clock(self) -> Pick | None:
        if self.cursor >= len(self.picks):
            return None
        return self.picks[self.cursor]

    def make_pick(self, player: Player) -> Pick:
        pick = self.on_the_clock
        if pick is None:
            raise RuntimeError("Draft is over.")
        pick.player = player
        self.teams[pick.team_idx].add(player)
        self.cursor += 1
        return pick

    def available(self, all_players: list[Player]) -> list[Player]:
        drafted = {p.player.name for p in self.picks if p.player is not None}
        return [p for p in all_players if p.name not in drafted]

    def summary(self) -> str:
        lines = [f"=== {self.league.name} ==="]
        for team in self.teams:
            lines.append(f"\n{team.name} ({len(team.roster)} players):")
            for p in sorted(team.roster, key=lambda x: (x.position, -x.projection)):
                lines.append(f"  {p.position:4} {p.name} ({p.team})")
        return "\n".join(lines)


def _build_pick_order(league: LeagueConfig) -> list[Pick]:
    """Construct the full pick list with snake order if enabled."""
    picks: list[Pick] = []
    overall = 1
    base_order = list(league.draft_order) if league.draft_order else list(range(league.num_teams))
    for rnd in range(1, league.rounds + 1):
        order = list(base_order)
        if league.snake and rnd % 2 == 0:
            order = list(reversed(order))
        for pos, team_idx in enumerate(order, start=1):
            picks.append(
                Pick(
                    overall=overall,
                    round_num=rnd,
                    pick_in_round=pos,
                    team_idx=team_idx,
                )
            )
            overall += 1
    return picks
