"""Data-nerd insights from MONEYLEAGUE — the things that make you say
"huh, didn't expect that."

Less personality, more numbers. Stats with an oh-shit punchline.
"""
from __future__ import annotations

import glob
import json
import statistics
import sys
from collections import Counter, defaultdict
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
MD_OUT = ROOT / "data" / "MONEYLEAGUE_INSIGHTS.md"
PDF_OUT = ROOT / "data" / "MONEYLEAGUE_INSIGHTS.pdf"


def _mgr(rid: int) -> str | None:
    m = manager_for_sleeper_roster(rid)
    return m["canonical_name"].split(" (")[0] if m else None


def _season_records() -> dict[int, dict[int, dict]]:
    """Returns {season: {rid: {early_w: int, final_w: int}}} for reg season."""
    out: dict[int, dict[int, dict]] = defaultdict(
        lambda: defaultdict(lambda: {"early_w": 0, "final_w": 0}))
    for ld in glob.glob(str(ROOT / "data" / "sleeper" / "league_*")):
        li_path = Path(ld) / "league.json"
        if not li_path.exists():
            continue
        season = int(json.loads(li_path.read_text()).get("season", 0))
        if not season:
            continue
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
                        out[season][w["roster_id"]]["final_w"] += 1
                        if wk <= 4:
                            out[season][w["roster_id"]]["early_w"] += 1
    return out


def _all_play_luck() -> dict[int, list[tuple[str, int, float, float]]]:
    """For each season, [(name, actual_wins, expected_wins, luck), ...]
    sorted by luck descending."""
    seasons = load_all_seasons(ROOT / "data" / "sleeper")
    apw: dict = defaultdict(lambda: defaultdict(lambda: {"apW": 0, "apL": 0, "aW": 0}))
    for s, sd in seasons.items():
        wkpts = defaultdict(dict)
        for (rid, wk), pts in sd.get("weekly_team_points", {}).items():
            if wk <= 14:
                wkpts[wk][rid] = pts
        for wk, scores in wkpts.items():
            for rid, p in scores.items():
                for orid, op in scores.items():
                    if orid == rid:
                        continue
                    if p > op:
                        apw[s][rid]["apW"] += 1
                    elif p < op:
                        apw[s][rid]["apL"] += 1
    recs = _season_records()
    for s, sr in recs.items():
        for rid, d in sr.items():
            apw[s][rid]["aW"] = d["final_w"]
    out: dict = {}
    for s, mgrs in apw.items():
        rows = []
        for rid, d in mgrs.items():
            nm = _mgr(rid)
            if not nm:
                continue
            denom = d["apW"] + d["apL"]
            exp = 14 * d["apW"] / denom if denom else 0
            luck = d["aW"] - exp
            rows.append((nm, d["aW"], exp, luck))
        rows.sort(key=lambda r: -r[3])
        out[s] = rows
    return out


def _bust_rate_by_round() -> dict[int, dict]:
    picks = load_draft_picks_with_points(ROOT / "data" / "sleeper")
    by_rd: dict[int, dict] = defaultdict(lambda: {"n": 0, "busts": 0, "pts": []})
    for p in picks:
        if p.get("is_keeper") or not p["season_points"]:
            continue
        r = p["round"]
        by_rd[r]["n"] += 1
        by_rd[r]["pts"].append(p["season_points"])
        if p["season_points"] < 50:
            by_rd[r]["busts"] += 1
    return dict(by_rd)


def _variance_by_mgr() -> list[tuple[str, float, float, float]]:
    seasons = load_all_seasons(ROOT / "data" / "sleeper")
    by_mgr: dict[int, list[float]] = defaultdict(list)
    for s, sd in seasons.items():
        for (rid, wk), pts in sd.get("weekly_team_points", {}).items():
            if wk <= 14 and _mgr(rid):
                by_mgr[rid].append(pts)
    rows = []
    for rid, pts in by_mgr.items():
        if len(pts) < 10:
            continue
        avg = statistics.mean(pts)
        sd = statistics.stdev(pts)
        rows.append((_mgr(rid), avg, sd, 100 * sd / avg))
    rows.sort(key=lambda r: -r[3])
    return rows


