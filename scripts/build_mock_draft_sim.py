"""MONEYLEAGUE 2026 mock draft simulator.

Builds the predicted 2026 draft (with traded picks + projected keepers),
runs one full simulation -> /tmp/mock_draft_picks.json, then runs N Monte
Carlo simulations -> data/mc_summary_all.json. The report script
(build_mock_draft_report.py) consumes both to render the PDF.
"""
from __future__ import annotations

import json
import math
import random
import sys
from collections import defaultdict, Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.draft import Draft  # noqa: E402
from fantasy_draft.league import LeagueConfig  # noqa: E402
from fantasy_draft.players import load_players  # noqa: E402
from fantasy_draft.predict import score_candidates_for_team  # noqa: E402
from fantasy_draft.simulate import _snapshot_teams  # noqa: E402
from fantasy_draft.team_identity import manager_for_sleeper_roster  # noqa: E402
from fantasy_draft.vbd import compute_vbd  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LEAGUE_CFG = ROOT / "configs" / "my_league.json"
PLAYERS_CSV = ROOT / "data" / "players_2026.csv"
KEEPERS_JSON = ROOT / "data" / "keepers_2026.json"
TRADED_PICKS_JSON = ROOT / "data" / "sleeper" / "league_1245039290518360064" / "traded_picks.json"
FP_RANKINGS = ROOT / "data" / "rankings_fantasypros.json"
TENDENCIES_JSON = ROOT / "data" / "manager_tendencies.json"

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

# Per-manager tendency bias: when a manager's typical first-pick round for a
# position is approaching, boost that position's score. Strength = max bonus
# added to score (need_weight is 0.6, so 0.5 is roughly a full extra "need" tick).
TENDENCY_STRENGTH = 0.4
# How wide is the "window" around the expected round (in rounds).
TENDENCY_WIDTH = 2.0


def _norm(s: str) -> str:
    return s.lower().replace(".", "").replace("'", "").replace("-", " ").strip()


def _apply_fp_overlay(players: list) -> int:
    """Take FantasyPros outright when present: override adp with fp_adp_avg,
    promote projection to the Sleeper-projection of the (fp_rank_pos)-th
    player at that position. Falls back to Sleeper for unmatched players.

    Returns the count of players promoted.
    """
    fp_data = json.loads(FP_RANKINGS.read_text())
    fp_by_key: dict[tuple[str, str], dict] = {}
    for r in fp_data.get("players", []):
        fp_by_key[(_norm(r["name"]), r["position"].upper())] = r

    # Per-position list of players sorted by Sleeper projection (desc) — we use
    # this to convert FP positional rank to a projection number.
    by_pos: dict[str, list] = defaultdict(list)
    for p in players:
        by_pos[p.position].append(p)
    for pos in by_pos:
        by_pos[pos].sort(key=lambda x: -x.projection)
    pos_proj_at_rank = {
        pos: [p.projection for p in lst] for pos, lst in by_pos.items()
    }

    promoted = 0
    for p in players:
        key = (_norm(p.name), p.position.upper())
        fp = fp_by_key.get(key)
        if not fp:
            continue
        # ADP override
        fp_adp = fp.get("fp_adp_avg")
        if fp_adp is not None:
            try:
                p.adp = float(fp_adp)
            except (TypeError, ValueError):
                pass
        # Projection promotion: FP says you're RB26 -> use the proj of the
        # 26th-best RB by Sleeper projection.
        pos_rank_str = fp.get("fp_rank_pos") or ""  # e.g. "RB26"
        digits = "".join(c for c in pos_rank_str if c.isdigit())
        if digits:
            target_rank = int(digits)  # 1-indexed
            proj_list = pos_proj_at_rank.get(p.position, [])
            if proj_list and 1 <= target_rank <= len(proj_list):
                p.projection = proj_list[target_rank - 1]
                promoted += 1
    return promoted


MIN_SAMPLES_FOR_TENDENCY = 2  # require 2+ years of evidence


def load_tendencies() -> tuple[dict, dict]:
    """Returns (mgr_pos_expected_round, league_pos_first_avg).

    Single-sample tendencies are filtered out — they're too noisy (e.g.
    Brower drafted exactly 1 K across 3 years, so his "K -3.4" delta is
    one early pick, not a habit).
    """
    data = json.loads(TENDENCIES_JSON.read_text())
    league_first = data['league_first_avg']
    mgr_expected: dict[str, dict[str, float]] = {}
    for mgr, posdata in data['tendencies'].items():
        mgr_expected[mgr] = {}
        for pos, info in posdata.items():
            if info['n_samples'] < MIN_SAMPLES_FOR_TENDENCY:
                continue
            mgr_expected[mgr][pos] = info['manager_first_avg']
    return mgr_expected, league_first


