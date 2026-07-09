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
SEASON_CFG = json.loads((ROOT / "configs" / "season_2026.json").read_text())
PLAYERS_CSV = ROOT / "data" / "players_2026.csv"
KEEPERS_JSON = ROOT / "data" / "keepers_2026.json"
TRADED_PICKS_JSON = ROOT / SEASON_CFG["league_dir"] / "traded_picks.json"
FP_RANKINGS = ROOT / "data" / "rankings_fantasypros.json"
TENDENCIES_JSON = ROOT / "data" / "manager_tendencies.json"

PICKS_OUT = ROOT / "data" / "mock_draft_picks.json"
MC_OUT = ROOT / "data" / "mc_summary_all.json"

# Draft slot -> roster_id from the season config (single source of truth).
PREDICTED_SLOT_TO_RID = {
    int(k): v for k, v in SEASON_CFG["slot_to_roster_id"].items()
}

N_SIMS = 300  # ±5% noise on a 50% event at n=300 (was 50 → ±14%)
MC_TEMPERATURE = 0.25       # Monte Carlo: some variance for honest distributions
DISPLAY_TEMPERATURE = 0.0   # Displayed board: greedy / no reaches
TOP_K = 15
MY_RID = SEASON_CFG["my_roster_id"]

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


def load_inputs():
    """League config + player pool with FP overlay + VBD."""
    league = LeagueConfig.load(LEAGUE_CFG)
    players = load_players(PLAYERS_CSV)
    n_promoted = _apply_fp_overlay(players)
    print(f"FP overlay applied: {n_promoted} players promoted to FP positional rank")
    compute_vbd(players, league)
    return league, players


def build_skeleton(league) -> Draft:
    """Empty draft with 2026 traded-pick ownership applied. Cheap — safe to
    rebuild per Monte Carlo sim so keeper sets can vary."""
    rid_to_slot = {rid: slot for slot, rid in PREDICTED_SLOT_TO_RID.items()}
    team_names = [f"Slot {i+1}" for i in range(12)]
    league.draft_order = list(range(12))  # slot N -> team_idx N-1
    draft = Draft.new(league, team_names)

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
    return draft


def apply_keeper_set(draft: Draft, players: list, keeper_records: list[dict]) -> None:
    """Place a set of keeper records onto the draft (marks Picks + rosters)."""
    rid_to_slot = {rid: slot for slot, rid in PREDICTED_SLOT_TO_RID.items()}
    name_to_player = {_norm(p.name): p for p in players}
    consumed: set[tuple[int, int]] = set()
    for k in keeper_records:
        rid = k["roster_id"]
        slot = rid_to_slot.get(rid)
        if slot is None:
            continue
        team_idx = slot - 1
        player = name_to_player.get(_norm(k["player_name"]))
        if player is None:
            continue
        forfeit_rnd = int(k.get("effective_forfeit_round") or k.get("forfeit_round") or 0)
        if forfeit_rnd <= 0 or forfeit_rnd > draft.league.rounds:
            continue
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


# Probability a manager deviates from the predicted keeper set in a given
# Monte Carlo sim (swaps their weakest keeper for one of their alternates).
KEEPER_SWAP_PROB = 0.30


def sample_keeper_set(carryover: list[dict], alternates_by_rid: dict,
                      rng: random.Random) -> list[dict]:
    """One plausible keeper scenario: mostly the prediction, but each team
    with alternates swaps its lowest-net keeper ~30% of the time."""
    by_rid: dict[int, list[dict]] = defaultdict(list)
    for k in carryover:
        by_rid[k["roster_id"]].append(k)
    out: list[dict] = []
    for rid, keeps in by_rid.items():
        keeps = list(keeps)
        alts = alternates_by_rid.get(rid, [])
        if alts and len(keeps) > 0 and rng.random() < KEEPER_SWAP_PROB:
            weakest = min(keeps, key=lambda k: k.get("net_vbd") or 0)
            keeps.remove(weakest)
            keeps.append(rng.choice(alts))
        out.extend(keeps)
    return out


