"""MONEYLEAGUE Summer 2026 Preseason GUAP Rankings.

Built post-2025 / pre-2026 draft. Power score = weighted blend of:
  - Recent form (Sleeper-era OVR composite)         35%
  - 2025 regular-season W-L                         25%
  - 2025 PPG                                        15%
  - 2026 early-round draft capital (R1-R3 picks)    15%
  - Momentum (2024 -> 2025 win pct change)          10%
"""
from __future__ import annotations

import base64
import json
import os
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

from fantasy_draft.results import load_all_seasons  # noqa: E402
from fantasy_draft.team_identity import (  # noqa: E402
    all_managers, manager_for_sleeper_roster,
)
from scripts import build_power_rankings as bpr  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PDF_OUT = ROOT / "data" / "MONEYLEAGUE_2026_PRESEASON.pdf"
CHART_DIR = ROOT / "data" / "charts" / "preseason"
CHART_DIR.mkdir(parents=True, exist_ok=True)
CHROMIUM_EXEC = bpr.CHROMIUM_EXEC

ROSTER_HANDOFFS = {(2025, 10): "josh_wildboy"}

# Brian's hot take per manager (in his voice — the GUAP take)
GUAP_TAKES = {
    "trevor_bergerboy": ("Defending Champ, Depleted Cupboard",
        "Won 2025 but mortgaged his future doing it. 0 R1s and 0 R2s for "
        "2026 — Kyle gutted him in the W6 deadline trade. Still the most "
        "consistent floor in the league, but the ceiling just got capped."),
    "coop": ("Quiet Contender",
        "Won 2024, slept through 2025 (.476). Now sitting on 1 R1, 2 R2s — "
        "enough capital to retool. History says he wakes up in odd years. "
        "Sneaky preseason pick."),
    "kyle_figgy": ("The Pick Hoarder",
        "Three R1s. THREE. Bought Trevor's championship and shipped him "
        "every garbage pick he owned. If his ceiling years align with his "
        "rookie draft, this is a coronation. If they don't, it's another "
        "10th-place finish."),
    "brower_barry": ("Year of the Choke Breakthrough?",
        "Three straight regular seasons winning the league. Three straight "
        "playoff exits. Still no rings. The data screams he should have 2 "
        "by now. Watch this card: either he finally gets one or we add "
        "'Brower Curse' to the league lexicon."),
    "ankur_patel": ("Came in Hot, Cooling Off",
        "Won as a rookie in 2022 and we've been waiting for round 2. "
        "Traded away his R1+R2 in 2025 to chase, ended up middling. "
        "Now picking late with no top-end capital. Bridge year."),
    "eric_m": ("Sleeping Giant",
        "2023 champ. Quiet 2024 + 2025 but he's a top-4 drafter when you "
        "control for slot. If he wakes up at the draft table, he's a "
        "playoff threat. Holds standard 1 R1/R2 capital."),
    "troy_mullings": ("The Mid Mid Mid",
        "Hasn't finished higher than 4th since his 2019 ring. Hasn't "
        "finished below 8th either. Lives in the dead-zone of fantasy "
        "football. Could break either way."),
    "brian_bigguap": ("Year 16 Begins",
        "15 years in, 0 rings. The most-traded manager in league history "
        "still chasing his white whale. Going into 2026 with standard "
        "capital and the league's deepest scar tissue. The story writes "
        "itself if he ever wins one."),
    "lem": ("Schedule-Luck Tax",
        "15 years, 0 rings, -0.80 schedule luck (worst in league). Sitting "
        "on 2 R2s and 2 R4s — actually decent capital. If the universe "
        "stops hating him, this could be his year."),
    "donnie": ("The Lottery Ticket",
        "Bottom of every meaningful chart for years, but now sitting on "
        "2 R1s after fleecing Tim. If you squint, there's a path. If you "
        "open your eyes, it's another double-digit-loss season."),
    "tim_breswick": ("Sold the Farm Early",
        "Already mortgaged his 2026 R1 in October trades. Long-snapper "
        "energy continues into year 10. Ceiling: 6th place. Floor: 12th."),
    "josh_wildboy": ("Year Two — Now It's His",
        "Inherited Dave's roster and went 9-5 last year on training wheels. "
        "Now it's his draft, his trades, his decisions. The Dave-legacy "
        "asterisk comes off — for better or worse."),
}


def _data_uri(path):
    if not Path(path).exists():
        return ""
    ext = str(path).lower().split(".")[-1]
    mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg"}.get(ext, "image/png")
    b = Path(path).read_bytes()
    return f"data:{mime};base64,{base64.b64encode(b).decode()}"


