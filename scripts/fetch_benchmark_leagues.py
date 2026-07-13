"""Fetch the BENCHMARK CORPUS: MONEYLEAGUE-format leagues we're not in.

The corpus (data/scouting/benchmark/_corpus.json) is a set of completed
Sleeper leagues discovered by snowball crawl through the superflex
half-PPR neighborhood of our rivals' leaguemates — every league matches
the format that defines ours (SUPER_FLEX, 0.5 rec, max_keepers > 1,
redraft, 10-12 teams) and contains NONE of our 13 owner accounts. They
exist purely as an out-of-sample validation set for the Champion Profile
signals (scripts/build_benchmark_validation.py).

Cache-first: every artifact lands under
data/scouting/benchmark/<season>_<league_id>/ and is never refetched if
present, so reruns are cheap no-ops. Discovery is NOT repeated here —
completed seasons don't change; grow the corpus by appending to
_corpus.json (discovery crawl documented in the file's _meta).

Usage: python3 scripts/fetch_benchmark_leagues.py
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BENCH = ROOT / "data" / "scouting" / "benchmark"
CORPUS = BENCH / "_corpus.json"
API = "https://api.sleeper.app/v1"
THROTTLE = 0.12

CALLS = [0]


def get(url: str, retry: int = 1):
    CALLS[0] += 1
    req = urllib.request.Request(
        url, headers={"User-Agent": "moneyleague-benchmark"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            out = json.loads(r.read())
        time.sleep(THROTTLE)
        return out
    except Exception:
        if retry:
            time.sleep(1.5)
            return get(url, 0)
        return None


def fetch_json(url: str, dest: Path) -> bool:
    """Cache-first single artifact. Returns True if present afterwards."""
    if dest.exists():
        return True
    data = get(url)
    if data is None:
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(data))
    return True


def fetch_league(lid: str, season: str) -> str:
    d = BENCH / f"{season}_{lid}"
    ok = True
    ok &= fetch_json(f"{API}/league/{lid}", d / "league.json")
    ok &= fetch_json(f"{API}/league/{lid}/users", d / "users.json")
    ok &= fetch_json(f"{API}/league/{lid}/rosters", d / "rosters.json")
    ok &= fetch_json(f"{API}/league/{lid}/winners_bracket",
                     d / "winners_bracket.json")
    if not fetch_json(f"{API}/league/{lid}/drafts", d / "drafts.json"):
        return "FAILED drafts"
    drafts = json.loads((d / "drafts.json").read_text())
    for dr in drafts or []:
        did = dr["draft_id"]
        ok &= fetch_json(f"{API}/draft/{did}/picks",
                         d / f"draft_{did}_picks.json")
    for w in range(1, 18):
        ok &= fetch_json(f"{API}/league/{lid}/matchups/{w}",
                         d / "matchups" / f"week_{w}.json")
    for w in range(1, 19):
        ok &= fetch_json(f"{API}/league/{lid}/transactions/{w}",
                         d / "transactions" / f"week_{w}.json")
    return "ok" if ok else "partial"


def main() -> None:
    if not CORPUS.exists():
        sys.exit("no corpus file — nothing to fetch "
                 f"(expected {CORPUS.relative_to(ROOT)})")
    corpus = json.loads(CORPUS.read_text())
    leagues = {k: v for k, v in corpus.items() if not k.startswith("_")}
    print(f"[benchmark] corpus of {len(leagues)} league-seasons")
    statuses: dict[str, int] = {}
    for lid, meta in leagues.items():
        st = fetch_league(lid, meta["season"])
        statuses[st] = statuses.get(st, 0) + 1
        print(f"  {meta['season']} {meta['name'][:40]:<40} {st}")
    print(f"[benchmark] done — {statuses} ({CALLS[0]} API calls this run)")


if __name__ == "__main__":
    main()
