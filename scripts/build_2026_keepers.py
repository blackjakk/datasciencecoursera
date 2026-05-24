"""Build the canonical 2026 keepers file from xlsx truth + 2026 projections.

Pipeline:
  1. Read 2025 keepers from MONEY_LEAGUE.xlsx (41 records: 24 yr1, 14 yr2, 3 yr3).
  2. Map each to the 2025 Sleeper draft pick via (normalized_name, round) to get
     the team's draft_slot.
  3. Match the player to the canonical 2026 projections name (handles
     "CJ Stroud" vs "C.J. Stroud", etc.) so apply_keepers can find them.
  4. Compute each eligible keeper's NET VBD (player's 2026 VBD minus the
     expected VBD of the player you'd otherwise draft in the forfeit
     round). Any keeper with net VBD < 0 is downgraded from "carryover"
     to "drop_recommended" -- the team is better off forfeiting that
     keeper slot than burning the pick on someone below replacement.
  5. Emit data/keepers_2026.json with one record per 2025 keeper.

`status` is one of:
  - "carryover":        eligible AND net VBD >= 0; will be applied to draft.
  - "drop_recommended": eligible BUT net VBD < 0; assumed dropped.
  - "forced_drop":      yr3 keepers hitting the 3-year cap; cannot be kept.

Both "drop_recommended" and "forced_drop" records still go in the file for
documentation, but apply_keepers (via the live-draft loader) only honors
"carryover" status.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.draft import Draft  # noqa: E402
from fantasy_draft.keeper_predict import expected_vbd_curve  # noqa: E402
from fantasy_draft.keepers import Keeper, apply_keepers  # noqa: E402
from fantasy_draft.players import load_players  # noqa: E402
from fantasy_draft.projections import load_projections_from_cache  # noqa: E402
from fantasy_draft.sleeper_offline import league_from_offline  # noqa: E402
from fantasy_draft.trades import apply_trades, load_trades_from_sleeper_dump  # noqa: E402
from fantasy_draft.vbd import compute_vbd_post_keepers  # noqa: E402
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


def _compute_net_vbd_by_canonical_name() -> dict[str, float]:
    """Run the full pipeline (trades + keepers as if every eligible 2025
    keeper were declared) to get a post-keeper VBD context, then compute
    net VBD for each candidate keeper using the same curve the report
    uses. Returns {lowercased_canonical_name: net_vbd}.

    The "pretend everyone keeps everything" pass is just to get the right
    replacement levels. We then read the resulting VBDs off each keeper
    individually.
    """
    cfg = league_from_offline(str(Path("data/sleeper")),
                               round_penalty=2, max_years_consecutive=3)
    players = load_players("data/players_2026.csv")

    # Pass 1: pretend every eligible 2025 keeper carries over.
    xlsx_keepers = load_keepers_for_year(XLSX_PATH, 2025)
    picks = json.loads(PICKS_PATH.read_text())
    pick_idx = _index_picks_by_name(picks)
    proj = load_projections_from_cache(PROJ_CACHE, scoring="half_ppr")
    canon = _canonical_name_lookup(proj)

    draft = Draft.new(cfg)
    trades = [t for t in load_trades_from_sleeper_dump("data/sleeper")
              if t.season == 2026]
    apply_trades(draft, trades)
    applied = []
    for k in xlsx_keepers:
        if k.years_kept >= 3:
            continue
        norm = normalize_name(k.player_name)
        p = pick_idx.get(norm)
        if not p:
            continue
        canonical = canon.get(norm) or k.player_name
        applied.append(Keeper(
            team_idx=int(p["roster_id"]) - 1,
            player_name=canonical,
            prior_round=k.round_num,
            years_kept=k.years_kept,
        ))
    apply_keepers(draft, players, applied)
    kept = {p.player.name for p in draft.picks if p.is_keeper and p.player}
    _, replacement_proj = compute_vbd_post_keepers(players, cfg, keeper_names=kept)
    # Assign post-keeper VBD to the kept players too.
    kept_lc = {n.lower() for n in kept}
    for p in players:
        if p.name.lower() in kept_lc:
            p.vbd = p.projection - replacement_proj.get(p.position, 0.0)

    curve = expected_vbd_curve(players, cfg)
    pbn = {p.name.lower(): p for p in players}

    out: dict[str, float] = {}
    for k in xlsx_keepers:
        if k.years_kept >= 3:
            continue
        norm = normalize_name(k.player_name)
        canonical = canon.get(norm) or k.player_name
        p = pbn.get(canonical.lower())
        if p is None:
            continue
        forfeit = max(1, k.round_num - cfg.keepers.round_penalty)
        out[canonical.lower()] = p.vbd - curve.get(forfeit, 0.0)
    return out


def build() -> list[dict]:
    keepers = load_keepers_for_year(XLSX_PATH, 2025)
    picks = json.loads(PICKS_PATH.read_text())
    pick_idx = _index_picks_by_name(picks)
    proj = load_projections_from_cache(PROJ_CACHE, scoring="half_ppr")
    canon = _canonical_name_lookup(proj)
    net_vbd_lookup = _compute_net_vbd_by_canonical_name()

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

        if k.years_kept >= 3:
            status = "forced_drop"
            net_vbd = None
        else:
            net_vbd = round(net_vbd_lookup.get(canonical.lower(), 0.0), 1)
            status = "carryover" if net_vbd >= 0 else "drop_recommended"

        out.append({
            "team_idx": roster_id - 1,          # 0..11; matches trades' roster_id key
            "roster_id": roster_id,
            "draft_slot_2025": draft_slot_2025,  # informational only
            "player_name": canonical,
            "position": p["metadata"]["position"],
            "prior_round": k.round_num,
            "years_kept": k.years_kept,
            "status": status,
            "net_vbd": net_vbd,
        })
    return out


def main():
    records = build()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(records, indent=2))

    carryover = [r for r in records if r["status"] == "carryover"]
    drop_rec = [r for r in records if r["status"] == "drop_recommended"]
    forced = [r for r in records if r["status"] == "forced_drop"]
    by_team: dict[int, list[dict]] = {}
    for r in records:
        by_team.setdefault(r["team_idx"], []).append(r)

    print(f"\nWrote {OUT_PATH} with {len(records)} records "
          f"({len(carryover)} carryover, {len(drop_rec)} drop_recommended, "
          f"{len(forced)} forced drops).")
    print("\nPer-team summary (keyed by roster_id):")
    for idx in sorted(by_team):
        recs = by_team[idx]
        carry = [r for r in recs if r["status"] == "carryover"]
        dropr = [r for r in recs if r["status"] == "drop_recommended"]
        forced_team = [r for r in recs if r["status"] == "forced_drop"]
        keep_names = ", ".join(f"{r['player_name']}(+{r['net_vbd']:.0f})"
                                for r in carry)
        drop_names = ", ".join(f"{r['player_name']}({r['net_vbd']:.0f})"
                                for r in dropr)
        forced_names = ", ".join(r['player_name'] for r in forced_team)
        print(f"  roster {idx+1:>2}: {len(carry)} KEEP [{keep_names}]")
        if dropr:
            print(f"             {len(dropr)} DROP [{drop_names}]")
        if forced_team:
            print(f"             {len(forced_team)} FORCED [{forced_names}]")


if __name__ == "__main__":
    main()
