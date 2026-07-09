"""Predict 2026 keepers using Sleeper draft data + xlsx FF2025 keeper-year
comments to enforce the 3-year max-keep rule.

Strategy:
  - 2025 is_keeper=True players auto-roll to 2026 with cost dropping
    2 rounds (R-2 rule), UNLESS the xlsx FF2025 comment says they're
    already a "3rd year keeper" (cap reached).
  - Teams with fewer than 4 carry-over keepers fill remaining slots from
    their best R3+ non-keeper roster players (ranked by 2025 fpts).

Public API:
  predict_2026_keepers() -> {roster_id: [{name, pos, year_2026,
                                           cost_round, source}]}
"""
from __future__ import annotations

import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LG_2025 = ROOT / "data/sleeper/league_1245039290518360064"
PICKS_FILE = next(LG_2025.glob("draft_*_picks.json"))
ROSTERS_FILE = LG_2025 / "rosters.json"
PLAYERS_FILE = ROOT / "data/sleeper/players_nfl.json"
MATCHUPS_DIR = LG_2025 / "matchups"
XLSX = ROOT / "data/historical/MONEY_LEAGUE.xlsx"
ROUND_PENALTY = 2
MAX_KEEPERS = 4


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().strip()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()


def xlsx_keeper_years_2025() -> dict[str, int]:
    """{normalized_player_name: year_of_keeping_in_2025}.

    Year 3 means this is their 3rd year → cannot be kept again in 2026.
    """
    try:
        import openpyxl
    except ImportError:
        return {}
    out: dict[str, int] = {}
    try:
        wb = openpyxl.load_workbook(XLSX, data_only=True)
        ws = wb["FF2025"]
        for r in range(1, 18):
            for c in range(2, 14):
                cell = ws.cell(r, c)
                if not (cell.comment and "keeper" in cell.comment.text.lower()):
                    continue
                m = re.search(r"(\d+)(?:st|nd|rd|th)\s*year keeper",
                              cell.comment.text, re.IGNORECASE)
                if m and cell.value:
                    out[_norm(str(cell.value))] = int(m.group(1))
    except Exception:
        pass
    return out


def _player_season_pts() -> dict[str, float]:
    pts: dict[str, float] = defaultdict(float)
    for f in sorted(MATCHUPS_DIR.glob("week_*.json")):
        for e in json.loads(f.read_text()):
            for pid, p in (e.get("players_points") or {}).items():
                if p:
                    pts[pid] += p
    return pts


