#!/usr/bin/env python3
"""The 2025 Autopsy — decompose Brian's 12th-place season into named, sized causes.

Reads the cached matchups/transactions in data/league_history/ (written by
scripts/fetch_league_history.py — run that first) plus the on-disk league
metadata in data/sleeper/, and decomposes the 2025 result into four buckets:

  1. Draft value      — citation of the recorded backtest verdict
                        (data/backtest_results.json: tool-vs-Brian 2025)
                        plus roster strength = optimal PF vs league median.
  2. Lineup efficiency— optimal-lineup points minus actual starter points,
                        per week, using the MONEYLEAGUE start shape
                        1QB/2RB/3WR/1TE/1FLEX/1SF/1K/1DEF; league rank;
                        Brian's 3 worst individual benchings.
  3. Roster churn     — waiver/FA adds vs league median.
  4. Schedule luck    — all-play record vs actual record; expected-wins delta.

Computed for ALL 12 teams (Brian highlighted). Writes:
  data/research/autopsy_2025.json   — machine-readable findings
  data/research/autopsy_2025.html   — one <section> fragment (ml.css classes
                                      only; no raw hex; no page wrappers)

Self-verifies: optimal >= actual for every team-week; reconstructed
regular-season standings match rosters.json; the losers-bracket placement
puts bigguap69 12th; all-play totals satisfy the 12*11/2-per-week identity.
"""
from __future__ import annotations

import html
import json
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HIST = ROOT / "data" / "league_history"
OUT_DIR = ROOT / "data" / "research"

SEASON = 2025
LEAGUE_ID = "1245039290518360064"
LEAGUE_DIR = ROOT / "data" / "sleeper" / f"league_{LEAGUE_ID}"
MY_ROSTER_ID = 9
MY_NAME = "bigguap69"

REG_WEEKS = range(1, 15)    # regular season, weeks 1-14 (playoffs start wk 15)
ALL_WEEKS = range(1, 18)    # incl. playoff/consolation weeks with a real game
N_TEAMS = 12

# MONEYLEAGUE start shape (league.json roster_positions, bench excluded)
SLOTS = ["QB", "RB", "RB", "WR", "WR", "WR", "TE",
         "FLEX", "SUPER_FLEX", "K", "DEF"]
SLOT_ELIG = {
    "QB": {"QB"},
    "RB": {"RB"},
    "WR": {"WR"},
    "TE": {"TE"},
    "K": {"K"},
    "DEF": {"DEF"},
    "FLEX": {"RB", "WR", "TE"},
    "SUPER_FLEX": {"QB", "RB", "WR", "TE"},
}
EPS = 1e-6


# --------------------------------------------------------------------------
# loading
# --------------------------------------------------------------------------

def load_matchups() -> dict[int, list[dict]]:
    out = {}
    for wk in ALL_WEEKS:
        p = HIST / f"{SEASON}_matchups_w{wk}.json"
        if not p.exists():
            sys.exit(f"missing {p} — run scripts/fetch_league_history.py first")
        out[wk] = json.loads(p.read_text())
    return out


def load_transactions() -> list[dict]:
    txs = []
    for wk in range(1, 19):
        p = HIST / f"{SEASON}_transactions_w{wk}.json"
        if p.exists():
            txs.extend(json.loads(p.read_text()))
    return txs


def load_names() -> dict[int, str]:
    users = json.loads((LEAGUE_DIR / "users.json").read_text())
    rosters = json.loads((LEAGUE_DIR / "rosters.json").read_text())
    uname = {u["user_id"]: u.get("display_name") or u["user_id"] for u in users}
    return {r["roster_id"]: uname.get(r["owner_id"], f"roster {r['roster_id']}")
            for r in rosters}


