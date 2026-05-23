"""Interactive mock draft CLI.

Usage:
    python -m fantasy_draft.cli --league configs/superflex_12.json \
                                --players data/players_sample.csv \
                                --keepers configs/keepers_example.json \
                                --my-team 3 --auto
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .draft import Draft
from .keepers import Keeper, apply_keepers
from .league import LeagueConfig
from .players import Player, load_players
from .predict import predict_pick, score_candidates


def main() -> None:
    args = _parse_args()
    league = LeagueConfig.load(args.league)
    players = load_players(args.players)

    team_names = _load_team_names(args.team_names, league.num_teams)
    draft = Draft.new(league, team_names=team_names)

    if args.keepers:
        keepers = _load_keepers(args.keepers)
        for line in apply_keepers(draft, players, keepers):
            print(line)
        print()

    _print_header(league, draft, args.my_team)
    _run_draft(draft, players, my_team_idx=args.my_team, auto=args.auto, top_n=args.top_n)
    print("\n=== DRAFT COMPLETE ===")
    print(draft.summary())


def _run_draft(draft: Draft, players: list[Player], my_team_idx: int | None, auto: bool, top_n: int) -> None:
    while True:
        pick = draft.on_the_clock
        if pick is None:
            return

        # Keeper picks are pre-assigned; just advance.
        if pick.is_keeper and pick.player is not None:
            print(f"R{pick.round_num}.{pick.pick_in_round} ({pick.overall:>3}) "
                  f"{draft.teams[pick.team_idx].name}: KEEPER {pick.player}")
            draft.cursor += 1
            continue

        team = draft.teams[pick.team_idx]
        available = draft.available(players)
        ranked = score_candidates(draft, available, pick.team_idx, pick.overall, top_n=top_n)

        is_my_pick = (my_team_idx is not None and pick.team_idx == my_team_idx)

        if is_my_pick and not auto:
            _show_my_options(pick, team, ranked)
            chosen = _prompt_human_pick(available)
            if chosen is None:
                print("Exiting draft early.")
                return
            draft.make_pick(chosen)
        else:
            best = ranked[0] if ranked else None
            if best is None:
                print(f"R{pick.round_num}.{pick.pick_in_round}: no candidates available, skipping.")
                draft.cursor += 1
                continue
            draft.make_pick(best.player)
            tag = " (YOU - auto)" if is_my_pick else ""
            print(
                f"R{pick.round_num}.{pick.pick_in_round} ({pick.overall:>3}) "
                f"{team.name}{tag}: {best.player}  "
                f"[score={best.score:.2f}, {best.reason}]"
            )


def _show_my_options(pick, team, ranked) -> None:
    print(f"\n----- YOUR PICK: R{pick.round_num}.{pick.pick_in_round} (overall {pick.overall}) -----")
    print(f"Roster so far: {[str(p) for p in team.roster]}")
    print("Top suggestions:")
    for i, c in enumerate(ranked, start=1):
        print(
            f"  {i:>2}. {c.player}  ADP={c.player.adp:>5.1f}  "
            f"proj={c.player.projection:>5.1f}  "
            f"score={c.score:.2f}  ({c.reason})"
        )


def _prompt_human_pick(available: list[Player]) -> Player | None:
    """Accept either a top-N suggestion number, a player name substring, or 'q'."""
    by_name = {p.name.lower(): p for p in available}
    while True:
        raw = input("Pick (name or number, 'q' to quit, 'list QB' to filter): ").strip()
        if not raw:
            continue
        if raw.lower() in {"q", "quit", "exit"}:
            return None
        if raw.lower().startswith("list "):
            pos = raw.split(None, 1)[1].upper()
            matches = [p for p in available if p.position == pos][:25]
            for p in matches:
                print(f"  {p}  ADP={p.adp:.1f}  proj={p.projection:.1f}")
            continue
        # Exact match preferred, else first substring match.
        if raw.lower() in by_name:
            return by_name[raw.lower()]
        matches = [p for p in available if raw.lower() in p.name.lower()]
        if len(matches) == 1:
            return matches[0]
        if not matches:
            print(f"  no available player matches '{raw}'")
            continue
        print(f"  ambiguous: {[p.name for p in matches[:8]]}")


def _print_header(league: LeagueConfig, draft: Draft, my_team_idx: int | None) -> None:
    print(f"League: {league.name}  |  {league.num_teams} teams  |  {league.rounds} rounds  "
          f"|  snake={league.snake}")
    print(f"Roster: " + ", ".join(f"{s.count}{s.name}" for s in league.roster))
    if league.keepers.enabled:
        k = league.keepers
        print(f"Keepers: max {k.max_keepers_per_team}/team, penalty {k.round_penalty} rounds")
    if my_team_idx is not None:
        print(f"You are: {draft.teams[my_team_idx].name} (idx {my_team_idx})")
    print()


def _load_team_names(path: str | None, num_teams: int) -> list[str] | None:
    if path is None:
        return None
    with open(path) as f:
        names = [line.strip() for line in f if line.strip()]
    if len(names) != num_teams:
        raise ValueError(f"team names file has {len(names)} entries, league expects {num_teams}")
    return names


def _load_keepers(path: str | Path) -> list[Keeper]:
    with open(path) as f:
        raw = json.load(f)
    return [
        Keeper(
            team_idx=int(k["team_idx"]),
            player_name=k["player_name"],
            prior_round=(int(k["prior_round"]) if k.get("prior_round") is not None else None),
        )
        for k in raw
    ]


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fantasy football mock draft tool")
    p.add_argument("--league", required=True, help="path to league config JSON")
    p.add_argument("--players", required=True, help="path to players CSV")
    p.add_argument("--keepers", help="optional keepers JSON")
    p.add_argument("--team-names", help="optional newline-separated team names file")
    p.add_argument("--my-team", type=int, default=None,
                   help="0-indexed team slot you're drafting for (you'll be prompted on your picks)")
    p.add_argument("--auto", action="store_true", help="auto-draft every team, including yours")
    p.add_argument("--top-n", type=int, default=10, help="how many suggestions to show on your pick")
    return p.parse_args()


if __name__ == "__main__":
    main()
