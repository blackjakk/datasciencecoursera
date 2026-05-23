"""End-to-end import: pull a Sleeper league + history (and optionally merge
Yahoo CSVs for years that predate Sleeper), detect keepers, and write out a
ready-to-use league config + keepers JSON.

Usage:
    # Sleeper-only (most common case for a league that's been on Sleeper a while)
    python -m fantasy_draft.import_league \
        --sleeper-league-id 1234567890 \
        --players data/players_sample.csv \
        --out-league configs/my_league.json \
        --out-keepers configs/my_keepers.json

    # Sleeper + Yahoo historical CSVs (for a league that migrated)
    python -m fantasy_draft.import_league \
        --sleeper-league-id 1234567890 \
        --yahoo-csv data/yahoo_2021.csv data/yahoo_2022.csv \
        --players data/players_sample.csv \
        --out-league configs/my_league.json \
        --out-keepers configs/my_keepers.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .history import (
    HistoricalDraftPick,
    consolidate_years_kept,
    detect_keepers_by_adp,
    latest_season_keepers,
)
from .keepers import Keeper
from .league import LeagueConfig
from .players import load_players


def main() -> None:
    args = _parse_args()
    players = load_players(args.players)

    by_season: dict[int, list[HistoricalDraftPick]] = {}

    # --- Sleeper history (live or offline dump) ---------------------------
    if args.sleeper_dump:
        from .sleeper_offline import history_from_offline, league_from_offline
        print(f"Loading Sleeper dump from {args.sleeper_dump}...")
        config = league_from_offline(
            args.sleeper_dump,
            target_league_id=args.sleeper_league_id,
            round_penalty=args.round_penalty,
            max_years_consecutive=args.max_years_consecutive,
        )
        sleeper_hist = history_from_offline(args.sleeper_dump, max_seasons=args.seasons_back)
        for season, picks in sleeper_hist.items():
            by_season.setdefault(season, []).extend(picks)
    elif args.sleeper_league_id:
        from . import sleeper as sl  # local import: keeps urllib out of cold path
        print(f"Fetching Sleeper league {args.sleeper_league_id} and walking history...")
        league_payload = sl.fetch_league(args.sleeper_league_id)
        config = sl.league_config_from_sleeper(
            league_payload,
            round_penalty=args.round_penalty,
            max_years_consecutive=args.max_years_consecutive,
        )
        sleeper_hist = sl.fetch_history(args.sleeper_league_id, seasons_back=args.seasons_back)
        for season, picks in sleeper_hist.items():
            by_season.setdefault(season, []).extend(picks)
    else:
        config = _fallback_config(args)

    # --- Yahoo historical CSVs (for the migration-from era) ---------------
    if args.yahoo_csv:
        from .yahoo import import_draft_csv
        for path in args.yahoo_csv:
            picks = import_draft_csv(path)
            seasons_in_file = {p.season for p in picks}
            for s in seasons_in_file:
                by_season.setdefault(s, []).extend([p for p in picks if p.season == s])
            print(f"Loaded {len(picks)} picks from {path} (seasons: {sorted(seasons_in_file)})")

    # --- Keeper detection where the upstream didn't tag them --------------
    if args.detect_keepers:
        for season, picks in by_season.items():
            detect_keepers_by_adp(
                picks, players,
                num_teams=config.num_teams,
                round_threshold=args.keeper_round_threshold,
            )
            flagged = sum(1 for p in picks if p.is_keeper)
            print(f"Season {season}: {flagged} keepers detected/confirmed out of {len(picks)} picks")

    # --- Consolidate consecutive-years-kept across seasons ----------------
    consolidate_years_kept(by_season)

    # --- Generate Keepers list for the upcoming draft ---------------------
    target_season = max(by_season) if by_season else None
    keepers_for_next_year = _build_next_year_keepers(by_season, target_season, config)

    # --- Write outputs ----------------------------------------------------
    Path(args.out_league).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out_keepers).parent.mkdir(parents=True, exist_ok=True)
    _write_league(config, args.out_league)
    _write_keepers(keepers_for_next_year, args.out_keepers)
    print(f"\nWrote league config -> {args.out_league}")
    print(f"Wrote {len(keepers_for_next_year)} candidate keepers -> {args.out_keepers}")
    print("\nReview the keepers file (drop any the team won't actually keep), then run:")
    print(f"  python -m fantasy_draft.cli --league {args.out_league} "
          f"--players {args.players} --keepers {args.out_keepers} --my-team N")


def _build_next_year_keepers(
    by_season: dict[int, list[HistoricalDraftPick]],
    target_season: int | None,
    config: LeagueConfig,
) -> list[dict]:
    """Translate last year's keeper picks into Keeper records for this year.

    Output is JSON-friendly dicts because we need a stable team_idx mapping
    when names differ; we pass through team_id + team_name and a placeholder
    team_idx the user can fix up.
    """
    if target_season is None:
        return []
    last_year_picks = latest_season_keepers(by_season, target_season)
    # team_id ordering becomes team_idx (0..N-1), stable across files.
    team_ids_in_order = sorted({p.team_id for picks in by_season.values() for p in picks})
    team_idx_of: dict[str, int] = {tid: i for i, tid in enumerate(team_ids_in_order)}

    out: list[dict] = []
    cap = config.keepers.max_years_consecutive or 99
    for p in last_year_picks:
        if p.years_kept >= cap:
            continue  # already at the cap, can't be kept again
        out.append({
            "team_idx": team_idx_of.get(p.team_id, 0),
            "team_id": p.team_id,
            "team_name": p.team_name,
            "player_name": p.player_name,
            "position": p.player_position,
            "prior_round": p.round_num,    # what they cost last year
            "years_kept": p.years_kept,
            "source_season": p.season,
        })
    out.sort(key=lambda r: (r["team_idx"], r["prior_round"]))
    return out


def _fallback_config(args) -> LeagueConfig:
    """When no Sleeper league_id, default to the superflex config baked in."""
    from .league import standard_superflex_12
    cfg = standard_superflex_12()
    cfg.keepers.enabled = True
    cfg.keepers.max_keepers_per_team = 4
    cfg.keepers.round_penalty = args.round_penalty
    cfg.keepers.max_years_consecutive = args.max_years_consecutive
    return cfg


def _write_league(cfg: LeagueConfig, path: str) -> None:
    data = {
        "name": cfg.name,
        "num_teams": cfg.num_teams,
        "rounds": cfg.rounds,
        "snake": cfg.snake,
        "roster": [{"name": s.name, "count": s.count} for s in cfg.roster],
        "scoring": cfg.scoring.__dict__,
        "keepers": cfg.keepers.__dict__,
    }
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def _write_keepers(keepers: list[dict], path: str) -> None:
    with open(path, "w") as f:
        json.dump(keepers, f, indent=2)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Import league + keepers from Sleeper (and/or Yahoo CSVs)")
    p.add_argument("--sleeper-league-id", help="numeric Sleeper league ID")
    p.add_argument("--sleeper-dump", help="path to a local Sleeper dump dir (data/sleeper). "
                                          "Use this when the running env can't reach api.sleeper.app.")
    p.add_argument("--yahoo-csv", nargs="*", default=[],
                   help="one or more Yahoo draft CSVs (older seasons before Sleeper migration)")
    p.add_argument("--players", required=True, help="players CSV with ADP (used for keeper detection)")
    p.add_argument("--out-league", default="configs/imported_league.json")
    p.add_argument("--out-keepers", default="configs/imported_keepers.json")
    p.add_argument("--seasons-back", type=int, default=4,
                   help="how many Sleeper seasons to walk backward")
    p.add_argument("--round-penalty", type=int, default=2,
                   help="rounds higher you give up vs. last year's cost")
    p.add_argument("--max-years-consecutive", type=int, default=3,
                   help="how many years in a row a player can be kept by the same team")
    p.add_argument("--keeper-round-threshold", type=float, default=1.5,
                   help="how many rounds later than ADP a pick must be to flag as a keeper")
    p.add_argument("--no-detect-keepers", dest="detect_keepers", action="store_false",
                   help="skip ADP-anomaly keeper detection (trust upstream flags only)")
    p.set_defaults(detect_keepers=True)
    return p.parse_args()


if __name__ == "__main__":
    main()
