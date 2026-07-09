#!/usr/bin/env python3
"""Fetch FantasyCalc redraft trade values for 2QB / superflex / half-PPR.

The endpoint returns each player's TRADE VALUE on a 0-10000 scale,
calibrated against actual completed trades in fantasy leagues. Useful
for cross-checking the projection-based VBD against what the fantasy
community is actually paying.

Writes data/rankings_fantasycalc.json.
"""
from __future__ import annotations
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "rankings_fantasycalc.json"

URL = "https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=2&ppr=0.5"


def main() -> None:
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
    print(f"[FC] fetching {URL}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    print(f"  Got {len(data)} player trade values")

    out = []
    for entry in data:
        pl = entry.get("player", {})
        out.append({
            "name": pl.get("name", "").strip(),
            "position": pl.get("position", "").strip(),
            "team": (pl.get("maybeTeam") or "").strip(),
            "age": pl.get("maybeAge"),
            "sleeper_id": pl.get("sleeperId"),
            "fc_value": entry.get("value"),
            "fc_overall_rank": entry.get("overallRank"),
            "fc_position_rank": entry.get("positionRank"),
            "fc_tier": entry.get("maybeTier"),
            "fc_trend_30day": entry.get("trend30Day"),
            "fc_adp": entry.get("maybeAdp"),
        })
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "source": "FantasyCalc API",
        "url": URL,
        "format": "superflex 2QB half-PPR redraft",
        "n_players": len(out),
        "players": out,
    }, indent=2), encoding="utf-8")
    print(f"  Wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