def build_draft() -> tuple[Draft, list, int]:
    """Canonical draft: skeleton + the PREDICTED keeper set."""
    league, players = load_inputs()
    draft = build_skeleton(league)
    keepers = json.loads(KEEPERS_JSON.read_text())
    apply_keeper_set(draft, players,
                     [k for k in keepers if k.get("status") == "carryover"])
    rid_to_slot = {rid: slot for slot, rid in PREDICTED_SLOT_TO_RID.items()}
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
    league, players = load_inputs()
    draft = build_skeleton(league)
    apply_keeper_set(
        draft, players,
        [k for k in json.loads(KEEPERS_JSON.read_text())
         if k.get("status") == "carryover"],
    )
    rid_to_slot_map = {rid: slot for slot, rid in PREDICTED_SLOT_TO_RID.items()}
    my_team_idx = rid_to_slot_map[MY_RID] - 1
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
    #
    # KEEPER UNCERTAINTY: each sim samples a keeper scenario — mostly the
    # predicted set, but ~30% of the time a team swaps its weakest keeper for
    # one of its alternates (from keepers_2026.json status="alternate"). The
    # draft skeleton is rebuilt per sim so keeper slots can move.
    #
    # SURVIVAL: per player, track the overall pick at which they left the
    # board in each sim (keepers = gone from pick 1, undrafted = never), so we
    # can publish P(available at the start of each round).
    all_keepers = json.loads(KEEPERS_JSON.read_text())
    carryover = [k for k in all_keepers if k.get("status") == "carryover"]
    alternates_by_rid: dict[int, list[dict]] = defaultdict(list)
    for k in all_keepers:
        if k.get("status") == "alternate":
            alternates_by_rid[k["roster_id"]].append(k)
    print(f"Keeper scenarios: {len(carryover)} predicted + "
          f"{sum(len(v) for v in alternates_by_rid.values())} alternates "
          f"across {len(alternates_by_rid)} teams (swap p={KEEPER_SWAP_PROB})")

    per_team_totals: dict[int, list[float]] = {ti: [] for ti in range(12)}
    per_team_round_seq_picks: dict[int, dict[int, dict[int, Counter]]] = {
        ti: defaultdict(lambda: defaultdict(Counter)) for ti in range(12)
    }
    per_team_sim_rosters: dict[int, list[list[tuple[int, int, str]]]] = {
        ti: [] for ti in range(12)
    }
    # survival_gone[name] = list of "gone at overall" per sim (999 = undrafted)
    survival_gone: dict[str, list[int]] = defaultdict(list)

    mc_rng = random.Random(7)
    for sim_idx in range(N_SIMS):
        sim_rng = random.Random(mc_rng.randint(0, 10**9))
        keeper_set = sample_keeper_set(carryover, alternates_by_rid, sim_rng)
        sim_draft = build_skeleton(league)
        apply_keeper_set(sim_draft, players, keeper_set)
        sim_full = simulate_full_draft_with_tendencies(
            sim_draft, players, my_team_idx,
            temperature=MC_TEMPERATURE, top_k=TOP_K, rng=sim_rng,
            mgr_expected=mgr_expected, league_first=league_first,
            team_idx_to_mgr=team_idx_to_mgr,
        )
        team_totals = defaultdict(float)
        team_picks: dict[int, list[tuple[int, int, str]]] = defaultdict(list)
        round_seq_counter: dict[tuple[int, int], int] = defaultdict(int)
        drafted_this_sim: set[str] = set()
        for fp in sorted(sim_full, key=lambda x: x.overall):
            p = players_by_name.get(_norm(fp.player_name))
            if p:
                team_totals[fp.team_idx] += p.projection
            key = (fp.team_idx, fp.round_num)
            seq = round_seq_counter[key]
            round_seq_counter[key] += 1
            per_team_round_seq_picks[fp.team_idx][fp.round_num][seq][fp.player_name] += 1
            team_picks[fp.team_idx].append((fp.round_num, seq, fp.player_name))
            # Keepers were never draftable in this sim; regular picks leave
            # the board at their overall.
            survival_gone[fp.player_name].append(
                0 if fp.is_keeper else fp.overall)
            drafted_this_sim.add(fp.player_name)
        for ti, tot in team_totals.items():
            per_team_totals[ti].append(tot)
            per_team_sim_rosters[ti].append(team_picks[ti])
        # Players never drafted this sim: available throughout. Only track
        # names we've ever seen drafted (others default to always-available).
        for nm in list(survival_gone.keys()):
            if nm not in drafted_this_sim:
                survival_gone[nm].append(999)

    # Survival as draft-position QUANTILES (0th, 10th, ..., 100th percentile
    # of the overall pick where the player left the board; keeper=0,
    # undrafted=999). Quantiles beat per-round curves because they stay
    # accurate inside round 1, where linear round-interpolation badly
    # overstates elite players' availability (Bijan at pick 6 is ~10%
    # available, not 62%). Client: P(avail at pick N) = 1 - F(N) via linear
    # interpolation over the 11 quantile points.
    survival: dict[str, list[int]] = {}
    for nm, gone_list in survival_gone.items():
        s = sorted(gone_list)
        n = len(s)
        q = [s[min(n - 1, round(f * (n - 1)))] for f in
             (i / 10 for i in range(11))]
        survival[nm] = q

    per_team_out = {}
    for ti in range(12):
        totals_unsorted = per_team_totals[ti]
        if not totals_unsorted:
            continue
        mean_tot = sum(totals_unsorted) / len(totals_unsorted)
        totals = sorted(totals_unsorted)
        def pctl(q):
            i = max(0, min(len(totals) - 1, int(round(q * (len(totals) - 1)))))
            return totals[i]

        # Representative sim: the one whose team-total is closest to the mean.
        # Renders as one internally-consistent roster (vs the modal-per-slot
        # collapse which double-counts positions across non-consistent sims).
        rep_idx = min(range(len(totals_unsorted)),
                      key=lambda i: abs(totals_unsorted[i] - mean_tot))
        rep_roster = per_team_sim_rosters[ti][rep_idx]

        # For each pick in the representative roster, annotate with the
        # MC confidence (% of sims where THIS slot picked THIS player).
        rep_picks_annotated = []
        for rnd, seq, name in rep_roster:
            dist = per_team_round_seq_picks[ti].get(rnd, {}).get(seq, Counter())
            n_sims_here = sum(dist.values())
            pct = (dist.get(name, 0) / n_sims_here * 100) if n_sims_here else 0
            rep_picks_annotated.append({
                "round": rnd, "seq": seq, "player": name,
                "pct": round(pct, 1),
            })

        # Keep the full pick_distribution for back-compat.
        pick_dist: dict[str, list[dict[str, int]]] = {}
        for rnd in sorted(per_team_round_seq_picks[ti]):
            seqs = per_team_round_seq_picks[ti][rnd]
            pick_dist[str(rnd)] = [dict(seqs[seq]) for seq in sorted(seqs)]

        per_team_out[str(ti)] = {
            "mean": mean_tot,
            "p25": pctl(0.25),
            "p50": pctl(0.50),
            "p75": pctl(0.75),
            "min": totals[0],
            "max": totals[-1],
            "representative_total": totals_unsorted[rep_idx],
            "representative_roster": rep_picks_annotated,
            "pick_distribution": pick_dist,
        }

    out = {
        "n_sims": N_SIMS,
        "keeper_swap_prob": KEEPER_SWAP_PROB,
        "team_idx_to_mid_slot": {
            str((slot - 1)): slot for slot in PREDICTED_SLOT_TO_RID
        },
        "per_team": per_team_out,
        "survival": survival,
    }
    MC_OUT.write_text(json.dumps(out, indent=2))
    print(f"Wrote {MC_OUT} ({len(per_team_out)} teams x {N_SIMS} sims, "
          f"{len(survival)} survival curves)")


if __name__ == "__main__":
    main()
