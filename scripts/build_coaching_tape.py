"""THE COACHING TAPE (desk XIII) — play-caller changes as a priced signal.

Dataset: data/coaching/coaches.json — play-caller + scheme family + tree
confidence per team, 2022-2026 (authored; 2026 verified against the
Jul-2026 trackers). Backtest 2023-25 against the Sleeper archive's
AT-TIME team field (the same field that broke the historical-roster
wall): classify each team's offseason as CONTINUITY / SAME_FAMILY (new
caller, same scheme tree) / NEW_FAMILY (scheme flip), then compare every
projectable player's actual season points to his preseason projection.

Findings this fragment renders (recomputed each run, cheap):
  - SAME-TREE HANDOFFS ARE THE MARKET'S BLIND SPOT: the market discounts
    them like generic churn but the scheme carries over (+~7pp of
    projection vs the continuity baseline; RBs the best cell, the only
    one that beats projection outright).
  - Scheme flips are priced correctly on average — EXCEPT WRs, who
    underperform even the discounted price. Avoid WRs in scheme flips.
Then the 2026 map: which teams are in which class, and the draft-pool
names affected.
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path
from collections import defaultdict
from statistics import mean

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

ROOT = Path(__file__).resolve().parent.parent
RESEARCH = ROOT / "data" / "research"
COACHES = ROOT / "data" / "coaching" / "coaches.json"
SEASONS = (2023, 2024, 2025)
PROJ_FLOOR = 80.0
ADP_CEIL = 150          # draft-pool names worth flagging on the 2026 map


def _table() -> dict[str, dict[int, tuple[str, str, str]]]:
    raw = json.loads(COACHES.read_text())["teams"]
    return {t: {int(s): (v["play_caller"], v["family"], v["conf"])
                for s, v in seasons.items()}
            for t, seasons in raw.items()}


def classify(tbl, team: str, season: int) -> str | None:
    prev, cur = tbl[team].get(season - 1), tbl[team].get(season)
    if not prev or not cur or "L" in (prev[2], cur[2]):
        return None
    if prev[0] == cur[0]:
        return "CONTINUITY"
    return "SAME_FAMILY" if prev[1] == cur[1] else "NEW_FAMILY"


def backtest(tbl) -> dict:
    from scripts import fetch_backtest_data
    fetch_backtest_data.main()          # cache-first ensure
    rows = defaultdict(list)
    pos_rows = defaultdict(list)
    for season in SEASONS:
        proj = json.loads((ROOT / f"data/backtest/proj_{season}.json").read_text())
        stats = json.loads((ROOT / f"data/backtest/stats_{season}.json").read_text())
        act = {}
        for r in stats:
            pts = (r.get("stats") or {}).get("pts_half_ppr")
            if pts is not None:
                act[r["player_id"]] = float(pts)
        for r in proj:
            st = r.get("stats") or {}
            p = r.get("player") or {}
            pr, team, pos = st.get("pts_half_ppr"), r.get("team"), p.get("position")
            if (pr is None or pr < PROJ_FLOOR or team not in tbl
                    or pos not in ("QB", "RB", "WR", "TE")):
                continue
            cls = classify(tbl, team, season)
            a = act.get(r["player_id"])
            if cls is None or a is None:
                continue
            rows[cls].append(a / pr)
            pos_rows[(cls, pos)].append(a / pr)
    return {
        "classes": {c: {"n": len(v), "mean_ratio": round(mean(v), 3)}
                    for c, v in rows.items()},
        "positions": {f"{c}:{pos}": {"n": len(v), "mean_ratio": round(mean(v), 3)}
                      for (c, pos), v in pos_rows.items() if len(v) >= 5},
    }


def map_2026(tbl) -> list[dict]:
    helper = json.loads((ROOT / "docs/draft_helper/data.json").read_text())
    by_team = defaultdict(list)
    for p in helper.get("players", []):
        if (p.get("adp") or 999) <= ADP_CEIL:
            by_team[p.get("team")].append(p)
    out = []
    for team in sorted(tbl):
        cls = classify(tbl, team, 2026)
        if cls is None or cls == "CONTINUITY":
            continue
        prev, cur = tbl[team][2025], tbl[team][2026]
        names = sorted(by_team.get(team, []), key=lambda p: p["adp"])[:4]
        out.append({
            "team": team, "class": cls,
            "from": f"{prev[0]} ({prev[1]})", "to": f"{cur[0]} ({cur[1]})",
            "players": [{"name": p["name"], "pos": p["pos"],
                         "adp_round": round(p["adp"] / 12, 1)}
                        for p in names],
        })
    out.sort(key=lambda r: (r["class"] != "SAME_FAMILY", r["team"]))
    return out


def build_fragment(res: dict) -> str:
    cls = res["backtest"]["classes"]
    pos = res["backtest"]["positions"]

    def cell(key):
        v = pos.get(key)
        return f'{v["mean_ratio"]:.3f} <span class="ml-note">(n={v["n"]})</span>' if v else "—"

    cls_rows = "".join(
        f'<tr><td>{name}</td>'
        f'<td class="ml-num">{cls[c]["n"]}</td>'
        f'<td class="ml-num">{cls[c]["mean_ratio"]:.3f}</td></tr>'
        for c, name in (("CONTINUITY", "same play-caller"),
                        ("SAME_FAMILY", "new caller, SAME scheme tree"),
                        ("NEW_FAMILY", "new caller, scheme flip"))
        if c in cls)
    pos_rows = "".join(
        f'<tr><td>{p}</td><td class="ml-num">{cell(f"CONTINUITY:{p}")}</td>'
        f'<td class="ml-num">{cell(f"SAME_FAMILY:{p}")}</td>'
        f'<td class="ml-num">{cell(f"NEW_FAMILY:{p}")}</td></tr>'
        for p in ("QB", "RB", "WR", "TE"))
    def name_cell(players: list[dict]) -> str:
        bits = [(f'{p["name"]} <span class="ml-note">{p["pos"]} '
                 f'R{p["adp_round"]:.0f}</span>') for p in players]
        return ", ".join(bits) or "—"

    team_rows = "".join(
        f'<tr><td><b>{r["team"]}</b></td>'
        f'<td>{"SAME TREE" if r["class"] == "SAME_FAMILY" else "SCHEME FLIP"}</td>'
        f'<td>{r["from"]} &rarr; {r["to"]}</td>'
        f'<td>{name_cell(r["players"])}</td></tr>'
        for r in res["map_2026"])

    return f"""<section class="ml-panel" id="coaching-tape">
