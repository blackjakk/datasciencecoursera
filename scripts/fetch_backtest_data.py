"""Fetch the period-honest backtest files: data/backtest/{proj,stats}_<year>.json.

These are the season-level Sleeper archives every historical analysis
grades against — proj_<year> carries the period ADP fields (adp_2qb is
the only period signal we trust; truth #3) and stats_<year> carries the
realized season points (pts_half_ppr). Consumers: stash_curve (option
book + keeper tiers), champion profile, benchmark validation, manager
fingerprints, autopsy, backtest_recommender.

The directory is gitignored (~41MB) and was originally fetched by hand,
which broke CI the moment derive/reports started needing it — the
weekly runner has no data/backtest. This makes the dependency explicit:
cache-first (existing files never refetched), one file per season from
2023 through the last COMPLETED season, so a new season folds in
automatically once it ends.

Usage: python3 scripts/fetch_backtest_data.py
"""
from __future__ import annotations

import json
import time
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "backtest"
FIRST_SEASON = 2023            # first Sleeper season of this league
THROTTLE = 0.3                 # these responses are ~7MB each — be polite


def get(url: str, retry: int = 2):
    req = urllib.request.Request(
        url, headers={"User-Agent": "moneyleague-backtest"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except Exception:
        if retry:
            time.sleep(2.0)
            return get(url, retry - 1)
        raise


def main() -> None:
    last_completed = date.today().year - 1
    OUT.mkdir(parents=True, exist_ok=True)
    fetched = skipped = 0
    for season in range(FIRST_SEASON, last_completed + 1):
        for kind, url in (
            ("proj", f"https://api.sleeper.com/projections/nfl/{season}"
                     "?season_type=regular&order_by=adp_2qb"),
            ("stats", f"https://api.sleeper.com/stats/nfl/{season}"
                      "?season_type=regular"),
        ):
            dest = OUT / f"{kind}_{season}.json"
            if dest.exists() and dest.stat().st_size > 100_000:
                skipped += 1
                continue
            data = get(url)
            if not isinstance(data, list) or len(data) < 500:
                raise SystemExit(
                    f"suspicious {kind}_{season} payload "
                    f"({type(data).__name__}, "
                    f"n={len(data) if isinstance(data, list) else '?'}) — "
                    "refusing to write")
            dest.write_text(json.dumps(data))
            print(f"  fetched {dest.relative_to(ROOT)} ({len(data)} rows)")
            fetched += 1
            time.sleep(THROTTLE)
    print(f"[backtest] seasons {FIRST_SEASON}-{last_completed}: "
          f"{fetched} fetched, {skipped} cached")


if __name__ == "__main__":
    main()
