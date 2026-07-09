"""Maps team names across data sources (Yahoo, Sleeper, MONEY_LEAGUE.xlsx)
to a single canonical manager identity.

Source of truth: data/team_identity.json — edit that file to correct
mappings. This module just loads + exposes lookup helpers.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def load_identity(path: str | Path = "data/team_identity.json") -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def manager_for_sleeper_roster(roster_id: int) -> dict | None:
    """Return the manager record for a Sleeper roster_id, or None."""
    data = load_identity()
    for mid, rec in data["managers"].items():
        if rec.get("sleeper_roster_id") == roster_id:
            return {"id": mid, **rec}
    return None


def manager_for_yahoo_team(team_name: str, season: int) -> dict | None:
    """Find the manager who used `team_name` in Yahoo `season`."""
    data = load_identity()
    for mid, rec in data["managers"].items():
        if rec.get("yahoo_team_names", {}).get(str(season)) == team_name:
            return {"id": mid, **rec}
    return None


def manager_for_xlsx_nickname(nickname: str) -> dict | None:
    """Find the manager by xlsx nickname (e.g. 'Figgy', 'Lem')."""
    data = load_identity()
    nl = nickname.strip().lower()
    for mid, rec in data["managers"].items():
        for nick in rec.get("xlsx_nicknames", []):
            if nick.strip().lower() == nl:
                return {"id": mid, **rec}
    return None


def all_managers() -> list[dict]:
    data = load_identity()
    return [{"id": mid, **rec} for mid, rec in data["managers"].items()]
