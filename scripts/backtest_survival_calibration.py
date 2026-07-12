"""backtest_survival_calibration.py — is the Monte Carlo survival number
on the helper's "Next✓" column actually honest? Period-honest 2025 test.

The helper quotes P(player still available at your next pick) from the
mock-draft Monte Carlo. This script rebuilds that machinery inside the
REAL 2025 draft world using only what was knowable that August:

  - Board: period ADP only (backtest_recommender.load_period_players —
    projections synthesized from positional ADP rank, because Sleeper's
    stored historical projections are contaminated with in-season
    knowledge).
  - Keepers: the picks that were actually keeper seats (explicit
    is_keeper flag + the repo's implicit-keeper rule: actual round 1.5+
    rounds later than the ADP-implied round) are pre-filled, exactly as
    a live draft room would see them.
  - Brian's picks: xlsx-attributed pick numbers (the xlsx is the source
    of truth for pick ownership).
  - Bots: build_mock_draft_sim.simulate_full_draft_with_tendencies with
    the tendency model DISABLED (manager_tendencies.json is fit on
    2023-25 drafts — feeding it back into a 2025 backtest would leak the
    answer into the question).

Then: predicted P(available at each of Brian's live 2025 picks) for the
top-150 period-ADP players vs what ACTUALLY happened in the real draft.
Output: calibration buckets (predicted 0-20% ... 80-100% vs realized
availability rate, with counts), Brier score, one-line verdict.

Emits data/research/survival_calibration.{json,html} per the RESEARCH
DESK fragment contract (one <section>, ml.css classes only, no raw hex).

Usage: python3 scripts/backtest_survival_calibration.py [--sims N]
"""
from __future__ import annotations

import argparse
import html
import json
import random
import sys
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import backtest_recommender as br  # noqa: E402  (loaders: period board, xlsx)
from build_mock_draft_sim import (  # noqa: E402  (the MC survival machinery)
    MC_TEMPERATURE, TOP_K, simulate_full_draft_with_tendencies,
)
from fantasy_draft.draft import Draft  # noqa: E402
from fantasy_draft.league import LeagueConfig  # noqa: E402
from fantasy_draft.vbd import compute_vbd  # noqa: E402

YEAR = 2025
N_SIMS = 100          # reduced vs the 2026 pipeline's 300 — noise ±~10% on 50%
TOP_PLAYERS = 150     # calibrate on the top-150 period-ADP board
UNDRAFTED = 999       # sentinel: never left the board
OUT = ROOT / "data" / "research"
BUCKETS = ((0, 20), (20, 40), (40, 60), (60, 80), (80, 100))


def load_real_draft() -> list[dict]:
    ldir, did = br.SEASONS[YEAR]
    picks = json.loads((ROOT / ldir / f"draft_{did}_picks.json").read_text())
    return sorted(picks, key=lambda p: p["pick_no"])


def detect_keeper_picks(picks: list[dict], by_pid: dict) -> set[int]:
    """Pick numbers that were keeper seats: explicit flag OR the repo's
    implicit rule (this league enters keepers as ordinary unflagged picks;
    detect by ADP gap >= 1.5 rounds). Same logic as backtest_recommender."""
    out: set[int] = set()
    for pk in picks:
        kp = by_pid.get(str(pk["player_id"]))
        explicit = bool(pk.get("is_keeper"))
        implicit = False
        if not explicit and kp is not None and kp.adp < 999:
            adp_round = max(1.0, kp.adp / 12.0)
            implicit = (pk["round"] - adp_round) >= 1.5
        if explicit or implicit:
            out.add(pk["pick_no"])
    return out


def build_2025_skeleton(league: LeagueConfig, picks: list[dict],
                        by_pid: dict, keeper_picks: set[int]) -> Draft:
    """The 2025 draft world at pick 1: real seat ownership (roster_id per
    pick — 2025's Sleeper feed is the clean year), keeper seats pre-filled
    with the players everyone in the room already knew were kept."""
    league.draft_order = list(range(12))
    draft = Draft.new(league, [f"rid {i + 1}" for i in range(12)])
    pick_owner = {pk["pick_no"]: pk["roster_id"] for pk in picks}
    for pick in draft.picks:
        pick.team_idx = pick_owner.get(pick.overall, pick.team_idx + 1) - 1
    for pk in picks:
        if pk["pick_no"] not in keeper_picks:
            continue
        p = by_pid.get(str(pk["player_id"]))
        if p is None:
            continue  # invisible to the period board — bots can't draft him
        slot = draft.picks[pk["pick_no"] - 1]
        slot.player = p
        slot.is_keeper = True
        draft.teams[slot.team_idx].add(p)
    return draft


