#!/usr/bin/env python3
"""Cache MONEYLEAGUE matchup + transaction history for the 2025 Autopsy.

Fetches, for each of the three MONEYLEAGUE seasons (2023/2024/2025):
  - matchups weeks 1-17  -> data/league_history/<season>_matchups_w<w>.json
  - transactions weeks 1-18 -> data/league_history/<season>_transactions_w<w>.json

Cache-first: a file that already exists on disk is never re-fetched, so the
weekly pipeline only pulls what is missing and a second run needs no network.
Public Sleeper endpoints only, no auth; ~0.15s throttle between calls; one
retry on failure; empty weeks (404 / null / []) are tolerated and cached as
[] so they do not re-trigger fetches.

Usage:
  python3 scripts/fetch_league_history.py            # fill the cache
  python3 scripts/fetch_league_history.py --refresh-current  # refetch 2025 only
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "league_history"

# season -> MONEYLEAGUE league_id (verified in docs/GOAL_RESEARCH.md)
LEAGUES = {
    2023: "1001657805583077376",
    2024: "1085805164784664576",
    2025: "1245039290518360064",
}
CURRENT_SEASON = 2025  # newest completed season with data

API = "https://api.sleeper.app/v1"
THROTTLE_S = 0.15
UA = "MONEYLEAGUE-research/1.0 (github.com/blackjakk/MONEYLEAGUE)"

MATCHUP_WEEKS = range(1, 18)       # 1..17
TRANSACTION_WEEKS = range(1, 19)   # 1..18


def _get_json(url: str):
    """GET url, one retry, tolerate 404/null -> []."""
    for attempt in (1, 2):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            return data if data is not None else []
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return []
            if attempt == 2:
                raise
            time.sleep(1.0)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1.0)
    return []


def _fetch_to(path: Path, url: str, force: bool = False) -> bool:
    """Cache-first fetch. Returns True if a network call was made."""
    if path.exists() and not force:
        return False
    data = _get_json(url)
    path.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    time.sleep(THROTTLE_S)
    return True


def main() -> None:
    refresh_current = "--refresh-current" in sys.argv[1:]
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    total_fetched = 0
    total_cached = 0
    for season, lid in sorted(LEAGUES.items()):
        force = refresh_current and season == CURRENT_SEASON
        fetched = 0
        for wk in MATCHUP_WEEKS:
            out = OUT_DIR / f"{season}_matchups_w{wk}.json"
            fetched += _fetch_to(out, f"{API}/league/{lid}/matchups/{wk}", force)
        for wk in TRANSACTION_WEEKS:
            out = OUT_DIR / f"{season}_transactions_w{wk}.json"
            fetched += _fetch_to(out, f"{API}/league/{lid}/transactions/{wk}", force)
        n_files = len(MATCHUP_WEEKS) + len(TRANSACTION_WEEKS)
        total_fetched += fetched
        total_cached += n_files - fetched
        print(f"[history] {season} (league {lid}): "
              f"{fetched} fetched, {n_files - fetched} already cached")

    print(f"[history] done: {total_fetched} network calls, "
          f"{total_cached} cache hits -> {OUT_DIR.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
