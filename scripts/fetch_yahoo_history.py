"""Scrape public Yahoo league draft results to CSV.

Yahoo doesn't require auth to view a public league's draft page; the HTML
contains every pick in a round-by-round table layout. We parse those tables
and emit one CSV per season matching the schema the rest of this project's
yahoo importer expects (see fantasy_draft/yahoo.py).

Position is NOT in the draft results page — it appears on each player's
profile (a separate HTTP request per player). We leave position blank here;
a downstream pass can backfill from a Sleeper player catalog if needed.
"""
from __future__ import annotations

import csv
import re
import sys
import urllib.error
import urllib.request
from html import unescape
from pathlib import Path

LEAGUE_ID = "591940"
# Only 2022 is the actual MONEYLEAGUE predecessor at this league_id. Yahoo
# assigns league IDs per-season independently, so the same numeric ID in 2023
# or 2024 happens to belong to unrelated leagues (team rosters don't match
# MONEYLEAGUE). Pre-2022 requires login. To pull a different season/league,
# edit LEAGUE_ID + SEASONS and re-run.
SEASONS = (2022,)
OUT_DIR = Path("data/yahoo/league_591940")

UA = "Mozilla/5.0"


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
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
    totals = {}
    for season in SEASONS:
        url = f"https://football.fantasysports.yahoo.com/{season}/f1/{LEAGUE_ID}/draftresults"
        try:
            html = fetch(url)
        except urllib.error.HTTPError as e:
            print(f"  {season}: HTTP error {e.code}; skipping.")
            continue
        picks = parse_draft(html, season)
        out_path = OUT_DIR / f"draft_{season}.csv"
        with open(out_path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=[
                "season", "overall_pick", "round", "pick_in_round",
                "team_id", "team_name", "player_name", "position", "is_keeper",
            ])
            w.writeheader()
            w.writerows(picks)
        totals[season] = len(picks)
        # Quick stats: teams + max round
        teams = sorted({p["team_name"] for p in picks})
        rounds = max((p["round"] for p in picks), default=0)
        print(f"  {season}: {len(picks)} picks across {len(teams)} teams, "
              f"{rounds} rounds  ->  {out_path}")

    if not totals:
        print("\nNo draft data found. Check that the league is public.")
        sys.exit(1)


if __name__ == "__main__":
    main()