def run(n_sims: int) -> dict:
    t0 = time.time()
    league = LeagueConfig.load(br.LEAGUE_CFG)
    players, by_pid = br.load_period_players(YEAR)
    compute_vbd(players, league)
    picks = load_real_draft()
    keeper_picks = detect_keeper_picks(picks, by_pid)
    keeper_names = {by_pid[str(pk["player_id"])].name for pk in picks
                    if pk["pick_no"] in keeper_picks
                    and str(pk["player_id"]) in by_pid}

    # Brian's live (non-keeper) 2025 picks, xlsx-attributed.
    brian_all = br.brian_pick_numbers(YEAR)
    brian_live = sorted(pk for pk in brian_all if pk not in keeper_picks)

    # Evaluation set: top-150 period-ADP players who were actually
    # draftable (not keeper-locked before pick 1).
    board = sorted((p for p in players if p.adp < 999
                    and p.name not in keeper_names),
                   key=lambda p: p.adp)[:TOP_PLAYERS]
    board_names = [p.name for p in board]

    # Where each player ACTUALLY left the board.
    actual_gone: dict[str, int] = {nm: UNDRAFTED for nm in board_names}
    for pk in picks:
        p = by_pid.get(str(pk["player_id"]))
        if p is not None and p.name in actual_gone:
            actual_gone[p.name] = pk["pick_no"]

    # Monte Carlo: replay the 2025 draft n_sims times with the 2026
    # pipeline's bot (temperature 0.25, top-15 softmax), tendencies OFF.
    avail_count: dict[tuple[str, int], int] = defaultdict(int)
    rng = random.Random(2025)
    for _ in range(n_sims):
        sim_rng = random.Random(rng.randint(0, 10 ** 9))
        draft = build_2025_skeleton(league, picks, by_pid, keeper_picks)
        sim = simulate_full_draft_with_tendencies(
            draft, players, my_team_idx=-1,
            temperature=MC_TEMPERATURE, top_k=TOP_K, rng=sim_rng,
            mgr_expected={}, league_first={}, team_idx_to_mgr={},
        )
        gone = {fp.player_name: (0 if fp.is_keeper else fp.overall)
                for fp in sim}
        for nm in board_names:
            g = gone.get(nm, UNDRAFTED)
            for n in brian_live:
                if g >= n:
                    avail_count[(nm, n)] += 1

    # Pair up: predicted p vs realized outcome y for every (player, pick).
    pairs = []
    for nm in board_names:
        for n in brian_live:
            p_hat = avail_count[(nm, n)] / n_sims
            y = 1 if actual_gone[nm] >= n else 0
            pairs.append({"player": nm, "pick": n,
                          "predicted": round(p_hat, 3), "actual": y})

    brier = sum((pr["predicted"] - pr["actual"]) ** 2
                for pr in pairs) / len(pairs)
    base_rate = sum(pr["actual"] for pr in pairs) / len(pairs)
    brier_base = sum((base_rate - pr["actual"]) ** 2
                     for pr in pairs) / len(pairs)
    skill = 1 - brier / brier_base if brier_base else 0.0

    buckets = []
    for lo, hi in BUCKETS:
        rows = [pr for pr in pairs
                if lo / 100 <= pr["predicted"] < hi / 100
                or (hi == 100 and pr["predicted"] == 1.0)]
        n = len(rows)
        buckets.append({
            "band": f"{lo}-{hi}%",
            "n": n,
            "mean_predicted": round(100 * sum(r["predicted"] for r in rows)
                                    / n, 1) if n else None,
            "realized": round(100 * sum(r["actual"] for r in rows) / n, 1)
            if n else None,
        })
    assert sum(b["n"] for b in buckets) == len(pairs), "buckets lose pairs"

    # Honest one-liner, written by the numbers, not by hope.
    gaps = [(b, abs(b["mean_predicted"] - b["realized"]))
            for b in buckets if b["n"] >= 20]
    worst = max(gaps, key=lambda t: t[1]) if gaps else (None, 0.0)
    if brier < brier_base and worst[1] <= 12:
        verdict = (f"Trustworthy: Brier {brier:.3f} beats the base rate "
                   f"({brier_base:.3f}), worst bucket off by "
                   f"{worst[1]:.0f} pts ({worst[0]['band']}) — read the "
                   "helper's survival % at face value.")
    elif brier < brier_base:
        verdict = (f"Directionally right but miscalibrated: Brier "
                   f"{brier:.3f} beats the base rate ({brier_base:.3f}), "
                   f"but the {worst[0]['band']} bucket realizes "
                   f"{worst[0]['realized']:.0f}% vs {worst[0]['mean_predicted']:.0f}% "
                   "predicted — pad that band before betting a pick on it.")
    else:
        verdict = (f"Not calibrated: Brier {brier:.3f} is no better than "
                   f"always guessing the base rate ({brier_base:.3f}) — "
                   "treat survival % as decoration, not information.")

    return {
        "generated": time.strftime("%Y-%m-%d"),
        "method": {
            "world": f"real {YEAR} draft, period-honest: ADP-only board "
                     "(synthesized projections), keeper seats pre-filled "
                     "(explicit flag + implicit ADP-gap rule), xlsx pick "
                     "attribution for Brian",
            "machinery": f"build_mock_draft_sim bot, {n_sims} sims, "
                         f"temperature {MC_TEMPERATURE}, top-{TOP_K} "
                         "softmax, tendency model OFF (it is fit on "
                         "2023-25 — using it here would leak the answer)",
            "sample": f"top-{TOP_PLAYERS} period-ADP players x "
                      f"{len(brian_live)} Brian live picks",
        },
        "brian_picks": brian_live,
        "n_sims": n_sims,
        "n_pairs": len(pairs),
        "base_rate": round(base_rate, 3),
        "brier": round(brier, 4),
        "brier_base_rate": round(brier_base, 4),
        "skill_vs_base": round(skill, 3),
        "buckets": buckets,
        "verdict": verdict,
        "runtime_sec": round(time.time() - t0, 1),
    }