def _avatar_path(mid):
    p = ROOT / "data" / "charts" / "avatars" / f"{mid}.jpg"
    return p if p.exists() else None


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


def compute_pick_capital():
    """Returns {mid: {round: count}} of 2026 picks owned."""
    rid_to_mid = {m["sleeper_roster_id"]: m["id"]
                  for m in all_managers() if m.get("sleeper_roster_id")}
    def mgr(rid):
        return ROSTER_HANDOFFS.get((2025, rid)) or rid_to_mid.get(rid)

    picks = defaultdict(lambda: defaultdict(int))
    for rid in range(1, 13):
        mid = mgr(rid)
        if mid:
            for rnd in range(1, 18):
                picks[mid][rnd] += 1
    LG = "league_1245039290518360064"
    for f in sorted((ROOT / "data/sleeper" / LG / "transactions").glob("week_*.json")):
        for t in json.loads(f.read_text()):
            if t.get("type") != "trade" or t.get("status") != "complete":
                continue
            for pk in (t.get("draft_picks") or []):
                if str(pk.get("season")) != "2026":
                    continue
                orig = mgr(pk["previous_owner_id"])
                new = mgr(pk["owner_id"])
                rnd = pk["round"]
                if orig:
                    picks[orig][rnd] -= 1
                if new:
                    picks[new][rnd] += 1
    return picks


def compute_preseason_ranks():
    """Returns sorted list of dicts ranking managers heading into 2026."""
    sl = lambda y: 2023 <= y <= 2025
    stats_all = bpr.compute_career_stats(year_filter=sl)
    vbd_s, _ = bpr.compute_trade_vbd(year_filter=sl)
    draft_s = bpr.compute_draft_stats(year_filter=sl)
    sleeper_cards = bpr.build_madden_cards_sleeper(stats_all, vbd_s, {}, draft_s)
    sleeper_ovr = {c["mid"]: c["ovr"] for c in sleeper_cards}

    # 2025 specifics
    season_table = bpr.compute_season_table()
    pick_cap = compute_pick_capital()

    rows = []
    current_mids = [m["id"] for m in all_managers()
                    if m.get("sleeper_roster_id")] + ["josh_wildboy"]
    current_mids = list(dict.fromkeys(current_mids))

    for mid in current_mids:
        s2025 = season_table.get((2025, mid))
        if not s2025:
            continue
        s2024 = season_table.get((2024, mid))
        sleeper_ovr_v = sleeper_ovr.get(mid, 60)
        wpct_2025 = s2025["w"] / max(s2025["games"], 1)
        wpct_2024 = (s2024["w"] / max(s2024["games"], 1)) if s2024 else 0.5
        ppg_2025 = s2025["ppg"]
        early_picks = pick_cap[mid][1] + pick_cap[mid][2] + pick_cap[mid][3]
        momentum = wpct_2025 - wpct_2024

        rows.append({
            "mid": mid,
            "name": bpr._mgr_name(mid),
            "sleeper_ovr": sleeper_ovr_v,
            "wpct_2025": wpct_2025,
            "wl_2025": (s2025["w"], s2025["l"]),
            "ppg_2025": ppg_2025,
            "rank_2025": s2025["wins_rank"],
            "r1_2026": pick_cap[mid][1],
            "r2_2026": pick_cap[mid][2],
            "r3_2026": pick_cap[mid][3],
            "early_picks": early_picks,
            "momentum": momentum,
        })

    # Normalize each component 0-100
    def _norm(vals, lo_pct=1, hi_pct=99):
        vmin, vmax = min(vals), max(vals)
        return [(0 if vmax == vmin else (v - vmin) / (vmax - vmin)) * 100
                for v in vals]

    sov = _norm([r["sleeper_ovr"] for r in rows])
    wpc = _norm([r["wpct_2025"] for r in rows])
    ppg = _norm([r["ppg_2025"] for r in rows])
    cap = _norm([r["early_picks"] for r in rows])
    mom = _norm([r["momentum"] for r in rows])

    for i, r in enumerate(rows):
        score = (0.35 * sov[i] + 0.25 * wpc[i] + 0.15 * ppg[i]
                 + 0.15 * cap[i] + 0.10 * mom[i])
        r["sleeper_norm"] = round(sov[i])
        r["wpct_norm"] = round(wpc[i])
        r["ppg_norm"] = round(ppg[i])
        r["cap_norm"] = round(cap[i])
        r["mom_norm"] = round(mom[i])
        r["power_score"] = round(score, 1)

    rows.sort(key=lambda r: -r["power_score"])
    for rk, r in enumerate(rows, 1):
        r["preseason_rank"] = rk
    return rows