def _tendency_bonus(team_mgr: str | None, pos: str, current_round: int,
                    mgr_expected: dict, league_first: dict) -> float:
    """Bonus added to a candidate's score when current_round is near this
    manager's typical first-pick round for `pos`. Falls off as we move away
    from that round.

    A manager with strong EARLY tendency gets the bonus a few rounds before
    league avg; a WAIT tendency delays it.
    """
    if not team_mgr:
        return 0.0
    expected = mgr_expected.get(team_mgr, {}).get(pos)
    if expected is None:
        expected = league_first.get(pos)
    if expected is None:
        return 0.0
    dist = abs(current_round - expected)
    # Bell-shaped bonus centred at the manager's typical first-pick round.
    return TENDENCY_STRENGTH * math.exp(-(dist ** 2) / (2 * TENDENCY_WIDTH ** 2))


def _softmax_choice(scored: list[tuple[float, object]], temperature: float,
                    rng: random.Random):
    """Sample a (score, player) pair via softmax."""
    if not scored:
        raise RuntimeError("empty candidate list")
    if temperature <= 1e-6:
        return max(scored, key=lambda sp: sp[0])[1]
    max_s = max(s for s, _ in scored)
    weights = [math.exp((s - max_s) / temperature) for s, _ in scored]
    total = sum(weights)
    r = rng.random() * total
    acc = 0.0
    for w, (_, pl) in zip(weights, scored):
        acc += w
        if r <= acc:
            return pl
    return scored[-1][1]


def _compute_pos_caps(league) -> dict[str, int]:
    """Per-position roster cap matching predict.py's logic. Used by the
    fallback path so it can respect the same cap as score_candidates_for_team."""
    from fantasy_draft.vbd import FLEX_SHARES
    demand = league.position_demand()
    caps: dict[str, int] = {}
    for pos in demand:
        direct = sum(s.count for s in league.starters if s.name == pos)
        flex_share = 0.0
        for slot in league.starters:
            if slot.name in FLEX_SHARES and pos in FLEX_SHARES[slot.name]:
                flex_share += slot.count * FLEX_SHARES[slot.name][pos]
        if pos in ("K", "DEF", "DST"):
            backup = 0
        else:
            backup = max(1, direct)
        caps[pos] = direct + round(flex_share) + backup
    return caps


def simulate_full_draft_with_tendencies(
    draft: Draft, players: list, my_team_idx: int,
    temperature: float, top_k: int, rng: random.Random,
    mgr_expected: dict, league_first: dict, team_idx_to_mgr: dict,
):
    """Replays simulate_full_draft but injects per-manager position bias
    into each candidate's score before sampling."""
    teams = _snapshot_teams(draft)
    drafted: set[str] = {p.player.name for p in draft.picks if p.player is not None}
    valid_positions = set(draft.league.position_demand().keys())
    pool = [p for p in players
            if p.name not in drafted and p.position in valid_positions]
    removed: set[str] = set()
    pos_caps = _compute_pos_caps(draft.league)

    def alive():
        if not removed:
            return pool
        return [p for p in pool if p.name not in removed]

    from fantasy_draft.simulate import FullSimPick
    out = []
    for pick in draft.picks:
        team_name = draft.teams[pick.team_idx].name
        if pick.player is not None:
            out.append(FullSimPick(
                overall=pick.overall, round_num=pick.round_num,
                pick_in_round=pick.pick_in_round, team_idx=pick.team_idx,
                team_name=team_name, player_name=pick.player.name,
                position=pick.player.position, vbd=pick.player.vbd,
                is_keeper=pick.is_keeper, is_you=pick.team_idx == my_team_idx,
            ))
            removed.add(pick.player.name)
            continue

        team = teams[pick.team_idx]
        avail = alive()
        mgr = team_idx_to_mgr.get(pick.team_idx)
        candidates = score_candidates_for_team(
            team, draft.league, avail, pick.overall, top_n=top_k,
        )

        # If this manager has an early-K or early-DEF tendency, predict.py's
        # default R15 floor blocks them. Inject the top K/DEF player manually
        # when we're within 2 rounds of their expected pick — but only if the
        # team doesn't already have one (K/DEF cap = 1).
        existing_pos = {c.player.position for c in candidates}
        team_counts = team.position_counts()
        for early_pos in ('K', 'DEF'):
            if early_pos in existing_pos:
                continue
            if team_counts.get(early_pos, 0) >= 1:
                continue
            expected = mgr_expected.get(mgr, {}).get(early_pos) if mgr else None
            if expected is None or pick.round_num < expected - 2:
                continue
            top_pos = next((p for p in sorted(avail, key=lambda x: -x.projection)
                            if p.position == early_pos), None)
            if not top_pos:
                continue
            # Synthesize a Candidate-like entry: value ~ 0.2 baseline, no need.
            from fantasy_draft.predict import Candidate
            candidates.append(Candidate(
                player=top_pos, score=0.25, value_score=0.25, need_score=0.0,
                reason=f'tendency: {mgr} drafts {early_pos} early',
            ))

        if not candidates:
            # Cap-aware fallback: only consider positions the team isn't
            # already capped on. Otherwise BPA hands out 2nd K/DEFs.
            team_counts = team.position_counts()
            cap_ok = [p for p in avail
                      if team_counts.get(p.position, 0) <
                         pos_caps.get(p.position, 99)]
            chosen = max(cap_ok if cap_ok else avail,
                         key=lambda p: (p.vbd, p.projection))
        else:
            scored = []
            for c in candidates:
                bonus = _tendency_bonus(mgr, c.player.position,
                                        pick.round_num, mgr_expected, league_first)
                scored.append((c.score + bonus, c.player))
            chosen = _softmax_choice(scored, temperature, rng)

        team.roster.append(chosen)
        removed.add(chosen.name)
        out.append(FullSimPick(
            overall=pick.overall, round_num=pick.round_num,
            pick_in_round=pick.pick_in_round, team_idx=pick.team_idx,
            team_name=team_name, player_name=chosen.name,
            position=chosen.position, vbd=chosen.vbd, is_keeper=False,
            is_you=pick.team_idx == my_team_idx,
        ))
    return out


