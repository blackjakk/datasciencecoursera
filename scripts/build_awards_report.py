#!/usr/bin/env python3
"""MONEYLEAGUE Awards Report — comprehensive rankings (all 12 teams in
every category) + bonus awards. Writes:
  data/MONEYLEAGUE_AWARDS.md
  data/MONEYLEAGUE_AWARDS.pdf
"""
from __future__ import annotations

import json
import statistics
import sys
from collections import defaultdict, Counter
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.results import (
    load_draft_picks_with_points, load_all_seasons,
    load_all_trades, summarize_trade,
)
from fantasy_draft.team_identity import manager_for_sleeper_roster

ROOT = Path(__file__).resolve().parent.parent
MD_OUT = ROOT / "data" / "MONEYLEAGUE_AWARDS.md"
PDF_OUT = ROOT / "data" / "MONEYLEAGUE_AWARDS.pdf"


def mgr_name(rid: int) -> str:
    m = manager_for_sleeper_roster(rid)
    return m["canonical_name"] if m else f"Roster {rid}"


def compute_data():
    picks = load_draft_picks_with_points(ROOT / "data" / "sleeper")
    seasons = load_all_seasons(ROOT / "data" / "sleeper")
    catalog = json.loads((ROOT / "data" / "sleeper" / "players_nfl.json").read_text(encoding="utf-8"))
    pv = json.loads((ROOT / "data" / "pick_value.json").read_text(encoding="utf-8"))
    pv_blind = {int(r): d["mean_vbd"] for r, d in pv["by_round"].items()}
    RANKS = pv["replacement_ranks_used"]

    # Tag every pick with VBD + slot expectation.
    per_season = defaultdict(list)
    for p in picks:
        per_season[p["season"]].append(p)

    def repl_for(sp):
        by_pos = defaultdict(list)
        for p in sp:
            if p["position"] in RANKS and p["season_points"]:
                by_pos[p["position"]].append(p["season_points"])
        out = {}
        for pos, pts in by_pos.items():
            pts.sort(reverse=True)
            out[pos] = pts[min(RANKS[pos] - 1, len(pts) - 1)] if pts else 0.0
        return out

    repl = {s: repl_for(ps) for s, ps in per_season.items()}
    for p in picks:
        p["vbd"] = (p["season_points"] or 0) - repl[p["season"]].get(p["position"], 0)
        p["expected"] = pv_blind.get(p["round"], 0)

    # ===== Drafting =====
    draft = defaultdict(lambda: {"n": 0, "sum_vbd": 0.0, "sum_above": 0.0})
    for p in picks:
        if p.get("is_keeper"):
            continue
        rid = p["roster_id"]
        draft[rid]["n"] += 1
        draft[rid]["sum_vbd"] += p["vbd"]
        draft[rid]["sum_above"] += p["vbd"] - p["expected"]

    # ===== FA / waivers =====
    pp_sw = defaultdict(lambda: defaultdict(dict))
    for ld in sorted((ROOT / "data" / "sleeper").glob("league_*")):
        if not (ld / "league.json").exists():
            continue
        season = int(json.loads((ld / "league.json").read_text(encoding="utf-8"))["season"])
        for wf in sorted((ld / "matchups").glob("week_*.json")):
            wk = int(wf.stem.split("_")[1])
            for e in json.loads(wf.read_text(encoding="utf-8")):
                for pid, pts in (e.get("players_points") or {}).items():
                    if pts is not None:
                        pp_sw[season][wk][str(pid)] = float(pts)

    fa = defaultdict(lambda: {"adds": 0, "pts": 0.0, "hits": 0, "misses": 0,
                                "best": None})
    best_pickup_ever = None
    for ld in sorted((ROOT / "data" / "sleeper").glob("league_*")):
        if not (ld / "league.json").exists():
            continue
        season = int(json.loads((ld / "league.json").read_text(encoding="utf-8"))["season"])
        for tf in sorted((ld / "transactions").glob("week_*.json")):
            wk = int(tf.stem.split("_")[1])
            try:
                txns = json.loads(tf.read_text(encoding="utf-8"))
            except Exception:
                continue
            for t in txns:
                if t.get("type") not in ("waiver", "free_agent"):
                    continue
                if t.get("status") not in ("complete", "completed"):
                    continue
                for pid, rid in (t.get("adds") or {}).items():
                    pts = sum(pp_sw[season].get(w, {}).get(str(pid), 0.0)
                              for w in range(wk, 18))
                    rid = int(rid)
                    fa[rid]["adds"] += 1
                    fa[rid]["pts"] += pts
                    if pts >= 80:
                        fa[rid]["hits"] += 1
                    if pts < 10:
                        fa[rid]["misses"] += 1
                    nm = (catalog.get(str(pid)) or {}).get("full_name", pid)
                    if not fa[rid]["best"] or pts > fa[rid]["best"]["pts"]:
                        fa[rid]["best"] = {"name": nm, "pts": pts,
                                            "wk": wk, "season": season}
                    if not best_pickup_ever or pts > best_pickup_ever["pts"]:
                        best_pickup_ever = {"name": nm, "rid": rid, "pts": pts,
                                             "wk": wk, "season": season}

    # ===== Lineup commander =====
    SLOTS = [("QB", {"QB"}, 1), ("RB", {"RB"}, 2), ("WR", {"WR"}, 3),
             ("TE", {"TE"}, 1), ("FLEX", {"RB", "WR", "TE"}, 1),
             ("SUPERFLEX", {"QB", "RB", "WR", "TE"}, 1),
             ("K", {"K"}, 1), ("DEF", {"DEF", "DST"}, 1)]

    def opt_lineup(pp):
        by_pos = defaultdict(list)
        for pid, pts in pp.items():
            pos = (catalog.get(str(pid), {}) or {}).get("position") or ""
            by_pos[pos].append((pts, pid))
        for pos in by_pos:
            by_pos[pos].sort(reverse=True)
        used, total = set(), 0
        for _, allowed, count in SLOTS:
            cands = [(pts, pid) for pos in allowed
                     for pts, pid in by_pos.get(pos, []) if pid not in used]
            cands.sort(reverse=True)
            for pts, pid in cands[:count]:
                used.add(pid)
                total += pts
        return total

    lineup = defaultdict(lambda: {"weeks": 0, "bench_loss": 0.0})
    for ld in sorted((ROOT / "data" / "sleeper").glob("league_*")):
        if not (ld / "league.json").exists():
            continue
        for wf in sorted((ld / "matchups").glob("week_*.json")):
            wk = int(wf.stem.split("_")[1])
            if wk > 14:
                continue
            for e in json.loads(wf.read_text(encoding="utf-8")):
                pp = e.get("players_points") or {}
                actual = sum(float(pp.get(str(s), 0) or 0)
                             for s in (e.get("starters") or []))
                opt = opt_lineup(pp)
                lineup[int(e["roster_id"])]["weeks"] += 1
                lineup[int(e["roster_id"])]["bench_loss"] += (opt - actual)

    # ===== Trade scorecard =====
    trades = load_all_trades(ROOT / "data" / "sleeper")
    pts_by_season = {s["season"]: s["player_total_points"] for s in seasons.values()}
    roster_team = {rid: r["team_name"]
                   for s in seasons.values() for rid, r in s["rosters"].items()}
    trade = defaultdict(lambda: {"n": 0, "net": 0.0})
    for t in trades:
        if t.get("_season") == 2023:  # unreliable attribution
            continue
        sides = summarize_trade(t, roster_team, catalog, pts_by_season, pv_blind)
        for s in sides:
            trade[s["team"]]["n"] += 1
            trade[s["team"]]["net"] += s["net"]

    # ===== Best/worst single picks =====
    pickables = [p for p in picks if not p.get("is_keeper")]
    steals = sorted(pickables, key=lambda p: -(p["vbd"] - p["expected"]))[:12]
    busts = sorted(pickables, key=lambda p: (p["vbd"] - p["expected"]))[:12]

    # ===== Standings & championships =====
    season_stats = {}
    for yr, s in seasons.items():
        wins_sorted = sorted(s["rosters"].items(),
                              key=lambda x: (-x[1]["wins"], -x[1]["fpts"]))
        season_stats[yr] = {
            "champion_rid": s.get("champion_roster_id"),
            "standings": wins_sorted,
        }

    # Years rostered per manager.
    n_years = defaultdict(int)
    for s in seasons.values():
        for rid in s["rosters"]:
            n_years[rid] += 1

    return {
        "picks": picks,
        "seasons": seasons,
        "draft": draft,
        "fa": fa,
        "lineup": lineup,
        "trade": trade,
        "steals": steals,
        "busts": busts,
        "best_pickup": best_pickup_ever,
        "season_stats": season_stats,
        "n_years": n_years,
    }


