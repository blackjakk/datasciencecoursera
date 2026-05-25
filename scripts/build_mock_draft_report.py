"""MONEYLEAGUE 2026 Mock Draft Report — full draft board + analysis."""
from __future__ import annotations

import base64
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.team_identity import all_managers, manager_for_sleeper_roster
from scripts import build_power_rankings as bpr

ROOT = Path(__file__).resolve().parent.parent
PDF_OUT = ROOT / "data" / "MONEYLEAGUE_2026_MOCK.pdf"
CHART_DIR = ROOT / "data" / "charts" / "mock"
CHART_DIR.mkdir(parents=True, exist_ok=True)
CHROMIUM_EXEC = bpr.CHROMIUM_EXEC

# Predicted 2026 draft order: reverse final 2025 standings.
# Playoff teams ranked by playoff finish (champ picks last); rest by reg-season.
# 2025: Trevor=champ, Josh=runnerup, Ankur=3rd, Brower=4th, Tim=5th, Eric=6th
# Non-playoff (by reg season wins+fpts): Coop, Lem, Donnie, Kyle, Brian, Troy(worst)
# Slot = pick number in R1 (1 = first overall = worst team).
# 2025 consolation bracket results determine picks 1-6:
#   7th (consolation champ) = Lem      -> R1.1
#   8th (consolation 2nd)   = Coop     -> R1.2
#   9th (consolation 3rd)   = Kyle     -> R1.3
#   10th                    = Troy     -> R1.4
#   11th                    = Donnie   -> R1.5
#   12th (last)             = Brian    -> R1.6
# Playoff teams take picks 7-12 in reverse finish (champ last):
#   6th = Eric, 5th = Tim, 4th = Brower, 3rd = Ankur, 2nd = Josh, 1st = Trevor
PREDICTED_SLOT_TO_RID = {
    1: 6,    # Lem (consolation champ → 7th place)
    2: 12,   # Coop (consolation runner-up → 8th)
    3: 5,    # Kyle (consolation 3rd → 9th)
    4: 4,    # Troy (10th)
    5: 2,    # Donnie (11th)
    6: 9,    # Brian (12th — last place)
    7: 7,    # Eric (playoff 6th)
    8: 1,    # Tim (playoff 5th)
    9: 8,    # Brower (playoff 4th)
    10: 3,   # Ankur (playoff 3rd)
    11: 10,  # Josh (runner-up)
    12: 11,  # Trevor (champion)
}

# Default Sleeper placeholder
SLEEPER_PLACEHOLDER_SLOT_TO_RID = {1: 6, 2: 2, 3: 7, 4: 11, 5: 5, 6: 1,
                                    7: 10, 8: 8, 9: 9, 10: 3, 11: 4, 12: 12}

# Use predicted order
SLOT_TO_RID = PREDICTED_SLOT_TO_RID
ROSTER_HANDOFFS = {(2025, 10): "josh_wildboy"}

POS_COLORS = {
    "QB": "#dc2626", "RB": "#0891b2", "WR": "#2d6a4f",
    "TE": "#f59e0b", "K": "#9a3412", "DEF": "#525252",
}


def _norm_player(s):
    import re, unicodedata
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().strip()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()


def _data_uri(path):
    if not Path(path).exists():
        return ""
    ext = str(path).lower().split(".")[-1]
    mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg"}.get(ext, "image/png")
    b = Path(path).read_bytes()
    return f"data:{mime};base64,{base64.b64encode(b).decode()}"


def _setup_mpl():
    for f in (ROOT / "data" / "fonts").glob("*.ttf"):
        try:
            fm.fontManager.addfont(str(f))
        except Exception:
            pass
    plt.rcParams.update({
        "font.family": ["Inter", "DejaVu Sans"],
        "font.size": 10,
        "axes.spines.top": False,
        "axes.spines.right": False,
    })


def team_idx_to_mid(idx):
    """team_idx 0-11 -> manager_id. CLI uses 0-indexed; Sleeper slot is 1-indexed."""
    slot = idx + 1
    rid = SLOT_TO_RID.get(slot)
    if not rid:
        return None
    mid = ROSTER_HANDOFFS.get((2025, rid))
    if mid:
        return mid
    m = manager_for_sleeper_roster(rid)
    return m["id"] if m else None


def team_idx_to_name(idx):
    mid = team_idx_to_mid(idx)
    return bpr._mgr_name(mid) if mid else f"Team {idx+1}"