def load_positions() -> dict[str, str]:
    players = json.loads((ROOT / "data" / "sleeper" / "players_nfl.json").read_text())
    pos = {}
    names = {}
    for pid, pl in players.items():
        p = pl.get("position") or (pl.get("fantasy_positions") or [None])[0]
        if p:
            pos[pid] = p
        nm = pl.get("full_name")
        if not nm:
            nm = f"{pl.get('first_name', '')} {pl.get('last_name', '')}".strip()
        names[pid] = nm or pid
    load_positions.names = names  # piggyback the name map
    return pos


# --------------------------------------------------------------------------
# optimal lineup
# --------------------------------------------------------------------------

def optimal_points(players_points: dict[str, float], pos: dict[str, str]) -> tuple[float, set[str]]:
    """Best legal lineup for the MONEYLEAGUE start shape.

    Dedicated slots first (top-k per position), then FLEX from the remaining
    RB/WR/TE pool, then SUPER_FLEX from the remaining QB/RB/WR/TE pool.
    Because FLEX eligibility is a subset of SUPER_FLEX eligibility this
    greedy order is exact for this shape.
    """
    by_pos: dict[str, list[tuple[float, str]]] = {}
    for pid, pts in players_points.items():
        p = pos.get(pid)
        if p in ("QB", "RB", "WR", "TE", "K", "DEF"):
            by_pos.setdefault(p, []).append((pts, pid))
    for lst in by_pos.values():
        lst.sort(reverse=True)

    used: set[str] = set()
    total = 0.0
    need = {"QB": 1, "RB": 2, "WR": 3, "TE": 1, "K": 1, "DEF": 1}
    for p, k in need.items():
        for pts, pid in by_pos.get(p, [])[:k]:
            total += pts
            used.add(pid)
    for elig in (SLOT_ELIG["FLEX"], SLOT_ELIG["SUPER_FLEX"]):
        best = None
        for p in elig:
            for pts, pid in by_pos.get(p, []):
                if pid not in used:
                    if best is None or pts > best[0]:
                        best = (pts, pid)
                    break  # list is sorted; first unused is that pos's best
        if best:
            total += best[0]
            used.add(best[1])
    return total, used


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main() -> None:
    matchups = load_matchups()
    txs = load_transactions()
    names = load_names()
    pos = load_positions()
    pname = load_positions.names

    teams = {rid: {
        "roster_id": rid, "manager": names[rid],
        "wins": 0, "losses": 0, "ties": 0, "pf": 0.0, "pa": 0.0,
        "allplay_w": 0.0, "allplay_g": 0,
        "optimal_pf": 0.0, "left_reg": 0.0, "left_all": 0.0, "gp_all": 0,
        "adds": 0, "drops": 0, "trades": 0,
    } for rid in names}

    # ---- weekly loop: records, all-play, lineup efficiency -----------------
    benchings = []  # Brian's individual benchings, all played weeks
    for wk in ALL_WEEKS:
        rows = {m["roster_id"]: m for m in matchups[wk]}
        played = [m for m in rows.values() if m.get("matchup_id") is not None]

        # lineup efficiency for every roster with a real game this week
        for m in played:
            t = teams[m["roster_id"]]
            actual = float(m["points"])
            opt, opt_set = optimal_points(m["players_points"], pos)
            assert opt >= actual - EPS, (
                f"optimal {opt:.2f} < actual {actual:.2f} "
                f"(roster {m['roster_id']} wk {wk})")
            left = max(0.0, opt - actual)
            t["left_all"] += left
            t["gp_all"] += 1
            if wk in REG_WEEKS:
                t["left_reg"] += left
                t["optimal_pf"] += opt

            if m["roster_id"] == MY_ROSTER_ID and left > EPS:
                # per-player benchings: starters array aligns with SLOTS
                starters = m["starters"]
                started = set(starters)
                slot_pts = {}  # slot type -> min started pts at that slot
                for i, pid in enumerate(starters):
                    sp = float(m["players_points"].get(pid, 0.0))
                    st = SLOTS[i]
                    slot_pts[st] = min(slot_pts.get(st, 1e9), sp)
                for pid in opt_set - started:
                    bpts = float(m["players_points"][pid])
                    p = pos.get(pid)
                    eligible = [slot_pts[s] for s, e in SLOT_ELIG.items()
                                if p in e and s in slot_pts]
                    if not eligible:
                        continue
                    gain = bpts - min(eligible)
                    if gain > 0.5:
                        benchings.append({
                            "week": wk, "player": pname.get(pid, pid),
                            "pos": p, "bench_pts": round(bpts, 1),
                            "started_pts": round(min(eligible), 1),
                            "points_left": round(gain, 1),
                        })

        # records + all-play (regular season only)
        if wk in REG_WEEKS:
            scores = {m["roster_id"]: float(m["points"]) for m in played}
            by_matchup: dict[int, list[dict]] = {}
            for m in played:
                by_matchup.setdefault(m["matchup_id"], []).append(m)
            for pair in by_matchup.values():
                assert len(pair) == 2, f"matchup pair size {len(pair)} wk {wk}"
                a, b = pair
                ta, tb = teams[a["roster_id"]], teams[b["roster_id"]]
                pa, pb = float(a["points"]), float(b["points"])
                ta["pf"] += pa; ta["pa"] += pb
                tb["pf"] += pb; tb["pa"] += pa
                if pa > pb:
                    ta["wins"] += 1; tb["losses"] += 1
                elif pb > pa:
                    tb["wins"] += 1; ta["losses"] += 1
                else:
                    ta["ties"] += 1; tb["ties"] += 1
            for rid, s in scores.items():
                t = teams[rid]
                t["allplay_w"] += sum(1.0 if s > o else 0.5 if s == o else 0.0
                                      for orid, o in scores.items() if orid != rid)
                t["allplay_g"] += len(scores) - 1

    # ---- all-play identity: each week awards 12*11/2 = 66 wins ------------
    total_apw = sum(t["allplay_w"] for t in teams.values())
    expect_apw = N_TEAMS * (N_TEAMS - 1) / 2 * len(REG_WEEKS)   # 66 * 14 = 924
    assert abs(total_apw - expect_apw) < EPS, (total_apw, expect_apw)
    total_apg = sum(t["allplay_g"] for t in teams.values())
    assert total_apg == N_TEAMS * (N_TEAMS - 1) * len(REG_WEEKS)

    # ---- luck: expected wins from all-play win% ----------------------------
    for t in teams.values():
        t["allplay_pct"] = t["allplay_w"] / t["allplay_g"]
        t["exp_wins"] = t["allplay_pct"] * len(REG_WEEKS)
        t["luck_wins"] = round(t["wins"] + 0.5 * t["ties"] - t["exp_wins"], 2)

    # ---- churn -------------------------------------------------------------
    for tx in txs:
        if tx.get("status") != "complete":
            continue
        ttype = tx.get("type")
        if ttype == "trade":
            for rid in tx.get("roster_ids") or []:
                teams[rid]["trades"] += 1
            continue
        if ttype not in ("waiver", "free_agent"):
            continue
        for _pid, rid in (tx.get("adds") or {}).items():
            teams[rid]["adds"] += 1
        for _pid, rid in (tx.get("drops") or {}).items():
            teams[rid]["drops"] += 1

    # ---- verify reconstructed standings vs rosters.json --------------------
    rosters = json.loads((LEAGUE_DIR / "rosters.json").read_text())
    stored_pf_by_rid = {}
    for r in rosters:
        s, t = r["settings"], teams[r["roster_id"]]
        stored_pf = s["fpts"] + s.get("fpts_decimal", 0) / 100
        stored_pf_by_rid[r["roster_id"]] = stored_pf
        assert (s["wins"], s["losses"]) == (t["wins"], t["losses"]), \
            f"record mismatch roster {r['roster_id']}"
        # Sleeper's stored season fpts carries late stat corrections that the
        # weekly matchup snapshots do not (observed 2025 deltas: 0-24 pts, all
        # multiples of 3). Tolerate that, but require the standings order to
        # be identical under either PF column.
        assert abs(stored_pf - t["pf"]) < 25, \
            f"PF mismatch roster {r['roster_id']}: {stored_pf} vs {t['pf']:.2f}"
    order_computed = sorted(teams, key=lambda rid: (-teams[rid]["wins"], -teams[rid]["pf"]))
    order_stored = sorted(teams, key=lambda rid: (-teams[rid]["wins"], -stored_pf_by_rid[rid]))
    assert order_computed == order_stored, "standings order differs under stored vs computed PF"

    # ---- verify final placement: losers-bracket 11th-place game ------------
    bracket = json.loads((LEAGUE_DIR / "losers_bracket.json").read_text())
    p5 = next(g for g in bracket if g.get("p") == 5)   # 11th-place game
    assert MY_ROSTER_ID in (p5["t1"], p5["t2"]) and p5["l"] == MY_ROSTER_ID, \
        "bracket does not place bigguap69 as the 11th-place-game loser (12th)"
    wk16 = {m["roster_id"]: m for m in matchups[15 + p5["r"] - 1]}
    opp = p5["w"]
    assert wk16[MY_ROSTER_ID]["points"] < wk16[opp]["points"], \
        "week-16 matchup points do not confirm the 11th-place-game loss"
    final_place = 12
    print(f"[autopsy] verified: {MY_NAME} {teams[MY_ROSTER_ID]['wins']}-"
          f"{teams[MY_ROSTER_ID]['losses']}, lost 11th-place game wk16 "
          f"{wk16[MY_ROSTER_ID]['points']:.1f}-{wk16[opp]['points']:.1f} "
          f"-> finished {final_place}th")

    # ---- ranks + medians ----------------------------------------------------
    tlist = sorted(teams.values(), key=lambda t: (-(t["wins"] + 0.5 * t["ties"]), -t["pf"]))
    eff_order = sorted(teams.values(), key=lambda t: t["left_reg"])
    for i, t in enumerate(eff_order, 1):
        t["eff_rank"] = i
    opt_order = sorted(teams.values(), key=lambda t: -t["optimal_pf"])
    for i, t in enumerate(opt_order, 1):
        t["opt_rank"] = i
    med_pf = statistics.median(t["pf"] for t in teams.values())
    med_opt = statistics.median(t["optimal_pf"] for t in teams.values())
    med_left = statistics.median(t["left_reg"] for t in teams.values())
    med_adds = statistics.median(t["adds"] for t in teams.values())
    me = teams[MY_ROSTER_ID]

    # ---- backtest citation (draft value) ------------------------------------
    bt = json.loads((ROOT / "data" / "backtest_results.json").read_text())
    bt2025 = next(y for y in bt if y["year"] == 2025)
    draft_edge_2025 = bt2025["edge"]           # tool minus Brian; negative = Brian better
    draft_edge_3yr = round(sum(y["edge"] for y in bt) / len(bt), 1)

    # ---- bucket sizing for Brian --------------------------------------------
    buckets = {
        "draft_value": {
            "label": "Draft value",
            "roster_strength_vs_median_pts": round(me["optimal_pf"] - med_opt, 1),
            "roster_strength_rank": me["opt_rank"],
            "backtest_tool_edge_2025": draft_edge_2025,
            "backtest_tool_edge_3yr_avg": draft_edge_3yr,
            "note": ("Backtest: the tool would have drafted "
                     f"{draft_edge_2025:+.0f} pts vs Brian's real 2025 "
                     "draft (bestball) — within a ~break-even 3-season "
                     f"{draft_edge_3yr:+.0f}/season. Process was fine; the "
                     f"roster it produced ranked {me['opt_rank']}/12 by "
                     "optimal PF."),
        },
        "lineup_efficiency": {
            "label": "Lineup efficiency",
            "points_left_reg": round(me["left_reg"], 1),
            "points_left_vs_median": round(me["left_reg"] - med_left, 1),
            "league_rank": me["eff_rank"],
            "points_left_incl_playoffs": round(me["left_all"], 1),
        },
        "roster_churn": {
            "label": "Roster churn",
            "adds": me["adds"], "drops": me["drops"], "trades": me["trades"],
            "league_median_adds": med_adds,
            "adds_vs_median": round(me["adds"] - med_adds, 1),
        },
        "schedule_luck": {
            "label": "Schedule luck",
            "record": f"{me['wins']}-{me['losses']}",
            "allplay": f"{me['allplay_w']:.0f}-{me['allplay_g'] - me['allplay_w']:.0f}",
            "expected_wins": round(me["exp_wins"], 2),
            "luck_delta_wins": me["luck_wins"],
        },
    }

    worst = sorted(benchings, key=lambda b: -b["points_left"])[:3]

    # ---- verdict -------------------------------------------------------------
    strength_gap = med_opt - me["optimal_pf"]           # pts short of median roster
    eff_excess = me["left_reg"] - med_left              # pts left beyond median
    verdict = (
        f"Roster strength was the killer: Brian's best possible lineup scored "
        f"{strength_gap:.0f} pts below the median roster over weeks 1-14 "
        f"({me['optimal_pf']:.0f} vs {med_opt:.0f} optimal PF) — lineup-setting "
        f"left {me['left_reg']:.0f} pts on the bench "
        f"({eff_excess:+.0f} vs median, rank {me['eff_rank']}/12), churn and "
        f"luck ({me['luck_wins']:+.1f} wins) were secondary."
    )
    if eff_excess > strength_gap:
        verdict = (
            f"Lineup-setting was the killer: {me['left_reg']:.0f} pts left on "
            f"the bench over weeks 1-14 ({eff_excess:+.0f} vs league median, "
            f"rank {me['eff_rank']}/12) — the roster itself was only "
            f"{strength_gap:.0f} pts below the median optimal, and luck was "
            f"{me['luck_wins']:+.1f} wins."
        )

    # ---- write JSON ----------------------------------------------------------
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "season": SEASON,
        "league_id": LEAGUE_ID,
        "subject": {"manager": MY_NAME, "roster_id": MY_ROSTER_ID,
                    "final_place": final_place,
                    "record": f"{me['wins']}-{me['losses']}",
                    "pf": round(me["pf"], 2)},
        "verdict": verdict,
        "buckets": buckets,
        "worst_benchings": worst,
        "league_medians": {"pf": round(med_pf, 1), "optimal_pf": round(med_opt, 1),
                           "points_left": round(med_left, 1), "adds": med_adds},
        "teams": [{
            "roster_id": t["roster_id"], "manager": t["manager"],
            "record": f"{t['wins']}-{t['losses']}" + (f"-{t['ties']}" if t["ties"] else ""),
            "pf": round(t["pf"], 1),
            "optimal_pf": round(t["optimal_pf"], 1),
            "points_left": round(t["left_reg"], 1),
            "eff_rank": t["eff_rank"],
            "adds": t["adds"], "drops": t["drops"], "trades": t["trades"],
            "allplay": f"{t['allplay_w']:.0f}-{t['allplay_g'] - t['allplay_w']:.0f}",
            "allplay_pct": round(t["allplay_pct"], 3),
            "exp_wins": round(t["exp_wins"], 2),
            "luck_wins": t["luck_wins"],
            "is_me": t["roster_id"] == MY_ROSTER_ID,
        } for t in tlist],
        "method": {
            "windows": "records/all-play/table: weeks 1-14 (regular season); "
                       "benchings scan weeks 1-17 where a real game was played",
            "optimal_lineup": "best legal fill of 1QB/2RB/3WR/1TE/1FLEX(RB-WR-TE)/"
                              "1SF(QB-RB-WR-TE)/1K/1DEF from players_points",
            "churn": "completed waiver + free-agent adds (trades listed separately)",
            "all_play": "each week every team is scored against all 11 others; "
                        "expected wins = all-play win% x 14",
            "draft_citation": "data/backtest_results.json (scripts/backtest_recommender.py)",
        },
    }
    (OUT_DIR / "autopsy_2025.json").write_text(
        json.dumps(payload, indent=2), encoding="utf-8")

    # ---- fragment -------------------------------------------------------------
    frag = build_fragment(payload)
    (OUT_DIR / "autopsy_2025.html").write_text(frag, encoding="utf-8")

    # ---- console report --------------------------------------------------------
    print(f"[autopsy] verdict: {verdict}")
    print(f"[autopsy] buckets: strength gap {strength_gap:.1f} pts below median optimal; "
          f"pts left {me['left_reg']:.1f} (rank {me['eff_rank']}/12, "
          f"{eff_excess:+.1f} vs median); adds {me['adds']} vs median {med_adds:.0f}; "
          f"luck {me['luck_wins']:+.2f} wins (all-play {buckets['schedule_luck']['allplay']})")
    for b in worst:
        print(f"[autopsy] benching: wk{b['week']} {b['player']} ({b['pos']}) "
              f"{b['bench_pts']} on bench vs {b['started_pts']} started "
              f"-> {b['points_left']} left")
    print(f"[autopsy] wrote {OUT_DIR / 'autopsy_2025.json'} and .html")


