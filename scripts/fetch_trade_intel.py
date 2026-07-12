#!/usr/bin/env python3
"""fetch_trade_intel.py — cache-first fetcher for the RESEARCH DESK trade desk.

Pulls three kinds of public Sleeper data into data/scouting/ (the book's
raw paper trail), skipping anything already on disk so weekly reruns only
touch the current season:

  1. In-league transactions — MONEYLEAGUE, all weeks 1-18, seasons 2023-25
     (plus 2026 automatically once Sleeper opens the next book).
       data/scouting/inleague/<season>/transactions_w<W>.json   (raw)
  2. Counterparty scouting — for each of the 11 current rivals, their OTHER
     leagues per season (raw /user/<uid>/leagues response), and for every
     such league: the league object, rosters, and its completed trades.
     Rival-league transactions are stored TRADES-ONLY (waiver noise is
     ~95% of raw weekly files and useless for dossiers; keeping full raw
     weeks for ~32 leagues would be ~17MB of committed cache — this is the
     "reconsider granularity" clause in action).
       data/scouting/rivals/leagues_<uid>_<season>.json         (raw)
       data/scouting/rivals/league_<lid>_<season>/league.json   (raw)
       data/scouting/rivals/league_<lid>_<season>/rosters.json  (raw)
       data/scouting/rivals/league_<lid>_<season>/trades.json   (filtered)
  3. Weekly player stats (api.sleeper.com — the .com host, like the
     backtest fetch) for rest-of-season trade grading. The raw endpoint is
     ~1.8MB/week (~97MB/3yr — uncommittable), so the cache stores a trimmed
     projection per season: {week: {player_id: {pts_half_ppr, pts_ppr,
     rec, pos}}} for players with points only (~25KB/week).
       data/scouting/stats/stats_<season>.json

Usage:
  python3 scripts/fetch_trade_intel.py                  # cache-first fill
  python3 scripts/fetch_trade_intel.py --refresh-current  # refetch newest
                                                           # season only

No credentials; public endpoints; ~0.15s throttle; one retry per call;
404/empty weeks tolerated (cached as empty so reruns stay offline).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCOUT = ROOT / "data" / "scouting"

THROTTLE = 0.15
UA = {"User-Agent": "moneyleague-research (github.com/blackjakk/MONEYLEAGUE)"}
WEEKS = range(1, 19)  # NFL regular season weeks 1-18

# Season -> MONEYLEAGUE league_id (verified in docs/GOAL_RESEARCH.md).
ML_LEAGUES = {
    2023: "1001657805583077376",
    2024: "1085805164784664576",
    2025: "1245039290518360064",
}
BRIAN_UID = "207020614303621120"

# The 11 current rivals (2025 room minus Brian). wvw5022 departed after
# 2024 (rid-10 handoff) and gets no dossier; Wi1dboy joined 2025 but we
# still scout his earlier seasons.
RIVALS = {
    "kbrower": "335950922154774528",
    "kylefiggy": "461689313671770112",
    "tjt5055": "470754140222386176",
    "BigDickNicholas": "721397055716659200",
    "TBreswick": "1001713986179686400",
    "LEMVP": "1001871601794637824",
    "apatel185": "1001875733720981504",
    "troymullings": "1001879029017903104",
    "dibach215": "1001897607733514240",
    "emattessich": "1001952871493054464",
    "Wi1dboy": "1249817196369022976",
}

_calls = 0


def _get(url: str):
    """GET json with throttle + one retry; None on 404/failure."""
    global _calls
    for attempt in (1, 2):
        try:
            time.sleep(THROTTLE)
            _calls += 1
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as fh:
                return json.load(fh)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if attempt == 2:
                print(f"    WARN {e.code} {url}", file=sys.stderr)
                return None
        except Exception as e:  # noqa: BLE001 — network soup; retry once
            if attempt == 2:
                print(f"    WARN {e} {url}", file=sys.stderr)
                return None
        time.sleep(0.6)
    return None


def _save(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":"), sort_keys=True))


def _cached(path: Path, refresh: bool) -> bool:
    return path.exists() and not refresh


# ---------------------------------------------------------------- in-league
def fetch_inleague(season: int, lid: str, refresh: bool) -> dict:
    n_tx = n_trades = fetched = 0
    for w in WEEKS:
        path = SCOUT / "inleague" / str(season) / f"transactions_w{w}.json"
        if _cached(path, refresh):
            data = json.loads(path.read_text())
        else:
            data = _get(f"https://api.sleeper.app/v1/league/{lid}/transactions/{w}")
            _save(path, data or [])  # cache empty weeks too — reruns stay offline
            fetched += 1
            data = data or []
        n_tx += len(data)
        n_trades += sum(
            1 for t in data if t.get("type") == "trade" and t.get("status") == "complete"
        )
    print(f"  in-league {season}: {n_tx} transactions, {n_trades} trades "
          f"({fetched} weeks fetched, {18 - fetched} cached)")
    return {"transactions": n_tx, "trades": n_trades}


def discover_2026(refresh: bool) -> str | None:
    """The 2026 book, once Sleeper opens it (tolerates not-yet-existing).

    The result (even a miss) is cached so plain reruns make zero network
    calls; --refresh-current re-checks.
    """
    path = SCOUT / "inleague" / "_league_2026.json"
    if _cached(path, refresh):
        return json.loads(path.read_text()).get("league_id")
    leagues = _get(f"https://api.sleeper.app/v1/user/{BRIAN_UID}/leagues/nfl/2026") or []
    lid = next((lg["league_id"] for lg in leagues
                if lg.get("previous_league_id") == ML_LEAGUES[2025]), None)
    _save(path, {"league_id": lid, "checked": time.strftime("%Y-%m-%d")})
    return lid


# ------------------------------------------------------------------ rivals
def fetch_rivals(season: int, refresh: bool) -> dict:
    ml_ids = set(ML_LEAGUES.values())
    seen: dict[str, list[str]] = {}          # league_id -> rival names in it
    counts = {"leagues": 0, "trades": 0}
    for name, uid in RIVALS.items():
        lpath = SCOUT / "rivals" / f"leagues_{uid}_{season}.json"
        if _cached(lpath, refresh):
            leagues = json.loads(lpath.read_text())
        else:
            leagues = _get(f"https://api.sleeper.app/v1/user/{uid}/leagues/nfl/{season}") or []
            _save(lpath, leagues)
        for lg in leagues:
            lid = lg["league_id"]
            if lid in ml_ids:
                continue
            seen.setdefault(lid, []).append(name)
            counts["leagues"] += 1  # per-rival membership count
            ldir = SCOUT / "rivals" / f"league_{lid}_{season}"
            if not _cached(ldir / "league.json", refresh):
                _save(ldir / "league.json", lg)
            if not _cached(ldir / "rosters.json", refresh):
                _save(ldir / "rosters.json",
                      _get(f"https://api.sleeper.app/v1/league/{lid}/rosters") or [])
            tpath = ldir / "trades.json"
            if not _cached(tpath, refresh):
                trades, total = [], 0
                for w in WEEKS:
                    tx = _get(f"https://api.sleeper.app/v1/league/{lid}/transactions/{w}") or []
                    total += len(tx)
                    trades += [t for t in tx
                               if t.get("type") == "trade" and t.get("status") == "complete"]
                _save(tpath, {"_meta": {"filter": "type==trade && status==complete",
                                        "weeks": "1-18",
                                        "total_transactions_seen": total},
                              "trades": trades})
            counts["trades"] += len(json.loads(tpath.read_text())["trades"])
    print(f"  rivals {season}: {len(seen)} distinct outside leagues "
          f"({counts['leagues']} memberships), {counts['trades']} trades on file")
    counts["distinct_leagues"] = len(seen)
    return counts


# ------------------------------------------------------------------- stats
def fetch_stats(season: int, refresh: bool) -> int:
    path = SCOUT / "stats" / f"stats_{season}.json"
    if _cached(path, refresh):
        weeks = json.loads(path.read_text())
        print(f"  stats {season}: cached ({len([k for k in weeks if k != '_meta'])} weeks)")
        return 0
    weeks: dict = {"_meta": {
        "source": f"https://api.sleeper.com/stats/nfl/{season}/<week>?season_type=regular",
        "note": "trimmed to scored players only (raw is ~1.8MB/week); "
                "pts_half_ppr / pts_ppr / rec / pos per player_id",
    }}
    kept = 0
    for w in WEEKS:
        rows = _get(f"https://api.sleeper.com/stats/nfl/{season}/{w}?season_type=regular") or []
        trimmed = {}
        for r in rows:
            st = r.get("stats") or {}
            if st.get("pts_half_ppr") is None and st.get("pts_ppr") is None:
                continue
            trimmed[r["player_id"]] = {
                "pts_half_ppr": st.get("pts_half_ppr"),
                "pts_ppr": st.get("pts_ppr"),
                "rec": st.get("rec"),
                "pos": (r.get("player") or {}).get("position"),
            }
        weeks[str(w)] = trimmed
        kept += len(trimmed)
    _save(path, weeks)
    print(f"  stats {season}: fetched 18 weeks, {kept} scored player-weeks")
    return kept


# -------------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--refresh-current", action="store_true",
                    help="refetch the newest season only (weekly pipeline mode)")
    args = ap.parse_args()

    leagues = dict(ML_LEAGUES)
    lid_2026 = discover_2026(args.refresh_current)
    if lid_2026:
        leagues[2026] = lid_2026
        print(f"2026 book discovered: {lid_2026}")
    newest = max(leagues)

    t0 = time.time()
    summary: dict = {}
    for season, lid in sorted(leagues.items()):
        refresh = args.refresh_current and season == newest
        print(f"season {season}{' [refresh]' if refresh else ''}:")
        summary[season] = {
            "inleague": fetch_inleague(season, lid, refresh),
            "rivals": fetch_rivals(season, refresh) if season in (2023, 2024, 2025) else {},
        }
        if season <= 2025:  # stats exist only for played seasons
            fetch_stats(season, refresh)

    size = sum(f.stat().st_size for f in SCOUT.rglob("*.json"))
    biggest = max(SCOUT.rglob("*.json"), key=lambda f: f.stat().st_size)
    print(f"done: {_calls} API calls in {time.time() - t0:.0f}s; "
          f"cache {size / 1e6:.1f}MB across {sum(1 for _ in SCOUT.rglob('*.json'))} files; "
          f"largest {biggest.relative_to(ROOT)} "
          f"{biggest.stat().st_size / 1e6:.2f}MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
