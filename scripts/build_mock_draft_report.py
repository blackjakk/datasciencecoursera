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
_SEASON_CFG = json.loads((ROOT / "configs" / "season_2026.json").read_text())
PREDICTED_SLOT_TO_RID = {
    int(k): v for k, v in _SEASON_CFG["slot_to_roster_id"].items()
}
SLOT_TO_RID = PREDICTED_SLOT_TO_RID
ROSTER_HANDOFFS = {
    tuple(int(x) for x in k.split(":")): v
    for k, v in _SEASON_CFG.get("roster_handoffs", {}).items()
}

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
    """Cumulative position picks over the draft. Skip K/DEF (all R16-R17)."""
    _setup_mpl()
    overall = sorted({p["overall"] for p in picks})
    cum = defaultdict(lambda: defaultdict(int))
    for p in picks:
        pos = p["position"] if p["position"] in POS_COLORS else "OTHER"
        cum[p["overall"]][pos] += 1
    running = defaultdict(int)
    series = defaultdict(list)
    x = []
    for o in overall:
        for pos in cum[o]:
            running[pos] += cum[o][pos]
        x.append(o)
        for pos in ["QB", "RB", "WR", "TE"]:
            series[pos].append(running[pos])
    fig, ax = plt.subplots(figsize=(9, 3.6), dpi=140)
    for pos in ["RB", "WR", "QB", "TE"]:
        ax.plot(x, series[pos], color=POS_COLORS[pos], linewidth=2.4,
                label=pos)
    ax.set_xlabel("Overall pick", fontweight="bold")
    ax.set_ylabel("Cumulative drafted", fontweight="bold")
    ax.set_title("Position Runs Over the Draft  ·  K + DEF excluded (all picked R16-R17)",
                 loc="left", pad=10, fontsize=12)
    ax.grid(linestyle="--", alpha=0.4)
    ax.set_axisbelow(True)
    ax.legend(loc="lower right", frameon=False, ncol=4)
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
    fig, ax = plt.subplots(figsize=(9, 0.32 * len(s) + 0.6), dpi=140)
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


def render_draft_board_html(picks, round_range=None):
    """Snake-order board. Each row = 1 round of 12 picks in actual draft order.
    Cells colored by the manager that MADE that pick (reflects pick trades).
    Column header shows pick_in_round (1..12)."""
    by_overall = {p["overall"]: p for p in picks}
    all_rounds = sorted({p["round"] for p in picks})
    if round_range:
        lo, hi = round_range
        rounds = [r for r in all_rounds if lo <= r <= hi]
    else:
        rounds = all_rounds
    NTEAMS = 12

    h = ['<table class="board">']
    # Header: R + pick number 1..12
    h.append('<thead><tr><th class="rd-col">R</th>')
    for col in range(1, NTEAMS + 1):
        h.append(f'<th class="pick-col">{col}</th>')
    h.append('</tr></thead><tbody>')

    for rnd in rounds:
        h.append(f'<tr><td class="rd-num">{rnd}</td>')
        # In snake order
        for col in range(1, NTEAMS + 1):
            overall = (rnd - 1) * NTEAMS + col
            cell = by_overall.get(overall)
            if not cell:
                h.append('<td class="empty">—</td>')
                continue
            pos = cell["position"]
            pos_color = POS_COLORS.get(pos, "#888")
            kept = ' k' if cell["is_keeper"] else ""
            mid = team_idx_to_mid(cell["team_idx"])
            team_color = bpr.mgr_color(mid) if mid else "#888"
            team_name = team_idx_to_name(cell["team_idx"])
            short = cell["player_name"]
            if " " in short:
                first, last = short.split(" ", 1)
                short = f"{first[0]}. {last}"
            short = short[:16]
            h.append(f'<td class="cell{kept}" style="background:{team_color}22;'
                     f'border-left:3px solid {team_color};border-top:2px solid {pos_color}">'
                     f'<span class="tname" style="color:{team_color}">{team_name}</span>'
                     f'<span class="pname">{short}</span>'
                     f'<span class="pos" style="color:{pos_color}">{pos}</span></td>')
        h.append('</tr>')
    h.append('</tbody></table>')
    return "\n".join(h)


