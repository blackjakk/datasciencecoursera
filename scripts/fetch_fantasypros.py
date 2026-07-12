#!/usr/bin/env python3
"""Fetch FantasyPros half-PPR consensus rankings — BOTH formats.

  superflex (OP)  -> data/rankings_fantasypros.json       (league truth)
  standard 1QB    -> data/rankings_fantasypros_1qb.json   (the sheet the
                     room brings: this league drafts live in person and
                     rivals typically print popular/Reddit 1QB rankings)

Each file has one entry per player:
  {name, position, team, bye, fp_rank_overall, fp_rank_pos, fp_tier,
   fp_adp_avg, fp_rank_min, fp_rank_max, fp_rank_std, fp_expert_count}

The merger in fantasy_draft.rankings_overlay layers the superflex file
onto players_2026.csv at load time; the 1QB file feeds the Research
Desk's room-sheet analysis. Endpoint is free (no auth), the public
consensus URL FantasyPros embeds in its rankings pages.
"""
from __future__ import annotations
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

URL_TMPL = (
    "https://partners.fantasypros.com/api/v1/consensus-rankings.php"
    "?sport=NFL&year=2026&week=0&position={pos}&type=ROS&scoring=HALF&export=json"
)

FORMATS = [
    ("OP", "superflex (OP)", ROOT / "data" / "rankings_fantasypros.json"),
    ("ALL", "standard 1QB", ROOT / "data" / "rankings_fantasypros_1qb.json"),
]


def fetch_one(pos: str, label: str, out_path: Path) -> None:
    url = URL_TMPL.format(pos=pos)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    print(f"[FP] fetching {label}: {url[:80]}...")
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    n_experts = payload.get("total_experts", "?")
    last_updated = payload.get("last_updated", "?")
    players = payload.get("players", [])
    print(f"  Got {len(players)} players ({n_experts} experts, "
          f"updated {last_updated})")

    out = []
    for p in players:
        out.append({
            "name": p.get("player_name", "").strip(),
            "position": p.get("player_position_id", "").strip(),
            "team": p.get("player_team_id", "").strip(),
            "bye": p.get("player_bye_week"),
            "fp_rank_overall": p.get("rank_ecr"),
            "fp_rank_pos": p.get("pos_rank"),
            "fp_tier": p.get("tier"),
            "fp_adp_avg": p.get("rank_ave"),
            "fp_rank_min": p.get("rank_min"),
            "fp_rank_max": p.get("rank_max"),
            "fp_rank_std": p.get("rank_std"),
            "fp_expert_count": n_experts,
        })

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({
        "source": "FantasyPros partners API",
        "url": url,
        "scoring": "half_ppr",
        "format": label,
        "last_updated": last_updated,
        "total_experts": n_experts,
        "n_players": len(out),
        "players": out,
    }, indent=2), encoding="utf-8")
    print(f"  Wrote {out_path.relative_to(ROOT)}")


def main() -> None:
    for pos, label, out_path in FORMATS:
        fetch_one(pos, label, out_path)


if __name__ == "__main__":
    main()