def chart_position_runs(picks, path):
    """Cumulative position picks over the draft."""
    _setup_mpl()
    overall = sorted({p["overall"] for p in picks})
    cum = defaultdict(lambda: defaultdict(int))
    for p in picks:
        pos = p["position"] if p["position"] in POS_COLORS else "OTHER"
        cum[p["overall"]][pos] += 1
    # Running totals
    running = defaultdict(int)
    series = defaultdict(list)
    x = []
    for o in overall:
        for pos in cum[o]:
            running[pos] += cum[o][pos]
        x.append(o)
        for pos in ["QB", "RB", "WR", "TE", "K", "DEF"]:
            series[pos].append(running[pos])
    fig, ax = plt.subplots(figsize=(9, 4.5), dpi=140)
    for pos in ["QB", "RB", "WR", "TE", "K", "DEF"]:
        ax.plot(x, series[pos], color=POS_COLORS[pos], linewidth=2.4,
                label=pos)
    ax.set_xlabel("Overall pick", fontweight="bold")
    ax.set_ylabel("Cumulative drafted", fontweight="bold")
    ax.set_title("Position Runs Over the Draft",
                 loc="left", pad=12, fontsize=13)
    ax.grid(linestyle="--", alpha=0.4)
    ax.set_axisbelow(True)
    ax.legend(loc="lower right", frameon=False)
    plt.tight_layout()
    plt.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close()


def chart_team_projection(team_totals, path):
    """Sort teams by total projection."""
    _setup_mpl()
    s = sorted(team_totals.items(), key=lambda kv: kv[1])
    names = [t[0] for t in s]
    vals = [t[1] for t in s]
    colors = [bpr.mgr_color(team_idx_to_mid_by_name(t[0])) for t in s]
    fig, ax = plt.subplots(figsize=(9, 0.42 * len(s) + 0.8), dpi=140)
    ax.barh(names, vals, color=colors, edgecolor="white", linewidth=1.2,
            height=0.72)
    for i, v in enumerate(vals):
        ax.text(v + 15, i, f"{v:.0f}", va="center", fontsize=10,
                fontweight="bold", color="#1a1d24")
    ax.set_xlim(min(vals) * 0.98, max(vals) * 1.04)
    ax.set_xlabel("Total projected pts (full roster, half-PPR)",
                  fontweight="bold")
    ax.set_title("Projected Total Roster Strength (Mock Output)",
                 loc="left", pad=12, fontsize=13)
    ax.grid(axis="x", linestyle="--", alpha=0.4)
    ax.set_axisbelow(True)
    plt.tight_layout()
    plt.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close()


def team_idx_to_mid_by_name(name):
    for m in all_managers():
        if m["canonical_name"].split(" (")[0] == name:
            return m["id"]
    return None


def find_steals_reaches(picks, top_n=10):
    """ADP delta = overall_pick - ADP. Positive = drafted LATER than ADP (steal —
    they fell). Negative = drafted EARLIER than ADP (reach — taken too soon)."""
    candidates = []
    for p in picks:
        if p["is_keeper"]:
            continue
        if p["adp"] >= 999:
            continue
        candidates.append((p, p["overall"] - p["adp"]))
    steals = sorted(candidates, key=lambda x: -x[1])[:top_n]   # biggest fall
    reaches = sorted(candidates, key=lambda x: x[1])[:top_n]   # most premature
    return steals, reaches


def render_draft_board_html(picks):
    """17 rounds × 12 teams grid. Each cell shows player + pos."""
    # Group picks: (round, team_idx) -> pick
    by_cell = {(p["round"], p["team_idx"]): p for p in picks}
    rounds = sorted({p["round"] for p in picks})
    teams = sorted({p["team_idx"] for p in picks})

    h = ['<table class="board">']
    # Header row
    h.append('<thead><tr><th class="rd-col">R</th>')
    for ti in teams:
        nm = team_idx_to_name(ti)
        mid = team_idx_to_mid(ti)
        color = bpr.mgr_color(mid) if mid else "#666"
        h.append(f'<th class="team-col" style="background:{color}">{nm}</th>')
    h.append('</tr></thead><tbody>')

    for rnd in rounds:
        h.append(f'<tr><td class="rd-num">{rnd}</td>')
        for ti in teams:
            cell = by_cell.get((rnd, ti))
            if not cell:
                h.append('<td class="empty">—</td>')
                continue
            pos = cell["position"]
            pos_color = POS_COLORS.get(pos, "#888")
            kept = ' k' if cell["is_keeper"] else ""
            short = cell["player_name"]
            if " " in short:
                first, last = short.split(" ", 1)
                short = f"{first[0]}. {last}"
            short = short[:18]
            h.append(f'<td class="cell{kept}" style="border-left:3px solid {pos_color}">'
                     f'<span class="pname">{short}</span>'
                     f'<span class="pos" style="color:{pos_color}">{pos}</span></td>')
        h.append('</tr>')
    h.append('</tbody></table>')
    return "\n".join(h)


