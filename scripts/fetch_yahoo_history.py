"""Scrape Yahoo league draft results to CSV.

Yahoo serves public leagues' draft pages anonymously; older / private
seasons require an authenticated session. We support both:

  - Anonymous (no cookies): works for recent public leagues.
  - Cookie-authenticated: paste a Yahoo session cookie string into
    .yahoo_cookies (gitignored) and the script will send it. This unlocks
    pre-2022 draft pages and private leagues.

How to get cookies:
  1. Log into football.fantasysports.yahoo.com in your browser.
  2. DevTools -> Application -> Cookies -> yahoo.com
  3. Copy the values for T, Y, SSL, B (and any others Yahoo set).
  4. Save them as one line in `.yahoo_cookies` at the repo root in the
     form:  T=...; Y=...; SSL=...; B=...
     (or just copy the entire Cookie header from a request in DevTools'
     Network tab — works the same way.)

The script writes one CSV per season into data/yahoo/league_<id>/.
"""
from __future__ import annotations

import csv
import os
import re
import sys
import urllib.error
import urllib.request
from html import unescape
from pathlib import Path

LEAGUE_ID = "591940"
# Pre-2022 needs cookies. With them, you can also follow the renew chain
# backward — Yahoo's URL pattern is /YEAR/f1/LEAGUE_ID/draftresults and the
# league_id can change year-to-year via renew; see fantasy_draft/yahoo.py
# for the OAuth-based renew walker.
#
# Known MONEYLEAGUE league IDs across years (Yahoo re-keys each season):
#   2018 = 50466  (game_id 380, named "moneyleague")
#   2021 = 60044  (game_id 406, named "moneyleague")
#   2022 = 591940 (game_id 414, named "moneyleague")
#   2023 = 591940 (game_id 423)
#   2024 = 591940 (game_id 449, renamed "Lucky 7")
# 2019/2020 IDs are unknown — Yahoo doesn't expose the renew chain in
# public HTML, so they need to be supplied manually (see SEASON_LEAGUE_IDS).
SEASON_LEAGUE_IDS: dict[int, str] = {
    2018: "50466",
    2021: "60044",
    2022: "591940",
    2023: "591940",
    2024: "591940",
}
SEASONS = tuple(sorted(SEASON_LEAGUE_IDS))
OUT_DIR = Path("data/yahoo")
COOKIE_FILE = Path(".yahoo_cookies")

UA = "Mozilla/5.0"


def _cookie_header() -> str | None:
    """Return Cookie header value if cookies are available, else None."""
    env = os.environ.get("YAHOO_COOKIES")
    if env:
        return env.strip()
    if COOKIE_FILE.exists():
        return COOKIE_FILE.read_text().strip() or None
    return None


def fetch(url: str) -> str:
    headers = {"User-Agent": UA}
    cookies = _cookie_header()
    if cookies:
        headers["Cookie"] = cookies
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


# Each round is wrapped in:
#   <th colspan="3" class="Fw-b">Round N</th>
#   <tr> <td class="first">PICK.</td>
#        <td class="player ..."><a ... class="name">PLAYER</a> ... </td>
#        <td class="last ..." title="TEAM">TEAM</td>
#   </tr>
# We split by "Round N" header, then regex each pick row.

ROUND_HEADER = re.compile(r'>Round\s+(\d+)</th>')
PICK_ROW = re.compile(
    r'<td class="first">(\d+)\.</td>\s*'
    r'<td class="player[^"]*">.*?<a[^>]*class="name">([^<]+)</a>.*?</td>\s*'
    r'<td class="last[^"]*"\s*title="([^"]*)">',
    re.DOTALL,
)


def parse_draft(html: str, season: int, num_teams: int = 12) -> list[dict]:
    picks: list[dict] = []
    # Find all "Round N" boundaries.
    headers = [(m.start(), int(m.group(1))) for m in ROUND_HEADER.finditer(html)]
    if not headers:
        return picks
    # The actual table rows for Round N live after its header up to the next
    # header (or end of doc). Iterate that slice.
    headers.append((len(html), None))
    for i, (start, rnd) in enumerate(headers[:-1]):
        end = headers[i + 1][0]
        chunk = html[start:end]
        for m in PICK_ROW.finditer(chunk):
            overall = int(m.group(1))
            name = unescape(m.group(2)).strip()
            team = unescape(m.group(3)).strip()
            pick_in_round = ((overall - 1) % num_teams) + 1
            picks.append({
                "season": season,
                "overall_pick": overall,
                "round": rnd,
                "pick_in_round": pick_in_round,
                "team_id": f"t.{((overall - 1) % num_teams) + 1}",  # slot-based
                "team_name": team,
                "player_name": name,
                "position": "",     # not on the draft results page
                "is_keeper": "",    # not exposed on this view
            })
    return picks


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cookies_present = bool(_cookie_header())
    print(f"  Cookie auth: {'YES' if cookies_present else 'no (pre-2022 will skip)'}")
    totals = {}
    for season in SEASONS:
        league_id = SEASON_LEAGUE_IDS[season]
        url = f"https://football.fantasysports.yahoo.com/{season}/f1/{league_id}/draftresults"
        try:
            html = fetch(url)
        except urllib.error.HTTPError as e:
            print(f"  {season}: HTTP error {e.code}; skipping.")
            continue
        # Yahoo redirects unauthenticated requests for old/private leagues
        # to a login page; detect that case so we don't write empty CSVs.
        if "Login - Sign in to Yahoo" in html[:5000] or "<title>Sign in" in html[:5000]:
            print(f"  {season}: login wall (cookies missing or expired); skipping.")
            continue
        # "There was a problem" means the league_id doesn't exist for that year.
        if "There was a problem" in html[:2000]:
            print(f"  {season}: league {league_id} doesn't exist that year; skipping.")
            continue
        picks = parse_draft(html, season)
        if not picks:
            print(f"  {season}: no picks parsed (league may not exist this season); skipping.")
            continue
        season_dir = OUT_DIR / f"league_{league_id}"
        season_dir.mkdir(parents=True, exist_ok=True)
        out_path = season_dir / f"draft_{season}.csv"
        with open(out_path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=[
                "season", "overall_pick", "round", "pick_in_round",
                "team_id", "team_name", "player_name", "position", "is_keeper",
            ])
            w.writeheader()
            w.writerows(picks)
        totals[season] = len(picks)
        teams = sorted({p["team_name"] for p in picks})
        rounds = max((p["round"] for p in picks), default=0)
        print(f"  {season}: {len(picks)} picks across {len(teams)} teams, "
              f"{rounds} rounds  ->  {out_path}")

    if not totals:
        print("\nNo draft data fetched. If pre-2022 is what you want, write your "
              "Yahoo session cookies to .yahoo_cookies first (see module docstring).")
        sys.exit(1)


if __name__ == "__main__":
    main()