# ------------------------------------------------------------------ fragment
def render_fragment(res: dict) -> str:
    rows = []
    for b in res["buckets"]:
        if b["n"] == 0:
            rows.append(f'<tr><td class="ml-num">{b["band"]}</td>'
                        '<td class="ml-num">0</td>'
                        '<td class="ml-num">&mdash;</td>'
                        '<td class="ml-num">&mdash;</td>'
                        '<td class="ml-num">&mdash;</td></tr>')
            continue
        gap = b["realized"] - b["mean_predicted"]
        cls = ("ml-sv-hi" if abs(gap) <= 8
               else ("ml-sv-mid" if abs(gap) <= 15 else "ml-sv-lo"))
        rows.append(
            "<tr>"
            f'<td class="ml-num">{b["band"]}</td>'
            f'<td class="ml-num">{b["n"]}</td>'
            f'<td class="ml-num">{b["mean_predicted"]:.0f}%</td>'
            f'<td class="ml-num">{b["realized"]:.0f}%</td>'
            f'<td class="ml-num"><span class="{cls}">{gap:+.0f}</span></td>'
            "</tr>")
    m = res["method"]
    return f"""<section id="survival_calibration" class="ml-panel">
<h2>Survival Calibration &mdash; the 2025 Receipt</h2>
<p class="ml-serial">PREDICTED vs REALIZED AVAILABILITY &middot; REAL {YEAR} DRAFT &middot; {res["n_sims"]} SIMS &middot; {res["n_pairs"]} PLAYER&times;PICK PAIRS &middot; {html.escape(res["generated"])}</p>
<div class="ml-tape"><span>BRIER:</span> <span><b>{res["brier"]:.3f}</b> model</span> <span><b>{res["brier_base_rate"]:.3f}</b> base-rate guess</span> <span>skill <b>{res["skill_vs_base"]:+.0%}</b></span></div>
<p>{html.escape(res["verdict"])}</p>
<table class="ml-table ml-table--compact">
<thead><tr><th>Predicted band</th><th class="ml-num">Pairs</th><th class="ml-num">Mean predicted</th><th class="ml-num">Realized</th><th class="ml-num">Gap</th></tr></thead>
<tbody>{"".join(rows)}</tbody>
</table>
<p class="ml-fineprint">How this was scored: the helper&rsquo;s Monte Carlo survival machinery was replayed inside the real {YEAR} draft using only period-August information &mdash; {html.escape(m["world"])}. Bots: {html.escape(m["machinery"])}. Sample: {html.escape(m["sample"])}; each pair asks &ldquo;was this player still on the board at this Brian pick?&rdquo; and compares the simulated probability with the one draft that actually happened. Buckets with realized above predicted mean the model was too pessimistic (players lasted longer than it thought); below means too optimistic. One season is one draw &mdash; a perfectly calibrated model still misses buckets on n this small, which is why the Brier-vs-base-rate line, not any single bucket, carries the verdict.</p>
</section>
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sims", type=int, default=N_SIMS)
    args = ap.parse_args()
    res = run(args.sims)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "survival_calibration.json").write_text(json.dumps(res, indent=1))
    (OUT / "survival_calibration.html").write_text(render_fragment(res))
    print(f"calibration: {res['n_pairs']} pairs "
          f"({len(res['brian_picks'])} Brian picks x top-{TOP_PLAYERS}), "
          f"{res['n_sims']} sims in {res['runtime_sec']}s")
    for b in res["buckets"]:
        print(f"  {b['band']:>8}: n={b['n']:>4}  "
              f"pred {b['mean_predicted']}%  realized {b['realized']}%")
    print(f"  Brier {res['brier']} vs base-rate {res['brier_base_rate']} "
          f"(skill {res['skill_vs_base']:+.1%})")
    print(f"  VERDICT: {res['verdict']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