def build_draft() -> tuple[Draft, list, int]:
    league = LeagueConfig.load(LEAGUE_CFG)
    players = load_players(PLAYERS_CSV)
    n_promoted = _apply_fp_overlay(players)
    print(f"FP overlay applied: {n_promoted} players promoted to FP positional rank")
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

    # Per-manager tendency model (from 2023-2025 historical drafts).
    mgr_expected, league_first = load_tendencies()
    rid_to_slot = {rid: slot for slot, rid in PREDICTED_SLOT_TO_RID.items()}
    team_idx_to_mgr: dict[int, str] = {}
    for slot, rid in PREDICTED_SLOT_TO_RID.items():
        m = manager_for_sleeper_roster(rid)
        if m:
            team_idx_to_mgr[slot - 1] = m['id']
    print(f"Loaded tendencies for {len(team_idx_to_mgr)} managers")

    # One full sim for the draft board — deterministic so the visible board
    # has no implausible reaches (e.g. Chase falling past pick 5).
    rng = random.Random(42)
    full = simulate_full_draft_with_tendencies(
        draft, players, my_team_idx,
        temperature=DISPLAY_TEMPERATURE, top_k=TOP_K, rng=rng,
        mgr_expected=mgr_expected, league_first=league_first,
        team_idx_to_mgr=team_idx_to_mgr,
    )
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
    # Track each pick by (team_idx, round, seq_within_round) so trades that
    # give a team multiple picks in one round show up as separate rows.
    per_team_totals: dict[int, list[float]] = {ti: [] for ti in range(12)}
    # per_team_round_seq_picks[ti][rnd][seq] -> Counter of player_name
    per_team_round_seq_picks: dict[int, dict[int, dict[int, Counter]]] = {
        ti: defaultdict(lambda: defaultdict(Counter)) for ti in range(12)
    }
    mc_rng = random.Random(7)
    for sim_idx in range(N_SIMS):
        sim_rng = random.Random(mc_rng.randint(0, 10**9))
        sim_full = simulate_full_draft_with_tendencies(
            draft, players, my_team_idx,
            temperature=MC_TEMPERATURE, top_k=TOP_K, rng=sim_rng,
            mgr_expected=mgr_expected, league_first=league_first,
            team_idx_to_mgr=team_idx_to_mgr,
        )
        team_totals = defaultdict(float)
        round_seq_counter: dict[tuple[int, int], int] = defaultdict(int)
        for fp in sorted(sim_full, key=lambda x: x.overall):
            p = players_by_name.get(_norm(fp.player_name))
            if p:
                team_totals[fp.team_idx] += p.projection
            key = (fp.team_idx, fp.round_num)
            seq = round_seq_counter[key]
            round_seq_counter[key] += 1
            per_team_round_seq_picks[fp.team_idx][fp.round_num][seq][fp.player_name] += 1
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
        # Build the pick_distribution out: for each round, list of distributions
        # (one per pick that team has in that round). Use a list so order is
        # preserved (seq 0 first).
        pick_dist: dict[str, list[dict[str, int]]] = {}
        for rnd in sorted(per_team_round_seq_picks[ti]):
            seqs = per_team_round_seq_picks[ti][rnd]
            pick_dist[str(rnd)] = [
                dict(seqs[seq]) for seq in sorted(seqs)
            ]
        per_team_out[str(ti)] = {
            "mean": sum(totals) / len(totals),
            "p25": pctl(0.25),
            "p50": pctl(0.50),
            "p75": pctl(0.75),
            "min": totals[0],
            "max": totals[-1],
            "pick_distribution": pick_dist,
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
