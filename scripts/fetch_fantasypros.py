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


SHARP_K = 8
CHEATSHEET_URL = ("https://www.fantasypros.com/nfl/rankings/"
                  "half-point-ppr-cheatsheets.php")
EXPERTS_CACHE = ROOT / "data" / "fp_experts.json"
SHARP_OUT = ROOT / "data" / "rankings_fantasypros_sharp.json"


def _scrape_expert_directory() -> list[dict]:
    """The cheatsheet page embeds the full expert directory, including
    each expert's placement in FP's draft-accuracy contest
    (`draft_rank`). Bracket-match the JSON array out of the HTML."""
    req = urllib.request.Request(CHEATSHEET_URL,
                                 headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode("utf-8", "replace")
    i = raw.find('"profile_link"')
    if i < 0:
        raise ValueError("expert directory not found in page")
    start = raw.rfind("[", 0, i)
    depth = 0
    for j in range(start, len(raw)):
        if raw[j] == "[":
            depth += 1
        elif raw[j] == "]":
            depth -= 1
            if depth == 0:
                break
    experts = json.loads(raw[start:j + 1])
    keep = [{"id": e["id"], "name": e.get("name"), "site": e.get("site"),
             "draft_rank": e.get("draft_rank")}
            for e in experts if isinstance(e, dict) and e.get("id")]
    if len(keep) < 20:
        raise ValueError(f"directory suspiciously small ({len(keep)})")
    return keep


def fetch_sharp() -> None:
    """THE SHARP BOARD: consensus of the top-K experts by FP draft
    accuracy (select-crowd construction — equal weight within the top
    decile; single-season winners rotate, so K=8 dilutes contest noise).
    1QB-format ranks: valid for RB/WR/TE comparisons only (their QB
    ordering is meaningless in a superflex room). Scrape failures fall
    back to the committed directory cache so the pipeline never dies on
    a page redesign."""
    try:
        experts = _scrape_expert_directory()
        EXPERTS_CACHE.write_text(json.dumps(
            {"fetched": True, "experts": experts}, indent=1))
        print(f"[FP] expert directory: {len(experts)} scraped fresh")
    except Exception as exc:                        # noqa: BLE001
        if not EXPERTS_CACHE.exists():
            print(f"[FP] SHARP skipped — no directory ({exc})")
            return
        experts = json.loads(EXPERTS_CACHE.read_text())["experts"]
        print(f"[FP] directory scrape failed ({exc}); using cache "
              f"({len(experts)} experts)")
    ranked = sorted((e for e in experts
                     if str(e.get("draft_rank") or "").isdigit()),
                    key=lambda e: int(e["draft_rank"]))[:SHARP_K]
    if not ranked:
        print("[FP] SHARP skipped — no accuracy-ranked experts")
        return
    ids = ":".join(str(e["id"]) for e in ranked)
    url = URL_TMPL.format(pos="ALL") + f"&filters={ids}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    players = payload.get("players", [])
    SHARP_OUT.write_text(json.dumps({
        "source": "FantasyPros partners API, trimmed to top "
                  f"{len(ranked)} draft-accuracy experts (equal weight)",
        "experts": ranked,
        "scoring": "half_ppr", "format": "standard 1QB (RB/WR/TE use only)",
        "last_updated": payload.get("last_updated"),
        "n_players": len(players),
        "players": [{"name": p.get("player_name", "").strip(),
                     "position": p.get("player_position_id", "").strip(),
                     "sharp_rank": p.get("rank_ecr"),
                     "sharp_std": p.get("rank_std")}
                    for p in players],
    }, indent=2))
    print(f"[FP] SHARP board: {len(players)} players from "
          + ", ".join(f'{e["name"]} (#{e["draft_rank"]})' for e in ranked[:4])
          + " …")


def main() -> None:
    for pos, label, out_path in FORMATS:
        fetch_one(pos, label, out_path)
    fetch_sharp()


if __name__ == "__main__":
    main()