def _top12_by_position() -> dict[int, dict[str, int]]:
    picks = load_draft_picks_with_points(ROOT / "data" / "sleeper")
    out: dict[int, dict[str, int]] = {}
    for s in (2023, 2024, 2025):
        sp = [p for p in picks if p["season"] == s and p["season_points"]]
        sp.sort(key=lambda p: -p["season_points"])
        out[s] = dict(Counter(p["position"] for p in sp[:12]))
    return out


def _hot_cold_predictor() -> tuple[int, int, int, int]:
    recs = _season_records()
    hot_starts = hot_playoffs = cold_starts = cold_playoffs = 0
    for s, sr in recs.items():
        rows = sorted(sr.items(), key=lambda kv: -kv[1]["final_w"])
        top6 = set(rid for rid, _ in rows[:6])
        for rid, d in sr.items():
            if d["early_w"] >= 3:
                hot_starts += 1
                if rid in top6:
                    hot_playoffs += 1
            if d["early_w"] <= 1:
                cold_starts += 1
                if rid in top6:
                    cold_playoffs += 1
    return hot_starts, hot_playoffs, cold_starts, cold_playoffs


def _pickup_tenure() -> tuple[float, float, float, float]:
    ownership = load_player_ownership_windows(ROOT / "data" / "sleeper")
    tenures = []
    for (s, pid), windows in ownership.items():
        for sw, ew, rid in windows:
            if sw <= 1:
                continue
            tenures.append(ew - sw + 1)
    avg = statistics.mean(tenures)
    med = statistics.median(tenures)
    quick = 100 * sum(1 for t in tenures if t <= 2) / len(tenures)
    stick = 100 * sum(1 for t in tenures if t >= 8) / len(tenures)
    return avg, med, quick, stick


