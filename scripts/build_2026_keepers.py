"""Build the canonical 2026 keepers file from xlsx truth + 2026 projections.

Pipeline:
  1. Read 2025 keepers from MONEY_LEAGUE.xlsx (41 records: 24 yr1, 14 yr2, 3 yr3).
  2. Map each to the 2025 Sleeper draft pick via (normalized_name, round) to get
     the team's draft_slot.
  3. Match the player to the canonical 2026 projections name (handles
     "CJ Stroud" vs "C.J. Stroud", etc.) so apply_keepers can find them.
  4. Emit data/keepers_2026.json (list of {team_idx, draft_slot, player_name,
     prior_round, years_kept, status}).

`status` is one of:
  - "carryover": eligible to be re-kept in 2026 (years_kept will become +1).
  - "forced_drop": yr3 keepers hitting the 3-year cap; cannot be kept.

The 3 forced drops still go in the file so the live draft can display them as
"used to be a keeper, now back in the pool" and so consumers can see the full
picture, but apply_keepers will (correctly) reject them via max_years_consecutive.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.projections import load_projections_from_cache  # noqa: E402
from fantasy_draft.xlsx_history import load_keepers_for_year, normalize_name  # noqa: E402


XLSX_PATH = Path("data/historical/MONEY_LEAGUE.xlsx")
PICKS_PATH = Path("data/sleeper/league_1245039290518360064/draft_1245039290522550272_picks.json")
PROJ_CACHE = Path("data/sleeper_projections_2026.json")
OUT_PATH = Path("data/keepers_2026.json")


def _index_picks_by_name(picks: list[dict]) -> dict[str, dict]:
    """norm_name -> pick row (most-recent / unique match)."""
    out: dict[str, dict] = {}
    for p in picks:
        meta = p.get("metadata") or {}
        name = f"{meta.get('first_name', '').strip()} {meta.get('last_name', '').strip()}".strip()
        if not name:
            continue
        out[normalize_name(name)] = p
    return out


def _canonical_name_lookup(proj_players) -> dict[str, str]:
    return {normalize_name(p.name): p.name for p in proj_players}


def build() -> list[dict]:
    keepers = load_keepers_for_year(XLSX_PATH, 2025)
    picks = json.loads(PICKS_PATH.read_text())
    pick_idx = _index_picks_by_name(picks)
    proj = load_projections_from_cache(PROJ_CACHE, scoring="half_ppr")
    canon = _canonical_name_lookup(proj)

    out: list[dict] = []
    for k in keepers:
        norm = normalize_name(k.player_name)
        p = pick_idx.get(norm)
        if not p:
            print(f"WARN: no Sleeper pick for {k.player_name} R{k.round_num}; skipping.")
            continue
        canonical = canon.get(norm)
        if canonical is None:
            # Player not in 2026 projections (retired? out of league?). Keep
            # the xlsx name; the live draft will flag it on apply.
            canonical = k.player_name
            print(f"WARN: {k.player_name} not in 2026 projections; using raw name.")

        draft_slot_2025 = int(p["draft_slot"])
        roster_id = int(p["roster_id"])
        status = "forced_drop" if k.years_kept >= 3 else "carryover"
        # team_idx keys on roster_id (persistent team identity) so it lines up
        # with traded_picks.json (also keyed on roster_id). The 2026 draft slot
        # order isn't drawn yet; the live-draft engine treats team_idx as the
        # 2026 snake slot, so this implicitly assumes slot = roster_id until
        # the real 2026 draft is created and slots are randomized.
        out.append({
            "team_idx": roster_id - 1,          # 0..11; matches trades' roster_id key
            "roster_id": roster_id,
            "draft_slot_2025": draft_slot_2025,  # informational only
            "player_name": canonical,
            "position": p["metadata"]["position"],
            "prior_round": k.round_num,
            "years_kept": k.years_kept,
            "status": status,
        })
    return out


def main():
    records = build()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(records, indent=2))

    carryover = [r for r in records if r["status"] == "carryover"]
    forced = [r for r in records if r["status"] == "forced_drop"]
    by_team: dict[int, list[dict]] = {}
    for r in records:
        by_team.setdefault(r["team_idx"], []).append(r)

    print(f"\nWrote {OUT_PATH} with {len(records)} records "
          f"({len(carryover)} carryover, {len(forced)} forced drops).")
    print("\nPer-team summary (keyed by roster_id):")
    for idx in sorted(by_team):
        recs = by_team[idx]
        carry = [r for r in recs if r["status"] == "carryover"]
        drop = [r for r in recs if r["status"] == "forced_drop"]
        names = ", ".join(f"{r['player_name']}(R{r['prior_round']},yr{r['years_kept']})"
                          for r in recs)
        print(f"  roster {idx+1:>2} ({len(carry)} keep, {len(drop)} drop): {names}")


if __name__ == "__main__":
    main()
