"""MONEYLEAGUE 2026 mock draft simulator.

Builds the predicted 2026 draft (with traded picks + projected keepers),
runs one full simulation -> /tmp/mock_draft_picks.json, then runs N Monte
Carlo simulations -> data/mc_summary_all.json. The report script
(build_mock_draft_report.py) consumes both to render the PDF.
"""
from __future__ import annotations

import json
import random
import sys
from collections import defaultdict, Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.draft import Draft  # noqa: E402
from fantasy_draft.league import LeagueConfig  # noqa: E402
from fantasy_draft.players import load_players  # noqa: E402
from fantasy_draft.simulate import simulate_full_draft, _softmax_pick, _snapshot_teams  # noqa: E402
from fantasy_draft.vbd import compute_vbd  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LEAGUE_CFG = ROOT / "configs" / "my_league.json"
PLAYERS_CSV = ROOT / "data" / "players_2026.csv"
KEEPERS_JSON = ROOT / "data" / "keepers_2026.json"
TRADED_PICKS_JSON = ROOT / "data" / "sleeper" / "league_1245039290518360064" / "traded_picks.json"

PICKS_OUT = Path("/tmp/mock_draft_picks.json")
MC_OUT = ROOT / "data" / "mc_summary_all.json"

# Predicted 2026 draft slot -> roster_id (matches build_mock_draft_report.py)
PREDICTED_SLOT_TO_RID = {
    1: 6, 2: 12, 3: 5, 4: 4, 5: 2, 6: 9,
    7: 7, 8: 1, 9: 8, 10: 3, 11: 10, 12: 11,
}

N_SIMS = 50
MC_TEMPERATURE = 0.25       # Monte Carlo: some variance for honest distributions
DISPLAY_TEMPERATURE = 0.0   # Displayed board: greedy / no reaches
TOP_K = 15
MY_RID = 9  # Brian — bottom of consolation


def _norm(s: str) -> str:
    return s.lower().replace(".", "").replace("'", "").replace("-", " ").strip()


def build_draft() -> tuple[Draft, list, int]:
    league = LeagueConfig.load(LEAGUE_CFG)
    players = load_players(PLAYERS_CSV)
    compute_vbd(players, league)

    # Roster IDs filtered to those we have a slot for.
    rid_to_slot = {rid: slot for slot, rid in PREDICTED_SLOT_TO_RID.items()}
    # team_idx = slot - 1
    team_names = [f"Slot {i+1}" for i in range(12)]
    league.draft_order = list(range(12))  # slot N -> team_idx N-1
    draft = Draft.new(league, team_names)

    # Apply 2026 traded picks: reassign Pick.team_idx by ownership.
    # traded_picks entries: {season, round, roster_id (original owner),
    # owner_id (current owner — also a roster_id, NOT a Sleeper user_id)}.
    traded = json.loads(TRADED_PICKS_JSON.read_text())
    overrides: dict[tuple[int, int], int] = {}
    for t in traded:
        if str(t.get("season")) != "2026":
            continue
        overrides[(int(t["round"]), int(t["roster_id"]))] = int(t["owner_id"])

    for pick in draft.picks:
        orig_slot = (pick.pick_in_round if pick.round_num % 2 == 1
                     else 13 - pick.pick_in_round)
        orig_rid = PREDICTED_SLOT_TO_RID[orig_slot]
        new_rid = overrides.get((pick.round_num, orig_rid), orig_rid)
        new_slot = rid_to_slot[new_rid]
        pick.team_idx = new_slot - 1

    # Apply keepers: each keeper -> assign player to roster + mark Pick at the
    # forfeit_round for that team as the keeper pick (consumes that round).
    keepers = json.loads(KEEPERS_JSON.read_text())
    name_to_player = {_norm(p.name): p for p in players}
    # Track which (round, team_idx) is consumed by a keeper for that team.
    consumed: set[tuple[int, int]] = set()
    for k in keepers:
        if k.get("status") != "carryover":
            continue
        rid = k["roster_id"]
        slot = rid_to_slot.get(rid)
        if slot is None:
            continue
        team_idx = slot - 1
        player = name_to_player.get(_norm(k["player_name"]))
        if player is None:
            continue
        forfeit_rnd = int(k.get("effective_forfeit_round") or k.get("forfeit_round") or 0)
        if forfeit_rnd <= 0 or forfeit_rnd > league.rounds:
            continue
        # Find this team's pick in forfeit_rnd that isn't already a keeper.
        target = next((p for p in draft.picks
                       if p.round_num == forfeit_rnd and p.team_idx == team_idx
                       and (p.round_num, p.team_idx) not in consumed
                       and p.player is None), None)
        if target is None:
            continue
        target.player = player
        target.is_keeper = True
        consumed.add((forfeit_rnd, team_idx))
        draft.teams[team_idx].add(player)

    my_team_idx = rid_to_slot[MY_RID] - 1
    return draft, players, my_team_idx