# --------------------------------------------------------------------------
# HTML fragment (ml.css classes only — no raw hex, no page wrappers)
# --------------------------------------------------------------------------

def build_fragment(d: dict) -> str:
    e = html.escape
    me = d["subject"]
    b = d["buckets"]
    rows = []
    for t in d["teams"]:
        star = "★ " if t["is_me"] else ""
        hl = ' style="background:var(--ml-mine-tint)"' if t["is_me"] else ""
        me_tag = ' <span class="ml-note">(me)</span>' if t["is_me"] else ""
        luck_cls = "ml-sv-hi" if t["luck_wins"] > 0.5 else (
            "ml-sv-lo" if t["luck_wins"] < -0.5 else "ml-sv-mid")
        rows.append(
            f'<tr{hl}><td>{star}{e(t["manager"])}{me_tag}</td>'
            f'<td class="ml-num">{e(t["record"])}</td>'
            f'<td class="ml-num">{t["pf"]:.1f}</td>'
            f'<td class="ml-num">{t["optimal_pf"]:.1f}</td>'
            f'<td class="ml-num">{t["points_left"]:.1f}</td>'
            f'<td class="ml-num">{t["eff_rank"]}</td>'
            f'<td class="ml-num">{t["adds"]}</td>'
            f'<td class="ml-num">{e(t["allplay"])}</td>'
            f'<td class="ml-num {luck_cls}">{t["luck_wins"]:+.1f}</td></tr>')

    bench_items = []
    for w in d["worst_benchings"]:
        badge = e((w["pos"] or "?").lower())
        bench_items.append(
            f'<li><span class="ml-badge ml-badge--{badge}">{e(w["pos"] or "?")}</span> '
            f'<strong>{e(w["player"])}</strong> — week <span class="ml-num">{w["week"]}</span>: '
            f'<span class="ml-num">{w["bench_pts"]}</span> on the bench while the slot '
            f'scored <span class="ml-num">{w["started_pts"]}</span> '
            f'&rarr; <span class="ml-num ml-sv-lo">{w["points_left"]}</span> pts left</li>')

    dv = b["draft_value"]
    le = b["lineup_efficiency"]
    rc = b["roster_churn"]
    sl = b["schedule_luck"]
    cards = f"""
  <div class="ml-card"><span class="ml-h-label">1 &middot; Draft value</span>
    <p>Roster strength (optimal PF) <span class="ml-num">{dv["roster_strength_vs_median_pts"]:+.0f}</span> pts vs the median roster.
    {e(dv["note"])}</p></div>
  <div class="ml-card"><span class="ml-h-label">2 &middot; Lineup efficiency</span>
    <p><span class="ml-num">{le["points_left_reg"]:.0f}</span> pts left on the bench, weeks 1&ndash;14
    (<span class="ml-num">{le["points_left_vs_median"]:+.0f}</span> vs league median &mdash;
    efficiency rank <span class="ml-num">{le["league_rank"]}/12</span>;
    <span class="ml-num">{le["points_left_incl_playoffs"]:.0f}</span> incl. consolation weeks).</p></div>
  <div class="ml-card"><span class="ml-h-label">3 &middot; Roster churn</span>
    <p><span class="ml-num">{rc["adds"]}</span> adds vs league median <span class="ml-num">{rc["league_median_adds"]:.0f}</span>
    (<span class="ml-num">{rc["adds_vs_median"]:+.0f}</span>); {rc["drops"]} drops, {rc["trades"]} trade{"" if rc["trades"] == 1 else "s"}.</p></div>
  <div class="ml-card"><span class="ml-h-label">4 &middot; Schedule luck</span>
    <p>Actual <span class="ml-num">{e(sl["record"])}</span> vs all-play <span class="ml-num">{e(sl["allplay"])}</span> &mdash;
    expected wins <span class="ml-num">{sl["expected_wins"]:.1f}</span>, luck
    <span class="ml-num">{sl["luck_delta_wins"]:+.1f}</span> wins.</p></div>"""

    return f"""<section id="autopsy-2025" aria-labelledby="autopsy-2025-h">
<h2 class="ml-h-label" id="autopsy-2025-h">THE 2025 AUTOPSY &mdash; WHY 12TH</h2>
<div class="ml-banner ml-banner--error" role="note"><strong>VERDICT:</strong> {e(d["verdict"])}</div>
<div class="ml-panel">
  <h2 class="ml-h-label">THE FOUR BUCKETS &mdash; {e(me["manager"])}, {e(me["record"])}, {me["pf"]:.1f} PF, finished {me["final_place"]}th</h2>
  {cards}
</div>
<div class="ml-panel">
  <h2 class="ml-h-label">FULL-LEAGUE DECOMPOSITION &mdash; 2025 REGULAR SEASON (WKS 1&ndash;14)</h2>
  <table class="ml-table ml-table--compact">
    <thead><tr><th scope="col">Manager</th><th scope="col">Record</th><th scope="col">PF</th>
    <th scope="col">Optimal PF</th><th scope="col">Pts left</th><th scope="col">Eff rank</th>
    <th scope="col">Adds</th><th scope="col">All-play</th><th scope="col">Luck &Delta;W</th></tr></thead>
    <tbody>
{chr(10).join(rows)}
    </tbody>
  </table>
</div>
<div class="ml-panel">
  <h2 class="ml-h-label">THE THREE WORST BENCHINGS</h2>
  <ul>
{chr(10).join(bench_items)}
  </ul>
</div>
<p class="ml-fineprint">Method: optimal lineup = best legal fill of
1QB/2RB/3WR/1TE/1FLEX(RB&ndash;WR&ndash;TE)/1SF(QB&ndash;RB&ndash;WR&ndash;TE)/1K/1DEF
from each week&rsquo;s rostered player scores; pts left = optimal &minus; actual starters.
Table window is the 14-week regular season; benchings scan every week a real game was
played (Brian&rsquo;s season ended with the week-16 11th-place game). All-play scores each
team against all 11 opponents each week; luck &Delta;W = actual wins &minus; all-play
expected wins. Churn counts completed waiver/FA adds. Draft-value citation from the
recorded backtest (scripts/backtest_recommender.py): the tool would have drafted
{b["draft_value"]["backtest_tool_edge_2025"]:+.0f} pts vs Brian&rsquo;s real 2025 draft,
inside a ~break-even {b["draft_value"]["backtest_tool_edge_3yr_avg"]:+.0f}/season
three-year record &mdash; per-swap benching gains overlap and need not sum to the weekly
total. Sources: Sleeper matchups/transactions cached in data/league_history/.</p>
</section>
"""


if __name__ == "__main__":
    main()
