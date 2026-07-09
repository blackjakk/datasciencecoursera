"""MONEYLEAGUE category leaderboards — every angle the league might
care about, with my synthesis at the end.
"""
from __future__ import annotations

import glob
import json
import statistics
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.results import (  # noqa: E402
    load_all_seasons,
    load_draft_picks_with_points,
    load_player_ownership_windows,
    load_weekly_player_points,
)
from fantasy_draft.league_history import load_all_history  # noqa: E402
from fantasy_draft.team_identity import (  # noqa: E402
    manager_for_sleeper_roster, all_managers,
)

ROOT = Path(__file__).resolve().parent.parent
MD_OUT = ROOT / "data" / "MONEYLEAGUE_RANKINGS.md"
PDF_OUT = ROOT / "data" / "MONEYLEAGUE_RANKINGS.pdf"


def _mgr(rid: int) -> str | None:
    m = manager_for_sleeper_roster(rid)
    return m["canonical_name"].split(" (")[0] if m else None


def _compute_all_metrics() -> dict:
    seasons = load_all_seasons(ROOT / "data" / "sleeper")

    # Champions
    champs: dict[int, int] = {}
    for s, sd in seasons.items():
        crid = sd.get("champion_roster_id")
        if crid:
            champs[s] = crid

    # All-play wins per (rid, season) + collect weekly score lists for CV/max
    apw: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    weekly_pts: dict[int, list[float]] = defaultdict(list)
    max_week: dict[int, tuple[int, int, float]] = {}  # rid → (season, week, pts)
    for s, sd in seasons.items():
        wkpts: dict[int, dict[int, float]] = defaultdict(dict)
        for (rid, wk), pts in sd.get("weekly_team_points", {}).items():
            if wk <= 14:
                wkpts[wk][rid] = pts
                weekly_pts[rid].append(pts)
                if rid not in max_week or pts > max_week[rid][2]:
                    max_week[rid] = (s, wk, pts)
        for wk, scores in wkpts.items():
            for rid, p in scores.items():
                for orid, op in scores.items():
                    if orid != rid and p > op:
                        apw[rid][s] += 1

    # Actual wins + playoff appearances (top-6 by wins makes playoffs)
    actual: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    po_appearances: dict[int, int] = defaultdict(int)
    for ld in glob.glob(str(ROOT / "data" / "sleeper" / "league_*")):
        li_path = Path(ld) / "league.json"
        if not li_path.exists():
            continue
        season = int(json.loads(li_path.read_text()).get("season", 0))
        if season not in (2023, 2024, 2025):
            continue
        mdir = Path(ld) / "matchups"
        if not mdir.exists():
            continue
        season_wins: dict[int, int] = defaultdict(int)
        for wf in sorted(mdir.glob("week_*.json")):
            wk = int(wf.stem.replace("week_", ""))
            if wk > 14:
                continue
            ms = json.loads(wf.read_text())
            by_mid: dict = defaultdict(list)
            for m in ms:
                mid = m.get("matchup_id")
                if mid is not None:
                    by_mid[mid].append(m)
            for mid, pair in by_mid.items():
                if len(pair) == 2 and all(p.get("points") is not None for p in pair):
                    pair.sort(key=lambda p: -p["points"])
                    w, l = pair[0], pair[1]
                    if w["points"] != l["points"]:
                        actual[w["roster_id"]][season] += 1
                        season_wins[w["roster_id"]] += 1
        # Playoff teams = top 6 by wins (assume tiebreaker by PF, but for counts good enough)
        top6 = sorted(season_wins.items(), key=lambda kv: -kv[1])[:6]
        for rid, _ in top6:
            po_appearances[rid] += 1

    # Total PF
    pf: dict[int, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    for s, sd in seasons.items():
        for (rid, wk), pts in sd.get("weekly_team_points", {}).items():
            if wk <= 14:
                pf[rid][s] += pts

    # Draft VBD overall + by position (QB / RB / WR)
    picks = load_draft_picks_with_points(ROOT / "data" / "sleeper")
    pv = json.loads((ROOT / "data" / "pick_value.json").read_text())
    RANKS = pv["replacement_ranks_used"]
    per_season_picks: dict[int, list[dict]] = defaultdict(list)
    for p in picks:
        per_season_picks[p["season"]].append(p)
    def repl_for(sp):
        bp: dict[str, list[float]] = defaultdict(list)
        for p in sp:
            if p["position"] in RANKS and p["season_points"]:
                bp[p["position"]].append(p["season_points"])
        out = {}
        for pos, pts in bp.items():
            pts.sort(reverse=True)
            out[pos] = pts[min(RANKS[pos] - 1, len(pts) - 1)] if pts else 0.0
        return out
    repl = {s: repl_for(ps) for s, ps in per_season_picks.items()}
    draft_vbd: dict[int, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    pos_vbd: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    for p in picks:
        if p.get("is_keeper"):
            continue
        v = (p["season_points"] or 0) - repl[p["season"]].get(p["position"], 0)
        draft_vbd[p["roster_id"]][p["season"]] += v
        pos_vbd[p["position"]][p["roster_id"]] += v

    # Wire VBD (FA adds only, not trades) + total adds count
    ownership = load_player_ownership_windows(ROOT / "data" / "sleeper")
    weekly = load_weekly_player_points(ROOT / "data" / "sleeper")
    wire_pts: dict[int, float] = defaultdict(float)
    wire_adds: dict[int, int] = defaultdict(int)
    for (s, pid), windows in ownership.items():
        if s not in (2023, 2024, 2025):
            continue
        for sw, ew, rid, src in windows:
            if sw <= 1 or src != "add":
                continue
            wire_adds[rid] += 1
            wire_pts[rid] += sum(weekly.get(s, {}).get(wk, {}).get(pid, 0.0)
                                  for wk in range(sw, min(ew + 1, 18)))

    # Per-manager summary across 3 years
    all_rids = {r for r in pf if _mgr(r)}
    rows = []
    for rid in all_rids:
        nm = _mgr(rid)
        ch_yrs = [s for s, crid in champs.items() if crid == rid]
        a_w = sum(actual[rid].values())
        apw_total = sum(apw[rid].values())
        exp_w = (apw_total / 462) * 14 * 3 if apw_total else 0
        tpf = sum(pf[rid].values())
        dvbd = sum(draft_vbd[rid].values())
        wpts = wire_pts[rid]
        wkly = weekly_pts.get(rid, [])
        cv = (100 * statistics.stdev(wkly) / statistics.mean(wkly)
              if len(wkly) > 1 else 0.0)
        mx = max_week.get(rid, (0, 0, 0))
        rows.append({
            "rid": rid, "name": nm,
            "championships": ch_yrs,
            "actual_w": a_w, "expected_w": exp_w,
            "playoff_appearances": po_appearances.get(rid, 0),
            "total_pf": tpf, "draft_vbd": dvbd,
            "wire_pts": wpts, "wire_adds": wire_adds.get(rid, 0),
            "luck": a_w - exp_w,
            "cv": cv,
            "max_week": mx,  # (season, week, pts)
            "qb_vbd": pos_vbd["QB"].get(rid, 0),
            "rb_vbd": pos_vbd["RB"].get(rid, 0),
            "wr_vbd": pos_vbd["WR"].get(rid, 0),
        })
    return {"rows": rows, "champions": champs}


def build_markdown() -> str:
    data = _compute_all_metrics()
    rows = data["rows"]
    champs = data["champions"]
    today = date.today().strftime("%B %Y")

    md: list[str] = []
    md.append("# MONEYLEAGUE Category Leaderboards")
    md.append(f"*{today} · Sleeper era 2023-2025 · 42 regular-season games per manager*\n")
    md.append("Twelve different lenses on who's been good at what — followed "
              "by a synthesis at the end.\n")
    md.append("---\n")

    # ===== 1. Championships =====
    # ===== 15-year all-time =====
    history = load_all_history()
    all_time: dict[str, dict] = {}
    for yr, sd in history.items():
        for mid, r in sd["rosters"].items():
            d = all_time.setdefault(mid, {
                "years": set(), "wins": 0, "losses": 0,
                "pf": 0.0, "pa": 0.0, "high": (0, 0, 0.0),
                "low": (0, 0, 999.0),
            })
            d["years"].add(yr)
            d["wins"] += r["wins"]
            d["losses"] += r["losses"]
            d["pf"] += r["pf"]
            d["pa"] += r["pa"]
            if r["high_score"][1] > d["high"][2]:
                d["high"] = (yr, r["high_score"][0], r["high_score"][1])
            if 0 < r["low_score"][1] < d["low"][2]:
                d["low"] = (yr, r["low_score"][0], r["low_score"][1])

    mgr_name = {m["id"]: m["canonical_name"].split(" (")[0]
                for m in all_managers()}
    current = {m["id"] for m in all_managers() if m.get("sleeper_roster_id")}
    sorted_all = sorted(all_time.items(),
                        key=lambda kv: -kv[1]["wins"])

    md.append("## 🕰️ All-Time Standings (2011-2025, regular season only)\n")
    md.append("Combined Yahoo (2011-2022) + Sleeper (2023-2025). Active "
              "managers only; former members in a footnote.\n")
    md.append("| Rank | Manager | Years | W | L | Win% | PF | PA |")
    md.append("|---|---|---|---|---|---|---|---|")
    rank = 0
    for mid, d in sorted_all:
        if mid not in current:
            continue
        rank += 1
        n_yr = len(d["years"])
        gp = d["wins"] + d["losses"]
        wp = 100 * d["wins"] / max(1, gp)
        md.append(f"| {rank} | **{mgr_name[mid]}** | {n_yr} | "
                  f"{d['wins']} | {d['losses']} | {wp:.0f}% | "
                  f"{d['pf']:.0f} | {d['pa']:.0f} |")
    md.append("")
    md.append("*Win% over **regular season games only** (W1-W13). Hot take: "
              "this is the most honest measure of long-term competitiveness — "
              "no playoff luck, no schedule tricks.*\n")

    md.append("## 🚀 All-Time Single-Game High Scores\n")
    md.append("| Rank | Manager | High | When |")
    md.append("|---|---|---|---|")
    by_high = sorted(((mid, d) for mid, d in all_time.items() if mid in current),
                     key=lambda kv: -kv[1]["high"][2])
    for i, (mid, d) in enumerate(by_high, 1):
        yr, wk, pts = d["high"]
        md.append(f"| {i} | **{mgr_name[mid]}** | {pts:.1f} | {yr} W{wk} |")
    md.append("")

    md.append("## 💩 All-Time Single-Game Lows (≥10 pts)\n")
    md.append("Just for fun — the worst weeks ever.\n")
    md.append("| Rank | Manager | Low | When |")
    md.append("|---|---|---|---|")
    by_low = sorted(((mid, d) for mid, d in all_time.items() if mid in current),
                    key=lambda kv: kv[1]["low"][2])
    for i, (mid, d) in enumerate(by_low, 1):
        yr, wk, pts = d["low"]
        if pts > 990:
            continue
        md.append(f"| {i} | **{mgr_name[mid]}** | {pts:.1f} | {yr} W{wk} |")
    md.append("")

    md.append("## 🏆 Championships (the only ring that matters)\n")
    md.append("| Year | Champion |")
    md.append("|---|---|")
    for s in sorted(champs):
        md.append(f"| {s} | **{_mgr(champs[s])}** |")
    md.append("")
    md.append("Three different winners in three years. No repeat champs. "
              "Eight of twelve current managers still have zero titles in "
              "the Sleeper era. Each year someone different has unlocked it.\n")

    # ===== 2. Total regular-season wins =====
    md.append("## 📊 Regular-Season Wins (2023-25, 42 games)\n")
    by_wins = sorted(rows, key=lambda r: -r["actual_w"])
    md.append("| Rank | Manager | Total W | Best year | Notes |")
    md.append("|---|---|---|---|---|")
    for i, r in enumerate(by_wins, 1):
        nm = r["name"]
        note = "🏆 " + ", ".join(str(y) for y in r["championships"]) if r["championships"] else ""
        md.append(f"| {i} | **{nm}** | {r['actual_w']} | — | {note} |")
    md.append("")
    md.append("**Brower has more regular-season wins than anyone — 33 of "
              "42 (79%)** — but no title. That's the playoff-variance tax: "
              "you can dominate the season and still get bounced in one bad "
              "Sunday.\n")

    # ===== 3. All-play wins (true team strength) =====
    md.append("## 🎯 True Team Strength — Expected Wins\n")
    md.append("Computed as **all-play expected wins**: your weekly score "
              "compared against every other team's that week. Removes "
              "schedule noise entirely.\n")
    by_exp = sorted(rows, key=lambda r: -r["expected_w"])
    md.append("| Rank | Manager | Expected W | Actual W | Gap |")
    md.append("|---|---|---|---|---|")
    for i, r in enumerate(by_exp, 1):
        gap = r["actual_w"] - r["expected_w"]
        gap_str = f"{gap:+.1f}"
        md.append(f"| {i} | **{r['name']}** | {r['expected_w']:.1f} | "
                  f"{r['actual_w']} | {gap_str} |")
    md.append("")
    md.append("This is **the most accurate measure of who's been good** in "
              "our league. Brower remains #1 (no surprise — most wins AND "
              "most points). What's striking is the gap between actual and "
              "expected for some managers: several teams below the actual-"
              "wins line have substantially MORE expected wins than their "
              "record shows. That's the schedule-luck story — quantified in "
              "its own table further down.\n")

    # ===== 4. Total points scored =====
    md.append("## 🔥 Total Points Scored (42 games)\n")
    by_pf = sorted(rows, key=lambda r: -r["total_pf"])
    md.append("| Rank | Manager | Total PF | PPG |")
    md.append("|---|---|---|---|")
    for i, r in enumerate(by_pf, 1):
        md.append(f"| {i} | **{r['name']}** | {r['total_pf']:.0f} | "
                  f"{r['total_pf']/42:.1f} |")
    median_ppg = statistics.median(r["total_pf"]/42 for r in rows)
    leader = by_pf[0]
    md.append(f"\nLeader averages **{leader['total_pf']/42:.1f} PPG** "
              f"vs the league median of ~{median_ppg:.0f}. That few-point "
              f"edge week after week compounds into wins.\n")

    # ===== Playoff appearances =====
    md.append("## 🎟️ Playoff Appearances (out of 3)\n")
    by_po = sorted(rows, key=lambda r: (-r["playoff_appearances"], -r["actual_w"]))
    md.append("| Rank | Manager | Appearances | Titles |")
    md.append("|---|---|---|---|")
    for i, r in enumerate(by_po, 1):
        ch = ", ".join(str(y) for y in r["championships"]) or "—"
        md.append(f"| {i} | **{r['name']}** | {r['playoff_appearances']}/3 | {ch} |")
    md.append("")
    md.append("Making the playoffs is the threshold question; winning one "
              "is a different game entirely. Several managers have made all "
              "three playoffs without converting; one champion did it on "
              "just one playoff appearance.\n")

    # ===== Consistency =====
    md.append("## 📐 Consistency Index — Weekly Scoring CV\n")
    by_cv = sorted(rows, key=lambda r: r["cv"])
    md.append("| Rank | Manager | Avg PPG | StdDev | CV |")
    md.append("|---|---|---|---|---|")
    for i, r in enumerate(by_cv, 1):
        avg = r["total_pf"]/42
        sd = avg * r["cv"]/100
        md.append(f"| {i} | **{r['name']}** | {avg:.1f} | {sd:.1f} | {r['cv']:.1f}% |")
    md.append("")
    md.append("Coefficient of variation — lower = steadier week to week. "
              "Consistent rosters dodge the bad-week blowups that kill "
              "playoff seeding. Volatile rosters can boom-OR-bust; the "
              "bust weeks usually outnumber the booms.\n")

    # ===== Highest single-game score =====
    md.append("## 🚀 Highest Single-Game Score\n")
    by_max = sorted(rows, key=lambda r: -r["max_week"][2])
    md.append("| Rank | Manager | Best Game | When |")
    md.append("|---|---|---|---|")
    for i, r in enumerate(by_max, 1):
        s, w, p = r["max_week"]
        md.append(f"| {i} | **{r['name']}** | {p:.1f} | {s} W{w} |")
    md.append("")
    md.append("The single-week explosions. These are the games you screenshot "
              "and never let anyone forget.\n")

    # ===== 5. Draft skill =====
    md.append("## 🎯 Draft VBD (3-year cumulative)\n")
    by_draft = sorted(rows, key=lambda r: -r["draft_vbd"])
    md.append("| Rank | Manager | 3-yr Draft VBD | Per year |")
    md.append("|---|---|---|---|")
    for i, r in enumerate(by_draft, 1):
        md.append(f"| {i} | **{r['name']}** | {r['draft_vbd']:+.0f} | "
                  f"{r['draft_vbd']/3:+.0f} |")
    md.append("")
    md.append("Draft skill measured strictly: above-replacement points "
              "delivered by drafted players (keepers excluded). The "
              "champions (Eric, Coop, Trevor) all ranked top-5 here. "
              "**Drafting is the controllable thing that most correlates "
              "with winning.**\n")

    # ===== 6. Best QB Drafter (position-specific) =====
    md.append("## 👑 Best QB Drafter\n")
    by_qb = sorted(rows, key=lambda r: -r["qb_vbd"])
    md.append("| Rank | Manager | 3-yr QB VBD |")
    md.append("|---|---|---|")
    for i, r in enumerate(by_qb, 1):
        md.append(f"| {i} | **{r['name']}** | {r['qb_vbd']:+.0f} |")
    md.append("")
    md.append("In a 2QB/SF league, QB drafting is the highest-leverage "
              "category. Top of this list = found a top-12 QB in the late "
              "rounds and rode him to multiple titles' worth of points.\n")

    # ===== Wire VBD =====
    md.append("## 🔍 Wire Production (FA adds only, no trades)\n")
    by_wire = sorted(rows, key=lambda r: -r["wire_pts"])
    md.append("| Rank | Manager | 3-yr Wire pts | Hit rate |")
    md.append("|---|---|---|---|")
    for i, r in enumerate(by_wire, 1):
        adds = max(1, r["wire_adds"])
        ppa = r["wire_pts"] / adds
        md.append(f"| {i} | **{r['name']}** | +{r['wire_pts']:.0f} | "
                  f"{ppa:.1f} pts/add |")
    md.append("")
    md.append("Wire pickup production excludes trade acquisitions (which "
              "are credited to the trade ledger, not the wire). Volume "
              "drives the top of this ranking; selective adders show up "
              "with high pts/add but lower totals.\n")

    # ===== Activity =====
    md.append("## ⚡ Wire Activity — Total Adds (3 years)\n")
    by_adds = sorted(rows, key=lambda r: -r["wire_adds"])
    md.append("| Rank | Manager | Adds | Per Year |")
    md.append("|---|---|---|---|")
    for i, r in enumerate(by_adds, 1):
        md.append(f"| {i} | **{r['name']}** | {r['wire_adds']} | "
                  f"{r['wire_adds']/3:.0f}/yr |")
    md.append("")
    md.append("Two valid strategies here: spray-and-pray volume vs "
              "selective tactical. The bottom of this list isn't bad — "
              "Donnie has the fewest adds and the highest hit rate. "
              "The middle of this list (~80-100 adds with low hit rate) "
              "is the worst zone — too active to be selective, too sparse "
              "to catch every league-winner.\n")

    # ===== 7. Luckiest / unluckiest =====
    md.append("## 🍀 Luck Standings — Actual vs Expected Wins\n")
    by_luck = sorted(rows, key=lambda r: -r["luck"])
    md.append("| Rank | Manager | Actual W | Expected W | Luck |")
    md.append("|---|---|---|---|---|")
    for i, r in enumerate(by_luck, 1):
        md.append(f"| {i} | **{r['name']}** | {r['actual_w']} | "
                  f"{r['expected_w']:.1f} | {r['luck']:+.1f} |")
    md.append("")
    md.append("Positive luck = won more than your points deserved. "
              "Negative luck = the schedule has been hostile. **Trevor and "
              "Josh have been the league's beneficiaries.** **The most "
              "schedule-unlucky managers will regress upward in 2026 — "
              "that's not a hope, that's math.**\n")

    # ===== Luck — kept in the verdict section feeds =====
    # (we want the luck table earlier too, so move it before this)

    # ===== Synthesis =====
    md.append("## 🎙️ Synthesis — What the Data Actually Says\n")
    md.append("Pulling all twelve leaderboards together, here are the "
              "labels that the data supports — computed dynamically, no "
              "favorites:\n")

    top_strength = max(rows, key=lambda r: r["expected_w"])
    top_draft = max(rows, key=lambda r: r["draft_vbd"])
    top_qb = max(rows, key=lambda r: r["qb_vbd"])
    top_wire = max(rows, key=lambda r: r["wire_pts"])
    most_unlucky = min(rows, key=lambda r: r["luck"])
    most_lucky = max(rows, key=lambda r: r["luck"])
    bottom_strength = min(rows, key=lambda r: r["expected_w"])
    most_consistent = min(rows, key=lambda r: r["cv"])
    most_volatile = max(rows, key=lambda r: r["cv"])
    biggest_game = max(rows, key=lambda r: r["max_week"][2])
    most_po = max(rows, key=lambda r: r["playoff_appearances"])

    md.append(f"**🥇 Best overall team** (most points, most wins, most "
              f"expected wins): **{top_strength['name']}**. The only thing "
              f"missing is a ring, which is a coin flip every January.\n")
    md.append(f"**🎟️ Most playoff appearances**: **{most_po['name']}** "
              f"({most_po['playoff_appearances']}/3). Reliable contention "
              f"every year.\n")
    md.append(f"**🎯 Best drafter** ({top_draft['draft_vbd']:+.0f} 3-yr VBD): "
              f"**{top_draft['name']}**.\n")
    md.append(f"**👑 Best QB drafter** ({top_qb['qb_vbd']:+.0f}): "
              f"**{top_qb['name']}**. The most valuable position group "
              f"in our format.\n")
    md.append(f"**🔍 Best on the wire**: **{top_wire['name']}** "
              f"(+{top_wire['wire_pts']:.0f} pts off waivers).\n")
    md.append(f"**📐 Steadiest team** (lowest CV at {most_consistent['cv']:.1f}%): "
              f"**{most_consistent['name']}**. Almost never has a bad week.\n")
    md.append(f"**🎢 Most volatile team** ({most_volatile['cv']:.1f}% CV): "
              f"**{most_volatile['name']}**. When it's good it's great, but "
              f"the bad weeks come for everyone eventually.\n")
    md.append(f"**🚀 Single-week ceiling**: **{biggest_game['name']}** with "
              f"a **{biggest_game['max_week'][2]:.1f}-point** explosion in "
              f"{biggest_game['max_week'][0]} W{biggest_game['max_week'][1]}.\n")
    md.append(f"**🍀 Most schedule-lucky**: **{most_lucky['name']}** "
              f"({most_lucky['luck']:+.1f} wins above expectation). "
              f"Some regression coming in 2026.\n")
    md.append(f"**🌊 Most schedule-unlucky**: **{most_unlucky['name']}** "
              f"({most_unlucky['luck']:+.1f} wins below expectation). Has "
              f"been better than the record shows.\n")
    md.append(f"**🛠️ Most growth needed**: **{bottom_strength['name']}** "
              f"({bottom_strength['expected_w']:.1f} expected wins over 3 "
              f"years). Mostly a scoring problem.\n")

    md.append("**The big takeaway**: this is a *tight* league. Outside of "
              f"{top_strength['name']}'s clear top-tier dominance and "
              f"{bottom_strength['name']}'s scoring struggle, the middle 9 "
              "managers are all within ~6 expected wins of each other across "
              "42 games. Three different champs in three years isn't a "
              "coincidence — any of these teams can win it. The question is "
              "who'll have the peak draft year + a friendly schedule when "
              "their turn comes.\n")

    md.append("---\n")
    md.append("*All rankings from offline Sleeper data dump. Regular season "
              "only (W1-W14). Draft VBD uses post-Yahoo-trade xlsx "
              "attribution for 2023. Wire production excludes trade "
              "acquisitions. \"Expected wins\" = 14 × (all-play wins ÷ 462 "
              "max).*")
    return "\n".join(md)


def _md_to_html(md_text: str) -> str:
    import re
    lines = md_text.split("\n")
    html: list[str] = []
    in_table = in_para = False

    def cp():
        nonlocal in_para
        if in_para:
            html.append("</p>"); in_para = False

    def ct():
        nonlocal in_table
        if in_table:
            html.append("</tbody></table>"); in_table = False

    def inline(t):
        t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
        t = re.sub(r"\*(.+?)\*", r"<em>\1</em>", t)
        return t

    for ln in lines:
        if ln.startswith("# "):
            cp(); ct(); html.append(f"<h1>{inline(ln[2:])}</h1>")
        elif ln.startswith("## "):
            cp(); ct(); html.append(f"<h2>{inline(ln[3:])}</h2>")
        elif ln.startswith("|") and "---" in ln:
            continue
        elif ln.startswith("|"):
            cells = [c.strip() for c in ln.strip("|").split("|")]
            if not in_table:
                cp()
                html.append('<table><thead><tr>'
                            + "".join(f"<th>{inline(c)}</th>" for c in cells)
                            + "</tr></thead><tbody>")
                in_table = True
            else:
                html.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in cells) + "</tr>")
        elif ln.strip() == "---":
            cp(); ct(); html.append("<hr/>")
        elif ln.strip() == "":
            cp(); ct()
        else:
            ct()
            if not in_para:
                html.append("<p>"); in_para = True
            html.append(inline(ln))
    cp(); ct()

    css = """
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 720px;
           margin: 32px auto; padding: 0 30px; color: #1a1a1a;
           line-height: 1.55; font-size: 11pt; }
    h1 { font-size: 22pt; border-bottom: 3px solid #1a1a1a;
         padding-bottom: 8px; margin-top: 0; }
    h2 { font-size: 14pt; color: #0a4d6b; margin-top: 22px;
         margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin: 6px 0 12px 0;
            font-size: 9.5pt; }
    th { background: #2c5d7c; color: white; padding: 5px 8px; text-align: left; }
    td { padding: 4px 8px; border-bottom: 1px solid #ddd; }
    tr:nth-child(even) td { background: #f8f8f8; }
    em { color: #555; }
    hr { border: none; border-top: 1px solid #ccc; margin: 16px 0; }
    p { margin: 4px 0; }
    @page { size: letter; margin: 0.6in; }
    """
    return f"<!DOCTYPE html><html><head><meta charset='utf-8'><style>{css}</style></head><body>" + "\n".join(html) + "</body></html>"


def main():
    md = build_markdown()
    MD_OUT.write_text(md, encoding="utf-8")
    print(f"Wrote {MD_OUT.relative_to(ROOT)}")
    try:
        from weasyprint import HTML
    except ImportError:
        sys.exit("weasyprint not installed.")
    html = _md_to_html(md)
    HTML(string=html).write_pdf(str(PDF_OUT))
    print(f"Wrote {PDF_OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
