"""Fetch season-long fantasy projections from Sleeper.

Sleeper exposes projections at api.sleeper.com (not api.sleeper.app — different
host). The payload includes per-player stat projections and pre-computed
fantasy points under three scoring systems (`pts_std`, `pts_ppr`, `pts_half_ppr`),
which makes plugging into any league trivial.

No auth needed. Cache to disk; refresh weekly is plenty for draft prep.
"""

from __future__ import annotations

import csv
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

from .players import Player


SLEEPER_PROJ_BASE = "https://api.sleeper.com/projections/nfl"

# Sleeper position list to request.
DEFAULT_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"]

# Scoring -> field name in Sleeper's stats payload.
SCORING_FIELDS = {
    "standard": "pts_std",
    "ppr": "pts_ppr",
    "half_ppr": "pts_half_ppr",
}


def fetch_sleeper_projections(
    season: int,
    positions: list[str] | None = None,
    cache_path: str | Path | None = "data/sleeper_projections.json",
    ttl_days: int = 7,
) -> list[dict]:
    """Fetch season-long projections; cached to disk for ttl_days."""
    positions = positions or DEFAULT_POSITIONS
    cache = Path(cache_path) if cache_path else None
    if cache and cache.exists() and (time.time() - cache.stat().st_mtime) < ttl_days * 86400:
        with open(cache) as f:
            return json.load(f)

    params = [("season_type", "regular"), ("order_by", "adp_half_ppr")]
    for pos in positions:
        params.append(("position[]", pos))
    url = f"{SLEEPER_PROJ_BASE}/{season}?{urllib.parse.urlencode(params)}"

    with urllib.request.urlopen(url, timeout=30) as resp:
        data = json.loads(resp.read())

    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        with open(cache, "w") as f:
            json.dump(data, f)
    return data


def projections_to_players(
    raw: list[dict],
    scoring: str = "half_ppr",
) -> list[Player]:
    """Convert a Sleeper projections payload into Player objects.

    The Sleeper payload nests player metadata inside each entry's `player`
    field, and projections in `stats`. ADP from the half-PPR ordering is
    also included where Sleeper has computed it.
    """
    if scoring not in SCORING_FIELDS:
        raise ValueError(f"scoring must be one of {list(SCORING_FIELDS)}")
    points_field = SCORING_FIELDS[scoring]
    adp_field = {
        "standard": "adp_std",
        "ppr": "adp_ppr",
        "half_ppr": "adp_half_ppr",
    }[scoring]

    out: list[Player] = []
    for i, row in enumerate(raw, start=1):
        meta = row.get("player") or {}
        stats = row.get("stats") or {}
        name = (meta.get("full_name")
                or f"{meta.get('first_name', '').strip()} {meta.get('last_name', '').strip()}".strip())
        if not name:
            continue
        position = (meta.get("position") or "").upper()
        team = (meta.get("team") or "").upper()
        # ADP - Sleeper often puts ADP in `stats` rather than top-level.
        adp = stats.get(adp_field) or row.get(adp_field) or 999.0
        try:
            adp = float(adp)
        except (TypeError, ValueError):
            adp = 999.0
        projection = float(stats.get(points_field) or 0.0)
        out.append(Player(
            name=name,
            position=position,
            team=team,
            adp=adp,
            projection=projection,
            bye=int(meta.get("bye_week") or 0),
            rank_overall=i,
        ))
    return out


def write_players_csv(players: list[Player], path: str | Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "name", "position", "team", "adp", "projection",
            "bye", "tier", "rank_overall", "rank_position",
        ])
        for p in players:
            writer.writerow([
                p.name, p.position, p.team, p.adp, p.projection,
                p.bye, p.tier, p.rank_overall, p.rank_position,
            ])


def load_projections_from_cache(
    cache_path: str | Path = "data/sleeper_projections.json",
    scoring: str = "half_ppr",
) -> list[Player]:
    with open(cache_path) as f:
        raw = json.load(f)
    return projections_to_players(raw, scoring=scoring)
