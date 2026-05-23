"""Sleeper API client: pull league config, draft picks, and walk season history.

Sleeper's public REST API requires no authentication. Endpoints used:
  /league/{id}                   - roster_positions, settings, previous_league_id
  /league/{id}/drafts            - all drafts for a season
  /draft/{id}                    - draft metadata (incl. settings.rounds)
  /draft/{id}/picks              - all picks (incl. is_keeper flag if used)
  /league/{id}/users             - team owners
  /league/{id}/rosters           - roster_id -> owner_id
  /players/nfl                   - full player catalog (~5MB, cached on disk)
"""

from __future__ import annotations

import json
import os
import time
import urllib.request
from pathlib import Path

from .history import HistoricalDraftPick
from .league import KeeperRules, LeagueConfig, RosterSlot


SLEEPER_BASE = "https://api.sleeper.app/v1"

# Sleeper roster_position name -> our SLOT_ELIGIBILITY name.
SLOT_MAP = {
    "QB": "QB",
    "RB": "RB",
    "WR": "WR",
    "TE": "TE",
    "K": "K",
    "DEF": "DEF",
    "FLEX": "FLEX",
    "SUPER_FLEX": "SUPERFLEX",
    "REC_FLEX": "WR_TE_FLEX",
    "WRRB_FLEX": "WR_RB_FLEX",
    "WRRB_WT_FLEX": "FLEX",
    "BN": "BENCH",
    "IDP_FLEX": "IDP_FLEX",
    "DL": "DL",
    "LB": "LB",
    "DB": "DB",
}


def _get(path: str) -> dict | list:
    url = f"{SLEEPER_BASE}{path}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read())


def fetch_league(league_id: str) -> dict:
    return _get(f"/league/{league_id}")


def fetch_drafts_for_league(league_id: str) -> list[dict]:
    return _get(f"/league/{league_id}/drafts")  # type: ignore[return-value]


def fetch_draft(draft_id: str) -> dict:
    return _get(f"/draft/{draft_id}")


def fetch_draft_picks(draft_id: str) -> list[dict]:
    return _get(f"/draft/{draft_id}/picks")  # type: ignore[return-value]


def fetch_users(league_id: str) -> list[dict]:
    return _get(f"/league/{league_id}/users")  # type: ignore[return-value]


def fetch_rosters(league_id: str) -> list[dict]:
    return _get(f"/league/{league_id}/rosters")  # type: ignore[return-value]


def fetch_players_dump(cache_path: str | Path = "data/sleeper_players.json", ttl_days: int = 7) -> dict:
    """Sleeper's full NFL player catalog. ~5MB; cache locally."""
    path = Path(cache_path)
    if path.exists() and (time.time() - path.stat().st_mtime) < ttl_days * 86400:
        with open(path) as f:
            return json.load(f)
    data = _get("/players/nfl")
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f)
    return data


def league_config_from_sleeper(
    league: dict,
    round_penalty: int = 2,
    max_years_consecutive: int = 3,
) -> LeagueConfig:
    """Translate a Sleeper league payload into our LeagueConfig."""
    positions: list[str] = league.get("roster_positions", [])
    settings = league.get("settings", {})

    slot_counts: dict[str, int] = {}
    for raw in positions:
        mapped = SLOT_MAP.get(raw)
        if mapped is None:
            continue
        slot_counts[mapped] = slot_counts.get(mapped, 0) + 1
    # Preserve a sensible display order.
    order = ["QB", "RB", "WR", "TE", "FLEX", "WR_RB_FLEX", "WR_TE_FLEX",
             "SUPERFLEX", "K", "DEF", "IDP_FLEX", "DL", "LB", "DB", "BENCH"]
    roster = [RosterSlot(name=n, count=slot_counts[n]) for n in order if n in slot_counts]

    scoring_settings = league.get("scoring_settings", {}) or {}
    from .league import ScoringRules
    scoring = ScoringRules(
        passing_yards=scoring_settings.get("pass_yd", 0.04),
        passing_td=scoring_settings.get("pass_td", 4.0),
        interception=scoring_settings.get("pass_int", -2.0),
        rushing_yards=scoring_settings.get("rush_yd", 0.1),
        rushing_td=scoring_settings.get("rush_td", 6.0),
        receiving_yards=scoring_settings.get("rec_yd", 0.1),
        receiving_td=scoring_settings.get("rec_td", 6.0),
        reception=scoring_settings.get("rec", 0.0),
        fumble_lost=scoring_settings.get("fum_lost", -2.0),
    )

    max_keepers = int(settings.get("max_keepers", 0) or 0)
    # `settings.draft_rounds` in Sleeper is sometimes a startup/rookie draft
    # length (MONEYLEAGUE has draft_rounds=3 but actually drafts a full 17-round
    # roster). The reliable signal is the roster size itself.
    total_roster = sum(slot.count for slot in roster) or int(settings.get("draft_rounds", 15))
    keepers = KeeperRules(
        enabled=max_keepers > 0,
        max_keepers_per_team=max_keepers,
        round_penalty=round_penalty,
        # Waiver/undrafted players: treated as a last-round pick per user rule.
        undrafted_keeper_round=total_roster,
        max_years_consecutive=max_years_consecutive,
    )

    num_teams = int(settings.get("num_teams") or len([p for p in positions if p != "TAXI"]) or 12)

    return LeagueConfig(
        name=league.get("name", "Sleeper League"),
        num_teams=num_teams,
        rounds=total_roster,
        snake=True,
        roster=roster,
        scoring=scoring,
        keepers=keepers,
    )


