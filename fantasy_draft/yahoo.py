"""Yahoo league/draft import.

Yahoo's Fantasy Sports API requires OAuth 2.0, which means registering an app
at https://developer.yahoo.com and storing a refresh token. Two import paths:

1. CSV import (no auth, works offline):
   Export your Yahoo draft results to CSV with these columns:
     season, overall_pick, round, pick_in_round, team_id, team_name,
     player_name, position, is_keeper (optional: 0 or 1)
   Then call `import_draft_csv(path)`.

2. OAuth via the `yahoo_oauth` library (if installed):
   - Create an app at https://developer.yahoo.com/apps/create/ (set permission
     to Fantasy Sports: Read).
   - Save credentials as JSON: {"consumer_key": "...", "consumer_secret": "..."}
   - First call opens a browser to authorize; refresh token is cached.
   Call `fetch_league_history(league_key, oauth_credentials_path, seasons_back)`.

Yahoo league keys look like '423.l.12345' for season 2023.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

from .history import HistoricalDraftPick


_REQUIRED_CSV_COLS = {"season", "overall_pick", "round", "pick_in_round",
                       "team_id", "team_name", "player_name", "position"}


def import_draft_csv(path: str | Path, source: str = "yahoo_csv") -> list[HistoricalDraftPick]:
    """Load a draft from a CSV file. See module docstring for columns."""
    path = Path(path)
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        missing = _REQUIRED_CSV_COLS - set(reader.fieldnames or [])
        if missing:
            raise ValueError(
                f"{path}: missing required columns {sorted(missing)}. "
                f"Got: {reader.fieldnames}"
            )
        picks: list[HistoricalDraftPick] = []
        for row in reader:
            raw_keeper = row.get("is_keeper", "").strip()
            if raw_keeper in ("1", "true", "True", "TRUE", "yes", "Y"):
                is_keeper: bool | None = True
            elif raw_keeper in ("0", "false", "False", "FALSE", "no", "N"):
                is_keeper = False
            else:
                is_keeper = None
            picks.append(
                HistoricalDraftPick(
                    season=int(row["season"]),
                    overall_pick=int(row["overall_pick"]),
                    round_num=int(row["round"]),
                    pick_in_round=int(row["pick_in_round"]),
                    team_id=row["team_id"].strip(),
                    team_name=row["team_name"].strip(),
                    player_name=row["player_name"].strip(),
                    player_position=row["position"].strip().upper(),
                    is_keeper=is_keeper,
                    source=source,
                )
            )
    return picks


# ---------------------------------------------------------------------------
# Optional OAuth path. Only imports yahoo_oauth lazily so the rest of the
# package works without it installed.
# ---------------------------------------------------------------------------


@dataclass
class YahooSession:
    league_key: str  # e.g. "423.l.12345"
    creds_path: str  # path to yahoo_oauth JSON credentials


def _require_yahoo_oauth():
    try:
        from yahoo_oauth import OAuth2  # type: ignore
        return OAuth2
    except ImportError as e:
        raise ImportError(
            "Yahoo live API path needs 'yahoo_oauth' installed: pip install yahoo_oauth.\n"
            "Or use the CSV import path (import_draft_csv) instead."
        ) from e


def _yahoo_get(session, url: str) -> dict:
    if not session.token_is_valid():
        session.refresh_access_token()
    resp = session.session.get(url, params={"format": "json"})
    resp.raise_for_status()
    return resp.json()


def fetch_league_history(
    league_key: str,
    creds_path: str,
    seasons_back: int = 4,
) -> dict[int, list[HistoricalDraftPick]]:
    """Walk Yahoo league history backward through `renew` links.

    Yahoo includes `renew` (old league key) and `past_seasons` info on the
    league resource. We follow `renew` to step back one season at a time.
    """
    OAuth2 = _require_yahoo_oauth()
    sess = OAuth2(None, None, from_file=creds_path)

    by_season: dict[int, list[HistoricalDraftPick]] = {}
    current_key = league_key
    seen: set[str] = set()
    while current_key and current_key not in seen and len(by_season) < seasons_back:
        seen.add(current_key)
        league_data = _yahoo_get(
            sess,
            f"https://fantasysports.yahooapis.com/fantasy/v2/league/{current_key}"
            f";out=settings,teams,draftresults",
        )
        season, picks = _parse_yahoo_league(league_data, current_key)
        if picks:
            by_season[season] = picks
        # `renew` field points to the previous season's league key.
        renew = _extract_renew(league_data)
        current_key = renew
    return by_season


def _parse_yahoo_league(payload: dict, league_key: str) -> tuple[int, list[HistoricalDraftPick]]:
    """Parse Yahoo's deeply-nested JSON into HistoricalDraftPick list."""
    # Yahoo's JSON is annoyingly array-of-mixed-types. We walk defensively.
    fantasy_content = payload.get("fantasy_content", {})
    league_block = fantasy_content.get("league", [])
    settings = {}
    teams: dict[str, str] = {}     # team_id -> team_name
    draft_picks_raw: list[dict] = []
    season = 0
    if isinstance(league_block, list):
        for entry in league_block:
            if isinstance(entry, dict):
                if "season" in entry:
                    season = int(entry["season"])
                if "settings" in entry:
                    settings = entry["settings"]
                if "teams" in entry:
                    teams = _parse_yahoo_teams(entry["teams"])
                if "draft_results" in entry:
                    draft_picks_raw = _parse_yahoo_draft_results(entry["draft_results"])
    picks: list[HistoricalDraftPick] = []
    num_teams = max(len(teams), 1)
    for dp in draft_picks_raw:
        overall = int(dp.get("pick", 0))
        rnd = int(dp.get("round", 0)) or ((overall - 1) // num_teams + 1)
        slot_in_round = ((overall - 1) % num_teams) + 1
        team_id = str(dp.get("team_key", ""))
        picks.append(
            HistoricalDraftPick(
                season=season,
                overall_pick=overall,
                round_num=rnd,
                pick_in_round=slot_in_round,
                team_id=team_id,
                team_name=teams.get(team_id, team_id),
                player_name=dp.get("player_name", ""),
                player_position=dp.get("player_position", "").upper(),
                is_keeper=_yahoo_keeper_flag(dp),
                source="yahoo",
                raw=dp,
            )
        )
    return season, picks


def _parse_yahoo_teams(teams_block) -> dict[str, str]:
    out: dict[str, str] = {}
    if not isinstance(teams_block, dict):
        return out
    for k, v in teams_block.items():
        if not k.isdigit():
            continue
        team = v.get("team")
        # team is usually a list-of-dicts; find team_key and name fields
        team_key = None
        name = None
        if isinstance(team, list):
            for item in team:
                if isinstance(item, dict):
                    if "team_key" in item:
                        team_key = item["team_key"]
                    if "name" in item:
                        name = item["name"]
                elif isinstance(item, list):
                    for sub in item:
                        if isinstance(sub, dict):
                            if "team_key" in sub:
                                team_key = sub["team_key"]
                            if "name" in sub:
                                name = sub["name"]
        if team_key and name:
            out[team_key] = name
    return out


def _parse_yahoo_draft_results(block) -> list[dict]:
    picks: list[dict] = []
    if not isinstance(block, dict):
        return picks
    for k, v in block.items():
        if not k.isdigit():
            continue
        dr = v.get("draft_result")
        if isinstance(dr, dict):
            picks.append(dr)
    return picks


def _yahoo_keeper_flag(dp: dict) -> bool | None:
    raw = dp.get("is_keeper")
    if raw in (True, "1", 1):
        return True
    if raw in (False, "0", 0):
        return False
    return None


def _extract_renew(payload: dict) -> str | None:
    fc = payload.get("fantasy_content", {})
    league = fc.get("league", [])
    if isinstance(league, list):
        for entry in league:
            if isinstance(entry, dict) and "renew" in entry:
                renew = entry["renew"]
                if isinstance(renew, str) and "_" in renew:
                    # Yahoo format: "{game_id}_{league_id}". Convert to standard key.
                    game_id, league_id = renew.split("_", 1)
                    return f"{game_id}.l.{league_id}"
                return renew or None
    return None
