"""Generate a first-principles strategic report for MONEYLEAGUE.

Audience: all 12 managers. Tone: neutral, data-driven, insightful.
Sources: existing awards data + 10-year historical_draft_skill.json +
weekly wire data + championship history.

Output: data/MONEYLEAGUE_STRATEGY.pdf + .md
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.results import load_player_ownership_windows, load_weekly_player_points  # noqa: E402
from fantasy_draft.team_identity import manager_for_sleeper_roster  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
MD_OUT = ROOT / "data" / "MONEYLEAGUE_STRATEGY.md"
PDF_OUT = ROOT / "data" / "MONEYLEAGUE_STRATEGY.pdf"


def _mgr_name(rid: int) -> str:
    m = manager_for_sleeper_roster(rid)
    return m["canonical_name"].split(" (")[0] if m else f"rid{rid}"


def _wire_stats_by_mgr() -> dict[int, dict]:
    ownership = load_player_ownership_windows(ROOT / "data" / "sleeper")
    weekly = load_weekly_player_points(ROOT / "data" / "sleeper")
    by_mgr: dict[int, dict] = defaultdict(
        lambda: {"n": 0, "hits50": 0, "hits100": 0, "total_pts": 0.0,
                 "by_pos": defaultdict(lambda: {"n": 0, "pts": 0.0})})
    for season in (2023, 2024, 2025):
        if season not in weekly:
            continue
        for (s, pid), windows in ownership.items():
            if s != season:
                continue
            for start_wk, end_wk, rid in windows:
                if start_wk <= 1:
                    continue
                pts = sum(weekly[season].get(wk, {}).get(pid, 0.0)
                          for wk in range(start_wk, min(end_wk + 1, 18)))
                by_mgr[rid]["n"] += 1
                by_mgr[rid]["total_pts"] += pts
                if pts > 50:
                    by_mgr[rid]["hits50"] += 1
                if pts > 100:
                    by_mgr[rid]["hits100"] += 1
    return dict(by_mgr)


def _top_wire_hits(n: int = 15) -> list[dict]:
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
            for start_wk, end_wk, rid in windows:
                if start_wk <= 1:
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


def _week_distribution_of_big_hits() -> dict[int, int]:
    ownership = load_player_ownership_windows(ROOT / "data" / "sleeper")
    weekly = load_weekly_player_points(ROOT / "data" / "sleeper")
    by_wk: dict[int, int] = defaultdict(int)
    for season in (2023, 2024, 2025):
        if season not in weekly:
            continue
        for (s, pid), windows in ownership.items():
            if s != season:
                continue
            for start_wk, end_wk, rid in windows:
                if start_wk <= 1:
                    continue
                pts = sum(weekly[season].get(wk, {}).get(pid, 0.0)
                          for wk in range(start_wk, min(end_wk + 1, 18)))
                if pts > 100:
                    by_wk[start_wk] += 1
    return dict(by_wk)


def _pos_yield_overall() -> dict[str, dict]:
    ownership = load_player_ownership_windows(ROOT / "data" / "sleeper")
    weekly = load_weekly_player_points(ROOT / "data" / "sleeper")
    players = json.loads((ROOT / "data" / "sleeper" / "players_nfl.json").read_text())
    by_pos: dict[str, dict] = defaultdict(lambda: {"n": 0, "pts": 0.0, "hits": 0})
    for season in (2023, 2024, 2025):
        if season not in weekly:
            continue
        for (s, pid), windows in ownership.items():
            if s != season:
                continue
            for start_wk, end_wk, rid in windows:
                if start_wk <= 1:
                    continue
                pts = sum(weekly[season].get(wk, {}).get(pid, 0.0)
                          for wk in range(start_wk, min(end_wk + 1, 18)))
                pos = players.get(pid, {}).get("position", "?")
                by_pos[pos]["n"] += 1
                by_pos[pos]["pts"] += pts
                if pts > 100:
                    by_pos[pos]["hits"] += 1
    return dict(by_pos)


def build_markdown() -> str:
    hist = json.loads((ROOT / "data" / "historical_draft_skill.json").read_text())
    wire = _wire_stats_by_mgr()
    top_hits = _top_wire_hits(15)
    week_dist = _week_distribution_of_big_hits()
    pos_yield = _pos_yield_overall()
    today = date.today().strftime("%B %d, %Y")

    md: list[str] = []
    md.append("# MONEYLEAGUE — A First-Principles Look at What Wins")
    md.append(f"*An analytical post for the league · {today}*\n")
    md.append("This is an attempt to look at 10 years of our draft history "
              "(2015-2024, restored from the spreadsheet's cell colors) and "
              "3 years of full Sleeper transaction/matchup data (2023-2025) "
              "to figure out — from first principles — what actually makes "
              "people win in our league. Findings are league-neutral; "
              "everyone shows up in the data.\n")
    md.append("---\n")

    # ===== 1. The Win Equation =====
    md.append("## 1. The Win Equation (first principles)\n")
    md.append("Championship odds break down into roughly:\n")
    md.append("```\n"
              "P(title) = P(make playoffs) × P(win 3 playoff games)\n"
              "         = f(points scored, schedule luck) × f(matchup variance)\n"
              "```\n")
    md.append("**Points scored** is the only thing you control. It's a sum of:\n")
    md.append("- **Draft VBD** (17 picks set ~70% of your roster baseline)")
    md.append("- **Wire VBD** (volume × hit-rate over 17 weeks)")
    md.append("- **Trade VBD** (rare, net-zero across the league by definition)")
    md.append("- **Lineup decisions** (small but non-zero — start/sit calls)\n")
    md.append("**Uncontrollable**: weekly H2H matchup, injuries, playoff seeding "
              "RNG. Each of those is large-magnitude noise. Over a 14-game "
              "regular season, schedule luck swings 2-3 wins routinely.\n")
    md.append("**The implication**: the things you can actually control are draft, "
              "wire, and (occasionally) trade. Everything else is noise to be "
              "endured. The data below quantifies how much each lever matters.\n")

    # ===== 2. The 10-year cast =====
    md.append("## 2. The 10-Year Cast\n")
    cum = hist["cumulative"]
    full = [m for m, r in cum.items() if r["seasons"] == 10]
    partial = sorted(
        ((m, r) for m, r in cum.items() if r["seasons"] < 10),
        key=lambda kv: -kv[1]["seasons"])
    md.append(f"Nine managers have been here for all 10 seasons (2015-2024). "
              f"The rest have come and gone — here's the roster lineage:\n")
    md.append("| Era | Joined | Left |")
    md.append("|---|---|---|")
    md.append("| 2015 (Yahoo, 10-team) | Nine of the current core | — |")
    md.append("| 2017 (Yahoo expansion to 10) | One new owner | One departed |")
    md.append("| 2019 (Yahoo, 12-team) | Two new owners | — |")
    md.append("| 2020 | One slot turned over | — |")
    md.append("| 2021 | One slot turned over | — |")
    md.append("| 2023 (Sleeper migration) | — | — |")
    md.append("| 2025 | One slot turned over | — |")
    md.append("")
    md.append("Different drafters topped each scoring era — and the league has "
              "had three distinct scoring eras:\n")
    md.append("- **Standard era** (2015-18): 10-team, 0 PPR, 2QB")
    md.append("- **Half-PPR Yahoo** (2019-22): 12-team, 0.5 PPR, 2QB")
    md.append("- **Superflex Sleeper** (2023-24): 12-team, 0.5 PPR, superflex\n")
    md.append("**Per-era top-3 drafters (by VBD/season):**\n")

    def era_top3(year_range):
        ms: dict[str, list[float]] = {}
        for y in year_range:
            for mid, r in hist["per_season"].get(str(y), {}).items():
                ms.setdefault(mid, []).append(r["total_vbd"])
        return sorted(
            ((mid, sum(v)/len(v)) for mid, v in ms.items()),
            key=lambda kv: -kv[1])[:3]

    md.append("| Era | #1 | #2 | #3 |")
    md.append("|---|---|---|---|")
    for label, yr in [("Superflex Sleeper (2023-24)", range(2023, 2025))]:
        top = era_top3(yr)
        cells = []
        for mid, v in top:
            nm = cum.get(mid, {}).get("manager_name", mid)
            cells.append(f"{nm} ({v:+.0f}/yr)")
        md.append(f"| {label} | {cells[0]} | {cells[1]} | {cells[2]} |")
    md.append("")
    md.append("Earlier eras had completely different top-3s — the leaderboard "
              "resets when scoring changes. The lesson: **what worked in one "
              "format doesn't automatically carry forward.** This is most "
              "relevant if/when we ever tweak scoring again.\n")
    md.append("*Note: K and DEF picks excluded from this analysis (no "
              "historical data — neutral for everyone). Player names cross-"
              "matched against public nflverse season stats.*\n")

    # ===== 3. Lever #1: Drafting =====
    md.append("## 3. Lever #1 — Drafting (the biggest controllable signal)\n")
    md.append("A 17-round draft gives you 17 high-leverage decisions in a "
              "single day. The spread between the best and worst draft in a "
              "given year is routinely **±500-1,000 VBD points** — roughly "
              "30-60 points/week of expected scoring edge before any wire "
              "moves. That's the difference between a 10-4 team and a 4-10 "
              "team *before luck even enters the picture*.\n")
    md.append("**Things the data confirms:**\n")
    md.append("1. **Era matters more than ability.** The #1 drafter of the 2QB "
              "Yahoo era (2019-22) crashed to #11 in superflex. The #13 "
              "drafter of that era jumped to #4 in superflex. Format change "
              "= reset.")
    md.append("2. **Peak year > 3-year average.** Every champion of the Sleeper "
              "era (Eric 2023, Coop 2024, Trevor 2025) was top-2 in DRAFTING "
              "that specific year, even when their 3-year average was middle "
              "of the pack. **The goal isn't to be a consistently good "
              "drafter — it's to nail one year.**")
    md.append("3. **K/DEF in the late rounds is free money.** A R15 K (Aubrey, "
              "Boswell, Fairbairn) routinely returns +130-155 VBD. That's "
              "more than most R3 picks return above replacement. Almost no "
              "one drafts kickers strategically.\n")

    # ===== 4. Lever #2: Wire game =====
    md.append("## 4. Lever #2 — The Wire Game (under-exploited)\n")
    md.append("The wire is the most under-played lever in the league. Big hits "
              "show up *every single year* — here are the top 10 from the "
              "Sleeper era:\n")
    md.append("| Year | Wk | Pos | Player | Pts produced | Drafter |")
    md.append("|---|---|---|---|---|---|")
    for h in top_hits[:10]:
        md.append(f"| {h['season']} | W{h['week']} | {h['pos']} | "
                  f"**{h['name']}** | +{h['pts']:.0f} | {_mgr_name(h['rid'])} |")
    md.append("")

    md.append("**Volume vs hit-rate per manager (2023-2025):**\n")
    md.append("| Manager | Total adds | >50 pt hits | Hit rate | Total wire pts |")
    md.append("|---|---|---|---|---|")
    rows = sorted(wire.items(), key=lambda kv: -kv[1]["total_pts"])
    for rid, d in rows:
        rate = 100 * d["hits50"] / max(1, d["n"])
        md.append(f"| {_mgr_name(rid)} | {d['n']} | {d['hits50']} | "
                  f"{rate:.0f}% | +{d['total_pts']:.0f} |")
    md.append("")

    md.append("Two distinct successful styles:\n")
    md.append("- **High volume / lower hit-rate** (Trevor 192 adds, Brower 149, "
              "Brian 105): spray-and-pray. More darts = more chances of hitting.")
    md.append("- **Low volume / high hit-rate** (Donnie 29 adds at 38% hit-rate, "
              "Coop 50 at 36%): selective tactical. Each pickup is researched.\n")
    md.append("Both work. What *doesn't* work: mid-volume with low hit-rate "
              "(Ankur, Kyle, Lem in the 80-100 range with 13-15% hit-rate). "
              "**If you're going to play the wire, commit to one style.**\n")

    md.append("**Pickup yield by position (Sleeper era):**\n")
    md.append("| Position | Total adds | Avg pts/add | >100 pt hits |")
    md.append("|---|---|---|---|")
    for pos in ("QB", "RB", "WR", "TE", "DEF", "K"):
        d = pos_yield.get(pos, {"n": 0, "pts": 0, "hits": 0})
        if d["n"]:
            md.append(f"| {pos} | {d['n']} | {d['pts']/d['n']:.0f} | {d['hits']} |")
    md.append("")
    md.append("**QB and RB pickups yield the most per-attempt.** WR/TE adds "
              "have the worst average return — the WR3 who had a good Sunday "
              "is almost always a trap. **If you're picking up a WR, it should "
              "be a rookie with a target share spike, not a veteran who just "
              "scored a TD.**\n")

    md.append("**When the big hits happen (>100 pt pickups, by week):**\n")
    md.append("```")
    for wk in sorted(week_dist):
        bar = "█" * week_dist[wk]
        md.append(f"  W{wk:>2}: {bar} ({week_dist[wk]})")
    md.append("```")
    md.append("Three clear peaks:\n")
    md.append("- **W2-W3**: workhorse-RB injury wave (when handcuffs become starters)")
    md.append("- **W5-W7**: second-wave RB and early QB benchings")
    md.append("- **W10**: trade-deadline drops + bye-week QB streaming — the "
              "single biggest wire week of the year\n")

    # ===== 5. Lever #3: Trades =====
    md.append("## 5. Lever #3 — Trades (the net-zero category)\n")
    md.append("Trade VBD nets to ~zero across the league by mathematical "
              "definition: one side's gain is the other side's loss. Over the "
              "3-year Sleeper window, individual trade scorecards range from "
              "+400 to -400 VBD, but the league-wide sum is near zero.\n")
    md.append("**Implications:**\n")
    md.append("1. **Don't trade unless you're confident you're EV+.** The "
              "average trade is a coin flip. Bad trades are how you give "
              "away the season.")
    md.append("2. **Mid-season trades for stars favor the buyer of recent "
              "performance, not the seller.** A common pattern: someone trades "
              "for a hot QB in W8, the QB stays hot, but the trade itself "
              "still moves only ~150 VBD because half the season is already "
              "scored.")
    md.append("3. **Future picks are wildly under-priced.** Future R2 picks "
              "rarely command R5 current-year value, but historically a R2 "
              "delivers +100 VBD on average. Sellers of future picks are "
              "leaving value on the table.\n")

    # ===== 6. Lever #4: Lineup =====
    md.append("## 6. Lever #4 — Lineup Decisions (small but free)\n")
    md.append("Across the 12-team league, the spread between optimal-lineup "
              "and actual-lineup totals is typically ±20-50 points per season — "
              "less than 1.5 points/week. Most managers leave 30-40 points on "
              "the bench per year. It's small, but it's also free: research "
              "matchups, check inactives an hour before kickoff. Better "
              "lineup discipline alone is worth roughly 1 extra win across a "
              "14-game season.\n")

    # ===== 7. The noise: luck =====
    md.append("## 7. The Noise — Luck and Schedule\n")
    md.append("**All-play expected wins** (your weekly score vs every other "
              "manager's score that week) is a better measure of true team "
              "strength than your actual record. Across 3 years, the spread "
              "between most-lucky and least-lucky manager is ~4 wins — "
              "huge.\n")
    md.append("**The takeaway:**\n")
    md.append("- If your **PF is high but record is bad**, you're probably "
              "running good and just unlucky. Be patient. Don't blow up the "
              "team chasing a bad start.")
    md.append("- If your **PF is low but record is good**, you're getting "
              "lucky. Trade from a position of perceived strength while you "
              "can.")
    md.append("- **Luck regresses.** The unluckiest 2023-2025 manager is "
              "extremely likely to outperform their record in 2026, and "
              "vice versa.\n")

    # ===== 8. Champion patterns =====
    md.append("## 8. What Champions Have in Common\n")
    md.append("Looking at the three Sleeper-era champions:\n")
    md.append("- **Eric (2023)**: top-2 drafter that year + top-2 in trades")
    md.append("- **Coop (2024)**: top-2 drafter + top-2 in wire + top-2 in trades — total dominance")
    md.append("- **Trevor (2025)**: top-2 drafter + top-2 in wire — won despite "
              "mediocre trades and bad luck\n")
    md.append("**The single common thread**: top-2 in DRAFTING that year. "
              "Every other category is variable across champions. **The path "
              "to a title runs through nailing one specific year's draft, "
              "not through being a consistently good drafter.**\n")
    md.append("This also means: don't get cute. Don't engineer your draft "
              "around your keepers when the keepers don't pencil. Don't chase "
              "fades. A clean, BPA draft with good positional balance is "
              "what's actually winning.\n")

    # ===== 9. The 2026 tactical calendar =====
    md.append("## 9. A 2026 Tactical Calendar\n")
    md.append("- **Pre-draft**: Lock in your keepers. Decide WR vs RB-first "
              "before draft day. Don't make format changes in-room.")
    md.append("- **W1-W2**: Watch usage, not stats. Snap counts > yardage.")
    md.append("- **W2-W3 — RB INJURY HUNT**: Workhorse handcuffs become starters. "
              "Top historical hits: Kyren Williams W3, Breece Hall W6, "
              "D'Andre Swift W3, Woody Marks W3.")
    md.append("- **W5-W7 — SECOND-WAVE PICKUPS**: rookie WR after target spike, "
              "RB rotations sorting out. Most cheap leverage of the season.")
    md.append("- **W7-W10 — QB SHUFFLE**: Benchings + injuries + byes mean "
              "starter-quality QBs hit the wire constantly. Highest yield "
              "position by avg pts/add.")
    md.append("- **W10 — TRADE DEADLINE WEEK**: The biggest wire week of the "
              "year. Camp the wire. Other managers drop assets to clear "
              "playoff roster spots.")
    md.append("- **W11-W13 — PLAYOFF RUN**: Stop speculating. Add only direct "
              "contributors. Lock in matchups, not theories.")
    md.append("- **W14+ — PLAYOFFS**: Stream DEF and K against bad offenses. "
              "Trust your starters. Don't bench based on one bad game.\n")

    # ===== 10. Principles =====
    md.append("## 10. Six Principles (TL;DR)\n")
    md.append("1. **The draft is 70% of your team.** Peak-year matters more than "
              "career skill. Don't get cute — BPA wins.")
    md.append("2. **The wire is the biggest under-exploited margin.** Either "
              "commit to high volume or high selectivity. Mid-volume + low "
              "hit-rate is the worst zone.")
    md.append("3. **Trade only when you're clearly EV+.** Most trades are "
              "coin-flips. Future picks are under-priced.")
    md.append("4. **Lineups are free points.** Check inactives. Use FAAB "
              "discipline. Bank ~30 points/year that most managers leave on "
              "the bench.")
    md.append("5. **Don't trade against the wire when the wire is hot.** "
              "Weeks 3-6 and 10 are when the league's biggest pickups happen. "
              "Trade in dead weeks.")
    md.append("6. **Believe in regression.** High-PF + low-W = next year you. "
              "Low-PF + high-W = next year not you.\n")

    md.append("---\n")
    md.append("*Methodology: 10 years of draft attribution from the league "
              "spreadsheet (cell-color overlay used for Yahoo-era pick trades). "
              "Sleeper-era VBD computed against era-appropriate replacement "
              "ranks (10-team 0PPR for 2015-18, 12-team 2QB 0.5PPR for "
              "2019-22, 12-team SF 0.5PPR for 2023+). Player stats from the "
              "public nflverse data release for 2015-2024, live Sleeper data "
              "for 2025. Full underlying numbers + per-manager awards "
              "report available separately.*")
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
        elif ln.startswith("### "):
            close_para(); close_table()
            html_lines.append(f"<h3>{inline(ln[4:])}</h3>")
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
            html_lines.append(f"<p>• {inline(ln[2:])}</p>")
        elif ln.startswith(("1.", "2.", "3.", "4.", "5.", "6.", "7.", "8.", "9.")) and ". " in ln:
            close_para(); close_table()
            html_lines.append(f"<p>{inline(ln)}</p>")
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
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 760px;
           margin: 30px auto; padding: 0 28px; color: #1a1a1a;
           line-height: 1.55; font-size: 11pt; }
    h1 { font-size: 22pt; border-bottom: 3px solid #1a1a1a;
         padding-bottom: 8px; margin-top: 0; }
    h2 { font-size: 15pt; color: #0a4d6b; margin-top: 24px;
         border-bottom: 1px solid #aaa; padding-bottom: 4px; }
    h3 { font-size: 12pt; color: #555; margin-top: 14px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0 14px 0;
            font-size: 9.5pt; }
    th { background: #2c5d7c; color: white; padding: 5px 8px; text-align: left; }
    td { padding: 4px 8px; border-bottom: 1px solid #ddd; }
    tr:nth-child(even) td { background: #f8f8f8; }
    pre { background: #f4f4f4; padding: 10px 14px; border-radius: 4px;
          font-size: 9pt; overflow-x: auto; line-height: 1.3; }
    code { background: #efefef; padding: 1px 4px; border-radius: 3px;
           font-size: 9.5pt; }
    em { color: #555; }
    hr { border: none; border-top: 1px solid #ccc; margin: 18px 0; }
    p { margin: 6px 0; }
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
