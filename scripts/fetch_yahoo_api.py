"""One-shot Yahoo Fantasy API backfill: the league's 2011-2022 era.

(Complement to scripts/fetch_yahoo_history.py, an older cookie-based
page scraper for draft grids — this module uses the sanctioned OAuth
API and pulls standings, matchups, and transactions, which the scraper
can't reach reliably.)

Runs inside the yahoo_backfill workflow (or locally) with three env vars:

  YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET  — the user's Yahoo app
                                            (GitHub Actions secrets)
  YAHOO_AUTH_CODE                         — ONE-TIME authorization code
                                            from the browser consent
                                            flow (expires in minutes,
                                            single-use — safe to type
                                            into the workflow_dispatch
                                            input box)

Exchanges the code for an access token (no refresh token is stored
anywhere: historical seasons never change, so this backfill runs once),
discovers every NFL league the authorizing user belonged to via
`users;use_login=1/games;game_codes=nfl/leagues`, and saves RAW JSON
responses under data/yahoo/<season>_<league_id>/:

  league.json         — league metadata (name, size)
  standings.json      — final standings (rank, W-L, PF)
  transactions.json   — full transaction log (trades!)
  draftresults.json   — draft board (cross-check for the xlsx)
  scoreboard_wNN.json — weekly matchups

Raw-first doctrine: Yahoo's JSON is deeply nested with numbered keys;
parsing/normalizing happens in a later derive step once real shapes are
on disk. MONEYLEAGUE identification also happens later, by matching
data/team_identity.json yahoo_team_names against each league's teams —
so this fetches ALL the user's NFL leagues per season and lets the
analysis pick.

Redirect URI must EXACTLY match the Yahoo app: https://localhost:8080
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "yahoo"
REDIRECT_URI = "https://localhost:8080"
TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token"
API = "https://fantasysports.yahooapis.com/fantasy/v2"
FIRST_SEASON, LAST_SEASON = 2011, 2022
THROTTLE = 0.4


def _post_token(code: str, cid: str, secret: str) -> dict:
    basic = base64.b64encode(f"{cid}:{secret}".encode()).decode()
    body = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "redirect_uri": REDIRECT_URI,
        "code": code.strip(),
    }).encode()
    req = urllib.request.Request(
        TOKEN_URL, data=body, method="POST",
        headers={"Authorization": f"Basic {basic}",
                 "Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def _get(path: str, token: str, retry: int = 2):
    url = f"{API}/{path}?format=json"
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {token}",
                      "User-Agent": "moneyleague-history"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            out = json.loads(r.read())
        time.sleep(THROTTLE)
        return out
    except urllib.error.HTTPError as e:
        if e.code in (400, 404):
            return None                      # season/resource not present
        if retry:
            time.sleep(2.0)
            return _get(path, token, retry - 1)
        raise


def _save(dest: Path, data) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(data))


def discover_leagues(token: str) -> list[dict]:
    """Every NFL league on the authorizing account, all seasons."""
    raw = _get("users;use_login=1/games;game_codes=nfl/leagues", token)
    _save(OUT / "_discovery.json", raw)
    leagues: list[dict] = []
    try:
        games = raw["fantasy_content"]["users"]["0"]["user"][1]["games"]
        for gi in range(int(games.get("count", 0))):
            game = games[str(gi)]["game"]
            meta = game[0] if isinstance(game, list) else game
            season = int(meta.get("season", 0))
            if not (FIRST_SEASON <= season <= LAST_SEASON):
                continue
            lg_block = None
            if isinstance(game, list):
                for part in game[1:]:
                    if isinstance(part, dict) and "leagues" in part:
                        lg_block = part["leagues"]
            if not lg_block:
                continue
            for li in range(int(lg_block.get("count", 0))):
                lmeta = lg_block[str(li)]["league"]
                lmeta = lmeta[0] if isinstance(lmeta, list) else lmeta
                leagues.append({
                    "season": season,
                    "league_key": lmeta["league_key"],
                    "league_id": lmeta["league_id"],
                    "name": lmeta.get("name", "?"),
                    "num_teams": lmeta.get("num_teams"),
                    "end_week": int(lmeta.get("end_week") or 16),
                })
    except (KeyError, TypeError, ValueError) as e:
        sys.exit(f"discovery parse failed ({e}) — raw saved to "
                 f"{OUT / '_discovery.json'}; inspect and adjust")
    return leagues


def main() -> None:
    cid = os.environ.get("YAHOO_CLIENT_ID")
    secret = os.environ.get("YAHOO_CLIENT_SECRET")
    code = os.environ.get("YAHOO_AUTH_CODE")
    if not (cid and secret and code):
        sys.exit("need YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET, "
                 "YAHOO_AUTH_CODE in the environment")

    tok = _post_token(code, cid, secret)
    token = tok.get("access_token")
    if not token:
        sys.exit(f"token exchange failed: "
                 f"{ {k: v for k, v in tok.items() if 'token' not in k} }")
    print("token OK — discovering leagues")

    leagues = discover_leagues(token)
    print(f"found {len(leagues)} NFL league-season(s) in "
          f"{FIRST_SEASON}-{LAST_SEASON}:")
    for lg in leagues:
        print(f"  {lg['season']} {lg['name']} "
              f"({lg['num_teams']}tm, key {lg['league_key']})")

    for lg in leagues:
        d = OUT / f"{lg['season']}_{lg['league_id']}"
        key = lg["league_key"]
        if (d / "standings.json").exists():
            print(f"  {lg['season']} {lg['name']}: cached, skipping")
            continue
        _save(d / "league.json", _get(f"league/{key}", token))
        _save(d / "standings.json", _get(f"league/{key}/standings", token))
        _save(d / "transactions.json",
              _get(f"league/{key}/transactions", token))
        _save(d / "draftresults.json",
              _get(f"league/{key}/draftresults", token))
        for w in range(1, lg["end_week"] + 1):
            sb = _get(f"league/{key}/scoreboard;week={w}", token)
            if sb is not None:
                _save(d / f"scoreboard_w{w:02d}.json", sb)
        print(f"  {lg['season']} {lg['name']}: saved "
              f"(standings, transactions, draft, {lg['end_week']} weeks)")

    print(f"backfill complete -> {OUT.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