def render_team_card(ti, team_picks):
    """Per-team roster summary — compact 2-column inner layout."""
    mid = team_idx_to_mid(ti)
    nm = team_idx_to_name(ti)
    color = bpr.mgr_color(mid) if mid else "#666"
    avatar = ROOT / "data/charts/avatars" / f"{mid}.jpg"
    av_html = (f'<img class="t-avatar" src="{_data_uri(avatar)}"/>'
               if avatar.exists() else '<div class="t-avatar"></div>')

    by_pos = defaultdict(list)
    total_proj = 0
    for p in team_picks:
        by_pos[p["position"]].append(p)
        total_proj += p["projection"]

    qbs = sorted(by_pos["QB"], key=lambda x: -x["projection"])
    rbs = sorted(by_pos["RB"], key=lambda x: -x["projection"])
    wrs = sorted(by_pos["WR"], key=lambda x: -x["projection"])
    tes = sorted(by_pos["TE"], key=lambda x: -x["projection"])
    starters = qbs[:1] + rbs[:2] + wrs[:3] + tes[:1]
    flex_pool = sorted(rbs[2:] + wrs[3:] + tes[1:], key=lambda x: -x["projection"])
    flex = flex_pool[:1]
    superflex_pool = sorted(qbs[1:] + flex_pool[1:], key=lambda x: -x["projection"])
    superflex = superflex_pool[:1]
    starter_set = set(id(p) for p in starters + flex + superflex)
    starter_pts = sum(p["projection"] for p in starters + flex + superflex)

    # Build ordered roster
    all_players = []
    for pos in ["QB", "RB", "WR", "TE", "K", "DEF"]:
        for p in sorted(by_pos.get(pos, []), key=lambda x: -x["projection"]):
            all_players.append(p)

    def cell_html(p):
        star = "*" if id(p) in starter_set else ""
        keep_tag = ' <span class="k-tag">K</span>' if p["is_keeper"] else ""
        row_color = POS_COLORS.get(p["position"], "#888")
        # Abbreviate first name
        nm = p["player_name"]
        if " " in nm:
            f, l = nm.split(" ", 1)
            if len(f) > 2:
                nm = f"{f[0]}. {l}"
        return (f'<tr><td style="color:{row_color};font-weight:700">{p["position"]}</td>'
                f'<td>{nm}{keep_tag}</td>'
                f'<td class="proj">{p["projection"]:.0f}{star}</td>'
                f'<td class="rd">R{p["round"]}</td></tr>')

    # 2-column inner layout (split ~half/half)
    half = (len(all_players) + 1) // 2
    left_rows = [cell_html(p) for p in all_players[:half]]
    right_rows = [cell_html(p) for p in all_players[half:]]
    while len(right_rows) < len(left_rows):
        right_rows.append('<tr><td colspan="4">&nbsp;</td></tr>')

    return f"""
    <div class="t-card" style="border-top:5px solid {color}">
      <div class="t-head">
        {av_html}
        <div class="t-name">{nm}</div>
        <div class="t-totals">
          <div class="t-tot">{total_proj:.0f}<span class="lbl">TOT</span></div>
          <div class="t-tot">{starter_pts:.0f}<span class="lbl">START</span></div>
        </div>
      </div>
      <div class="t-cols">
        <table class="t-table">{''.join(left_rows)}</table>
        <table class="t-table">{''.join(right_rows)}</table>
      </div>
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

    steals, reaches = find_steals_reaches(picks, top_n=10)

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
    .chart { width: 100%; max-height: 5.5in; object-fit: contain;
             display: block; margin: 4px 0 8px; }
    .chart-half { max-height: 3.4in; margin: 2px 0 4px; }
    .page-break { page-break-after: always; height: 0; }
    .board { width: 100%; border-collapse: separate; border-spacing: 1px;
             font-size: 7pt; table-layout: fixed;
             page-break-inside: avoid; }
    .board th { background: #0a3d62; color: white; padding: 2px 2px;
                font-weight: 700; font-size: 7.5pt; }
    .pick-col { font-family: 'Bebas Neue', sans-serif; }
    .rd-col { width: 22px; }
    .rd-num { background: #0a3d62; color: white; font-weight: 700;
              text-align: center; font-family: 'Bebas Neue', sans-serif;
              font-size: 11pt; }
    .cell { padding: 2px 4px; border-radius: 3px;
            font-size: 7pt; line-height: 1.1; }
    .cell.k { background: #fef3c7 !important;
              border-left: 3px solid #d4a017 !important; }
    .tname { display: block; font-size: 5.5pt; font-weight: 700;
             letter-spacing: 0.3px; text-transform: uppercase;
             line-height: 1; }
    .pname { display: block; font-weight: 700; color: #1a1d24;
             margin-top: 1px; font-size: 7.5pt; line-height: 1.05; }
    .pos { font-size: 5.5pt; font-weight: 700; opacity: 0.7;
           line-height: 1; }
    .empty { color: #d1d5db; text-align: center; font-size: 7pt;
             background: #f9fafb; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 24px;
               margin-top: 8px; }
    .mc-summary { font-size: 9pt; color: #3d405b; margin: 0 0 6px;
                  padding: 4px 8px; background: #f9fafb; border-radius: 6px;
                  border-left: 4px solid #0a3d62; }
    .mc-table { width: 100%; font-size: 9pt; }
    .mc-table th { background: #0a3d62; color: white; padding: 5px 8px;
                   text-align: left; }
    .mc-table td { padding: 4px 8px; border-bottom: 1px solid #f0f0f0; }
    .mc-table .rd { background: #f9fafb; font-weight: 700; width: 36px;
                    color: #0a3d62; }
    .pct { color: #6b7280; font-weight: 600; font-size: 8.5pt; }
    .mc-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
               margin-top: 6px; }
    .mc-card { border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden;
               page-break-inside: avoid; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
    .mc-head { background: #f9fafb; padding: 4px 8px; display: flex;
               align-items: center; gap: 6px; }
    .mc-avatar { width: 22px; height: 22px; border-radius: 50%;
                 object-fit: cover; flex-shrink: 0; }
    .mc-name { font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.4px;
               font-size: 11pt; flex: 1; }
    .mc-tot { font-family: 'Bebas Neue', sans-serif; font-size: 11pt;
              color: #0a3d62; line-height: 1; text-align: right; }
    .mc-tot .lbl { display: block; font-size: 6pt; letter-spacing: 0.3px;
                   color: #6b7280; font-family: 'Inter', sans-serif;
                   text-transform: uppercase; font-weight: 600; }
    .mc-mini { width: 100%; font-size: 7pt; }
    .mc-mini td { padding: 1px 4px; border-bottom: 1px solid #f9fafb;
                  line-height: 1.3; }
    .mc-mini .r { color: #6b7280; font-weight: 700; width: 22px;
                  font-family: 'Bebas Neue', sans-serif; font-size: 8.5pt; }
    .mc-mini .pct { text-align: right; color: #16a34a; font-weight: 700;
                    width: 28px; }
    .steals-reaches { display: grid; grid-template-columns: 1fr 1fr;
                      gap: 16px; }
    .sr-table { width: 100%; font-size: 9pt; border-collapse: collapse; }
    .sr-table th { background: #e5e7eb; padding: 4px 6px; text-align: left;
                   font-size: 8pt; }
    .sr-table td { padding: 3px 6px; border-bottom: 1px solid #f0f0f0; }
    .sr-table .delta-pos { color: #16a34a; font-weight: 700; }
    .sr-table .delta-neg { color: #dc2626; font-weight: 700; }
    .team-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
                 margin: 8px 0; }
    .t-card { border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;
              page-break-inside: avoid; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .t-head { display: flex; align-items: center; gap: 6px; padding: 5px 8px;
              background: #f9fafb; }
    .t-avatar { width: 26px; height: 26px; border-radius: 50%; object-fit: cover;
                background: #d1d5db; flex-shrink: 0; }
    .t-name { font-family: 'Bebas Neue', sans-serif; font-size: 12pt;
              letter-spacing: 0.4px; flex: 1; }
    .t-totals { display: flex; gap: 6px; }
    .t-tot { font-family: 'Bebas Neue', sans-serif; font-size: 13pt;
             color: #0a3d62; text-align: right; line-height: 1; }
    .t-tot .lbl { display: block; font-size: 6pt; letter-spacing: 0.3px;
                  color: #6b7280; font-family: 'Inter', sans-serif;
                  text-transform: uppercase; font-weight: 600;
                  margin-top: 1px; }
    .t-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
    .t-cols .t-table { border-left: 1px solid #f0f0f0; }
    .t-cols .t-table:first-child { border-left: none; }
    .t-table { width: 100%; font-size: 7.5pt; }
    .t-table td { padding: 0px 5px; border-bottom: 1px solid #f9fafb;
                  line-height: 1.25; }
    .t-table .proj { text-align: right; font-weight: 700; color: #1a1d24;
                     width: 32px; }
    .t-table .rd { text-align: right; color: #9ca3af; font-size: 6.5pt;
                   width: 24px; }
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

    # ===== Draft board — split into 2 halves =====
    h.append('<h2>The Board · R1–R9</h2>')
    h.append('<p class="note">Yellow cells = keepers. Color stripe = position. '
             'Projected by recursive auto-pick (best VBD × positional need × roster fit).</p>')
    h.append('<div class="legend">')
    for pos, color in POS_COLORS.items():
        h.append(f'<div class="legend-item"><div class="legend-dot" '
                 f'style="background:{color}"></div>{pos}</div>')
    h.append('</div>')
    h.append(render_draft_board_html(picks, round_range=(1, 9)))
    h.append('<div class="page-break"></div>')

    h.append('<h2>The Board · R10–R17</h2>')
    h.append('<p class="note">Late-round depth, handcuffs, K/DEF.</p>')
    h.append(render_draft_board_html(picks, round_range=(10, 17)))
    h.append('<div class="page-break"></div>')

    # ===== Steals/Reaches first (compact, one page) =====
    h.append('<h2>Steals &amp; Reaches</h2>')
    h.append('<p class="note">ADP δ = pick − ADP. '
             '<strong style="color:#16a34a">Positive</strong> = fell (steal). '
             '<strong style="color:#dc2626">Negative</strong> = reach.</p>')
    h.append('<div class="two-col">')
    h.append('<div><h3 style="font-family:Bebas Neue;color:#16a34a;font-size:13pt;margin:0 0 4px;letter-spacing:0.5px">TOP STEALS</h3>'
             '<table class="sr-table"><tr><th>Player</th><th>Pos</th><th>Team</th><th>Pick</th><th>ADP</th><th>Δ</th></tr>')
    for p, delta in steals:
        h.append(f'<tr><td><strong>{p["player_name"]}</strong></td>'
                 f'<td>{p["position"]}</td>'
                 f'<td>{team_idx_to_name(p["team_idx"])}</td>'
                 f'<td>{p["overall"]}</td>'
                 f'<td>{p["adp"]:.0f}</td>'
                 f'<td class="delta-pos">+{delta:.0f}</td></tr>')
    h.append('</table></div>')
    h.append('<div><h3 style="font-family:Bebas Neue;color:#dc2626;font-size:13pt;margin:0 0 4px;letter-spacing:0.5px">TOP REACHES</h3>'
             '<table class="sr-table"><tr><th>Player</th><th>Pos</th><th>Team</th><th>Pick</th><th>ADP</th><th>Δ</th></tr>')
    for p, delta in reaches:
        h.append(f'<tr><td><strong>{p["player_name"]}</strong></td>'
                 f'<td>{p["position"]}</td>'
                 f'<td>{team_idx_to_name(p["team_idx"])}</td>'
                 f'<td>{p["overall"]}</td>'
                 f'<td>{p["adp"]:.0f}</td>'
                 f'<td class="delta-neg">{delta:.0f}</td></tr>')
    h.append('</table></div></div>')
    h.append('<div class="page-break"></div>')

    # ===== Monte Carlo: ALL 12 managers' pick distributions =====
    mc_all_path = ROOT / "data" / "mc_summary_all.json"
    if mc_all_path.exists():
        mc_all = json.loads(mc_all_path.read_text())
        n_sims = mc_all.get("n_sims", 50)
        h.append('<h2>Monte Carlo — Pick Distributions (All Teams)</h2>')
        h.append(f'<p class="note">{n_sims} sims with softmax sampling (temp=0.35) + '
                 'keeper-biased VBD scoring. For each manager, the most-likely pick per round '
                 'with confidence %. <strong>High %</strong> = consensus call. '
                 '<strong>Low % spread across many names</strong> = high variance / many viable options.</p>')

        per_team = mc_all.get("per_team", {})
        # Order managers by predicted draft slot (1..12)
        # team_idx 0..11 corresponds to slot 1..12
        h.append('<div class="mc-grid">')
        for ti in range(12):
            data = per_team.get(str(ti), {})
            mid = team_idx_to_mid(ti)
            nm = team_idx_to_name(ti)
            color = bpr.mgr_color(mid) if mid else "#666"
            avatar = ROOT / "data/charts/avatars" / f"{mid}.jpg"
            av_html = (f'<img class="mc-avatar" src="{_data_uri(avatar)}"/>'
                       if avatar.exists() else '')
            h.append(f'<div class="mc-card" style="border-top:5px solid {color}">')
            h.append(f'<div class="mc-head">{av_html}<span class="mc-name">{nm}</span>'
                     f'<span class="mc-tot">{data.get("mean",0):.0f}<span class="lbl">MEAN</span></span></div>')
            h.append('<table class="mc-mini">')
            # Use the representative-sim roster (an internally-consistent draft
            # closest to the team's mean total), not the modal-per-slot which
            # could double-count positions across non-consistent sims.
            rep = data.get("representative_roster")
            if rep:
                # Determine if any round has multiple picks so we can label
                # R1·1 / R1·2 when traded picks stack a round.
                round_counts: dict[int, int] = {}
                for entry in rep:
                    round_counts[entry["round"]] = round_counts.get(entry["round"], 0) + 1
                for entry in rep:
                    nm_top = entry["player"]
                    pct = int(round(entry["pct"]))
                    rnd = entry["round"]
                    seq = entry["seq"]
                    p_abbrev = nm_top
                    if " " in p_abbrev:
                        f, l = p_abbrev.split(" ", 1)
                        if len(f) > 2:
                            p_abbrev = f"{f[0]}. {l}"
                    p_abbrev = p_abbrev[:18]
                    rnd_label = (f"R{rnd}" if round_counts.get(rnd, 1) == 1
                                 else f"R{rnd}·{seq+1}")
                    h.append(f'<tr><td class="r">{rnd_label}</td>'
                             f'<td><strong>{p_abbrev}</strong></td>'
                             f'<td class="pct">{pct}%</td></tr>')
            else:
                # Legacy fallback: modal pick per slot (older mc_summary files).
                for rnd in sorted(int(r) for r in data.get("pick_distribution", {})):
                    slots = data["pick_distribution"][str(rnd)]
                    if isinstance(slots, dict):
                        slots = [slots]
                    for seq, dist in enumerate(slots):
                        if not dist:
                            continue
                        nm_top, cnt = max(dist.items(), key=lambda kv: kv[1])
                        pct = cnt * 100 // n_sims
                        p_abbrev = nm_top
                        if " " in p_abbrev:
                            f, l = p_abbrev.split(" ", 1)
                            if len(f) > 2:
                                p_abbrev = f"{f[0]}. {l}"
                        p_abbrev = p_abbrev[:18]
                        rnd_label = f"R{rnd}" if len(slots) == 1 else f"R{rnd}·{seq+1}"
                        h.append(f'<tr><td class="r">{rnd_label}</td>'
                                 f'<td><strong>{p_abbrev}</strong></td>'
                                 f'<td class="pct">{pct}%</td></tr>')
            h.append('</table></div>')
        h.append('</div>')
        h.append('<div class="page-break"></div>')

    # ===== Position runs + Roster strength on one page =====
    h.append('<h2>Position Runs &amp; Roster Strength</h2>')
    h.append('<p class="note"><strong>Top:</strong> when each position flew off the board. '
             '<strong>Bottom:</strong> projected total roster pts (full 17-player roster).</p>')
    h.append(f'<img class="chart chart-half" src="{_data_uri(chart_paths["pos_runs"])}"/>')
    h.append(f'<img class="chart chart-half" src="{_data_uri(chart_paths["team_proj"])}"/>')
    h.append('<div class="page-break"></div>')

    # ===== Per-team cards =====
    h.append('<h2>Team-by-Team Boards</h2>')
    h.append('<div class="team-grid">')
    for ti in sorted(team_picks):
        h.append(render_team_card(ti, team_picks[ti]))
    h.append('</div>')

    h.append('</body></html>')
    return "\n".join(h)


def main():
    picks = json.loads((ROOT / "data" / "mock_draft_picks.json").read_text())
    html = build_html(picks)

    import os
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
