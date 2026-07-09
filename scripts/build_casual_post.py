"""Casual league post — short, plain-English version of the strategy report.

The technical version lives in scripts/build_strategy_report.py. This one
strips out the math/tables and writes it like a group chat post.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.results import (  # noqa: E402
    load_draft_picks_with_points,
    load_player_ownership_windows,
    load_weekly_player_points,
)
from fantasy_draft.team_identity import manager_for_sleeper_roster  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
MD_OUT = ROOT / "data" / "MONEYLEAGUE_CASUAL.md"
PDF_OUT = ROOT / "data" / "MONEYLEAGUE_CASUAL.pdf"


def _mgr(rid: int) -> str:
    m = manager_for_sleeper_roster(rid)
    return m["canonical_name"].split(" (")[0] if m else f"rid{rid}"


def _top_wire_hits(n: int = 6) -> list[dict]:
    ownership = load_player_ownership_windows(ROOT / "data" / "sleeper")
    weekly = load_weekly_player_points(ROOT / "data" / "sleeper")
    players = json.loads((ROOT / "data" / "sleeper" / "players_nfl.json").read_text())
    hits = []
    for season in (2023, 2024, 2025):
        if season not in weekly:
            continue
        for (s, pid), windows in ownership.items():
            if s != season:
                continue
            for start_wk, end_wk, rid, _src in windows:
                if start_wk <= 1 or _src != "add":
                    continue
                pts = sum(weekly[season].get(wk, {}).get(pid, 0.0)
                          for wk in range(start_wk, min(end_wk + 1, 18)))
                if pts < 100:
                    continue
                pinfo = players.get(pid, {})
                hits.append({
                    "season": season, "week": start_wk, "rid": rid,
                    "name": f"{pinfo.get('first_name', '?')} {pinfo.get('last_name', '?')}",
                    "pos": pinfo.get("position", "?"),
                    "pts": pts,
                })
    hits.sort(key=lambda h: -h["pts"])
    return hits[:n]


def build_markdown() -> str:
    today = date.today().strftime("%B %Y")
    top_hits = _top_wire_hits(5)

    md: list[str] = []
    md.append("# What I Learned From 10 Years of MONEYLEAGUE Data")
    md.append(f"*{today}*\n")
    md.append("I went down a rabbit hole and pulled all 10 years of our drafts "
              "out of the league spreadsheet (the cell colors tell you who "
              "actually owned each pick — even the Yahoo pick trades). Then "
              "I matched everything up against real NFL stats and looked at "
              "what wins. Here's the TL;DR for everyone before next year.\n")
    md.append("---\n")

    md.append("## The biggest thing: peak-year draft > career-best draft\n")
    md.append("Every single champion in the Sleeper era — Eric (2023), Coop "
              "(2024), Trevor (2025) — was a **top-2 drafter that specific "
              "year**, even when their 3-year average wasn't elite. Meanwhile, "
              "the guy with the best 3-year *average* hasn't won.\n")
    md.append("Translation: it doesn't matter if you're a \"good drafter\" "
              "in the abstract. What matters is **nailing the one year you "
              "want to win.** Don't get cute, don't overthink your keepers, "
              "draft BPA, balance positions. That's it.\n")

    md.append("## The wire is way more important than most of us treat it\n")
    md.append("Look at the league-winners that came off the wire in the last "
              "3 years:\n")
    for h in top_hits:
        md.append(f"- **{h['name']}** ({h['pos']}) — picked up "
                  f"W{h['week']} of {h['season']}, "
                  f"+{h['pts']:.0f} pts after the add")
    md.append("\nThese aren't random. They follow a pattern. Every year, "
              "around Week 2-3 a workhorse RB gets hurt and his handcuff "
              "becomes a league-winner. Around Week 7-10 a starting QB gets "
              "benched or hurt and a backup takes over. Around Week 10 the "
              "trade deadline causes a wave of drops as people clear playoff "
              "roster space.\n")
    md.append("If you're checking the wire once a week and only on Tuesday "
              "morning, you're missing 80% of these.\n")

    md.append("## Stop overweighting WR and TE adds\n")
    md.append("Across the last 3 years, the average WR or TE wire pickup "
              "produced about **20 pts** — basically a wasted roster spot. "
              "The average QB pickup produced **48**. The average RB "
              "pickup produced **28**.\n")
    md.append("Most of us (me included) add too many \"that WR3 had a good "
              "Sunday\" guys. They almost never repeat. If you're picking up "
              "a WR, it should be a rookie with a target-share spike or "
              "someone moving up an injury depth chart — not a TD-vulture "
              "veteran.\n")

    md.append("## Don't trade unless you're robbing someone\n")
    md.append("Trade wins and losses across the league sum to zero by math. "
              "Most trades are coin flips. The successful trades in our "
              "league all had the same shape: **the buyer was getting clearly "
              "more VBD than they were giving up**, not just \"a different "
              "type of player.\"\n")
    md.append("Side note: **future picks are wildly underpriced** in our "
              "league. People keep accepting 1 current-year R5 for a future "
              "R2. The future R2 is worth more, every time. Stop doing this.\n")

    md.append("## If you had a bad season but lots of points, you got "
              "schedule-killed\n")
    md.append("Compare points-for to wins. If your PF was high but your "
              "record was bad, you got unlucky and you're due. If your PF "
              "was low but your record was good, you got lucky and you're "
              "going to regress. This is real — the unluckiest manager "
              "of 2023-25 was beating the league in scoring most weeks. "
              "Just got the wrong opponent each week.\n")
    md.append("Don't blow up your roster after a 1-3 start if the points "
              "are there. **Roster quality is a leading indicator, record "
              "is a lagging one.**\n")

    md.append("## Kickers are free money in the late rounds\n")
    md.append("Top kicker hits in our 3-year window:\n")
    md.append("- Brandon Aubrey (drafted R15) — +141 pts above replacement")
    md.append("- Chris Boswell (drafted R16) — +155 pts above replacement")
    md.append("- Evan McPherson (drafted R16) — +137 pts above replacement")
    md.append("- Ka'imi Fairbairn (R16) — +143 pts above replacement\n")
    md.append("Those are R2-level returns from R15 picks. Almost nobody "
              "does any kicker research. If you spent 10 minutes ranking "
              "kickers by FG% and dome stadiums in August, you'd find an "
              "extra ~100 VBD per year. Easy edge.\n")

    md.append("## TL;DR — six things to do differently\n")
    md.append("1. **Draft BPA.** Don't engineer your draft around your "
              "keepers. Best player available wins.")
    md.append("2. **Check the wire 3× a week, not 1×.** Sunday night and "
              "Monday after games is where the wire-winners get claimed.")
    md.append("3. **Stop adding marginal WRs and TEs.** Add QBs and RBs "
              "first, in that order.")
    md.append("4. **Trade rarely, trade only when clearly winning, and "
              "stop accepting current-year picks for future picks.**")
    md.append("5. **Trust regression.** Bad record + high points = next "
              "year is yours. Good record + low points = enjoy this year, "
              "next year hurts.")
    md.append("6. **Research kickers.** It's the dumbest, most reliable "
              "edge in the league.\n")

    md.append("---\n")
    md.append("*Full nerdy version (with tables and percentiles) available "
              "if anyone wants it. Numbers in here come from the league "
              "spreadsheet's draft history plus public NFL stats — happy to "
              "share the underlying data with anyone who wants to verify.*")
    return "\n".join(md)


def _md_to_html(md_text: str) -> str:
    import re
    lines = md_text.split("\n")
    html_lines: list[str] = []
    in_para = False

    def close_para():
        nonlocal in_para
        if in_para:
            html_lines.append("</p>")
            in_para = False

    def inline(text):
        text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
        text = re.sub(r"\*(.+?)\*", r"<em>\1</em>", text)
        return text

    for ln in lines:
        if ln.startswith("# "):
            close_para()
            html_lines.append(f"<h1>{inline(ln[2:])}</h1>")
        elif ln.startswith("## "):
            close_para()
            html_lines.append(f"<h2>{inline(ln[3:])}</h2>")
        elif ln.startswith("- "):
            close_para()
            html_lines.append(f"<p class='b'>• {inline(ln[2:])}</p>")
        elif ln.startswith(tuple(f"{i}." for i in range(1, 10))) and ". " in ln:
            close_para()
            html_lines.append(f"<p class='b'>{inline(ln)}</p>")
        elif ln.strip() == "---":
            close_para()
            html_lines.append("<hr/>")
        elif ln.strip() == "":
            close_para()
        else:
            if not in_para:
                html_lines.append("<p>")
                in_para = True
            html_lines.append(inline(ln))
    close_para()

    css = """
    body { font-family: Georgia, serif; max-width: 660px;
           margin: 40px auto; padding: 0 32px; color: #1a1a1a;
           line-height: 1.7; font-size: 12pt; }
    h1 { font-size: 22pt; font-family: -apple-system, sans-serif;
         border-bottom: 2px solid #1a1a1a; padding-bottom: 8px;
         margin-top: 0; }
    h2 { font-size: 14pt; color: #0a4d6b; font-family: -apple-system, sans-serif;
         margin-top: 28px; margin-bottom: 6px; }
    p { margin: 8px 0; }
    p.b { margin: 4px 0 4px 16px; }
    em { color: #555; }
    hr { border: none; border-top: 1px solid #ccc; margin: 22px 0; }
    @page { size: letter; margin: 0.7in; }
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