def walk_season_history(league_id: str, max_seasons: int = 10) -> list[dict]:
    """Walk previous_league_id back through years. Returns leagues newest-first."""
    history: list[dict] = []
    current_id = league_id
    seen: set[str] = set()
    while current_id and current_id not in seen and len(history) < max_seasons:
        seen.add(current_id)
        league = fetch_league(current_id)
        history.append(league)
        current_id = league.get("previous_league_id")
        if not current_id or current_id == "0":
            break
    return history


def picks_for_draft(
    draft_id: str,
    season: int,
    team_lookup: dict[str, str],
    player_lookup: dict[str, dict],
) -> list[HistoricalDraftPick]:
    """Fetch and normalize draft picks into HistoricalDraftPick objects."""
    raw_picks = fetch_draft_picks(draft_id)
    out: list[HistoricalDraftPick] = []
    for p in raw_picks:
        pid = str(p.get("player_id") or "")
        meta = p.get("metadata") or {}
        player_name = (
            f"{meta.get('first_name', '').strip()} {meta.get('last_name', '').strip()}".strip()
            or player_lookup.get(pid, {}).get("full_name")
            or pid
        )
        position = meta.get("position") or player_lookup.get(pid, {}).get("position") or "?"
        # Sleeper stores is_keeper as None / "0" / "1" / True / False depending on era.
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
                player_position=position.upper(),
                is_keeper=is_keeper,
                source="sleeper",
                raw=p,
            )
        )
    return out


def team_name_lookup(league_id: str) -> dict[str, str]:
    """roster_id -> team display name (falls back to owner username)."""
    rosters = fetch_rosters(league_id)
    users = {u["user_id"]: u for u in fetch_users(league_id)}
    out: dict[str, str] = {}
    for r in rosters:
        roster_id = str(r["roster_id"])
        owner = users.get(r.get("owner_id") or "", {})
        meta = owner.get("metadata") or {}
        name = meta.get("team_name") or owner.get("display_name") or f"Roster {roster_id}"
        out[roster_id] = name
    return out


def fetch_history(
    league_id: str,
    seasons_back: int = 4,
    players_cache: str | Path = "data/sleeper_players.json",
) -> dict[int, list[HistoricalDraftPick]]:
    """End-to-end: pull this league's draft + previous seasons' drafts.

    Returns {season: [HistoricalDraftPick, ...]}.
    """
    leagues = walk_season_history(league_id, max_seasons=seasons_back)
    player_lookup = fetch_players_dump(players_cache)
    by_season: dict[int, list[HistoricalDraftPick]] = {}
    for league in leagues:
        season = int(league.get("season", 0))
        team_lookup = team_name_lookup(league["league_id"])
        drafts = fetch_drafts_for_league(league["league_id"])
        for draft in drafts:
            if draft.get("status") in ("complete", "completed", "drafting"):
                picks = picks_for_draft(
                    draft["draft_id"], season, team_lookup, player_lookup
                )
                by_season.setdefault(season, []).extend(picks)
    return by_season
