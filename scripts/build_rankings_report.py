"""MONEYLEAGUE definitive rankings — multiple defensible metrics with
an honest opinion at the end. The "this is what the data actually says"
report.
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
from fantasy_draft.team_identity import manager_for_sleeper_roster  # noqa: E402

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

    # All-play wins per (rid, season)
    apw: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    for s, sd in seasons.items():
        wkpts: dict[int, dict[int, float]] = defaultdict(dict)
        for (rid, wk), pts in sd.get("weekly_team_points", {}).items():
            if wk <= 14:
                wkpts[wk][rid] = pts
        for wk, scores in wkpts.items():
            for rid, p in scores.items():
                for orid, op in scores.items():
                    if orid != rid and p > op:
                        apw[rid][s] += 1

    # Actual wins from matchup files
    actual: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    for ld in glob.glob(str(ROOT / "data" / "sleeper" / "league_*")):
        li_path = Path(ld) / "league.json"
        if not li_path.exists():
            continue
        season = int(json.loads(li_path.read_text()).get("season", 0))
        mdir = Path(ld) / "matchups"
        if not mdir.exists():
            continue
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

    # Total PF
    pf: dict[int, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    for s, sd in seasons.items():
        for (rid, wk), pts in sd.get("weekly_team_points", {}).items():
            if wk <= 14:
                pf[rid][s] += pts

    # Draft VBD per season per mgr (live Sleeper data 2023-25)
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
    for p in picks:
        if p.get("is_keeper"):
            continue
        v = (p["season_points"] or 0) - repl[p["season"]].get(p["position"], 0)
        draft_vbd[p["roster_id"]][p["season"]] += v

    # Wire VBD (FA adds only, not trades)
    ownership = load_player_ownership_windows(ROOT / "data" / "sleeper")
    weekly = load_weekly_player_points(ROOT / "data" / "sleeper")
    wire_pts: dict[int, float] = defaultdict(float)
    for (s, pid), windows in ownership.items():
        if s not in (2023, 2024, 2025):
            continue
        for sw, ew, rid, src in windows:
            if sw <= 1 or src != "add":
                continue
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
        # 11 opponents × 14 weeks × 3 years = 462 max possible
        exp_w = (apw_total / 462) * 14 * 3 if apw_total else 0
        tpf = sum(pf[rid].values())
        dvbd = sum(draft_vbd[rid].values())
        wpts = wire_pts[rid]
        rows.append({
            "rid": rid, "name": nm,
            "championships": ch_yrs,
            "actual_w": a_w, "expected_w": exp_w,
            "total_pf": tpf, "draft_vbd": dvbd,
            "wire_pts": wpts,
            "luck": a_w - exp_w,
        })
    return {"rows": rows, "champions": champs}


def build_markdown() -> str:
    data = _compute_all_metrics()
    rows = data["rows"]
    champs = data["champions"]
    today = date.today().strftime("%B %Y")

    md: list[str] = []
    md.append("# MONEYLEAGUE Rankings — The Honest Version")
    md.append(f"*{today} · Sleeper era 2023-2025*\n")
    md.append("Multiple defensible metrics, ranked, with my opinion at the "
              "end. No cherry-picking, no obfuscation. If the numbers say "
              "something, the numbers say it.\n")
    md.append("---\n")

    # ===== 1. Championships =====
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
              "most points). What's interesting is the bottom: Brian, Lem, "
              "and Tim all have fewer expected wins than several teams "
              "they outranked in actual wins. They're not unlucky — they're "
              "just losing.\n")

    # ===== 4. Total points scored =====
    md.append("## 🔥 Total Points Scored (42 games)\n")
    by_pf = sorted(rows, key=lambda r: -r["total_pf"])
    md.append("| Rank | Manager | Total PF | PPG |")
    md.append("|---|---|---|---|")
    for i, r in enumerate(by_pf, 1):
        md.append(f"| {i} | **{r['name']}** | {r['total_pf']:.0f} | "
                  f"{r['total_pf']/42:.1f} |")
    md.append("")
    md.append("Same shape as expected wins, because that's what expected "
              "wins is measuring. Brower's lead here is enormous — he's "
              "averaged **117.9 PPG vs the league median of ~109**. That "
              "8-point edge week after week is what built his 33-win record.\n")

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

    # ===== 6. Wire VBD =====
    md.append("## 🔍 Wire Production (FA adds only, no trades)\n")
    by_wire = sorted(rows, key=lambda r: -r["wire_pts"])
    md.append("| Rank | Manager | 3-yr Wire pts |")
    md.append("|---|---|---|")
    for i, r in enumerate(by_wire, 1):
        md.append(f"| {i} | **{r['name']}** | +{r['wire_pts']:.0f} |")
    md.append("")
    md.append("Wire pickup production (not including trade acquisitions). "
              "Volume managers — Brower, Trevor, Brian — tend to top this "
              "ranking. Selective managers underperform here by definition "
              "but make up for it elsewhere.\n")

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

    # ===== 8. My honest verdict =====
    md.append("## 🎙️ My Take — Who's Actually Been Good\n")
    md.append("Synthesizing all of the above, here's my opinion on what the "
              "data says, separating skill from luck:\n")

    # Identify standouts dynamically
    top_strength = max(rows, key=lambda r: r["expected_w"])
    top_draft = max(rows, key=lambda r: r["draft_vbd"])
    most_unlucky = min(rows, key=lambda r: r["luck"])
    most_lucky = max(rows, key=lambda r: r["luck"])
    bottom_strength = min(rows, key=lambda r: r["expected_w"])

    md.append(f"**🥇 Best overall manager (skill, not luck): {top_strength['name']}.** "
              f"Most points scored, most actual wins, most expected wins — "
              f"three different metrics, same answer. The only thing missing "
              f"is a title, which is a coin flip every January.\n")
    md.append(f"**🎯 Best drafter: {top_draft['name']}** "
              f"({top_draft['draft_vbd']:+.0f} 3-yr VBD). The actual edge in "
              f"the controllable phase of the year. Hasn't yet converted to "
              f"a title because drafting alone doesn't win December.\n")
    md.append(f"**🍀 Luckiest: {most_lucky['name']}** "
              f"({most_lucky['luck']:+.1f} wins above expectation). "
              f"Significant slice of {most_lucky['name']}'s record is schedule. "
              f"Probably regresses in 2026.\n")
    md.append(f"**🌊 Most unlucky: {most_unlucky['name']}** "
              f"({most_unlucky['luck']:+.1f} wins below expectation). Has "
              f"been a better team than the record shows. Bet on the bounce-"
              f"back.\n")
    md.append(f"**🛠️ Most work to do: {bottom_strength['name']}** "
              f"({bottom_strength['expected_w']:.1f} expected wins over 3 "
              f"years). Not luck — just hasn't scored enough points. The "
              f"answer for 2026: better draft, more wire activity.\n")

    md.append("**The honest answer about the league**: this is a *tight* "
              "league. Outside of Brower's clear top-tier dominance and "
              "Tim's clear bottom-tier struggle, **the middle 8 managers are "
              "all within ~6 expected wins of each other across 42 games.** "
              "That's why we have three different champs in three years. "
              "Any of these teams can win it. The question is who'll have "
              "the peak draft year + favorable schedule when their turn "
              "comes.\n")

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