def _pick_to_dict(fp, players_by_name) -> dict:
    p = players_by_name.get(_norm(fp.player_name))
    return {
        "round": fp.round_num,
        "pick_in_round": fp.pick_in_round,
        "overall": fp.overall,
        "team_idx": fp.team_idx,
        "player_name": fp.player_name,
        "position": fp.position,
        "team_nfl": p.team if p else "",
        "projection": p.projection if p else 0.0,
        "adp": p.adp if p else 999.0,
        "vbd": fp.vbd,
        "is_keeper": fp.is_keeper,
        "age": 0,
        "years_exp": 0,
    }


def main():
    draft, players, my_team_idx = build_draft()
    players_by_name = {_norm(p.name): p for p in players}

    # One full sim for the draft board — deterministic so the visible board
    # has no implausible reaches (e.g. Chase falling past pick 5).
    rng = random.Random(42)
    full = simulate_full_draft(draft, players, my_team_idx,
                               temperature=DISPLAY_TEMPERATURE,
                               top_k=TOP_K, rng=rng)
    picks_dicts = [_pick_to_dict(fp, players_by_name) for fp in full]
    PICKS_OUT.write_text(json.dumps(picks_dicts, indent=2))
    print(f"Wrote {PICKS_OUT} ({len(picks_dicts)} picks)")

    # Position counts sanity check
    counts = defaultdict(lambda: defaultdict(int))
    for d in picks_dicts:
        counts[d["team_idx"]][d["position"]] += 1
    qb_counts = sorted(counts[ti].get("QB", 0) for ti in counts)
    print(f"QB counts per team (sorted): {qb_counts}")

    # Monte Carlo across N_SIMS — collect totals + pick distribution per team.
    per_team_totals: dict[int, list[float]] = {ti: [] for ti in range(12)}
    per_team_round_picks: dict[int, dict[int, Counter]] = {
        ti: defaultdict(Counter) for ti in range(12)
    }
    mc_rng = random.Random(7)
    for sim_idx in range(N_SIMS):
        sim_rng = random.Random(mc_rng.randint(0, 10**9))
        sim_full = simulate_full_draft(draft, players, my_team_idx,
                                       temperature=MC_TEMPERATURE, top_k=TOP_K,
                                       rng=sim_rng)
        team_totals = defaultdict(float)
        for fp in sim_full:
            p = players_by_name.get(_norm(fp.player_name))
            if p:
                team_totals[fp.team_idx] += p.projection
            per_team_round_picks[fp.team_idx][fp.round_num][fp.player_name] += 1
        for ti, tot in team_totals.items():
            per_team_totals[ti].append(tot)

    per_team_out = {}
    for ti in range(12):
        totals = sorted(per_team_totals[ti])
        if not totals:
            continue
        def pctl(q):
            i = max(0, min(len(totals) - 1, int(round(q * (len(totals) - 1)))))
            return totals[i]
        per_team_out[str(ti)] = {
            "mean": sum(totals) / len(totals),
            "p25": pctl(0.25),
            "p50": pctl(0.50),
            "p75": pctl(0.75),
            "min": totals[0],
            "max": totals[-1],
            "pick_distribution": {
                str(rnd): dict(per_team_round_picks[ti][rnd])
                for rnd in sorted(per_team_round_picks[ti])
            },
        }

    out = {
        "n_sims": N_SIMS,
        "team_idx_to_mid_slot": {
            str((slot - 1)): slot for slot in PREDICTED_SLOT_TO_RID
        },
        "per_team": per_team_out,
    }
    MC_OUT.write_text(json.dumps(out, indent=2))
    print(f"Wrote {MC_OUT} ({len(per_team_out)} teams x {N_SIMS} sims)")


if __name__ == "__main__":
    main()