def render_team_card(ti, team_picks):
    """Per-team roster summary."""
    mid = team_idx_to_mid(ti)
    nm = team_idx_to_name(ti)
    color = bpr.mgr_color(mid) if mid else "#666"
    avatar = ROOT / "data/charts/avatars" / f"{mid}.jpg"
    av_html = (f'<img class="t-avatar" src="{_data_uri(avatar)}"/>'
               if avatar.exists() else '<div class="t-avatar"></div>')

    # Group by position
    by_pos = defaultdict(list)
    total_proj = 0
    for p in team_picks:
        by_pos[p["position"]].append(p)
        total_proj += p["projection"]

    # Project starters (1 QB + 2 RB + 3 WR + 1 TE + 1 FLEX + 1 SUPERFLEX)
    qbs = sorted(by_pos["QB"], key=lambda x: -x["projection"])
    rbs = sorted(by_pos["RB"], key=lambda x: -x["projection"])
    wrs = sorted(by_pos["WR"], key=lambda x: -x["projection"])
    tes = sorted(by_pos["TE"], key=lambda x: -x["projection"])
    starters = qbs[:1] + rbs[:2] + wrs[:3] + tes[:1]
    flex_pool = rbs[2:] + wrs[3:] + tes[1:]
    flex_pool.sort(key=lambda x: -x["projection"])
    flex = flex_pool[:1]
    superflex_pool = qbs[1:] + flex_pool[1:]
    superflex_pool.sort(key=lambda x: -x["projection"])
    superflex = superflex_pool[:1]
    starter_pts = sum(p["projection"] for p in starters + flex + superflex)

    rows = []
    for pos in ["QB", "RB", "WR", "TE", "K", "DEF"]:
        if pos not in by_pos:
            continue
        for p in sorted(by_pos[pos], key=lambda x: -x["projection"]):
            star = "*" if p in (starters + flex + superflex) else ""
            keep_tag = ' <span class="k-tag">K</span>' if p["is_keeper"] else ""
            row_color = POS_COLORS.get(pos, "#888")
            rows.append(f'<tr><td style="color:{row_color};font-weight:700">{pos}</td>'
                        f'<td>{p["player_name"]}{keep_tag}</td>'
                        f'<td class="proj">{p["projection"]:.0f}{star}</td>'
                        f'<td class="rd">R{p["round"]}</td></tr>')

    return f"""
    <div class="t-card" style="border-top:6px solid {color}">
      <div class="t-head">
        {av_html}
        <div class="t-name">{nm}</div>
        <div class="t-totals">
          <div class="t-tot">{total_proj:.0f}<span class="lbl">TOTAL</span></div>
          <div class="t-tot">{starter_pts:.0f}<span class="lbl">STARTERS</span></div>
        </div>
      </div>
      <table class="t-table">{''.join(rows)}</table>
    </div>
    """


