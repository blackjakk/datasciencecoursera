"""Offline Sleeper loader: reads a directory dumped by scripts/fetch_sleeper.sh.

Mirrors fantasy_draft.sleeper but reads from disk instead of the live API.
Use this when the running environment can't reach api.sleeper.app.
"""

from __future__ import annotations

import json
from pathlib import Path

from .history import HistoricalDraftPick
from .league import LeagueConfig
from .sleeper import league_config_from_sleeper, picks_for_draft


def load_players_dump(root: str | Path) -> dict:
    """Sleeper's full NFL player catalog from the local dump."""
    path = Path(root) / "players_nfl.json"
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _read(path: Path) -> dict | list:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _season_dirs(root: Path) -> list[Path]:
    return sorted([p for p in root.iterdir() if p.is_dir() and p.name.startswith("league_")])


def league_from_offline(root: str | Path, target_league_id: str | None = None,
                        round_penalty: int = 2,
                        max_years_consecutive: int = 3) -> LeagueConfig:
    """Build a LeagueConfig from the most recent (or specified) league JSON."""
    root = Path(root)
    if target_league_id:
        league_path = root / f"league_{target_league_id}" / "league.json"
    else:
        # Most recent = highest season among dumped leagues.
        candidates = []
        for d in _season_dirs(root):
            lp = d / "league.json"
            if lp.exists():
                data = _read(lp)
                candidates.append((int(data.get("season", 0) or 0), lp))
        if not candidates:
            raise FileNotFoundError(f"No league_*/league.json files under {root}")
        candidates.sort()
        league_path = candidates[-1][1]
    league = _read(league_path)
    return league_config_from_sleeper(league, round_penalty=round_penalty,
                                      max_years_consecutive=max_years_consecutive)


def current_rosters_from_offline(
    root: str | Path,
    league_id: str | None = None,
) -> dict[str, list[tuple[str, str]]]:
    """team_id -> [(player_name, position), ...] for the requested season.

    If league_id is None, use the most-recent dumped league.
    """
    root = Path(root)
    chosen = None
    chosen_season = -1
    for d in _season_dirs(root):
        league_path = d / "league.json"
        if not league_path.exists():
            continue
        with open(league_path, encoding="utf-8") as f:
            data = json.load(f)
        if league_id and data.get("league_id") != league_id:
            continue
        s = int(data.get("season", 0) or 0)
        if league_id is not None or s > chosen_season:
            chosen = d
            chosen_season = s
            if league_id is not None:
                break
    if chosen is None:
        return {}

    rosters = _read(chosen / "rosters.json")
    player_lookup = load_players_dump(root)
    out: dict[str, list[tuple[str, str]]] = {}
    for r in rosters:  # type: ignore[union-attr]
        team_id = str(r["roster_id"])
        roster: list[tuple[str, str]] = []
        for pid in (r.get("players") or []):
            meta = player_lookup.get(str(pid)) or {}
            name = meta.get("full_name") or f"{meta.get('first_name', '')} {meta.get('last_name', '')}".strip()
            pos = (meta.get("position") or "").upper()
            if name:
                roster.append((name, pos))
        out[team_id] = roster
    return out


def traded_away_rounds_from_offline(
    root: str | Path,
    season: int | None = None,
) -> dict[str, set[int]]:
    """team_id -> {round_num, ...} that the team has traded away this season."""
    from .trades import load_trades_from_sleeper_dump
    trades = load_trades_from_sleeper_dump(root, season=season)
    out: dict[str, set[int]] = {}
    for t in trades:
        if t.original_team_idx == t.new_team_idx:
            continue
        team_id = str(t.original_team_idx + 1)
        out.setdefault(team_id, set()).add(t.round_num)
    return out


def history_from_offline(
    root: str | Path,
    max_seasons: int = 5,
) -> dict[int, list[HistoricalDraftPick]]:
    """Build {season: [HistoricalDraftPick]} from a dump directory."""
    root = Path(root)
    player_lookup = load_players_dump(root)

    by_season: dict[int, list[HistoricalDraftPick]] = {}
    for season_dir in _season_dirs(root):
        league = _read(season_dir / "league.json")
        season = int(league.get("season", 0) or 0)
        # Build team_id -> name lookup.
        users = {u["user_id"]: u for u in _read(season_dir / "users.json")}  # type: ignore[index]
        rosters = _read(season_dir / "rosters.json")
        team_lookup: dict[str, str] = {}
        for r in rosters:  # type: ignore[union-attr]
            roster_id = str(r["roster_id"])
            owner = users.get(r.get("owner_id") or "", {})
            meta = owner.get("metadata") or {}
            team_lookup[roster_id] = (
                meta.get("team_name") or owner.get("display_name") or f"Roster {roster_id}"
            )

        # Iterate draft files.
        for pick_file in sorted(season_dir.glob("draft_*_picks.json")):
            picks_raw = _read(pick_file)
            # picks_for_draft expects to call fetch_draft_picks; emulate by
            # injecting via a local helper instead.
            from .sleeper import picks_for_draft  # noqa: F401 (re-import for clarity)
            picks = _picks_from_raw(picks_raw, season, team_lookup, player_lookup)  # type: ignore[arg-type]
            by_season.setdefault(season, []).extend(picks)

    # Truncate to most-recent max_seasons.
    if len(by_season) > max_seasons:
        keep = sorted(by_season.keys())[-max_seasons:]
        by_season = {s: by_season[s] for s in keep}
    return by_season


def _picks_from_raw(raw_picks: list, season: int, team_lookup: dict[str, str],
                    player_lookup: dict) -> list[HistoricalDraftPick]:
    """Same shape as sleeper.picks_for_draft but on already-fetched JSON."""
    out: list[HistoricalDraftPick] = []
    for p in raw_picks:
        pid = str(p.get("player_id") or "")
        meta = p.get("metadata") or {}
        player_name = (
            f"{meta.get('first_name', '').strip()} {meta.get('last_name', '').strip()}".strip()
            or (player_lookup.get(pid) or {}).get("full_name")
            or pid
        )
        position = meta.get("position") or (player_lookup.get(pid) or {}).get("position") or "?"
        raw_keeper = p.get("is_keeper")
        if raw_keeper in (True, "1", 1):
            is_keeper: bool | None = True
        elif raw_keeper in (False, "0", 0):
            is_keeper = False
        else:
            is_keeper = None
        roster_id = str(p.get("roster_id") or "")
        out.append(
            HistoricalDraftPick(
                season=season,
                overall_pick=int(p.get("pick_no", 0)),
                round_num=int(p.get("round", 0)),
                pick_in_round=int(p.get("draft_slot", 0)),
                team_id=roster_id,
                team_name=team_lookup.get(roster_id, f"Roster {roster_id}"),
                player_name=player_name,
                player_position=str(position).upper(),
                is_keeper=is_keeper,
                source="sleeper-offline",
                raw=p,
            )
        )
    return out