def chart_preseason_power(rows, path):
    _setup_mpl()
    s = sorted(rows, key=lambda r: r["power_score"])
    names = [r["name"] for r in s]
    vals = [r["power_score"] for r in s]
    colors = [bpr.mgr_color(r["mid"]) for r in s]
    fig, ax = plt.subplots(figsize=(9, 0.42 * len(s) + 1), dpi=140)
    bars = ax.barh(names, vals, color=colors, edgecolor="white", linewidth=1.4, height=0.72)
    for i, v in enumerate(vals):
        ax.text(v + 1, i, f"{v:.1f}", va="center", fontsize=10,
                fontweight="bold", color="#1a1d24")
    ax.set_xlim(0, max(vals) * 1.18)
    ax.set_xlabel("Preseason Power Score", fontweight="bold")
    ax.set_title("Summer 2026 GUAP Preseason Power Rankings",
                 loc="left", pad=14, fontsize=14)
    ax.grid(axis="x", linestyle="--", alpha=0.4)
    ax.set_axisbelow(True)
    plt.tight_layout()
    plt.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close()


def chart_pick_capital(rows, path):
    _setup_mpl()
    s = sorted(rows, key=lambda r: -(r["r1_2026"] * 3 + r["r2_2026"] * 2 + r["r3_2026"]))
    names = [r["name"] for r in s][::-1]
    r1 = [r["r1_2026"] for r in s][::-1]
    r2 = [r["r2_2026"] for r in s][::-1]
    r3 = [r["r3_2026"] for r in s][::-1]
    y = np.arange(len(s))
    fig, ax = plt.subplots(figsize=(9, 0.42 * len(s) + 1), dpi=140)
    ax.barh(y, r1, color="#0a3d62", edgecolor="white", linewidth=1.2, label="R1")
    ax.barh(y, r2, left=r1, color="#1f7a8c", edgecolor="white", linewidth=1.2, label="R2")
    ax.barh(y, r3, left=[a + b for a, b in zip(r1, r2)], color="#d4a017",
            edgecolor="white", linewidth=1.2, label="R3")
    ax.set_yticks(y)
    ax.set_yticklabels(names, fontweight="bold")
    for i, r in enumerate(s[::-1]):
        total = r["r1_2026"] + r["r2_2026"] + r["r3_2026"]
        ax.text(total + 0.1, i, f"R1×{r['r1_2026']} R2×{r['r2_2026']} R3×{r['r3_2026']}",
                va="center", fontsize=8.5, color="#3d405b")
    ax.set_xlabel("R1-R3 picks owned", fontweight="bold")
    ax.set_title("2026 Early-Round Draft Capital", loc="left", pad=14, fontsize=13)
    ax.legend(loc="lower right", frameon=False, fontsize=9)
    ax.grid(axis="x", linestyle="--", alpha=0.4)
    ax.set_axisbelow(True)
    plt.tight_layout()
    plt.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close()


def render_rank_card(r):
    color = bpr.mgr_color(r["mid"])
    label, body = GUAP_TAKES.get(r["mid"], ("?", "..."))
    av = _avatar_path(r["mid"])
    av_html = (f'<img class="avatar" src="{_data_uri(av)}"/>' if av else
               '<div class="avatar avatar-placeholder"></div>')
    mom_arrow = "↑" if r["momentum"] > 0.05 else ("↓" if r["momentum"] < -0.05 else "→")
    mom_color = "#16a34a" if r["momentum"] > 0.05 else ("#dc2626" if r["momentum"] < -0.05 else "#6b7280")
    return f"""
    <div class="rank-card">
      <div class="rank-head" style="background:linear-gradient(135deg, {color} 0%, {color}dd 100%)">
        <div class="rank-num">#{r['preseason_rank']}</div>
        {av_html}
        <div class="rank-name">
          <div class="player-name">{r['name']}</div>
          <div class="rank-label">{label}</div>
        </div>
        <div class="power-score"><div class="ps-num">{r['power_score']:.1f}</div><div class="ps-lbl">Power</div></div>
      </div>
      <div class="rank-body">
        <table class="rank-stats">
          <tr>
            <td>2025: <strong>{r['wl_2025'][0]}-{r['wl_2025'][1]}</strong> (#{r['rank_2025']})</td>
            <td>PPG <strong>{r['ppg_2025']:.1f}</strong></td>
            <td>Momentum <strong style="color:{mom_color}">{mom_arrow} {r['momentum']*100:+.0f}%</strong></td>
            <td>2026 R1-R3: <strong>{r['early_picks']}</strong> ({r['r1_2026']}/{r['r2_2026']}/{r['r3_2026']})</td>
          </tr>
        </table>
        <div class="rank-take">{body}</div>
      </div>
    </div>
    """