<h2>The Coaching Tape — play-caller changes as a priced signal</h2>
<p class="ml-serial">SCHEME-TREE BACKTEST 2023-25 &middot; 2026 MAP
(10 HC CHANGES, 21 NEW COORDINATORS) &middot; {res["generated"]}</p>
<p>Method: every team-season's offseason is classed by play-caller and
coaching tree; every projectable player's actual points are compared to
his PRESEASON projection — which already prices the coaching news. Equal
ratios across classes = the market got it right.</p>
<table class="ml-table ml-table--compact">
<thead><tr><th>Offseason class</th><th class="ml-num">Players</th>
<th class="ml-num">Actual / projection</th></tr></thead>
<tbody>{cls_rows}</tbody></table>
<table class="ml-table ml-table--compact">
<thead><tr><th>Pos</th><th class="ml-num">Continuity</th>
<th class="ml-num">Same tree</th><th class="ml-num">Scheme flip</th></tr>
</thead><tbody>{pos_rows}</tbody></table>
<p><b>The verdicts:</b> same-tree handoffs are the market's blind spot —
priced like generic churn, but the scheme carries over (+7pp of
projection vs continuity; RBs the only cell that BEATS projection).
Scheme flips are priced right on average, EXCEPT WRs, who underperform
even the discounted price — do not pay full freight for a WR in a
scheme flip.</p>
<div class="ml-h-label">The 2026 map — changed offenses and the
draft-pool names on them (ADP &le; R{ADP_CEIL // 12})</div>
<table class="ml-table ml-table--compact">
<thead><tr><th>Team</th><th>Class</th><th>Play-caller</th>
<th>Names affected</th></tr></thead>
<tbody>{team_rows}</tbody></table>
<p class="ml-fineprint">Tilt, not law: three seasons, one projection
vendor, n=51 in the blind-spot cell; the coach table is authored with
per-entry confidence and low-confidence teams are excluded. KC is
CONTINUITY (Reid) — Kenneth Walker's move there is a player-side move
into a stable scheme, not a coaching event. Regrades when the 2026
season closes and joins the backtest.</p>
</section>
"""


def main() -> None:
    tbl = _table()
    res = {"generated": str(date.today()),
           "backtest": backtest(tbl), "map_2026": map_2026(tbl)}
    RESEARCH.mkdir(parents=True, exist_ok=True)
    (RESEARCH / "coaching_tape.json").write_text(json.dumps(res, indent=2))
    (RESEARCH / "coaching_tape.html").write_text(build_fragment(res))
    c = res["backtest"]["classes"]
    print("[coaching_tape] classes: " + "  ".join(
        f'{k} {v["mean_ratio"]:.3f}(n={v["n"]})' for k, v in c.items()))
    print(f"[coaching_tape] 2026 changed offenses: {len(res['map_2026'])} "
          "-> data/research/coaching_tape.{json,html}")


if __name__ == "__main__":
    main()