def predict_2026_keepers() -> dict[int, list[dict]]:
    picks = json.loads(PICKS_FILE.read_text())
    rosters = json.loads(ROSTERS_FILE.read_text())
    players = json.loads(PLAYERS_FILE.read_text())
    season_pts = _player_season_pts()
    keeper_yr = xlsx_keeper_years_2025()

    def pname(pid: str) -> str:
        p = players.get(pid, {})
        return p.get("full_name") or f"{p.get('first_name','')} {p.get('last_name','')}".strip()

    def ppos(pid: str) -> str:
        return players.get(pid, {}).get("position", "?")

    picks_by_team: dict[int, list[dict]] = defaultdict(list)
    pick_by_pid: dict[str, dict] = {}
    for p in picks:
        rid = p.get("roster_id")
        if rid:
            picks_by_team[rid].append(p)
        pid = p.get("player_id")
        if pid:
            pick_by_pid[pid] = p

    out: dict[int, list[dict]] = {}
    for r in rosters:
        rid = r["roster_id"]
        roster_pids = r.get("players") or []
        confirmed: list[dict] = []
        aged_out: list[dict] = []

        # 1. Auto-roll 2025 keepers
        for p in picks_by_team[rid]:
            if not p.get("is_keeper"):
                continue
            pid = p.get("player_id")
            if not pid:
                continue
            nm = pname(pid)
            year_2025 = keeper_yr.get(_norm(nm), 1)
            new_cost = p["round"] - ROUND_PENALTY
            entry = {
                "name": nm,
                "pos": ppos(pid),
                "player_id": pid,
                "year_2026": year_2025 + 1,
                "cost_round_2026": new_cost,
                "drafted_round_2025": p["round"],
                "year_2025": year_2025,
                "pts_2025": round(season_pts.get(pid, 0), 1),
                "source": "carry-over",
            }
            if year_2025 >= 3 or new_cost <= 0:
                entry["age_out_reason"] = (
                    f"3-year cap" if year_2025 >= 3
                    else f"cost would be R{new_cost} <= 0")
                aged_out.append(entry)
            else:
                confirmed.append(entry)

        # 2. Fill remaining slots from R3+ non-keepers on roster
        carryover_pids = {e["player_id"] for e in confirmed}
        bubble: list[dict] = []
        for pid in roster_pids:
            if pid in carryover_pids:
                continue
            pk = pick_by_pid.get(pid)
            if pk:
                # Drafted in 2025; R1/R2 are ineligible
                if pk["round"] < 3:
                    continue
                if pk.get("is_keeper"):
                    # Already covered above (or aged out)
                    continue
                cost = pk["round"] - ROUND_PENALTY
                drafted_rnd = pk["round"]
            else:
                # Waiver pickup — assumed eligible at deepest-round cost
                cost = 17
                drafted_rnd = None
            if cost <= 0:
                continue
            bubble.append({
                "name": pname(pid),
                "pos": ppos(pid),
                "player_id": pid,
                "year_2026": 1,
                "cost_round_2026": cost,
                "drafted_round_2025": drafted_rnd,
                "year_2025": 0,
                "pts_2025": round(season_pts.get(pid, 0), 1),
                "source": "new keeper (R3+ roster)" if drafted_rnd
                          else "new keeper (waiver pickup)",
            })

        # Sort bubble by 2025 fpts desc, take top (MAX_KEEPERS - confirmed)
        bubble.sort(key=lambda x: -x["pts_2025"])
        n_open = MAX_KEEPERS - len(confirmed)
        adds = bubble[:n_open] if n_open > 0 else []

        out[rid] = {
            "confirmed": confirmed,
            "aged_out": aged_out,
            "bubble_adds": adds,
            "bubble_others": bubble[n_open:n_open + 4] if n_open > 0 else bubble[:4],
            "predicted": confirmed + adds,
        }
    return out


def _main():
    """Print a CLI-friendly table of predicted 2026 keepers per team."""
    pred = predict_2026_keepers()
    print("=" * 92)
    print(f"PREDICTED 2026 KEEPERS  (max {MAX_KEEPERS}/team · 3-year cap enforced via xlsx)")
    print("=" * 92)
    for rid in sorted(pred):
        block = pred[rid]
        print(f"\n--- ROSTER {rid} ---")
        print(f"   {'Player':<26} {'Pos':<4} {'2025 Pick':<10} "
              f"{'2026 Cost':<10} {'Yr':<3} {'2025 Pts':<8} {'Source'}")
        for e in block["predicted"]:
            origin = (f"R{e['drafted_round_2025']:>2}" if e['drafted_round_2025']
                      else "waiver")
            print(f" K {e['name'][:25]:<26} {e['pos']:<4} {origin:<10} "
                  f"R{e['cost_round_2026']:>2}        "
                  f"{e['year_2026']:<3} {e['pts_2025']:<8.1f} {e['source']}")
        for e in block["aged_out"]:
            print(f" X {e['name'][:25]:<26} {e['pos']:<4} "
                  f"R{e['drafted_round_2025']:>2}        AGED-OUT  "
                  f"{e['year_2026']:<3} {e['pts_2025']:<8.1f} {e['age_out_reason']}")
    total = sum(len(b["predicted"]) for b in pred.values())
    print(f"\nTotal predicted 2026 keepers: {total} / 48 max")


if __name__ == "__main__":
    _main()
