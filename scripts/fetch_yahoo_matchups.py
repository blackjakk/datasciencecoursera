"""Scrape Yahoo league weekly matchup pages to recover W/L + PF history.

For each (year, team_id, week) we fetch:
  /YEAR/f1/LEAGUE_ID/matchup?week=N&mid1=TEAM_ID
and extract: the two team names, their final scores, the winner, and
the manager.

Public leagues (2016-2022 confirmed) work without auth. Older / private
leagues need cookies — drop them into .yahoo_cookies at the repo root
(see scripts/fetch_yahoo_history.py docstring).

Output: data/yahoo/league_<id>/matchups_<year>.json with structure:

  {
    "season": 2021,
    "league_id": "60044",
    "teams": {"1": "Guap Gang", "2": "Pokemon Master", ...},
    "weeks": {
      "1": [{"team_a": 1, "team_b": 2, "pts_a": 144.16, "pts_b": 153.59,
             "winner": 2}],
      "2": [...]
    }
  }
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

# Same league-id table as fetch_yahoo_history.py.
SEASON_LEAGUE_IDS: dict[int, str] = {
    2015: "44369",
    2016: "63644",
    2017: "696645",
    2018: "50466",
    2019: "36588",
    2020: "64590",
    2021: "60044",
    2022: "591940",
}

REG_SEASON_WEEKS = range(1, 15)  # W1-W14
MAX_TEAMS = 12  # league has 10 in older years; we probe up to 12.
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
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.read().decode("utf-8", errors="ignore")
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        print(f"  ERROR fetching {url}: {e}", file=sys.stderr)
        return None


def _parse_matchup_page(html: str, league_id: str, year: int) -> Optional[dict]:
    """Pull team_id+name+score for the two teams on this matchup page."""
    # The page structure has two team blocks with F-shade scores. Team names
    # are linked via /YEAR/f1/LEAGUE/TEAM_ID with the team name as link text.
    # We pair the two scores in document order with the two team links.
    teams_re = re.compile(
        rf'/{year}/f1/{league_id}/(\d+)["\'][^>]*>([^<]{{3,40}})</'
    )
    scores_re = re.compile(r"F-shade[^>]*>(\d{2,3}\.\d{2})")
    teams = teams_re.findall(html)
    scores = scores_re.findall(html)
    # Filter to unique team links in encounter order
    seen = set()
    unique_teams = []
    for tid, nm in teams:
        if tid not in seen:
            seen.add(tid)
            unique_teams.append((int(tid), unescape(nm).strip()))
    if len(unique_teams) < 2 or len(scores) < 2:
        return None
    t_a, t_b = unique_teams[0], unique_teams[1]
    p_a, p_b = float(scores[0]), float(scores[1])
    winner = t_a[0] if p_a > p_b else (t_b[0] if p_b > p_a else None)
    return {
        "team_a": t_a[0], "name_a": t_a[1], "pts_a": p_a,
        "team_b": t_b[0], "name_b": t_b[1], "pts_b": p_b,
        "winner": winner,
    }


def scrape_season(year: int, league_id: str, cookies: Optional[str],
                  out_path: Path) -> dict:
    teams: dict[int, str] = {}
    weeks: dict[str, list[dict]] = {}
    for wk in REG_SEASON_WEEKS:
        seen_pairs: set[frozenset[int]] = set()
        wk_matchups: list[dict] = []
        for team_id in range(1, MAX_TEAMS + 1):
            url = (f"https://football.fantasysports.yahoo.com/"
                   f"{year}/f1/{league_id}/matchup?week={wk}&mid1={team_id}")
            html = _fetch(url, cookies)
            if not html:
                continue
            parsed = _parse_matchup_page(html, league_id, year)
            if not parsed:
                continue
            pair = frozenset((parsed["team_a"], parsed["team_b"]))
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            wk_matchups.append({
                "team_a": parsed["team_a"], "team_b": parsed["team_b"],
                "pts_a": parsed["pts_a"], "pts_b": parsed["pts_b"],
                "winner": parsed["winner"],
            })
            teams[parsed["team_a"]] = parsed["name_a"]
            teams[parsed["team_b"]] = parsed["name_b"]
            time.sleep(0.15)  # be polite
        weeks[str(wk)] = wk_matchups
        print(f"  W{wk:>2}: {len(wk_matchups)} matchups, "
              f"{len(teams)} teams known")
    payload = {
        "season": year,
        "league_id": league_id,
        "teams": {str(k): v for k, v in sorted(teams.items())},
        "weeks": weeks,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2))
    return payload


def main():
    cookies = _load_cookies()
    if cookies:
        print(f"[info] Using cookies from {COOKIE_FILE.relative_to(ROOT)}")
    else:
        print(f"[info] No {COOKIE_FILE.name} found — public leagues only")

    target_years = (list(range(2016, 2023)) if not cookies
                    else list(SEASON_LEAGUE_IDS.keys()))
    target_years = sorted(target_years)
    if len(sys.argv) > 1:
        # Override: pass years as arguments.
        target_years = [int(y) for y in sys.argv[1:]]

    for year in target_years:
        league_id = SEASON_LEAGUE_IDS.get(year)
        if not league_id:
            print(f"\n[skip] No league_id for {year}")
            continue
        out_path = (ROOT / "data" / "yahoo" / f"league_{league_id}"
                    / f"matchups_{year}.json")
        if out_path.exists():
            print(f"\n[skip] {out_path.relative_to(ROOT)} exists — delete to refetch")
            continue
        print(f"\n=== {year} (league {league_id}) ===")
        try:
            payload = scrape_season(year, league_id, cookies, out_path)
            n_matchups = sum(len(v) for v in payload["weeks"].values())
            print(f"  → wrote {out_path.relative_to(ROOT)} "
                  f"({n_matchups} matchups, {len(payload['teams'])} teams)")
        except KeyboardInterrupt:
            print("  interrupted; partial data not saved", file=sys.stderr)
            return


if __name__ == "__main__":
    main()
