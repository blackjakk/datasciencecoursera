"""Build the canonical 2026 keepers file from 2025 ENDING ROSTERS + 2026
projections (the roster-wide approach).

Pipeline:
  1. Walk every player on every team's 2025 end-of-season roster
     (data/sleeper/league_<2025>/rosters.json).
  2. Determine each candidate's prior_round:
       - drafted in 2025 -> the round they were drafted in
       - waiver / undrafted pickup -> 19 (so 2026 cost = R17, the last
         round; per league rule "waiver = R17+2")
  3. Cross-reference MONEY_LEAGUE.xlsx 2025 keeper tags to get years_kept
     (so we can fire the 3-year cap correctly).
  4. Compute each candidate's 2026 net VBD = post-keeper VBD minus the
     expected VBD of the player you'd otherwise draft at the forfeit
     round. Iterate 2 passes so replacement levels converge after
     picking keepers.
  5. For each team, take the top max_keepers candidates with net VBD > 0
     and prior_round >= 3 (R1/R2 picks ineligible: forfeit_round would
     be <= 0).
  6. Emit data/keepers_2026.json -- the top-4-positive per team as
     "carryover", plus all yr3 cap hits as "forced_drop" for
     documentation.

`status` is one of:
  - "carryover":   in the top-4-positive set for this team; will be applied.
  - "forced_drop": yr3 keepers hitting the 3-year cap; cannot be kept.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.draft import Draft  # noqa: E402
from fantasy_draft.keepers import Keeper, apply_keepers  # noqa: E402
from fantasy_draft.name_aliases import resolve_xlsx_name  # noqa: E402
from fantasy_draft.players import load_players  # noqa: E402
from fantasy_draft.projections import load_projections_from_cache  # noqa: E402
from fantasy_draft.sleeper_offline import league_from_offline  # noqa: E402
from fantasy_draft.trades import apply_trades, load_trades_from_sleeper_dump  # noqa: E402
from fantasy_draft.vbd import compute_vbd_post_keepers  # noqa: E402
from fantasy_draft.xlsx_history import load_keepers_for_year, normalize_name  # noqa: E402


XLSX_PATH = Path("data/historical/MONEY_LEAGUE.xlsx")
SEASON_2025 = Path("data/sleeper/league_1245039290518360064")
PICKS_PATH = SEASON_2025 / "draft_1245039290522550272_picks.json"
ROSTERS_PATH = SEASON_2025 / "rosters.json"
CATALOG_PATH = Path("data/sleeper/players_nfl.json")
PROJ_CACHE = Path("data/sleeper_projections_2026.json")
OUT_PATH = Path("data/keepers_2026.json")
PICK_VALUE_PATH = Path("data/pick_value.json")

WAIVER_PRIOR_ROUND = 19   # league rule: waiver/undrafted pickups cost R17 (= 19 - 2)
ROUND_PENALTY = 2
MAX_KEEPERS = 4
MAX_YEARS = 3


def _canonical_for_player(player_meta: dict, name_to_canonical: dict[str, str]) -> str:
    """Resolve a Sleeper player catalog entry to a 2026-projections canonical name."""
    nm = player_meta.get("full_name") or (
        f"{player_meta.get('first_name', '').strip()} "
        f"{player_meta.get('last_name', '').strip()}"
    ).strip()
    if not nm:
        return ""
    return name_to_canonical.get(normalize_name(nm), nm)


def _build_candidates() -> list[dict]:
    """For each (team, player) pair on the 2025 ending roster, build a
    candidate dict with everything needed to score it as a 2026 keeper."""
    rosters = json.loads(ROSTERS_PATH.read_text())
    picks = json.loads(PICKS_PATH.read_text())
    catalog = json.loads(CATALOG_PATH.read_text())
    proj = load_projections_from_cache(PROJ_CACHE, scoring="half_ppr")
    name_to_canonical = {normalize_name(p.name): p.name for p in proj}

    # Map player_id -> 2025 draft pick (for prior_round) and keep position.
    pick_by_pid: dict[str, dict] = {str(p["player_id"]): p for p in picks}

    # xlsx 2025 tags for years_kept tracking. resolve_xlsx_name first so we
    # match the canonical Sleeper name.
    xlsx_keepers = load_keepers_for_year(XLSX_PATH, 2025)
    years_kept_by_canonical: dict[str, int] = {}
    for k in xlsx_keepers:
        canon = resolve_xlsx_name(k.player_name) or k.player_name
        years_kept_by_canonical[normalize_name(canon)] = k.years_kept

    candidates: list[dict] = []
    for r in rosters:
        roster_id = int(r["roster_id"])
        team_idx = roster_id - 1
        for pid in (r.get("players") or []):
            pid = str(pid)
            cat_entry = catalog.get(pid)
            if not cat_entry:
                continue
            pos = cat_entry.get("position")
            if pos not in ("QB", "RB", "WR", "TE", "K", "DEF"):
                continue
            canonical = _canonical_for_player(cat_entry, name_to_canonical)
            if not canonical:
                continue

            # prior_round: from 2025 draft pick OR waiver default.
            if pid in pick_by_pid:
                prior_round = int(pick_by_pid[pid]["round"])
            else:
                prior_round = WAIVER_PRIOR_ROUND

            forfeit_round = prior_round - ROUND_PENALTY
            if forfeit_round < 1:
                # R1 or R2 picks: not eligible (cost would be 0 or negative).
                continue

            years_kept = years_kept_by_canonical.get(normalize_name(canonical), 0)

            candidates.append({
                "team_idx": team_idx,
                "roster_id": roster_id,
                "player_id": pid,
                "player_name": canonical,
                "position": pos,
                "prior_round": prior_round,
                "forfeit_round": forfeit_round,
                "years_kept": years_kept,
                "is_waiver": pid not in pick_by_pid,
            })
    return candidates


def _load_pick_value() -> tuple[dict[int, float], dict[int, dict[str, float]]]:
    """Load empirical pick value chart. Returns (round->mean_vbd_blind,
    round->{pos: mean_vbd_position_aware})."""
    if not PICK_VALUE_PATH.exists():
        sys.exit(f"ERROR: {PICK_VALUE_PATH} missing. Run "
                 f"scripts/build_pick_value.py first.")
    raw = json.loads(PICK_VALUE_PATH.read_text())
    blind = {int(r): d["mean_vbd"] for r, d in raw["by_round"].items()}
    position_aware: dict[int, dict[str, float]] = {}
    for r, per_pos in raw["by_round_position"].items():
        position_aware[int(r)] = {pos: d["mean_vbd"] for pos, d in per_pos.items()}
    return blind, position_aware


def _score_and_select(candidates: list[dict], n_iterations: int = 3) -> list[dict]:
    """Compute net VBD for each candidate, pick top-MAX_KEEPERS positive per
    team. Iterates so replacement levels stabilize after the first selection.

    Uses the EMPIRICAL pick-value chart (mean VBD actually delivered by
    historical players drafted at each round/position) as the comparison
    baseline instead of a current-year projection-based VBD curve. The
    position-aware variant is used so a keeper QB at R5 is judged against
    "what R5 QBs typically deliver" rather than the round-blind average.

    Returns the final keeper records (carryover + forced_drop)."""
    cfg = league_from_offline(str(Path("data/sleeper")),
                               round_penalty=ROUND_PENALTY,
                               max_years_consecutive=MAX_YEARS)
    players = load_players("data/players_2026.csv")

    pv_blind, pv_position_aware = _load_pick_value()

    def _baseline_for(round_num: int, position: str) -> float:
        """Position-aware historical baseline VBD at this forfeit round."""
        per_pos = pv_position_aware.get(round_num) or {}
        if position in per_pos:
            return per_pos[position]
        # Fallback: round-blind mean if position has no sample at this round.
        return pv_blind.get(round_num, 0.0)

    # Start with no keepers selected.
    selected_names: set[str] = set()

    for it in range(n_iterations):
        draft = Draft.new(cfg)
        trades = [t for t in load_trades_from_sleeper_dump("data/sleeper")
                  if t.season == 2026]
        apply_trades(draft, trades)
        applied = []
        for nm in selected_names:
            cand = next((c for c in candidates if c["player_name"] == nm), None)
            if cand is None:
                continue
            applied.append(Keeper(
                team_idx=cand["team_idx"],
                player_name=nm,
                prior_round=cand["prior_round"],
                years_kept=cand["years_kept"],
            ))
        apply_keepers(draft, players, applied)
        kept = {p.player.name for p in draft.picks if p.is_keeper and p.player}
        _, replacement_proj = compute_vbd_post_keepers(players, cfg, keeper_names=kept)
        kept_lc = {n.lower() for n in kept}
        for p in players:
            if p.name.lower() in kept_lc:
                p.vbd = p.projection - replacement_proj.get(p.position, 0.0)
        pbn = {p.name.lower(): p for p in players}

        # Score every candidate using EMPIRICAL pick value at forfeit round.
        for c in candidates:
            p = pbn.get(c["player_name"].lower())
            if p is None:
                c["net_vbd"] = None
                continue
            baseline = _baseline_for(c["forfeit_round"], c["position"])
            c["net_vbd"] = round(p.vbd - baseline, 1)
            c["raw_vbd"] = round(p.vbd, 1)
            c["pick_value_baseline"] = round(baseline, 1)
            c["adp"] = p.adp

        # Re-pick top-4 positive per team (ignore yr3 cap = forced_drop).
        new_selected: set[str] = set()
        by_team: dict[int, list[dict]] = defaultdict(list)
        for c in candidates:
            by_team[c["team_idx"]].append(c)
        for team_idx, cands in by_team.items():
            eligible = [c for c in cands
                        if c["years_kept"] < MAX_YEARS
                        and c.get("net_vbd") is not None
                        and c["net_vbd"] > 0]
            eligible.sort(key=lambda c: -c["net_vbd"])
            for c in eligible[:MAX_KEEPERS]:
                new_selected.add(c["player_name"])

        if new_selected == selected_names:
            break
        selected_names = new_selected
        print(f"  iter {it+1}: {len(selected_names)} keepers selected")

    # Build the output records.
    out: list[dict] = []
    selected_set = selected_names
    seen = set()
    for c in candidates:
        is_selected = c["player_name"] in selected_set
        is_forced = c["years_kept"] >= MAX_YEARS
        # Only emit:
        #   1. selected carryovers (top-4-positive per team)
        #   2. forced_drops (yr3 cap)
        if not (is_selected or is_forced):
            continue
        key = (c["team_idx"], c["player_name"])
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "team_idx": c["team_idx"],
            "roster_id": c["roster_id"],
            "player_name": c["player_name"],
            "position": c["position"],
            "prior_round": c["prior_round"],
            "forfeit_round": c["forfeit_round"],
            "years_kept": c["years_kept"],
            "status": "forced_drop" if is_forced else "carryover",
            "net_vbd": c.get("net_vbd"),
            "raw_vbd": c.get("raw_vbd"),
            "pick_value_baseline": c.get("pick_value_baseline"),
            "adp": c.get("adp"),
            "is_waiver": c.get("is_waiver"),
        })
    return out


def main():
    candidates = _build_candidates()
    print(f"Built {len(candidates)} keeper candidates across all 12 rosters.")
    records = _score_and_select(candidates)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(records, indent=2))

    carryover = [r for r in records if r["status"] == "carryover"]
    forced = [r for r in records if r["status"] == "forced_drop"]
    by_team: dict[int, list[dict]] = defaultdict(list)
    for r in records:
        by_team[r["team_idx"]].append(r)

    print(f"\nWrote {OUT_PATH} with {len(records)} records "
          f"({len(carryover)} carryover, {len(forced)} forced drops).")
    print("\nPer-team selected keepers:")
    for idx in sorted(by_team):
        recs = sorted(by_team[idx], key=lambda r: -(r.get("net_vbd") or 0))
        carry = [r for r in recs if r["status"] == "carryover"]
        forced_team = [r for r in recs if r["status"] == "forced_drop"]
        kn = ", ".join(f"{r['player_name']}(R{r['forfeit_round']}, "
                        f"{r.get('net_vbd', 0):+.0f})" for r in carry)
        fn = ", ".join(f"{r['player_name']}" for r in forced_team)
        total = sum(r.get("net_vbd") or 0 for r in carry)
        print(f"  roster {idx+1:>2}: {len(carry)} KEEP, total {total:+.0f}")
        if kn:
            print(f"             {kn}")
        if fn:
            print(f"             FORCED: {fn}")


if __name__ == "__main__":
    main()
