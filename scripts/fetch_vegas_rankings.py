#!/usr/bin/env python3
"""Fetch firstdown.studio Vegas-props season rankings (user-requested).

Season projections implied by Vegas player props — an opinion-free,
money-backed third voice next to our model and the room's paper.
Per-position pages (Next.js, server-rendered tables):

  /season-rankings      -> QB
  /season-rankings/rb   -> RB
  /season-rankings/wr   -> WR
  /season-rankings/te   -> TE

Output: data/rankings_vegas.json
  {players: [{name, team, position, vegas_pts, vegas_pos_rank}], meta}

Failure tolerance: any page that fails to fetch/parse keeps the prior
file's entries for that position (cache-first); consumers omit their
block if the file is absent. Scoring format is the site's own — we use
POSITION RANKS downstream, never raw points, so format mismatches
cannot leak into VBD math.
"""
from __future__ import annotations

import html as _html
import json
import re
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "rankings_vegas.json"
BASE = "https://www.firstdown.studio/season-rankings"
PAGES = {"QB": BASE, "RB": f"{BASE}/rb", "WR": f"{BASE}/wr",
         "TE": f"{BASE}/te"}


NAME_RE = re.compile(r'<span class="hidden md:inline">([^<]+)</span>')
TEAM_RE = re.compile(r'<span class="shrink-0[^"]*">([A-Z]{2,3})</span>')
NUM_RE = re.compile(r'text-right[^>]*>\s*([\d,]+(?:\.\d+)?)\s*<')


def parse_page(html: str, pos: str) -> list[dict]:
    """The desktop-name span, team span, and first right-aligned numeric
    cell (total points) per <tr> chunk — structural, not text-soup."""
    out = []
    for chunk in html.split("<tr")[1:]:
        nm = NAME_RE.search(chunk)
        tm = TEAM_RE.search(chunk)
        num = NUM_RE.search(chunk)
        if not (nm and tm and num):
            continue
        try:
            pts = float(num.group(1).replace(",", ""))
        except ValueError:
            continue
        out.append({"name": _html.unescape(nm.group(1)).strip(),
                    "team": tm.group(1), "position": pos, "vegas_pts": pts})
    # de-dup, rank by points
    seen, dedup = set(), []
    for r in sorted(out, key=lambda r: -r["vegas_pts"]):
        if r["name"] in seen:
            continue
        seen.add(r["name"])
        r["vegas_pos_rank"] = len(dedup) + 1
        dedup.append(r)
    return dedup


def main() -> None:
    prior = {}
    if OUT.exists():
        try:
            for r in json.loads(OUT.read_text()).get("players", []):
                prior.setdefault(r["position"], []).append(r)
        except json.JSONDecodeError:
            pass
    players: list[dict] = []
    fetched, kept = [], []
    for pos, url in PAGES.items():
        try:
            req = urllib.request.Request(url,
                                         headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                rows = parse_page(resp.read().decode("utf-8", "replace"), pos)
            if len(rows) < 10:
                raise ValueError(f"only {len(rows)} rows parsed")
            players += rows
            fetched.append(f"{pos}:{len(rows)}")
        except Exception as exc:                     # noqa: BLE001
            old = prior.get(pos, [])
            players += old
            kept.append(f"{pos} ({exc}; kept {len(old)} cached)")
    OUT.write_text(json.dumps({
        "meta": {"source": "firstdown.studio Vegas-props season rankings",
                 "fetched": str(date.today()),
                 "note": "site scoring format — consume POSITION RANKS "
                         "only, never raw points"},
        "players": players}, indent=1))
    print(f"[vegas] fetched {', '.join(fetched) or 'nothing'}"
          + (f"; fallback: {'; '.join(kept)}" if kept else "")
          + f" -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
