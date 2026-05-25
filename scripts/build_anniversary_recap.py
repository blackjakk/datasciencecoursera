"""15-Year Anniversary Recap — chronological story of MONEYLEAGUE.

Walks 2011-2025 season by season: who was in, the champion (when known),
the team names of the era, biggest game / heartbreak, who left, who joined,
notable storylines.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.league_history import load_all_history  # noqa: E402
from fantasy_draft.team_identity import all_managers, manager_for_sleeper_roster  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
MD_OUT = ROOT / "data" / "MONEYLEAGUE_15_YEAR.md"
PDF_OUT = ROOT / "data" / "MONEYLEAGUE_15_YEAR.pdf"


def _mgr_short() -> dict[str, str]:
    return {m["id"]: m["canonical_name"].split(" (")[0]
            for m in all_managers()}


def _yahoo_team_names_by_year() -> dict[int, dict[str, str]]:
    """{year: {manager_id: team_name}}"""
    out: dict[int, dict[str, str]] = defaultdict(dict)
    for m in all_managers():
        for yr, nm in (m.get("yahoo_team_names") or {}).items():
            if yr == "_note" or not nm:
                continue
            out[int(yr)][m["id"]] = str(nm)
    return out


# League lore — memorable stories tied to specific seasons.
# Add to this dict as more comes back to you.
LEAGUE_LORE: dict[int, list[str]] = {
    2017: [
        "🎰 **The Strip Club Draft.** This was the year the draft was held "
        "at a strip club. Figgy used his final pick (R19.10) on **Bobby Turbo**.",
    ],
}


def _era_for_year(yr: int) -> str:
    if yr <= 2012:
        return "8-team era · standard scoring"
    if yr <= 2018:
        return "10-team era · standard scoring"
    if yr == 2019 or yr == 2020 or yr == 2021 or yr == 2022:
        return "12-team era · 0.5 PPR · 2QB"
    return "12-team era · 0.5 PPR · superflex (Sleeper)"


def _format_record(r: dict) -> str:
    w, l = r["wins"], r["losses"]
    return f"{w}-{l}"


def build_markdown() -> str:
    history = load_all_history()
    mgr_name = _mgr_short()
    yahoo_names = _yahoo_team_names_by_year()
    today = date.today().strftime("%B %Y")

    # Known champions (Sleeper era + we don't have Yahoo playoff data scraped)
    champs = {}
    for yr, sd in history.items():
        if sd.get("champion"):
            mgr = manager_for_sleeper_roster(sd["champion"])
            if mgr:
                champs[yr] = mgr["id"]

    md: list[str] = []
    md.append("# 🏆 MONEYLEAGUE — 15 Years")
    md.append(f"*{today} · 2011 through 2025 · the chronological story*\n")
    md.append("---\n")

    md.append("## How we got here\n")
    md.append("This league started in **2011 with 8 teams** on Yahoo, expanded "
              "to 10 in 2013, expanded again to 12 in 2019, and migrated to "
              "Sleeper in 2023. The original 8-team roster has been mostly "
              "weeded out — only a handful of the founders are still here.\n")

    # Founder cohort
    founders = sorted(history[2011]["rosters"].keys())
    still_here = [m for m in founders if m in {x["id"] for x in all_managers()
                                                 if x.get("sleeper_roster_id")}]
    founders_named = [mgr_name.get(m, m) for m in still_here]
    md.append(f"**Founders still here (since 2011):** {', '.join(founders_named)}\n")
    md.append("---\n")

    # Year-by-year
    for yr in sorted(history.keys()):
        sd = history[yr]
        rosters = sd["rosters"]
        n_teams = len(rosters)

        md.append(f"## {yr} — {_era_for_year(yr)}\n")

        # Champion line (Sleeper era only)
        if yr in champs:
            md.append(f"**🏆 Champion: {mgr_name[champs[yr]]}**\n")

        # Per-manager record
        rows = sorted(rosters.items(), key=lambda kv: -kv[1]["wins"])
        md.append("| Place | Manager | Team Name | Record | PF | PA | Best Wk |")
        md.append("|---|---|---|---|---|---|---|")
        for i, (mid, r) in enumerate(rows, 1):
            name = mgr_name.get(mid, mid)
            team = yahoo_names.get(yr, {}).get(mid, "—")
            rec = _format_record(r)
            pf = r["pf"]; pa = r["pa"]
            high = r["high_score"]
            best = f"{high[1]:.1f} (W{high[0]})" if high[1] else "—"
            md.append(f"| {i} | **{name}** | {team} | {rec} | {pf:.0f} | "
                      f"{pa:.0f} | {best} |")
        md.append("")

        # Storyline snippets
        notes = []
        # Highest single-week score this year
        high_overall = max(
            ((mid, r["high_score"][1], r["high_score"][0])
             for mid, r in rosters.items() if r["high_score"][1]),
            key=lambda t: t[1], default=None)
        if high_overall:
            notes.append(f"🚀 Top single-week: **{mgr_name.get(high_overall[0])} "
                          f"{high_overall[1]:.1f}** in W{high_overall[2]}")
        # Lowest
        lows = [(mid, r["low_score"][1], r["low_score"][0])
                for mid, r in rosters.items() if 0 < r["low_score"][1] < 990]
        if lows:
            low = min(lows, key=lambda t: t[1])
            notes.append(f"💩 Low: **{mgr_name.get(low[0])} {low[1]:.1f}** in W{low[2]}")
        # Biggest gap between PF and W (unluckiest)
        if rosters:
            ap_rows = []
            for mid, r in rosters.items():
                total_ap = r["apw"] + r["apl"]
                if total_ap == 0:
                    continue
                exp_w = 13 * r["apw"] / total_ap
                ap_rows.append((mid, r["wins"], exp_w, r["wins"] - exp_w))
            if ap_rows:
                unlucky = min(ap_rows, key=lambda r: r[3])
                lucky = max(ap_rows, key=lambda r: r[3])
                if unlucky[3] < -1.5:
                    notes.append(f"🌊 Schedule-cursed: **{mgr_name.get(unlucky[0])}** "
                                 f"({unlucky[1]} actual W, {unlucky[2]:.1f} expected)")
                if lucky[3] > 1.5:
                    notes.append(f"🍀 Schedule-blessed: **{mgr_name.get(lucky[0])}** "
                                 f"({lucky[1]} actual W, {lucky[2]:.1f} expected)")

        # Roster changes from prior year
        if yr - 1 in history:
            prev = set(history[yr - 1]["rosters"].keys())
            curr = set(rosters.keys())
            joined = curr - prev
            left = prev - curr
            if joined or left:
                if joined:
                    notes.append(f"➕ **Joined**: {', '.join(mgr_name.get(m, m) for m in sorted(joined))}")
                if left:
                    notes.append(f"➖ **Left**: {', '.join(mgr_name.get(m, m) for m in sorted(left))}")

        for n in notes:
            md.append(f"- {n}")
        # Add any lore notes
        for lore in LEAGUE_LORE.get(yr, []):
            md.append(f"- {lore}")
        md.append("\n---\n")

    # Era roundup tables
    md.append("## 🏛️ The Eras of MONEYLEAGUE\n")
    md.append("Three distinct league eras, three different dynasties:\n")
    md.append("| Era | Years | Teams | Scoring | Format |")
    md.append("|---|---|---|---|---|")
    md.append("| **8-Team Founding** | 2011-2012 | 8 | Standard | 1QB |")
    md.append("| **10-Team Standard** | 2013-2018 | 10 | Standard | 1QB |")
    md.append("| **12-Team Half-PPR** | 2019-2022 | 12 | 0.5 PPR | 2QB |")
    md.append("| **12-Team Superflex (Sleeper)** | 2023-present | 12 | 0.5 PPR | SF |")
    md.append("")

    # All-time rankings (active managers)
    md.append("## 🏆 All-Time Win Leaders (regular season, 2011-2025)\n")
    all_time: dict[str, dict] = defaultdict(
        lambda: {"years": set(), "wins": 0, "losses": 0, "pf": 0.0, "pa": 0.0})
    for yr, sd in history.items():
        for mid, r in sd["rosters"].items():
            d = all_time[mid]
            d["years"].add(yr)
            d["wins"] += r["wins"]
            d["losses"] += r["losses"]
            d["pf"] += r["pf"]
            d["pa"] += r["pa"]
    current = {m["id"] for m in all_managers() if m.get("sleeper_roster_id")}
    by_wins = sorted(all_time.items(), key=lambda kv: -kv[1]["wins"])
    md.append("| Rank | Manager | Years | W | L | PF | PA |")
    md.append("|---|---|---|---|---|---|---|")
    rank = 0
    for mid, d in by_wins:
        if mid not in current:
            continue
        rank += 1
        n_yr = len(d["years"])
        md.append(f"| {rank} | **{mgr_name.get(mid, mid)}** | {n_yr} | "
                  f"{d['wins']} | {d['losses']} | {d['pf']:.0f} | "
                  f"{d['pa']:.0f} |")
    md.append("")

    md.append("## 🎖️ All-Time Champions\n")
    if champs:
        md.append("| Year | Champion |")
        md.append("|---|---|")
        for yr in sorted(champs):
            md.append(f"| {yr} | **{mgr_name[champs[yr]]}** |")
    else:
        md.append("*(Yahoo-era champions not scraped — playoff brackets use a "
                  "different URL pattern. To add: scrape the Yahoo playoff "
                  "bracket for each season.)*")
    md.append("")

    # Random fun stat: longest tenured former managers
    md.append("## 👋 Members Who've Come and Gone\n")
    historical = [(mid, d) for mid, d in all_time.items() if mid not in current]
    historical.sort(key=lambda kv: -len(kv[1]["years"]))
    md.append("| Manager | Years Active | Record |")
    md.append("|---|---|---|")
    for mid, d in historical:
        yrs = sorted(d["years"])
        if not yrs:
            continue
        year_range = f"{yrs[0]}-{yrs[-1]}" if len(yrs) > 1 else str(yrs[0])
        nm = mgr_name.get(mid, mid)
        md.append(f"| {nm} | {year_range} | {d['wins']}-{d['losses']} |")
    md.append("")

    md.append("---\n")
    md.append("*Generated from Yahoo Fantasy public/private league pages "
              "(2011-2022, scraped via authenticated session) and Sleeper "
              "offline data (2023-2025). 850+ matchups, 100% regular-season "
              "coverage across all 15 seasons.*")
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
        elif ln.startswith("- "):
            cp(); ct(); html.append(f"<p class='b'>• {inline(ln[2:])}</p>")
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
    body { font-family: Georgia, serif; max-width: 720px;
           margin: 32px auto; padding: 0 32px; color: #1a1a1a;
           line-height: 1.6; font-size: 11pt; }
    h1 { font-size: 28pt; font-family: -apple-system, sans-serif;
         border-bottom: 4px solid #b8860b; padding-bottom: 10px;
         margin-top: 0; text-align: center; }
    h2 { font-size: 15pt; color: #1a1a1a; font-family: -apple-system, sans-serif;
         margin-top: 24px; margin-bottom: 6px;
         background: linear-gradient(90deg, #fff8e6 0%, #ffffff 100%);
         padding: 6px 12px; border-left: 5px solid #b8860b; }
    p { margin: 4px 0; }
    p.b { margin: 2px 0 2px 14px; font-size: 10pt; }
    table { width: 100%; border-collapse: collapse; margin: 6px 0 10px 0;
            font-size: 9pt; }
    th { background: #2c5d7c; color: white; padding: 4px 7px; text-align: left; }
    td { padding: 3px 7px; border-bottom: 1px solid #ddd; }
    tr:nth-child(even) td { background: #f8f8f8; }
    em { color: #666; }
    hr { border: none; border-top: 2px dashed #ccc; margin: 14px 0; }
    @page { size: letter; margin: 0.55in; }
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