def build_markdown(D: dict) -> str:
    today = date.today().strftime("%B %d, %Y")
    md = []
    md.append("# 🏆 MONEYLEAGUE Awards Report")
    md.append(f"*Generated {today} — covers Sleeper seasons 2023, 2024, 2025*\n")
    md.append("*2023 draft attribution restored from MONEY_LEAGUE.xlsx cell-color overlay (Yahoo pick trades preserved).*\n")
    md.append("---\n")

    # ========== Drafting ==========
    md.append("## 🎯 DRAFTING — skill-adjusted")
    md.append("Above-expectation per pick: positive = beat what an average drafter would have gotten with the same draft slots.\n")
    md.append("| Rank | Manager | Picks | Total VBD | Per-pick raw | Above-exp / pick |")
    md.append("|---|---|---|---|---|---|")
    rows = sorted(D["draft"].items(),
                   key=lambda x: -x[1]["sum_above"] / max(1, x[1]["n"]))
    for i, (rid, m) in enumerate(rows, 1):
        ppp = m["sum_vbd"] / max(1, m["n"])
        aep = m["sum_above"] / max(1, m["n"])
        md.append(f"| {i} | **{mgr_name(rid)}** | {m['n']} | "
                  f"{m['sum_vbd']:+.0f} | {ppp:+.1f} | {aep:+.1f} |")
    md.append("\n*By raw per-pick: Donnie #1 (slot 1 every year). "
              "By skill-adjusted: Lem #1, with Brian a hair behind.*\n")

    # ========== FA ==========
    md.append("## 🔍 TALENT SCOUTING — waiver / free-agent skill")
    md.append("Per-add average + hit rate (% of adds scoring 80+ rest-of-season).\n")
    md.append("| Rank | Manager | Adds | Total pts | Pts/add | Hits | Hit % | Best pickup |")
    md.append("|---|---|---|---|---|---|---|---|")
    rows = sorted(D["fa"].items(), key=lambda x: -x[1]["pts"] / max(1, x[1]["adds"]))
    for i, (rid, m) in enumerate(rows, 1):
        ppa = m["pts"] / max(1, m["adds"])
        hit_pct = m["hits"] * 100 / max(1, m["adds"])
        best = m["best"]
        best_str = f"{best['name']} ({best['pts']:.0f}, {best['season']} W{best['wk']})" if best else "—"
        md.append(f"| {i} | **{mgr_name(rid)}** | {m['adds']} | "
                  f"+{m['pts']:.0f} | +{ppa:.1f} | {m['hits']} | {hit_pct:.0f}% | {best_str} |")
    md.append("")

    # Best pickups across league.
    bp = D["best_pickup"]
    md.append(f"**League best pickup ever:** {bp['name']} → {mgr_name(bp['rid'])} "
              f"(W{bp['wk']} {bp['season']}, +{bp['pts']:.0f} pts the rest of the year)\n")

    # ========== Lineup commander ==========
    md.append("## 🎬 LINEUP COMMANDER — least pts left on bench per week")
    md.append("Computed by comparing actual starting lineup pts vs. the optimal lineup from each week's roster.\n")
    md.append("| Rank | Manager | Weeks | Total bench loss | Per week |")
    md.append("|---|---|---|---|---|")
    rows = sorted(D["lineup"].items(),
                   key=lambda x: x[1]["bench_loss"] / max(1, x[1]["weeks"]))
    for i, (rid, m) in enumerate(rows, 1):
        per_wk = m["bench_loss"] / max(1, m["weeks"])
        md.append(f"| {i} | **{mgr_name(rid)}** | {m['weeks']} | "
                  f"{m['bench_loss']:+.0f} | +{per_wk:.1f} |")
    md.append("")

    # ========== Trade Maestro ==========
    md.append("## 🤝 TRADE MAESTRO — net VBD swing across trades")
    md.append("*Each trade scored after the fact: players valued by season points, picks by historical mean VBD at that round. **2023 excluded** — post-migration attribution is unreliable.*\n")
    md.append("| Rank | Team / Manager | Trades | Net VBD | Per trade |")
    md.append("|---|---|---|---|---|")
    rows = sorted(D["trade"].items(), key=lambda x: -x[1]["net"])
    for i, (team, m) in enumerate(rows, 1):
        per = m["net"] / max(1, m["n"])
        md.append(f"| {i} | **{team}** | {m['n']} | {m['net']:+.0f} | {per:+.1f} |")
    md.append("")

    # ========== Steals & busts ==========
    md.append("## 💎 BIGGEST DRAFT STEALS EVER (top 12)")
    md.append("Picks that beat their round's expected VBD by the widest margin.\n")
    md.append("| # | Year | Round | Player | Pos | VBD vs exp | Drafter |")
    md.append("|---|---|---|---|---|---|---|")
    for i, p in enumerate(D["steals"], 1):
        diff = p["vbd"] - p["expected"]
        md.append(f"| {i} | {p['season']} | R{p['round']} | **{p['player_name']}** | "
                  f"{p['position']} | +{diff:.0f} | {mgr_name(p['roster_id'])} |")
    md.append("")

    md.append("## 💩 BIGGEST DRAFT BUSTS EVER (top 12)")
    md.append("Picks that missed their round's expected VBD by the widest margin.\n")
    md.append("| # | Year | Round | Player | Pos | VBD vs exp | Owner |")
    md.append("|---|---|---|---|---|---|---|")
    for i, p in enumerate(D["busts"], 1):
        diff = p["vbd"] - p["expected"]
        md.append(f"| {i} | {p['season']} | R{p['round']} | **{p['player_name']}** | "
                  f"{p['position']} | {diff:+.0f} | {mgr_name(p['roster_id'])} |")
    md.append("")

    # ========== Activity ==========
    md.append("## 🌪️ MOST ACTIVE GM — waiver / FA volume")
    md.append("| Rank | Manager | Adds | Pts/add | Style |")
    md.append("|---|---|---|---|---|")
    rows = sorted(D["fa"].items(), key=lambda x: -x[1]["adds"])
    for i, (rid, m) in enumerate(rows, 1):
        ppa = m["pts"] / max(1, m["adds"])
        if m["adds"] >= 150:
            style = "🌪️ spray-and-pray volume"
        elif m["adds"] >= 90:
            style = "active churner"
        elif m["adds"] >= 50:
            style = "selective tactical"
        else:
            style = "minimal-touch"
        md.append(f"| {i} | **{mgr_name(rid)}** | {m['adds']} | +{ppa:.1f} | {style} |")
    md.append("")

    # ========== Standings + champions ==========
    md.append("## 👑 CHAMPIONS & STANDINGS")
    for yr in sorted(D["seasons"]):
        s = D["seasons"][yr]
        cid = s.get("champion_roster_id")
        champ = mgr_name(cid) if cid else "?"
        md.append(f"### {yr} — 🏆 {champ}")
        md.append(f"| Rank | Manager | W-L | Points For | Points Against |")
        md.append(f"|---|---|---|---|---|")
        for i, (rid, r) in enumerate(D["season_stats"][yr]["standings"], 1):
            badge = "🏆 " if rid == cid else ""
            md.append(f"| {i} | {badge}**{mgr_name(rid)}** | "
                      f"{r['wins']}-{r['losses']} | {r['fpts']:.1f} | {r['fpts_against']:.1f} |")
        md.append("")

    # ========== Composite ranking ==========
    md.append("## 🏅 COMPOSITE LEAGUE RANKING")
    md.append("Each manager's percentile rank within each skill, averaged.\n")

    def pct_rank(value, all_values, higher_is_better=True):
        """Return percentile rank 0-100."""
        sorted_v = sorted(all_values, reverse=higher_is_better)
        rank = sorted_v.index(value)
        return 100 * (len(sorted_v) - rank - 1) / max(1, len(sorted_v) - 1)

    draft_aep = {rid: m["sum_above"] / max(1, m["n"]) for rid, m in D["draft"].items()}
    fa_ppa = {rid: m["pts"] / max(1, m["adds"]) for rid, m in D["fa"].items()}
    lineup_per = {rid: -(m["bench_loss"] / max(1, m["weeks"])) for rid, m in D["lineup"].items()}
    # Trade scorecard is keyed by team_name, map back to rid.
    team_to_rid = {}
    for yr_s in D["seasons"].values():
        for rid, r in yr_s["rosters"].items():
            team_to_rid[r["team_name"]] = rid
    trade_net = {team_to_rid.get(team, -1): m["net"]
                  for team, m in D["trade"].items() if team in team_to_rid}

    composite = []
    for rid in D["draft"]:
        d_pct = pct_rank(draft_aep[rid], list(draft_aep.values()))
        f_pct = pct_rank(fa_ppa.get(rid, 0), list(fa_ppa.values()))
        l_pct = pct_rank(lineup_per.get(rid, 0), list(lineup_per.values()))
        t_pct = pct_rank(trade_net.get(rid, 0), list(trade_net.values()))
        composite.append({
            "rid": rid, "name": mgr_name(rid),
            "draft": d_pct, "fa": f_pct, "lineup": l_pct, "trade": t_pct,
            "avg": (d_pct + f_pct + l_pct + t_pct) / 4,
        })
    composite.sort(key=lambda x: -x["avg"])
    md.append("| Rank | Manager | Draft | FA | Lineup | Trade | **Avg** |")
    md.append("|---|---|---|---|---|---|---|")
    for i, c in enumerate(composite, 1):
        md.append(f"| {i} | **{c['name']}** | {c['draft']:.0f} | {c['fa']:.0f} | "
                  f"{c['lineup']:.0f} | {c['trade']:.0f} | **{c['avg']:.0f}** |")
    md.append("\n*Percentiles 0-100 (100 = best, 0 = worst). Composite = average across the 4 skills.*\n")

    md.append("---\n")
    md.append("*Generated by `scripts/build_awards_report.py`. "
              "Re-run to refresh after each new Sleeper season.*")
    return "\n".join(md)