def build_html(rows, paths):
    today = date.today().strftime("%B %Y")
    css = """
    body { font-family: 'Inter', -apple-system, system-ui, sans-serif;
           max-width: 780px; margin: 18px auto; padding: 0 22px;
           color: #1a1d24; line-height: 1.5; font-size: 10.5pt; }
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
    .note { color: #6b7280; font-size: 9.5pt; margin: 2px 0 8px; }
    .chart { width: 100%; max-height: 5.5in; object-fit: contain;
             display: block; margin: 4px 0 8px; }
    .rank-card { border: 1px solid #e5e7eb; border-radius: 12px;
                 overflow: hidden; margin: 6px 0; box-shadow: 0 1px 4px rgba(0,0,0,0.06);
                 page-break-inside: avoid; }
    .rank-head { color: white; padding: 10px 14px; display: flex;
                 align-items: center; gap: 12px; }
    .rank-num { font-family: 'Bebas Neue', sans-serif; font-size: 28pt;
                font-weight: bold; min-width: 56px; line-height: 1;
                text-shadow: 0 2px 4px rgba(0,0,0,0.25); }
    .avatar { width: 42px; height: 42px; border-radius: 50%; object-fit: cover;
              border: 2.5px solid rgba(255,255,255,0.85); }
    .rank-name { flex: 1; }
    .player-name { font-size: 13pt; font-weight: 800; line-height: 1.1; }
    .rank-label { font-size: 9pt; opacity: 0.92; margin-top: 3px;
                  font-weight: 500; letter-spacing: 0.3px; }
    .power-score { text-align: center; min-width: 60px; }
    .ps-num { font-family: 'Bebas Neue', sans-serif; font-size: 22pt;
              font-weight: bold; line-height: 1; }
    .ps-lbl { font-size: 7.5pt; opacity: 0.85; letter-spacing: 0.5px;
              text-transform: uppercase; }
    .rank-body { padding: 8px 14px 10px; }
    .rank-stats { width: 100%; font-size: 9pt; color: #3d405b; }
    .rank-stats td { padding: 1px 4px; }
    .rank-take { font-size: 9.5pt; color: #1a1d24; margin-top: 6px;
                 line-height: 1.55; }
    @page { size: letter; margin: 0.45in; }
    """
    h = ['<!DOCTYPE html><html><head><meta charset="utf-8">',
         f'<style>{css}</style></head><body>']
    h.append('<div class="hero"><h1>2026 PRESEASON POWER RANKINGS</h1>'
             f'<p class="subtitle">{today} · MONEYLEAGUE · Big Guap\'s Hot Takes</p></div>')

    h.append('<h2>Preseason Power Score</h2>')
    h.append('<p class="note">Composite: 35% Sleeper-era OVR · 25% 2025 win% · '
             '15% 2025 PPG · 15% 2026 early-round pick capital · 10% momentum.</p>')
    h.append(f'<img class="chart" src="{_data_uri(paths["power"])}"/>')

    h.append('<h2>2026 Pick Capital</h2>')
    h.append('<p class="note">Who hoarded picks, who sold them. R1+R2+R3 only — '
             'where the meaningful rookie draft action happens.</p>')
    h.append(f'<img class="chart" src="{_data_uri(paths["capital"])}"/>')

    h.append('<h2>The Rankings (with GUAP Takes)</h2>')
    for r in rows:
        h.append(render_rank_card(r))

    h.append('</body></html>')
    return "\n".join(h)


def main():
    rows = compute_preseason_ranks()
    paths = {
        "power": CHART_DIR / "power.png",
        "capital": CHART_DIR / "capital.png",
    }
    chart_preseason_power(rows, paths["power"])
    chart_pick_capital(rows, paths["capital"])

    html = build_html(rows, paths)

    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "/opt/pw-browsers"
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROMIUM_EXEC,
                              args=["--no-sandbox", "--disable-dev-shm-usage"])
        ctx = b.new_context(viewport={"width": 820, "height": 1100})
        page = ctx.new_page()
        page.set_content(html, wait_until="networkidle")
        page.pdf(path=str(PDF_OUT), format="Letter",
                 margin={"top": "0.4in", "bottom": "0.4in",
                         "left": "0.4in", "right": "0.4in"},
                 print_background=True)
        b.close()
    print(f"Wrote {PDF_OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