def build_html(picks):
    today = date.today().strftime("%B %Y")
    # Per-team totals
    team_picks = defaultdict(list)
    for p in picks:
        team_picks[p["team_idx"]].append(p)
    team_totals = {}
    for ti, plist in team_picks.items():
        team_totals[team_idx_to_name(ti)] = sum(p["projection"] for p in plist)

    chart_paths = {
        "pos_runs": CHART_DIR / "pos_runs.png",
        "team_proj": CHART_DIR / "team_proj.png",
    }
    chart_position_runs(picks, chart_paths["pos_runs"])
    chart_team_projection(team_totals, chart_paths["team_proj"])

    steals, reaches = find_steals_reaches(picks, top_n=8)

    css = """
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Bebas+Neue&display=swap');
    body { font-family: 'Inter', sans-serif; max-width: 920px; margin: 18px auto;
           padding: 0 22px; color: #1a1d24; line-height: 1.45; font-size: 10pt; }
    .hero { background: linear-gradient(135deg, #0a3d62 0%, #1f7a8c 100%);
            color: white; padding: 22px 26px; border-radius: 14px;
            margin-bottom: 18px; }
    .hero h1 { font-family: 'Bebas Neue', sans-serif; font-size: 38pt;
               letter-spacing: 1px; margin: 0; line-height: 1; color: white; }
    .hero .subtitle { color: rgba(255,255,255,0.85); margin: 8px 0 0;
                      font-weight: 500; font-size: 11pt; }
    h2 { font-family: 'Bebas Neue', sans-serif; font-size: 22pt;
         letter-spacing: 1px; color: #0a3d62; margin: 16px 0 4px;
         padding-bottom: 3px; border-bottom: 3px solid #d4a017;
         break-after: avoid-page; }
    .note { color: #6b7280; font-size: 9pt; margin: 2px 0 8px;
            break-after: avoid-page; }
    .chart { width: 100%; max-height: 4.5in; object-fit: contain;
             display: block; margin: 4px 0 12px; }
    .board { width: 100%; border-collapse: separate; border-spacing: 1px;
             font-size: 7pt; }
    .board th { background: #0a3d62; color: white; padding: 3px 2px;
                font-weight: 700; }
    .team-col { font-family: 'Bebas Neue', sans-serif; font-size: 9pt;
                letter-spacing: 0.5px; }
    .rd-col { width: 18px; }
    .rd-num { background: #f9fafb; font-weight: 700; text-align: center;
              font-size: 8pt; color: #6b7280; }
    .cell { background: white; padding: 2px 4px; border-radius: 3px;
            font-size: 7pt; line-height: 1.15; }
    .cell.k { background: #fef3c7; }
    .pname { display: block; font-weight: 700; color: #1a1d24; }
    .pos { font-size: 6pt; font-weight: 700; }
    .empty { color: #d1d5db; text-align: center; font-size: 8pt; }
    .steals-reaches { display: grid; grid-template-columns: 1fr 1fr;
                      gap: 16px; }
    .sr-table { width: 100%; font-size: 9pt; border-collapse: collapse; }
    .sr-table th { background: #e5e7eb; padding: 4px 6px; text-align: left;
                   font-size: 8pt; }
    .sr-table td { padding: 3px 6px; border-bottom: 1px solid #f0f0f0; }
    .sr-table .delta-pos { color: #16a34a; font-weight: 700; }
    .sr-table .delta-neg { color: #dc2626; font-weight: 700; }
    .team-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
                 margin: 10px 0; }
    .t-card { border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;
              page-break-inside: avoid; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .t-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px;
              background: #f9fafb; }
    .t-avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover;
                background: #d1d5db; flex-shrink: 0; }
    .t-name { font-family: 'Bebas Neue', sans-serif; font-size: 14pt;
              letter-spacing: 0.5px; flex: 1; }
    .t-totals { display: flex; gap: 8px; }
    .t-tot { font-family: 'Bebas Neue', sans-serif; font-size: 16pt;
             color: #0a3d62; text-align: right; line-height: 1; }
    .t-tot .lbl { display: block; font-size: 7pt; letter-spacing: 0.4px;
                  color: #6b7280; font-family: 'Inter', sans-serif;
                  text-transform: uppercase; font-weight: 600;
                  margin-top: 2px; }
    .t-table { width: 100%; font-size: 8.5pt; }
    .t-table td { padding: 1px 6px; border-bottom: 1px solid #f9fafb; }
    .t-table .proj { text-align: right; font-weight: 700; color: #1a1d24;
                     width: 40px; }
    .t-table .rd { text-align: right; color: #9ca3af; font-size: 7.5pt;
                   width: 28px; }
    .k-tag { background: #fef3c7; color: #92400e; font-size: 7pt;
             padding: 0 4px; border-radius: 3px; margin-left: 4px;
             font-weight: 700; }
    .legend { display: flex; gap: 10px; margin: 6px 0 12px; font-size: 8.5pt; }
    .legend-item { display: flex; align-items: center; gap: 4px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 2px; }
    @page { size: letter landscape; margin: 0.35in; }
    """

    h = ['<!DOCTYPE html><html><head><meta charset="utf-8">',
         f'<style>{css}</style></head><body>']

    h.append('<div class="hero"><h1>2026 MOCK DRAFT</h1>'
             f'<p class="subtitle">{today} · MONEYLEAGUE · projected final boards</p></div>')

    # ===== Draft board =====
    h.append('<h2>The Board</h2>')
    h.append('<p class="note">Yellow cells = keepers. Color stripe = position. '
             'Projected by recursive auto-pick (best VBD × positional need × roster fit).</p>')
    h.append('<div class="legend">')
    for pos, color in POS_COLORS.items():
        h.append(f'<div class="legend-item"><div class="legend-dot" '
                 f'style="background:{color}"></div>{pos}</div>')
    h.append('</div>')
    h.append(render_draft_board_html(picks))

    # ===== Steals & Reaches =====
    h.append('<h2>Steals &amp; Reaches</h2>')
    h.append('<p class="note">ADP delta = actual pick − ADP rank. '
             '<strong style="color:#16a34a">Positive</strong> = drafted LATER than ADP suggested (the player fell — bargain). '
             '<strong style="color:#dc2626">Negative</strong> = drafted EARLIER than ADP suggested (reach — paid premium).</p>')
    h.append('<div class="steals-reaches">')
    h.append('<div><h3 style="font-family:Bebas Neue;color:#16a34a;letter-spacing:1px;font-size:14pt;margin:0">TOP STEALS</h3>'
             '<table class="sr-table"><tr><th>Player</th><th>Pos</th><th>Team</th><th>Pick</th><th>ADP</th><th>Δ</th></tr>')
    for p, delta in steals:
        h.append(f'<tr><td><strong>{p["player_name"]}</strong></td>'
                 f'<td>{p["position"]}</td>'
                 f'<td>{team_idx_to_name(p["team_idx"])}</td>'
                 f'<td>{p["overall"]}</td>'
                 f'<td>{p["adp"]:.0f}</td>'
                 f'<td class="delta-pos">+{delta:.0f}</td></tr>')
    h.append('</table></div>')
    h.append('<div><h3 style="font-family:Bebas Neue;color:#dc2626;letter-spacing:1px;font-size:14pt;margin:0">TOP REACHES</h3>'
             '<table class="sr-table"><tr><th>Player</th><th>Pos</th><th>Team</th><th>Pick</th><th>ADP</th><th>Δ</th></tr>')
    for p, delta in reaches:
        h.append(f'<tr><td><strong>{p["player_name"]}</strong></td>'
                 f'<td>{p["position"]}</td>'
                 f'<td>{team_idx_to_name(p["team_idx"])}</td>'
                 f'<td>{p["overall"]}</td>'
                 f'<td>{p["adp"]:.0f}</td>'
                 f'<td class="delta-neg">{delta:.0f}</td></tr>')
    h.append('</table></div></div>')

    # ===== Position runs chart =====
    h.append('<h2>Position Runs</h2>')
    h.append('<p class="note">When did each position fly off the board? The slope shows the run.</p>')
    h.append(f'<img class="chart" src="{_data_uri(chart_paths["pos_runs"])}"/>')

    # ===== Team projection ranks =====
    h.append('<h2>Projected Roster Strength</h2>')
    h.append('<p class="note">Sum of half-PPR projections across the full 17-player roster. '
             'Imperfect (projections wobble), but a directional read.</p>')
    h.append(f'<img class="chart" src="{_data_uri(chart_paths["team_proj"])}"/>')

    # ===== Per-team cards =====
    h.append('<h2>Team-by-Team Boards</h2>')
    h.append('<div class="team-grid">')
    for ti in sorted(team_picks):
        h.append(render_team_card(ti, team_picks[ti]))
    h.append('</div>')

    h.append('</body></html>')
    return "\n".join(h)


def main():
    picks = json.loads((Path('/tmp/mock_draft_picks.json')).read_text())
    html = build_html(picks)

    import os
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "/opt/pw-browsers"
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROMIUM_EXEC,
                              args=["--no-sandbox", "--disable-dev-shm-usage"])
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        page.set_content(html, wait_until="networkidle")
        page.pdf(path=str(PDF_OUT), format="Letter", landscape=True,
                 margin={"top": "0.35in", "bottom": "0.35in",
                         "left": "0.35in", "right": "0.35in"},
                 print_background=True)
        b.close()
    print(f"Wrote {PDF_OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
