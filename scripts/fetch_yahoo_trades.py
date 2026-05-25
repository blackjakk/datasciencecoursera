"""Scrape Yahoo league trade history with players + picks.

For each year, fetches /year/f1/leagueId/transactions?transactionsfilter=trade
and parses each trade entry. A single completed trade typically appears
as multiple "Traded to <team> (<initiator>)" blocks — one per side per
trade — each listing the players + picks that team received.

We pair sides by date+time. Picks are detected as 'Round N' tokens
inside a side's block.

Output: data/yahoo/league_<id>/trades_<year>.json with structure:

  [
    {"date": "Nov 21, 12:29 am", "season": 2021,
     "sides": [
       {"team": "Weird Flex but OK", "manager": "BIGGUAP",
        "received_players": [{"name":"Jalen Hurts","team":"Phi","pos":"QB"}, ...],
        "received_picks": ["2022 Round 4", ...]},
       {"team": "Guap Gang", "manager": "TBRESWICK",
        "received_players": [...], "received_picks": [...]}
     ]}
  ]
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.request
from html import unescape
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
COOKIE_FILE = ROOT / ".yahoo_cookies"

SEASON_LEAGUE_IDS = {
    2011: "774143", 2012: "342156", 2013: "127090", 2014: "85803",
    2015: "44369", 2016: "63644", 2017: "696645", 2018: "50466",
    2019: "36588", 2020: "64590", 2021: "60044", 2022: "591940",
}
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")


def _load_cookies() -> Optional[str]:
    if COOKIE_FILE.exists():
        return COOKIE_FILE.read_text().strip()
    return None


def _fetch(url: str, cookies: Optional[str]) -> Optional[str]:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    if cookies:
        req.add_header("Cookie", cookies)
    backoff = 30
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.read().decode("utf-8", errors="ignore")
        except urllib.error.HTTPError as e:
            if e.code == 999 and attempt < 3:
                print(f"  rate-limited; sleeping {backoff}s", file=sys.stderr)
                time.sleep(backoff); backoff *= 2; continue
            print(f"  ERROR {url}: {e}", file=sys.stderr); return None
        except Exception as e:
            print(f"  ERROR {url}: {e}", file=sys.stderr); return None


# Capture each "Traded to ..." block, stopping before the next or end-marker.
# Yahoo's HTML uses class-based markup; after stripping tags we get a
# flat text stream of trade segments separated by "Traded to" headers.
_SIDE_RE = re.compile(
    r"Traded to ([^()\n]+?)\s*(?:\(\s*([^)]+?)\s*\))?\s*"
    r"(\w{3,4} \d{1,2}, \d{1,2}:\d{2} (?:am|pm))\s*"
    r"([\s\S]*?)(?=Traded to |\Z)"
)
_PLAYER_RE = re.compile(
    r"([A-Z][\w\.\-']+(?:\s[A-Z][\w\.\-']+){1,3}(?:\s[IVX]+| Jr\.?| Sr\.?)?)\s+"
    r"([A-Z][A-Za-z]{1,3})\s*-\s*(QB|RB|WR|TE|K|DEF|DST)"
)
_PICK_RE = re.compile(r"Round (\d+)(?:\s*\(traded from ([^)]+)\))?")
_DATE_PARSE = re.compile(r"(\w{3,4}) (\d{1,2}), (\d{1,2}):(\d{2}) (am|pm)")


def parse_trades_page(html: str, season: int) -> list[dict]:
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"\s+", " ", unescape(text)).strip()
    sides = []
    for m in _SIDE_RE.finditer(text):
        team_to = m.group(1).strip()
        initiator = (m.group(2) or "").strip()
        date_str = m.group(3).strip()
        body = m.group(4).strip()
        players = []
        for p in _PLAYER_RE.finditer(body):
            name = re.sub(r"^(NA|Q|O|D|IR|SUSP)\s+", "", p.group(1)).strip()
            players.append({"name": name, "nfl_team": p.group(2),
                            "pos": p.group(3)})
        picks = []
        for pm in _PICK_RE.finditer(body):
            pk = {"round": int(pm.group(1))}
            if pm.group(2):
                pk["originally_from"] = pm.group(2).strip()
            picks.append(pk)
        sides.append({
            "received_team": team_to, "initiator": initiator,
            "date_str": date_str,
            "received_players": players, "received_picks": picks,
        })
    # Pair sides into trades. Yahoo's page lists each side sequentially —
    # for a 2-team trade, 2 consecutive "Traded to X" rows describe it.
    # If multiple trades happened at the same minute, they appear as
    # 4+ consecutive rows (2 per trade). We pair sequentially.
    trades = []
    i = 0
    while i + 1 < len(sides):
        a, b = sides[i], sides[i + 1]
        # Sanity: same date_str
        if a["date_str"] == b["date_str"]:
            trades.append({"season": season, "date_str": a["date_str"],
                            "sides": [a, b]})
            i += 2
        else:
            # Solo side without partner — skip but log
            i += 1
    return trades


def scrape_year(season: int, league_id: str,
                cookies: Optional[str]) -> list[dict]:
    all_trades = []
    pos = 0
    while True:
        url = (f"https://football.fantasysports.yahoo.com/"
               f"{season}/f1/{league_id}/transactions"
               f"?transactionsfilter=trade&pos={pos}")
        html = _fetch(url, cookies)
        if not html:
            break
        trades = parse_trades_page(html, season)
        if not trades:
            break
        # Deduplicate by date+sides hash to detect end of pagination
        new = [t for t in trades
               if not any(t["date_str"] == prev["date_str"]
                          and t["sides"] == prev["sides"]
                          for prev in all_trades)]
        if not new:
            break
        all_trades.extend(new)
        print(f"  {season} pos={pos}: +{len(new)} trades "
              f"({len(all_trades)} total)")
        pos += 25
        time.sleep(2)
        if pos > 500:  # safety cap
            break
    return all_trades


def main():
    cookies = _load_cookies()
    if not cookies:
        sys.exit("Need .yahoo_cookies for transactions pages")
    years = [int(y) for y in sys.argv[1:]] or list(SEASON_LEAGUE_IDS.keys())
    for year in sorted(years):
        lg = SEASON_LEAGUE_IDS.get(year)
        if not lg:
            continue
        out = ROOT / "data" / "yahoo" / f"league_{lg}" / f"trades_{year}.json"
        if out.exists():
            existing = json.loads(out.read_text())
            if existing:
                print(f"\n[skip] {out.relative_to(ROOT)} already has "
                      f"{len(existing)} trades")
                continue
        print(f"\n=== {year} (league {lg}) ===")
        trades = scrape_year(year, lg, cookies)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(trades, indent=2))
        print(f"  → wrote {out.relative_to(ROOT)} ({len(trades)} trades)")


if __name__ == "__main__":
    main()
