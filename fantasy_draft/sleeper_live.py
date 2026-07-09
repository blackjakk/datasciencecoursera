"""Live Sleeper draft sync.

During a live Sleeper draft, GET /draft/<id>/picks returns the picks
made so far, updated in real-time. We poll that endpoint and stamp any
new picks onto the local Draft object so VBD, recommendations, and
availability forecasts stay in sync with the actual draft board.

The 2026 MONEYLEAGUE draft endpoint:
  league_id 1364055104709230592 -> draft_id 1364055104721788928

Usage:
    from fantasy_draft.sleeper_live import fetch_draft_picks, sync_draft_from_sleeper

    picks = fetch_draft_picks("1364055104721788928")
    n_new = sync_draft_from_sleeper(draft, players, picks)
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass

from .draft import Draft
from .players import Player


SLEEPER_API = "https://api.sleeper.app/v1"
DEFAULT_TIMEOUT = 10


@dataclass
class LivePick:
    overall: int
    round_num: int
    pick_in_round: int      # 1-indexed within the round
    roster_id: int          # Sleeper's stable team id
    player_id: str          # Sleeper player_id
    player_name: str        # "First Last"
    position: str
    is_keeper: bool


def fetch_draft_picks(draft_id: str, timeout: int = DEFAULT_TIMEOUT) -> list[LivePick]:
    """GET /draft/{id}/picks and normalize the payload.

    Raises urllib.error.HTTPError on network/HTTP issues. Returns [] if
    the draft has no picks yet (pre-draft).
    """
    url = f"{SLEEPER_API}/draft/{draft_id}/picks"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = json.loads(r.read())
    out: list[LivePick] = []
    for p in raw:
        meta = p.get("metadata") or {}
        out.append(LivePick(
            overall=int(p.get("pick_no") or 0),
            round_num=int(p.get("round") or 0),
            pick_in_round=int(p.get("draft_slot") or 0),
            roster_id=int(p.get("roster_id") or 0),
            player_id=str(p.get("player_id") or ""),
            player_name=f"{meta.get('first_name','').strip()} {meta.get('last_name','').strip()}".strip(),
            position=(meta.get("position") or "").upper(),
            is_keeper=bool(p.get("is_keeper")),
        ))
    out.sort(key=lambda p: p.overall)
    return out


def find_2026_draft(league_id: str, timeout: int = DEFAULT_TIMEOUT) -> str | None:
    """Return the draft_id for the 2026 league, or None if it doesn't exist yet."""
    url = f"{SLEEPER_API}/league/{league_id}/drafts"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            drafts = json.loads(r.read())
    except urllib.error.HTTPError:
        return None
    if not drafts:
        return None
    return str(drafts[0].get("draft_id") or "")


def _normalize(name: str) -> str:
    return (name.lower().replace(".", "").replace("'", "").replace("-", " ")
            .replace("  ", " ").strip())


def sync_draft_from_sleeper(
    draft: Draft,
    players: list[Player],
    live_picks: list[LivePick],
) -> tuple[int, list[str]]:
    """Apply any Sleeper picks not yet on the local board, in overall order.

    Skips picks already placed (matched by overall pick number). Reports
    name-match failures as log lines without aborting the sync. Returns
    (new_picks_applied, log_lines).
    """
    by_name = {_normalize(p.name): p for p in players}
    # Build set of already-applied pick overall numbers from the local board.
    applied_overalls = {pick.overall for pick in draft.picks
                        if pick.player is not None and pick.cursor_passed if False}
    # Simpler: any pick on the local board with a player set is "done".
    done_overalls = {p.overall for p in draft.picks if p.player is not None}

    new_count = 0
    log: list[str] = []
    for live in live_picks:
        if live.overall in done_overalls:
            continue
        # Find the corresponding local Pick by overall number.
        target = next((p for p in draft.picks if p.overall == live.overall), None)
        if target is None:
            log.append(f"WARN: live overall {live.overall} has no local pick slot "
                       f"(draft only has {len(draft.picks)} picks)")
            continue
        # Try to match the player.
        local = by_name.get(_normalize(live.player_name))
        if local is None:
            # Try last name + position fallback for cases like rookies missing
            # from the projections file.
            log.append(f"MISS R{live.round_num}.{live.pick_in_round} "
                       f"overall {live.overall}: '{live.player_name}' "
                       f"({live.position}) not in player pool")
            continue
        target.player = local
        target.is_keeper = live.is_keeper
        # Drop the player from any team's available pool by assigning to roster.
        draft.teams[target.team_idx].add(local)
        # Advance cursor past consecutive completed picks.
        new_count += 1
        log.append(f"SYNC R{live.round_num}.{live.pick_in_round} "
                   f"overall {live.overall}: {local.name} ({local.position}) "
                   f"-> team {target.team_idx}")
    # Advance the cursor to the first incomplete pick.
    draft.cursor = 0
    while draft.cursor < len(draft.picks) and draft.picks[draft.cursor].player is not None:
        draft.cursor += 1
    return new_count, log