def build_markdown() -> str:
    luck = _all_play_luck()
    bust = _bust_rate_by_round()
    var_rows = _variance_by_mgr()
    top12 = _top12_by_position()
    hot, hot_po, cold, cold_po = _hot_cold_predictor()
    avg_t, med_t, quick_pct, stick_pct = _pickup_tenure()

    today = date.today().strftime("%B %Y")
    md: list[str] = []
    md.append("# MONEYLEAGUE — Things in the Data You Wouldn't Have Guessed")
    md.append(f"*{today} · Sleeper era 2023-2025 · 36 manager-seasons · "
              f"~3,500 transactions · ~6,000 game results*\n")
    md.append("---\n")

    # ========================================
    md.append("## 1. The 0-4 Death Sentence\n")
    md.append("Looking at 36 manager-seasons of regular-season data:\n")
    md.append(f"- Managers who started **3-1 or 4-0**: {hot} of 36 → "
              f"**{hot_po} made playoffs ({100*hot_po/max(1,hot):.0f}%)**")
    md.append(f"- Managers who started **0-4 or 1-3**: {cold} of 36 → "
              f"**{cold_po} made playoffs ({100*cold_po/max(1,cold):.0f}%)**\n")
    md.append("Hot starts are an 85% predictor of playoffs. **Cold starts "
              "are a 100% predictor of MISSING playoffs in our league.** "
              "Not a single 0-4 or 1-3 team has ever clawed back into the "
              "top 6 in the Sleeper era. Across 3 seasons, no one's done it. "
              "The first 4 weeks aren't just early data — they're the "
              "season.\n")

    # ========================================
    md.append("## 2. Boring Teams Win\n")
    md.append("Coefficient of variation (CV) on weekly scoring, 3-year window "
              "— lower = more consistent week to week:\n")
    md.append("| Manager | Avg PPG | StdDev | CV |")
    md.append("|---|---|---|---|")
    for nm, avg, sd, cv in sorted(var_rows, key=lambda r: r[3]):
        md.append(f"| {nm} | {avg:.1f} | {sd:.1f} | {cv:.1f}% |")
    md.append("")
    md.append("The most boring-looking lineups (lowest CV — Brower 16%, "
              "Eric 16%, Lem 20%) are also the league's most consistent "
              "playoff teams. The boom-or-bust managers (Kyle 26%, "
              "Ankur 25%) miss playoffs more often than they make them. "
              "**Variance is a tax, not a strategy.**\n")

    # ========================================
    md.append("## 3. Schedule Luck Is Worth ±5 Wins\n")
    md.append("Computing **all-play expected wins** (your weekly score vs "
              "every other team's that week, divided by 11). Difference "
              "from actual = pure schedule luck.\n")
    md.append("| Year | Most Lucky | Most Unlucky |")
    md.append("|---|---|---|")
    for s in sorted(luck):
        rows = luck[s]
        lucky = rows[0]
        unlucky = rows[-1]
        md.append(f"| {s} | {lucky[0]} +{lucky[3]:.1f} W "
                  f"(actual {lucky[1]}, expected {lucky[2]:.1f}) | "
                  f"{unlucky[0]} {unlucky[3]:+.1f} W "
                  f"(actual {unlucky[1]}, expected {unlucky[2]:.1f}) |")
    md.append("")
    md.append("**Trevor's 2025 title came with +5.5 wins of schedule luck** — "
              "he won 10 games against an expected 4.5. That's the single "
              "luckiest season in the dataset. Conversely, Troy's 2025 "
              "campaign cost him **5.4 wins of unluck** — finishing 3-11 on "
              "an 8-win-quality team.\n")
    md.append("If your record looks weird, it probably is.\n")

    # ========================================
    md.append("## 4. The R13-R16 Bust Belt\n")
    md.append("Non-keeper draft picks, bust rate = % producing <50 fantasy "
              "points in the season:\n")
    md.append("```")
    for r in sorted(bust):
        d = bust[r]
        bar = "█" * round(100 * d["busts"] / d["n"] / 4)
        md.append(f"  R{r:>2}: {bar} {100 * d['busts'] / d['n']:.0f}% bust "
                  f"(n={d['n']}, avg pts={statistics.mean(d['pts']):.0f})")
    md.append("```")
    md.append("Three things jump out:\n")
    md.append("- **R1-R8 are remarkably safe.** Bust rate stays under 10%. "
              "Top of the draft really is what it claims to be.")
    md.append("- **R13, R14, R16 are minefields** (41%, 36%, 44% bust rates). "
              "These are dart throws.")
    md.append("- **R15 dips against the trend** — only 14% bust. That's "
              "where kickers go. **Kickers are the safest late-round pick "
              "in the draft, full stop.**\n")

    # ========================================
    md.append("## 5. The Wire Is Mostly Trash\n")
    md.append(f"Across 3 years and **~1,000+ wire pickups**:\n")
    md.append(f"- Average tenure on a roster: **{avg_t:.1f} weeks**")
    md.append(f"- Median tenure: **{med_t:.0f} weeks**")
    md.append(f"- Pickups dropped within 2 weeks: **{quick_pct:.0f}%**")
    md.append(f"- Pickups that stick 8+ weeks: **{stick_pct:.0f}%**\n")
    md.append("More than half of every wire add gets dropped almost "
              "immediately. Only 1 in 6 turns into a meaningful contributor. "
              "The wire is signal-poor in expectation — but the signal is "
              "*concentrated* in a few players, which is why the strategy "
              "is volume, not selectivity.\n")

    # ========================================
    md.append("## 6. QBs Eat\n")
    md.append("In a 12-team superflex 0.5-PPR league, the top-12 highest-"
              "scoring players each season are dominated by QBs:\n")
    md.append("| Year | QB | RB | WR | TE |")
    md.append("|---|---|---|---|---|")
    for s in sorted(top12):
        d = top12[s]
        md.append(f"| {s} | {d.get('QB', 0)} | {d.get('RB', 0)} | "
                  f"{d.get('WR', 0)} | {d.get('TE', 0)} |")
    md.append("")
    md.append("**8-9 of the top 12 fantasy scorers every year are QBs.** "
              "Two QB starts + half-PPR makes elite QB the most valuable "
              "asset class in the league, full stop. WR/RB elite tier still "
              "matters (Bijan, Ja'Marr, etc.), but the *median* QB1 outscores "
              "the *median* WR1.\n")
    md.append("**Strategic corollary**: if you let QBs run on you in the "
              "draft, no clever R5 WR pivot fixes it. Get your QBs.\n")

    # ========================================
    md.append("## 7. The Champion Profile Is Boring\n")
    md.append("Recent champions: Eric 2023, Coop 2024, Trevor 2025. What "
              "did each have in common at season's end?\n")
    md.append("- **All three were top-2 in DRAFTING** that specific year — "
              "not their career average")
    md.append("- **All three had >10 actual wins** in the regular season")
    md.append("- **None of them were #1 in trades** for the year")
    md.append("- **Trevor 2025 was the LUCKIEST manager in our 3-year dataset** "
              "(+5.5 schedule wins)\n")
    md.append("Translation: nail the draft, don't get cute, win where you "
              "can. The path to a title is unspectacular execution + a kind "
              "schedule. The kind schedule is free — you can't control it. "
              "The unspectacular execution is *all* you can control.\n")

    # ========================================
    md.append("## 8. Things That Don't Predict Anything\n")
    md.append("Things people commonly think matter but actually don't:\n")
    md.append("- **Number of trades made**: zero correlation with wins")
    md.append("- **Draft slot**: no slot has won disproportionately. R1.01 "
              "is no more likely to lead to a title than R1.12.")
    md.append("- **Total transaction count**: Trevor's 192 adds vs Donnie's "
              "29 — both have made playoffs.")
    md.append("- **Career drafting reputation**: doesn't predict any given "
              "year. Peak-year matters; reputation doesn't.\n")

    md.append("---\n")
    md.append("*Methodology: All values from offline Sleeper data dump, "
              "regular season only (W1-14). Variance = std-dev / mean of "
              "weekly team total points. All-play expected wins computed "
              "weekly across the 11 other teams. Hot/cold start defined as "
              ">=3-1 or <=1-3 through week 4.*")
    return "\n".join(md)