def md_to_html(md_text: str) -> str:
    """Minimal markdown -> HTML for tables + headers + paragraphs + bold/italics."""
    import re
    lines = md_text.split("\n")
    html_lines = []
    in_table = False
    in_para = False
    header_row = []

    def close_para():
        nonlocal in_para
        if in_para:
            html_lines.append("</p>")
            in_para = False

    def close_table():
        nonlocal in_table, header_row
        if in_table:
            html_lines.append("</tbody></table>")
            in_table = False
            header_row = []

    def inline(text):
        text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
        text = re.sub(r"\*(.+?)\*", r"<em>\1</em>", text)
        text = re.sub(r"`(.+?)`", r"<code>\1</code>", text)
        return text

    for ln in lines:
        s = ln.strip()
        if s.startswith("###"):
            close_para(); close_table()
            html_lines.append(f"<h3>{inline(s[3:].strip())}</h3>")
        elif s.startswith("##"):
            close_para(); close_table()
            html_lines.append(f"<h2>{inline(s[2:].strip())}</h2>")
        elif s.startswith("#"):
            close_para(); close_table()
            html_lines.append(f"<h1>{inline(s[1:].strip())}</h1>")
        elif s.startswith("---"):
            close_para(); close_table()
            html_lines.append("<hr/>")
        elif s.startswith("|"):
            close_para()
            cells = [c.strip() for c in s.strip("|").split("|")]
            if not in_table:
                in_table = True
                html_lines.append('<table><thead><tr>'
                                   + "".join(f"<th>{inline(c)}</th>" for c in cells)
                                   + "</tr></thead><tbody>")
                header_row = cells
            else:
                # Header underline row?
                if all(set(c.replace(":", "").replace("-", "")) <= {""} for c in cells):
                    continue
                html_lines.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in cells) + "</tr>")
        elif not s:
            close_para(); close_table()
        else:
            close_table()
            if not in_para:
                html_lines.append("<p>")
                in_para = True
            html_lines.append(inline(s) + "<br/>")
    close_para(); close_table()

    css = """
    body { font-family: 'Helvetica', sans-serif; font-size: 11pt; line-height: 1.4;
            color: #222; max-width: 850px; margin: 0 auto; padding: 1.5em; }
    h1 { color: #b8860b; border-bottom: 3px solid #b8860b; padding-bottom: 8px; }
    h2 { color: #1e6091; border-bottom: 1px solid #1e6091; padding-bottom: 4px; margin-top: 1.5em; }
    h3 { color: #444; margin-top: 1em; }
    table { border-collapse: collapse; margin: 0.5em 0 1em 0; width: 100%; font-size: 9.5pt; }
    th, td { border: 1px solid #ddd; padding: 5px 8px; text-align: left; }
    th { background: #f0f0f0; font-weight: 600; }
    tr:nth-child(even) td { background: #fafafa; }
    strong { color: #000; }
    em { color: #555; }
    code { background: #f5f5f5; padding: 1px 4px; border-radius: 3px; font-size: 0.9em; }
    hr { border: none; border-top: 2px solid #ddd; margin: 2em 0; }
    """
    return f"<html><head><meta charset='utf-8'><style>{css}</style></head><body>{''.join(html_lines)}</body></html>"


def main():
    D = compute_data()
    md = build_markdown(D)
    MD_OUT.write_text(md, encoding="utf-8")
    print(f"Wrote {MD_OUT.relative_to(ROOT)}")

    try:
        from weasyprint import HTML
    except ImportError:
        sys.exit("weasyprint not installed — `pip install weasyprint` to render PDF.")
    html = md_to_html(md)
    HTML(string=html).write_pdf(str(PDF_OUT))
    print(f"Wrote {PDF_OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
