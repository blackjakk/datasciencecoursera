"""Build the data bundle for the draft helper at docs/draft_helper/data.json.

Includes:
  - Player pool (top by VBD; with FP overlay)
  - Brian's keepers (auto-applied to his pick slots)
  - Other managers' keepers (so the helper can auto-place them as we go)
  - Draft order (predicted 2026)
  - Brian's pick schedule (overall # per round)
  - Manager tendencies (for "Lem likely takes DEF early" hints)
"""
from __future__ import annotations

import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.team_identity import all_managers, manager_for_sleeper_roster  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "draft_helper" / "data.json"

SEASON_CFG = json.loads((ROOT / "configs" / "season_2026.json").read_text())
PREDICTED_SLOT_TO_RID = {
    int(k): v for k, v in SEASON_CFG["slot_to_roster_id"].items()
}
_RID_TO_SLOT = {rid: slot for slot, rid in PREDICTED_SLOT_TO_RID.items()}
MY_SLOT = _RID_TO_SLOT[SEASON_CFG["my_roster_id"]]  # Brian
ROUNDS = 17

# ---------- players: csv + FP overlay + Sleeper VBD ----------
def _norm(s: str) -> str:
    return s.lower().replace(".", "").replace("'", "").replace("-", " ").strip()


def load_players() -> list[dict]:
    rows = []
    with open(ROOT / "data" / "players_2026.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            rows.append(r)
    # Apply FP overlay (override ADP + promote projection)
    fp = json.loads((ROOT / "data" / "rankings_fantasypros.json").read_text())
    fp_by_key = {(_norm(p["name"]), p["position"].upper()): p
                 for p in fp.get("players", [])}

    # Per-position sleeper proj sorted (for FP-rank promotion)
    by_pos = defaultdict(list)
    for r in rows:
        by_pos[r["position"]].append(r)
    for pos in by_pos:
        by_pos[pos].sort(key=lambda r: -float(r["projection"]))

    for r in rows:
        key = (_norm(r["name"]), r["position"].upper())
        f = fp_by_key.get(key)
        if not f:
            continue
        adp = f.get("fp_adp_avg")
        if adp is not None:
            try:
                r["adp"] = float(adp)
            except (TypeError, ValueError):
                pass
        # Promote projection
        pr = f.get("fp_rank_pos") or ""
        digits = "".join(c for c in pr if c.isdigit())
        if digits:
            target_rank = int(digits)
            if 1 <= target_rank <= len(by_pos[r["position"]]):
                r["projection"] = by_pos[r["position"]][target_rank - 1]["projection"]
        r["fp_rank"] = f.get("fp_rank_overall")
        r["fp_pos_rank"] = f.get("fp_rank_pos")

    # Compute league-specific VBD (1 QB + 1 SUPERFLEX = ~22 QB replacement,
    # 2 RB + 0.6 flex = ~31 RB replacement, 3 WR + 0.48 flex = ~42, TE = ~13)
    REPLACEMENT_RANKS = {"QB": 22, "RB": 31, "WR": 42, "TE": 13, "K": 12, "DEF": 12}
    repl_pts = {}
    for pos in ("QB", "RB", "WR", "TE", "K", "DEF"):
        plist = sorted(
            [float(r["projection"]) for r in rows if r["position"] == pos],
            reverse=True,
        )
        rnk = REPLACEMENT_RANKS.get(pos, 12)
        repl_pts[pos] = plist[rnk - 1] if rnk <= len(plist) else 0

    # Sleeper player catalog for age / rookie status
    catalog = json.loads((ROOT / "data" / "sleeper" / "players_nfl.json").read_text())
    name_to_meta = {}
    for pid, p in catalog.items():
        nm = p.get("full_name")
        if nm and p.get("position") in ("QB", "RB", "WR", "TE", "K", "DEF"):
            if (nm, p.get("position")) not in name_to_meta:
                name_to_meta[(nm, p.get("position"))] = {
                    "age": p.get("age"),
                    "years_exp": p.get("years_exp"),
                    "status": p.get("status"),
                    "injury_status": p.get("injury_status") or "",
                }

    out = []
    for r in rows:
        proj = float(r["projection"])
        if proj <= 0:
            continue
        vbd = round(proj - repl_pts.get(r["position"], 0), 1)
        meta = name_to_meta.get((r["name"], r["position"]), {})
        out.append({
            "name": r["name"],
            "pos": r["position"],
            "team": r["team"],
            "adp": round(float(r["adp"]), 1),
            "proj": round(proj, 1),
            "vbd": vbd,
            "fp_rank": r.get("fp_rank"),
            "fp_pos_rank": r.get("fp_pos_rank"),
            "age": meta.get("age"),
            "years_exp": meta.get("years_exp"),
            "injury": meta.get("injury_status") or "",
        })
    # Keep the pool DEEP: live-sync marks every real Sleeper pick against this
    # list, and managers draft bench-tier players well below replacement. The
    # old vbd > -100 cutoff (381 players) left ~25 of 204 real 2025 picks
    # unmatchable. Draftable = has an ADP or projects >= 20 pts.
    out = [p for p in out if p["adp"] < 999 or p["proj"] >= 20]
    out.sort(key=lambda p: -p["vbd"])
    return out


def load_keepers() -> list[dict]:
    raw = json.loads((ROOT / "data" / "keepers_2026.json").read_text())
    return [k for k in raw if k.get("status") == "carryover"]


def load_managers() -> list[dict]:
    mgrs = []
    for slot, rid in PREDICTED_SLOT_TO_RID.items():
        m = manager_for_sleeper_roster(rid)
        mid = m["id"] if m else f"rid{rid}"
        nm = m.get("display_name") if m else f"Team {slot}"
        mgrs.append({
            "slot": slot,
            "team_idx": slot - 1,
            "roster_id": rid,
            "id": mid,
            "name": nm,
        })
    return mgrs


def build_pick_schedule() -> list[dict]:
    out = []
    for rnd in range(1, ROUNDS + 1):
        for pos_in_rnd in range(1, 13):
            if rnd % 2 == 1:
                slot = pos_in_rnd
            else:
                slot = 13 - pos_in_rnd
            out.append({
                "round": rnd,
                "pick_in_round": pos_in_rnd,
                "overall": (rnd - 1) * 12 + pos_in_rnd,
                "slot": slot,
                "team_idx": slot - 1,
            })
    return out


def load_tendencies() -> dict:
    return json.loads((ROOT / "data" / "manager_tendencies.json").read_text())


def attach_survival(players: list[dict]) -> int:
    """Attach Monte Carlo draft-position quantiles (11 values: percentiles
    0,10,...,100 of the overall pick where the player left the board) from
    mc_summary_all.json. Players with no entry were never drafted in any
    sim — the helper treats them as always-available."""
    mc_path = ROOT / "data" / "mc_summary_all.json"
    if not mc_path.exists():
        return 0
    survival = json.loads(mc_path.read_text()).get("survival", {})
    attached = 0
    for p in players:
        q = survival.get(p["name"])
        if q:
            p["svq"] = q
            attached += 1
    return attached


def main():
    players = load_players()
    keepers = load_keepers()
    managers = load_managers()
    schedule = build_pick_schedule()
    tendencies = load_tendencies()
    n_sv = attach_survival(players)
    print(f"Attached survival curves to {n_sv} players")

    # Traded 2026 picks (override Pick.team_idx by ownership)
    traded = json.loads(
        (ROOT / SEASON_CFG["league_dir"] / "traded_picks.json").read_text()
    )
    rid_to_slot = {rid: slot for slot, rid in PREDICTED_SLOT_TO_RID.items()}
    overrides = {}
    for t in traded:
        if str(t.get("season")) != "2026":
            continue
        overrides[(int(t["round"]), int(t["roster_id"]))] = int(t["owner_id"])
    for pick in schedule:
        orig_slot = pick["pick_in_round"] if pick["round"] % 2 == 1 else 13 - pick["pick_in_round"]
        orig_rid = PREDICTED_SLOT_TO_RID[orig_slot]
        new_rid = overrides.get((pick["round"], orig_rid), orig_rid)
        new_slot = rid_to_slot[new_rid]
        pick["slot"] = new_slot
        pick["team_idx"] = new_slot - 1

    bundle = {
        "my_slot": MY_SLOT,
        "my_team_idx": MY_SLOT - 1,
        "rounds": ROUNDS,
        "players": players,
        "keepers": keepers,
        "managers": managers,
        "schedule": schedule,
        "tendencies": tendencies,
        "league_rules": {
            "round_penalty": 2,
            "max_keepers": 4,
            "max_years_consecutive": 3,
            "waiver_keeper_round": 17,
        },
    }
    OUT.write_text(json.dumps(bundle, indent=2))
    print(f"Wrote {OUT} — {len(players)} players, {len(keepers)} keepers, "
          f"{len(schedule)} picks")


if __name__ == "__main__":
    main()