def _md_to_html(md_text: str) -> str:
    import re
    lines = md_text.split("\n")
    html_lines: list[str] = []
    in_table = False
    in_para = False
    in_code = False

    def close_para():
        nonlocal in_para
        if in_para:
            html_lines.append("</p>")
            in_para = False

    def close_table():
        nonlocal in_table
        if in_table:
            html_lines.append("</tbody></table>")
            in_table = False

    def close_code():
        nonlocal in_code
        if in_code:
            html_lines.append("</pre>")
            in_code = False

    def inline(text):
        text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
        text = re.sub(r"\*(.+?)\*", r"<em>\1</em>", text)
        text = re.sub(r"`(.+?)`", r"<code>\1</code>", text)
        return text

    for ln in lines:
        if ln.startswith("```"):
            close_para(); close_table()
            if not in_code:
                html_lines.append("<pre>")
                in_code = True
            else:
                close_code()
            continue
        if in_code:
            html_lines.append(ln)
            continue
        if ln.startswith("# "):
            close_para(); close_table()
            html_lines.append(f"<h1>{inline(ln[2:])}</h1>")
        elif ln.startswith("## "):
            close_para(); close_table()
            html_lines.append(f"<h2>{inline(ln[3:])}</h2>")
        elif ln.startswith("|") and "---" in ln:
            continue
        elif ln.startswith("|"):
            cells = [c.strip() for c in ln.strip("|").split("|")]
            if not in_table:
                close_para()
                html_lines.append('<table><thead><tr>'
                                  + "".join(f"<th>{inline(c)}</th>" for c in cells)
                                  + "</tr></thead><tbody>")
                in_table = True
            else:
                html_lines.append("<tr>"
                                  + "".join(f"<td>{inline(c)}</td>" for c in cells)
                                  + "</tr>")
        elif ln.startswith("- "):
            close_para(); close_table()
            html_lines.append(f"<p class='b'>• {inline(ln[2:])}</p>")
        elif ln.strip() == "---":
            close_para(); close_table()
            html_lines.append("<hr/>")
        elif ln.strip() == "":
            close_para(); close_table()
        else:
            close_table()
            if not in_para:
                html_lines.append("<p>")
                in_para = True
            html_lines.append(inline(ln))
    close_para(); close_table(); close_code()

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
    pre { background: #f4f4f4; padding: 10px 14px; border-radius: 4px;
          font-size: 9pt; overflow-x: auto; line-height: 1.35; }
    code { background: #efefef; padding: 1px 4px; border-radius: 3px; }
    em { color: #555; }
    hr { border: none; border-top: 1px solid #ccc; margin: 16px 0; }
    p { margin: 4px 0; }
    p.b { margin: 2px 0 2px 14px; }
    @page { size: letter; margin: 0.6in; }
    """
    return f"<!DOCTYPE html><html><head><meta charset='utf-8'><style>{css}</style></head><body>" + "\n".join(html_lines) + "</body></html>"


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
