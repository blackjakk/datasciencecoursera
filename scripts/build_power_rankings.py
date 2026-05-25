"""MONEYLEAGUE Power Rankings — Madden cards + Trade Behavior combined.

Active long-tenure managers only (5+ years, still rostered). Composite OVR
weights: Rings 35%, Win% 25%, PPG 15%, Trade VBD 15%, Longevity 10%.
"""
from __future__ import annotations

import json
import math
import re
import sys
import unicodedata
from collections import defaultdict
from datetime import date
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
from matplotlib.offsetbox import OffsetImage, AnnotationBbox
import matplotlib.image as mpimg
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.results import load_all_seasons  # noqa: E402
from fantasy_draft.team_identity import (  # noqa: E402
    all_managers, manager_for_sleeper_roster,
)

ROOT = Path(__file__).resolve().parent.parent
PDF_OUT = ROOT / "data" / "MONEYLEAGUE_POWER_RANKINGS.pdf"
MD_OUT = ROOT / "data" / "MONEYLEAGUE_POWER_RANKINGS.md"
CHART_DIR = ROOT / "data" / "charts" / "rankings"
CHART_DIR.mkdir(parents=True, exist_ok=True)

# Modern color palette
PALETTE = {
    "gold": "#d4a017", "navy": "#0a3d62", "teal": "#1f7a8c",
    "emerald": "#2d6a4f", "orange": "#dd6e42", "crimson": "#a23737",
    "slate": "#3d405b", "cream": "#f7f4ea", "ink": "#1a1d24",
    "gray": "#6b7280",
}

# Per-manager brand colors — stable across every chart
MANAGER_COLORS = {
    "trevor_bergerboy": "#2d6a4f",  # forest
    "coop":             "#1f3a5f",  # navy
    "dave_aka_wang":    "#8b1e3f",  # wine
    "kyle_figgy":       "#f59e0b",  # gold
    "brower_barry":     "#0891b2",  # teal
    "ankur_patel":      "#7c3aed",  # purple
    "eric_m":           "#dc2626",  # red
    "troy_mullings":    "#15803d",  # green
    "brian_bigguap":    "#1e40af",  # royal blue
    "lem":              "#65a30d",  # lime
    "donnie":           "#9a3412",  # rust
    "tim_breswick":     "#0f172a",  # ink
    "josh_wildboy":     "#a855f7",  # violet
    "nark":             "#78716c",  # stone
    "jp_former":        "#525252",  # gray
    "nick_lewis_left":  "#737373",  # gray
    "notebooks_left":   "#a3a3a3",  # silver
}


def mgr_color(mid):
    return MANAGER_COLORS.get(mid, PALETTE["gray"])


def _register_fonts():
    """Add Inter + Bebas Neue to matplotlib."""
    for f in (ROOT / "data" / "fonts").glob("*.ttf"):
        try:
            fm.fontManager.addfont(str(f))
        except Exception:
            pass


_register_fonts()


def _avatar_path(mid):
    p = ROOT / "data" / "charts" / "avatars" / f"{mid}.jpg"
    return p if p.exists() else None

# Reuse build_trades_report helpers
from scripts import build_trades_report as btr  # noqa: E402
from scripts.build_history_charts import KNOWN_CHAMPIONS  # noqa: E402

ROSTER_HANDOFFS = {(2023, 10): "dave_aka_wang",
                    (2024, 10): "dave_aka_wang",
                    (2025, 10): "josh_wildboy"}

MIN_YEARS_CURRENT = 5     # current managers need 5+ years
MIN_YEARS_FORMER = 10     # former managers need 10+ years (e.g. Dave Wang)


def _mgr_name(mid):
    for m in all_managers():
        if m["id"] == mid:
            return m["canonical_name"].split(" (")[0]
    return mid


def _norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().strip()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()


def compute_career_stats(year_filter=None):
    """Per-manager: years, wins, losses, fpts, ppg, rings.
    year_filter: callable(year) -> bool to scope to subset of seasons.
    """
    ytm = {}
    for m in all_managers():
        for yr, tn in (m.get("yahoo_team_names") or {}).items():
            if yr == "_note" or not tn:
                continue
            ytm[(int(yr), tn.strip().lower())] = m["id"]

    wl = defaultdict(lambda: [0, 0])
    fpts = defaultdict(float)
    years = defaultdict(set)

    # Yahoo
    for f in sorted((ROOT / "data" / "yahoo").glob("league_*/matchups_*.json")):
        yr = int(f.stem.split("_")[1])
        if year_filter and not year_filter(yr):
            continue
        d = json.loads(f.read_text())
        teams = d.get("teams", {})
        tid_to_mgr = {}
        for tid, name in teams.items():
            mid = ytm.get((yr, name.strip().lower()))
            if mid:
                tid_to_mgr[int(tid)] = mid
                years[mid].add(yr)
        n_teams = len(teams)
        reg_end = 14 if n_teams == 12 else 13
        for wk_str, games in d.get("weeks", {}).items():
            if int(wk_str) > reg_end:
                continue
            for g in games:
                ma = tid_to_mgr.get(g["team_a"])
                mb = tid_to_mgr.get(g["team_b"])
                if not (ma and mb):
                    continue
                fpts[ma] += g["pts_a"]
                fpts[mb] += g["pts_b"]
                if g["winner"] == g["team_a"]:
                    wl[ma][0] += 1
                    wl[mb][1] += 1
                elif g["winner"] == g["team_b"]:
                    wl[mb][0] += 1
                    wl[ma][1] += 1

    # Sleeper
    rings = defaultdict(int)
    for yr, mid in KNOWN_CHAMPIONS.items():
        if year_filter and not year_filter(yr):
            continue
        rings[mid] += 1
    for season, s in load_all_seasons().items():
        if year_filter and not year_filter(season):
            continue
        for rid, r in s["rosters"].items():
            m = manager_for_sleeper_roster(int(rid))
            mid = ROSTER_HANDOFFS.get((season, int(rid)),
                                      m["id"] if m else None)
            if not mid:
                continue
            wl[mid][0] += r["wins"]
            wl[mid][1] += r["losses"]
            fpts[mid] += r["fpts"]
            years[mid].add(season)
        rid = s.get("champion_roster_id")
        if rid and season not in KNOWN_CHAMPIONS:
            m = manager_for_sleeper_roster(int(rid))
            mid = ROSTER_HANDOFFS.get((season, int(rid)),
                                      m["id"] if m else None)
            if mid:
                rings[mid] += 1

    out = {}
    for mid, ys in years.items():
        w, l = wl[mid]
        games = w + l
        out[mid] = {
            "years": sorted(ys),
            "n_years": len(ys),
            "first": min(ys), "last": max(ys),
            "w": w, "l": l, "fpts": fpts[mid],
            "winpct": w / games if games else 0,
            "ppg": fpts[mid] / games if games else 0,
            "rings": rings[mid],
        }
    return out


def compute_draft_stats(year_filter=None):
    """Returns {mid: {'pts': total_rookie_pts, 'picks': n_picks, 'ppp': pts_per_pick}}."""
    nfl = btr._load_nflverse()
    sleeper_names = btr._load_sleeper_players()
    ynm = btr._yahoo_name_lookup()
    mgr_rid_to_id = {m["sleeper_roster_id"]: m["id"]
                     for m in all_managers() if m.get("sleeper_roster_id")}

    import csv
    pts_by_mgr = defaultdict(float)
    picks_by_mgr = defaultdict(int)

    # Yahoo draft CSVs (2015-2022)
    for f in sorted((ROOT / "data" / "yahoo").glob("league_*/draft_*.csv")):
        with open(f) as fh:
            for row in csv.DictReader(fh):
                yr = int(row["season"])
                if yr not in btr.NFL_SCORED_YEARS:
                    continue
                if year_filter and not year_filter(yr):
                    continue
                tn = row["team_name"].strip().lower()
                mid = ynm.get((yr, tn))
                if not mid:
                    continue
                player = row.get("player_name") or ""
                if not player:
                    continue
                picks_by_mgr[mid] += 1
                pts_by_mgr[mid] += nfl.get((yr, _norm(player)), 0)

    # Sleeper drafts
    for lg in ["league_1001657805583077376",
               "league_1085805164784664576",
               "league_1245039290518360064"]:
        d_idx = json.loads((ROOT / "data/sleeper" / lg / "drafts.json").read_text())
        for d in d_idx:
            picks_f = (ROOT / "data/sleeper" / lg /
                        f"draft_{d['draft_id']}_picks.json")
            if not picks_f.exists():
                continue
            picks = json.loads(picks_f.read_text())
            season = int(d["season"])
            if season not in btr.NFL_SCORED_YEARS:
                continue
            if year_filter and not year_filter(season):
                continue
            for p in picks:
                rid = int(p.get("roster_id") or 0)
                mid = ROSTER_HANDOFFS.get((season, rid)) or mgr_rid_to_id.get(rid)
                if not mid:
                    continue
                pid = p.get("player_id")
                name = sleeper_names.get(pid, "") if pid else ""
                picks_by_mgr[mid] += 1
                if name:
                    pts_by_mgr[mid] += nfl.get((season, _norm(name)), 0)

    out = {}
    for mid in picks_by_mgr:
        n = picks_by_mgr[mid]
        out[mid] = {"pts": pts_by_mgr[mid], "picks": n,
                    "ppp": pts_by_mgr[mid] / n if n else 0}
    return out


def compute_trade_vbd(year_filter=None):
    """Returns ({mid: net_vbd}, {mid: n_trades})."""
    nfl = btr._load_nflverse()
    sleeper_names = btr._load_sleeper_players()
    spp = btr._build_sleeper_pick_resolver()
    ypp = btr._build_yahoo_pick_resolver()
    ynm = btr._yahoo_name_lookup()
    mgr_rid = {m["id"]: m["sleeper_roster_id"]
               for m in all_managers() if m.get("sleeper_roster_id")}

    def score(side, source, year, giver):
        pts = sum(nfl.get((year, _norm(p["name"])), 0)
                  for p in side.get("received_players", []))
        for pk in side.get("received_picks", []):
            rnd = pk.get("round")
            if not rnd:
                continue
            if source == "sleeper":
                season = int(pk.get("season") or 0)
                orig = pk.get("previous_owner_id") or pk.get("roster_id")
                if not (season and orig):
                    continue
                pid = spp.get((season, rnd, orig))
                n = sleeper_names.get(pid, "") if pid else ""
                if n:
                    pts += nfl.get((season, _norm(n)), 0)
            else:
                ty = year + 1
                of = (pk.get("originally_from") or "").rstrip("?").strip().lower()
                om = ynm.get((year, of)) if of else None
                om = om or giver
                pl = ypp.get((ty, rnd, om))
                if pl:
                    pts += nfl.get((ty, _norm(pl)), 0)
                elif ty >= 2023:
                    r = mgr_rid.get(om)
                    if r:
                        pid = spp.get((ty, rnd, r))
                        n = sleeper_names.get(pid, "") if pid else ""
                        if n:
                            pts += nfl.get((ty, _norm(n)), 0)
        return pts

    trades = btr._load_all_trades()
    vbd = defaultdict(float)
    n = defaultdict(int)
    for t in trades:
        if t["year"] not in btr.NFL_SCORED_YEARS:
            continue
        if year_filter and not year_filter(t["year"]):
            continue
        pa = score(t["side_a"], t["source"], t["year"], t["side_b_mgr"])
        pb = score(t["side_b"], t["source"], t["year"], t["side_a_mgr"])
        vbd[t["side_a_mgr"]] += (pa - pb)
        vbd[t["side_b_mgr"]] += (pb - pa)
        n[t["side_a_mgr"]] += 1
        n[t["side_b_mgr"]] += 1
    return vbd, n


def _scale(val, lo, hi, lo_rating=50, hi_rating=99):
    if hi == lo:
        return (lo_rating + hi_rating) // 2
    r = (val - lo) / (hi - lo)
    r = max(0, min(1, r))
    return int(round(lo_rating + r * (hi_rating - lo_rating)))


def is_current(mid):
    """Currently rostered in Sleeper (2025)?"""
    for m in all_managers():
        if m["id"] == mid and m.get("sleeper_roster_id"):
            return True
    return False


def build_madden_cards(stats, vbd, vbd_n, draft):
    """Returns list of card dicts with all ratings + OVR."""
    # Current 5y+ OR long-tenured former (10y+)
    pool = {mid: s for mid, s in stats.items()
            if (s["n_years"] >= MIN_YEARS_CURRENT and is_current(mid))
            or s["n_years"] >= MIN_YEARS_FORMER}
    if not pool:
        return []

    def _safe(getter, default=0):
        vals = [getter(mid) for mid in pool]
        return (min(vals), max(vals)) if vals else (default, default)

    rng = {
        "rings": (0, max(s["rings"] for s in pool.values())),
        "winpct": _safe(lambda m: pool[m]["winpct"]),
        "ppg": _safe(lambda m: pool[m]["ppg"]),
        "vbd": _safe(lambda m: vbd.get(m, 0)),
        "yrs": _safe(lambda m: pool[m]["n_years"]),
        "ppp": _safe(lambda m: draft.get(m, {}).get("ppp", 0)),
    }

    cards = []
    for mid, s in pool.items():
        rings = _scale(s["rings"], 0, max(rng["rings"][1], 1), 50, 99)
        winp = _scale(s["winpct"], rng["winpct"][0], rng["winpct"][1])
        ppg = _scale(s["ppg"], rng["ppg"][0], rng["ppg"][1])
        trd = _scale(vbd.get(mid, 0), rng["vbd"][0], rng["vbd"][1], 40, 99)
        lng = _scale(s["n_years"], rng["yrs"][0], rng["yrs"][1])
        d = draft.get(mid, {"pts": 0, "picks": 0, "ppp": 0})
        drf = _scale(d["ppp"], rng["ppp"][0], rng["ppp"][1])
        # Weights: Rings 30, Win% 20, PPG 12, Trade 13, Draft 17, Long 8
        ovr = round(0.30 * rings + 0.20 * winp + 0.12 * ppg
                    + 0.13 * trd + 0.17 * drf + 0.08 * lng)
        cards.append({
            "mid": mid, "name": _mgr_name(mid), "ovr": ovr,
            "rings_rating": rings, "winp_rating": winp,
            "ppg_rating": ppg, "trade_rating": trd,
            "draft_rating": drf, "long_rating": lng,
            "rings": s["rings"], "winpct": s["winpct"], "ppg": s["ppg"],
            "trade_vbd": vbd.get(mid, 0), "trade_n": vbd_n.get(mid, 0),
            "draft_ppp": d["ppp"], "draft_picks": d["picks"],
            "years": s["n_years"], "w": s["w"], "l": s["l"],
            "is_current": is_current(mid),
        })
    cards.sort(key=lambda c: -c["ovr"])
    return cards


def tier(ovr):
    if ovr >= 90:
        return "Franchise"
    if ovr >= 85:
        return "Star"
    if ovr >= 80:
        return "Pro Bowler"
    if ovr >= 75:
        return "Solid Starter"
    if ovr >= 65:
        return "Depth"
    return "Bench"


def tier_color(ovr):
    if ovr >= 90:
        return "#b8860b"  # gold
    if ovr >= 85:
        return "#1f7a4d"  # green
    if ovr >= 80:
        return "#c08810"  # yellow
    if ovr >= 75:
        return "#c0540a"  # orange
    if ovr >= 65:
        return "#7a4a1f"  # brown
    return "#a02020"  # red


def archetype(card):
    """Madden-style descriptor based on the card's profile."""
    s = card
    if s["rings"] >= 3 and s["years"] >= 12:
        return "Iron-man 3-Ring Vet"
    if s["rings"] >= 2 and s["trade_vbd"] >= 1000:
        return "Franchise Player"
    if s["rings"] >= 2:
        return "Multi-Ring Vet"
    if s["winpct"] >= 0.60 and s["rings"] == 0:
        return "Regular-Season MVP, No Lombardi"
    if s["years"] <= 6 and s["rings"] >= 1:
        return "Rookie Champion"
    if s["rings"] == 1 and s["winpct"] < 0.40:
        return "Lucky-Ring Owner"
    if s["winpct"] < 0.40:
        return "Cellar Dweller"
    if s["rings"] == 0 and s["winpct"] >= 0.50:
        return "Steady Vet, Still Chasing"
    if s["rings"] == 0:
        return "Long-Tenured Underdog"
    return "Solid Pro"


def render_card_html(c):
    color = mgr_color(c["mid"])
    arch = archetype(c)
    badge = "" if c.get("is_current", True) else ' <span class="badge-fmr">FMR</span>'
    av = _avatar_path(c["mid"])
    av_html = (f'<img class="avatar" src="file://{av}"/>'
               if av else '<div class="avatar avatar-placeholder"></div>')
    return f"""
    <div class="card">
      <div class="card-head" style="background:linear-gradient(135deg, {color} 0%, {color}dd 100%)">
        <div class="ovr">{c['ovr']}</div>
        {av_html}
        <div class="card-name">
          <div class="player-name">{c['name']}{badge}</div>
          <div class="archetype">{arch} · {tier(c['ovr'])}</div>
        </div>
      </div>
      <div class="card-body">
        <table class="attr-table">
          <tr><td class="attr">RING</td><td class="bar"><div class="bar-fill" style="width:{c['rings_rating']}%;background:{color}"></div></td><td class="val">{c['rings_rating']}</td><td class="raw">{c['rings']} ring{'s' if c['rings']!=1 else ''}</td></tr>
          <tr><td class="attr">WIN%</td><td class="bar"><div class="bar-fill" style="width:{c['winp_rating']}%;background:{color}"></div></td><td class="val">{c['winp_rating']}</td><td class="raw">{c['w']}-{c['l']} ({c['winpct']:.3f})</td></tr>
          <tr><td class="attr">PPG</td><td class="bar"><div class="bar-fill" style="width:{c['ppg_rating']}%;background:{color}"></div></td><td class="val">{c['ppg_rating']}</td><td class="raw">{c['ppg']:.1f}</td></tr>
          <tr><td class="attr">DRFT</td><td class="bar"><div class="bar-fill" style="width:{c['draft_rating']}%;background:{color}"></div></td><td class="val">{c['draft_rating']}</td><td class="raw">{c['draft_ppp']:.1f}/pick · {c['draft_picks']}p</td></tr>
          <tr><td class="attr">TRADE</td><td class="bar"><div class="bar-fill" style="width:{c['trade_rating']}%;background:{color}"></div></td><td class="val">{c['trade_rating']}</td><td class="raw">{c['trade_vbd']:+.0f} ({c['trade_n']}t)</td></tr>
          <tr><td class="attr">LONG</td><td class="bar"><div class="bar-fill" style="width:{c['long_rating']}%;background:{color}"></div></td><td class="val">{c['long_rating']}</td><td class="raw">{c['years']} yrs</td></tr>
        </table>
      </div>
    </div>
    """


def build_madden_cards_sleeper(stats, vbd, vbd_n, draft):
    """Sleeper-era only: include all 12 current rosters."""
    pool = {mid: s for mid, s in stats.items()
            if s["n_years"] >= 1 and is_current(mid)}
    if not pool:
        return []

    def _safe(getter):
        vals = [getter(mid) for mid in pool]
        return (min(vals), max(vals)) if vals else (0, 0)

    rng = {
        "rings": (0, max(s["rings"] for s in pool.values()) or 1),
        "winpct": _safe(lambda m: pool[m]["winpct"]),
        "ppg": _safe(lambda m: pool[m]["ppg"]),
        "vbd": _safe(lambda m: vbd.get(m, 0)),
        "yrs": _safe(lambda m: pool[m]["n_years"]),
        "ppp": _safe(lambda m: draft.get(m, {}).get("ppp", 0)),
    }
    cards = []
    for mid, s in pool.items():
        rings = _scale(s["rings"], 0, rng["rings"][1], 50, 99)
        winp = _scale(s["winpct"], rng["winpct"][0], rng["winpct"][1])
        ppg = _scale(s["ppg"], rng["ppg"][0], rng["ppg"][1])
        trd = _scale(vbd.get(mid, 0), rng["vbd"][0], rng["vbd"][1], 40, 99)
        lng = _scale(s["n_years"], rng["yrs"][0], rng["yrs"][1])
        d = draft.get(mid, {"pts": 0, "picks": 0, "ppp": 0})
        drf = _scale(d["ppp"], rng["ppp"][0], rng["ppp"][1])
        ovr = round(0.25 * rings + 0.22 * winp + 0.13 * ppg
                    + 0.13 * trd + 0.22 * drf + 0.05 * lng)
        cards.append({
            "mid": mid, "name": _mgr_name(mid), "ovr": ovr,
            "rings_rating": rings, "winp_rating": winp,
            "ppg_rating": ppg, "trade_rating": trd,
            "draft_rating": drf, "long_rating": lng,
            "rings": s["rings"], "winpct": s["winpct"], "ppg": s["ppg"],
            "trade_vbd": vbd.get(mid, 0), "trade_n": vbd_n.get(mid, 0),
            "draft_ppp": d["ppp"], "draft_picks": d["picks"],
            "years": s["n_years"], "w": s["w"], "l": s["l"],
            "is_current": True,
        })
    cards.sort(key=lambda c: -c["ovr"])
    return cards


def _setup_mpl():
    plt.rcParams.update({
        "font.family": ["Inter", "DejaVu Sans", "sans-serif"],
        "font.size": 10,
        "axes.facecolor": "#ffffff",
        "figure.facecolor": "#ffffff",
        "axes.edgecolor": PALETTE["gray"],
        "axes.labelcolor": PALETTE["ink"],
        "axes.titleweight": "bold",
        "axes.titlesize": 13,
        "axes.titlecolor": PALETTE["ink"],
        "axes.spines.top": False,
        "axes.spines.right": False,
        "xtick.color": PALETTE["gray"],
        "ytick.color": PALETTE["gray"],
        "grid.color": "#e5e7eb",
        "grid.alpha": 0.7,
    })


def chart_ovr_ranking(cards, path, title="All-Time Power Rankings"):
    _setup_mpl()
    cards = sorted(cards, key=lambda c: c["ovr"])
    names = [c["name"] + (" (FMR)" if not c.get("is_current", True) else "") for c in cards]
    ovrs = [c["ovr"] for c in cards]
    colors = [mgr_color(c["mid"]) for c in cards]
    fig, ax = plt.subplots(figsize=(9, max(3, 0.42 * len(cards) + 1)), dpi=140)
    bars = ax.barh(names, ovrs, color=colors, edgecolor="white", linewidth=1.5, height=0.72)
    ax.set_xlim(40, 100)
    ax.set_xlabel("OVR Rating", fontweight="bold")
    ax.set_title(title, loc="left", pad=14)
    ax.grid(axis="x", linestyle="--", alpha=0.4)
    ax.set_axisbelow(True)
    for bar, ovr in zip(bars, ovrs):
        ax.text(bar.get_width() + 0.8, bar.get_y() + bar.get_height() / 2,
                f"{ovr}", va="center", ha="left",
                fontweight="bold", fontsize=11, color=PALETTE["ink"])
    # Tier divider lines
    for v, lbl in [(65, "Depth"), (75, "Starter"), (80, "Pro Bowler"),
                   (85, "Star"), (90, "Franchise")]:
        ax.axvline(v, color=PALETTE["gray"], linestyle=":", alpha=0.5, linewidth=0.8)
        ax.text(v, len(cards) - 0.4, lbl, ha="center", va="bottom",
                color=PALETTE["gray"], fontsize=7, alpha=0.8)
    plt.tight_layout()
    plt.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close()


def chart_radar_grid(cards, path, title="Top 6 Player Profiles"):
    _setup_mpl()
    top = sorted(cards, key=lambda c: -c["ovr"])[:6]
    cats = ["RING", "WIN%", "PPG", "DRFT", "TRADE", "LONG"]
    angles = np.linspace(0, 2 * np.pi, len(cats), endpoint=False).tolist()
    angles += angles[:1]
    fig, axes = plt.subplots(2, 3, figsize=(10, 7), dpi=140,
                              subplot_kw=dict(polar=True))
    for ax, c in zip(axes.flat, top):
        vals = [c["rings_rating"], c["winp_rating"], c["ppg_rating"],
                c["draft_rating"], c["trade_rating"], c["long_rating"]]
        vals += vals[:1]
        color = tier_color(c["ovr"])
        ax.plot(angles, vals, color=color, linewidth=2.2)
        ax.fill(angles, vals, color=color, alpha=0.25)
        ax.set_xticks(angles[:-1])
        ax.set_xticklabels(cats, fontsize=8, color=PALETTE["ink"])
        ax.set_yticks([40, 60, 80, 100])
        ax.set_yticklabels([], fontsize=7)
        ax.set_ylim(30, 100)
        ax.set_title(f"{c['name']}  ({c['ovr']})", color=color,
                     fontweight="bold", fontsize=11, pad=12)
        ax.grid(color="#d1d5db", linewidth=0.6)
        ax.spines["polar"].set_color("#d1d5db")
    for ax in axes.flat[len(top):]:
        ax.set_visible(False)
    fig.suptitle(title, fontweight="bold", fontsize=14, color=PALETTE["ink"], y=0.99)
    plt.tight_layout()
    plt.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close()


def chart_scatter_winpct_ppg(cards, path):
    _setup_mpl()
    fig, ax = plt.subplots(figsize=(9, 6), dpi=140)
    # Avatars as scatter points
    for c in cards:
        color = mgr_color(c["mid"])
        ax.scatter(c["winpct"], c["ppg"], s=900, color=color,
                   alpha=0.18, edgecolor="none", zorder=2)
        # Overlay avatar
        av = _avatar_path(c["mid"])
        if av:
            img = mpimg.imread(av)
            im = OffsetImage(img, zoom=0.10)
            ab = AnnotationBbox(im, (c["winpct"], c["ppg"]),
                                 frameon=False, zorder=4)
            ax.add_artist(ab)
        # Label below
        ax.annotate(c["name"] + (f" · {c['rings']}R" if c["rings"] else ""),
                    (c["winpct"], c["ppg"]),
                    xytext=(0, -18), textcoords="offset points",
                    fontsize=8.5, ha="center", color=PALETTE["ink"],
                    fontweight="bold")
    ax.axvline(0.5, color=PALETTE["gray"], linestyle="--", alpha=0.5)
    ax.axhline(np.mean([c["ppg"] for c in cards]),
               color=PALETTE["gray"], linestyle="--", alpha=0.5)
    ax.set_xlabel("Career Win %", fontweight="bold")
    ax.set_ylabel("Career PPG", fontweight="bold")
    ax.set_title("Win% vs Points-per-Game  ·  Bubble size = ring count",
                 loc="left", pad=14)
    ax.grid(linestyle="--", alpha=0.4)
    ax.set_axisbelow(True)
    plt.tight_layout()
    plt.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close()


def chart_trade_vbd(cards, path):
    _setup_mpl()
    s = sorted(cards, key=lambda c: c["trade_vbd"])
    names = [c["name"] for c in s]
    vals = [c["trade_vbd"] for c in s]
    colors = [PALETTE["emerald"] if v >= 0 else PALETTE["crimson"] for v in vals]
    fig, ax = plt.subplots(figsize=(9, max(3, 0.4 * len(s) + 1)), dpi=140)
    ax.barh(names, vals, color=colors, edgecolor="white", linewidth=1.2, height=0.7)
    ax.axvline(0, color=PALETTE["ink"], linewidth=1)
    for i, (v, c) in enumerate(zip(vals, s)):
        x = v + (60 if v >= 0 else -60)
        ha = "left" if v >= 0 else "right"
        ax.text(x, i, f"{v:+.0f}  ({c['trade_n']}t)", va="center", ha=ha,
                fontsize=9, color=PALETTE["ink"], fontweight="bold")
    pad = max(abs(min(vals)), max(vals)) * 0.25
    ax.set_xlim(min(vals) - pad, max(vals) + pad)
    ax.set_xlabel("Net VBD (points)", fontweight="bold")
    ax.set_title("Trade Fleecer Ledger  ·  green = winner, red = loser",
                 loc="left", pad=14)
    ax.grid(axis="x", linestyle="--", alpha=0.4)
    ax.set_axisbelow(True)
    plt.tight_layout()
    plt.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close()


def chart_drafters(cards, path):
    _setup_mpl()
    s = sorted([c for c in cards if c["draft_picks"] > 20],
                key=lambda c: c["draft_ppp"])
    names = [c["name"] for c in s]
    vals = [c["draft_ppp"] for c in s]
    colors = [tier_color(c["ovr"]) for c in s]
    fig, ax = plt.subplots(figsize=(9, max(3, 0.4 * len(s) + 1)), dpi=140)
    ax.barh(names, vals, color=colors, edgecolor="white", linewidth=1.2, height=0.7)
    for i, (v, c) in enumerate(zip(vals, s)):
        ax.text(v + 1.5, i, f"{v:.1f}  ({c['draft_picks']}p)",
                va="center", fontsize=9, color=PALETTE["ink"], fontweight="bold")
    ax.set_xlim(min(vals) - 5, max(vals) + 18)
    ax.set_xlabel("Rookie-Year Points Per Pick", fontweight="bold")
    ax.set_title("Best Drafters  ·  pts produced per pick made",
                 loc="left", pad=14)
    ax.grid(axis="x", linestyle="--", alpha=0.4)
    ax.set_axisbelow(True)
    plt.tight_layout()
    plt.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close()


def chart_championships_timeline(path):
    _setup_mpl()
    # Collect (year, mgr_id) for every champion
    champs = []
    for yr, mid in KNOWN_CHAMPIONS.items():
        champs.append((yr, mid))
    for season, s in load_all_seasons().items():
        if season in KNOWN_CHAMPIONS:
            continue
        rid = s.get("champion_roster_id")
        if rid:
            mid = ROSTER_HANDOFFS.get((season, int(rid)),
                                       (manager_for_sleeper_roster(int(rid)) or {}).get("id"))
            if mid:
                champs.append((season, mid))
    champs.sort()
    # Order managers by total rings desc
    counts = defaultdict(int)
    for _, mid in champs:
        counts[mid] += 1
    mgr_order = sorted(counts, key=lambda m: -counts[m])
    y_pos = {m: i for i, m in enumerate(mgr_order)}
    fig, ax = plt.subplots(figsize=(10, 0.55 * len(mgr_order) + 1), dpi=140)
    years = sorted({y for y, _ in champs})
    yr_min, yr_max = min(years), max(years)
    # Grid: faint vertical line per year
    for y in range(yr_min, yr_max + 1):
        ax.axvline(y, color="#e5e7eb", linewidth=0.5, zorder=0)
    # Trophies — star markers
    for yr, mid in champs:
        ax.scatter(yr, y_pos[mid], s=420, color=PALETTE["gold"], zorder=3,
                   edgecolor=PALETTE["ink"], linewidth=1.2, marker="*")
    ax.set_yticks(range(len(mgr_order)))
    ax.set_yticklabels([f"{_mgr_name(m)}  ({counts[m]})" for m in mgr_order],
                       fontweight="bold")
    ax.set_xticks(years)
    ax.set_xticklabels([str(y) for y in years], rotation=0, fontsize=8)
    ax.set_xlim(yr_min - 0.5, yr_max + 0.5)
    ax.invert_yaxis()
    ax.set_title("Championship Timeline (2011-2025)", loc="left", pad=14, fontsize=14)
    ax.spines["left"].set_visible(False)
    ax.tick_params(left=False)
    plt.tight_layout()
    plt.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close()


def chart_trade_heatmap(path, cards):
    """Pairwise net VBD matrix: cell[row][col] = row mgr's net advantage
    over col mgr across all their trades together."""
    _setup_mpl()
    nfl = btr._load_nflverse()
    sleeper_names = btr._load_sleeper_players()
    spp = btr._build_sleeper_pick_resolver()
    ypp = btr._build_yahoo_pick_resolver()
    ynm = btr._yahoo_name_lookup()
    mgr_rid = {m["id"]: m["sleeper_roster_id"]
               for m in all_managers() if m.get("sleeper_roster_id")}

    def score(side, source, year, giver):
        pts = sum(nfl.get((year, _norm(p["name"])), 0)
                  for p in side.get("received_players", []))
        for pk in side.get("received_picks", []):
            rnd = pk.get("round")
            if not rnd:
                continue
            if source == "sleeper":
                season = int(pk.get("season") or 0)
                orig = pk.get("previous_owner_id") or pk.get("roster_id")
                if not (season and orig):
                    continue
                pid = spp.get((season, rnd, orig))
                n = sleeper_names.get(pid, "") if pid else ""
                if n:
                    pts += nfl.get((season, _norm(n)), 0)
            else:
                ty = year + 1
                of = (pk.get("originally_from") or "").rstrip("?").strip().lower()
                om = ynm.get((year, of)) if of else None
                om = om or giver
                pl = ypp.get((ty, rnd, om))
                if pl:
                    pts += nfl.get((ty, _norm(pl)), 0)
                elif ty >= 2023:
                    r = mgr_rid.get(om)
                    if r:
                        pid = spp.get((ty, rnd, r))
                        n = sleeper_names.get(pid, "") if pid else ""
                        if n:
                            pts += nfl.get((ty, _norm(n)), 0)
        return pts

    # Build pairwise stats
    pair_net = defaultdict(float)
    pair_n = defaultdict(int)
    trades = btr._load_all_trades()
    for t in trades:
        if t["year"] not in btr.NFL_SCORED_YEARS:
            continue
        ma, mb = t["side_a_mgr"], t["side_b_mgr"]
        pa = score(t["side_a"], t["source"], t["year"], mb)
        pb = score(t["side_b"], t["source"], t["year"], ma)
        pair_net[(ma, mb)] += (pa - pb)
        pair_net[(mb, ma)] += (pb - pa)
        pair_n[(ma, mb)] += 1
        pair_n[(mb, ma)] += 1

    # Order managers by their card OVR (best to worst, top-down)
    mgrs = [c["mid"] for c in sorted(cards, key=lambda c: -c["ovr"])]
    n = len(mgrs)
    M = np.full((n, n), np.nan)
    cnt = np.zeros((n, n), dtype=int)
    for i, a in enumerate(mgrs):
        for j, b in enumerate(mgrs):
            if i == j:
                continue
            if pair_n[(a, b)] > 0:
                M[i, j] = pair_net[(a, b)]
                cnt[i, j] = pair_n[(a, b)]

    # Symmetric diverging scale around 0
    vmax = float(np.nanmax(np.abs(M)))
    if not vmax or np.isnan(vmax):
        vmax = 1.0

    fig, ax = plt.subplots(figsize=(10, 8.5), dpi=140)
    cmap = plt.get_cmap("RdYlGn")
    im = ax.imshow(M, cmap=cmap, vmin=-vmax, vmax=vmax, aspect="equal")
    # Diagonal = gray
    for i in range(n):
        ax.add_patch(plt.Rectangle((i - 0.5, i - 0.5), 1, 1,
                                    color="#1a1d24", zorder=2))
    names = [_mgr_name(m) for m in mgrs]
    ax.set_xticks(range(n))
    ax.set_yticks(range(n))
    ax.set_xticklabels(names, rotation=45, ha="right", fontsize=9,
                        fontweight="bold")
    ax.set_yticklabels(names, fontsize=9, fontweight="bold")
    ax.tick_params(top=True, labeltop=True, bottom=False, labelbottom=False)
    plt.setp(ax.get_xticklabels(), rotation=45, ha="left",
             rotation_mode="anchor")
    # Annotate cells
    for i in range(n):
        for j in range(n):
            if i == j or np.isnan(M[i, j]):
                continue
            val = M[i, j]
            # Text color based on cell brightness
            tc = "white" if abs(val) > 0.55 * vmax else "#1a1d24"
            ax.text(j, i - 0.12, f"{val:+.0f}", ha="center", va="center",
                    fontsize=8, color=tc, fontweight="bold")
            ax.text(j, i + 0.25, f"{cnt[i, j]}t", ha="center", va="center",
                    fontsize=6.5, color=tc, alpha=0.85)
    # Subtle grid
    for x in range(n + 1):
        ax.axhline(x - 0.5, color="white", linewidth=2)
        ax.axvline(x - 0.5, color="white", linewidth=2)
    ax.set_title("Trade Fleecing Matrix  ·  ROW's net VBD vs COLUMN  "
                 "·  green = row dominated, red = row got fleeced",
                 loc="left", pad=24, fontsize=12)
    cbar = plt.colorbar(im, ax=ax, fraction=0.04, pad=0.02)
    cbar.set_label("Net VBD (row - column)", fontweight="bold")
    cbar.ax.tick_params(labelsize=8)
    plt.tight_layout()
    plt.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close()


def chart_trade_network(path, cards):
    """Force-directed trade network. Nodes = avatars, edges = trade
    relationships (thickness = volume, color intensity = imbalance)."""
    import networkx as nx
    _setup_mpl()

    nfl = btr._load_nflverse()
    sleeper_names = btr._load_sleeper_players()
    spp = btr._build_sleeper_pick_resolver()
    ypp = btr._build_yahoo_pick_resolver()
    ynm = btr._yahoo_name_lookup()
    mgr_rid = {m["id"]: m["sleeper_roster_id"]
               for m in all_managers() if m.get("sleeper_roster_id")}

    def score(side, source, year, giver):
        pts = sum(nfl.get((year, _norm(p["name"])), 0)
                  for p in side.get("received_players", []))
        for pk in side.get("received_picks", []):
            rnd = pk.get("round")
            if not rnd:
                continue
            if source == "sleeper":
                season = int(pk.get("season") or 0)
                orig = pk.get("previous_owner_id") or pk.get("roster_id")
                if not (season and orig):
                    continue
                pid = spp.get((season, rnd, orig))
                n = sleeper_names.get(pid, "") if pid else ""
                if n:
                    pts += nfl.get((season, _norm(n)), 0)
            else:
                ty = year + 1
                of = (pk.get("originally_from") or "").rstrip("?").strip().lower()
                om = ynm.get((year, of)) if of else None
                om = om or giver
                pl = ypp.get((ty, rnd, om))
                if pl:
                    pts += nfl.get((ty, _norm(pl)), 0)
                elif ty >= 2023:
                    r = mgr_rid.get(om)
                    if r:
                        pid = spp.get((ty, rnd, r))
                        n = sleeper_names.get(pid, "") if pid else ""
                        if n:
                            pts += nfl.get((ty, _norm(n)), 0)
        return pts

    pair_count = defaultdict(int)
    pair_net = defaultdict(float)
    trades = btr._load_all_trades()
    for t in trades:
        if t["year"] not in btr.NFL_SCORED_YEARS:
            continue
        ma, mb = t["side_a_mgr"], t["side_b_mgr"]
        key = tuple(sorted([ma, mb]))
        pa = score(t["side_a"], t["source"], t["year"], mb)
        pb = score(t["side_b"], t["source"], t["year"], ma)
        pair_count[key] += 1
        # Net from key[0]'s perspective
        if key[0] == ma:
            pair_net[key] += (pa - pb)
        else:
            pair_net[key] += (pb - pa)

    G = nx.Graph()
    mgr_ids = [c["mid"] for c in cards]
    trade_n_by_mgr = {c["mid"]: c["trade_n"] for c in cards}
    for mid in mgr_ids:
        G.add_node(mid, trades=trade_n_by_mgr.get(mid, 0))
    for (a, b), n in pair_count.items():
        if a in mgr_ids and b in mgr_ids and n >= 2:
            G.add_edge(a, b, weight=n, net=pair_net[(a, b)])

    fig, ax = plt.subplots(figsize=(10, 9), dpi=140)
    pos = nx.spring_layout(G, k=1.8, iterations=120, seed=42, weight="weight")

    # Edges: thickness = trade count, color = imbalance direction
    max_net = max((abs(d["net"]) for _, _, d in G.edges(data=True)), default=1)
    for u, v, d in G.edges(data=True):
        net = d["net"]
        # Color intensity by imbalance (red = lopsided, gray = balanced)
        intensity = min(1.0, abs(net) / max(max_net, 1))
        color = (0.55 + 0.4 * intensity, 0.55 - 0.3 * intensity, 0.6 - 0.4 * intensity)
        lw = 0.6 + 0.45 * d["weight"]
        x = [pos[u][0], pos[v][0]]
        y = [pos[u][1], pos[v][1]]
        ax.plot(x, y, color=color, linewidth=lw, alpha=0.55, zorder=1)

    # Nodes: avatars sized by trade volume
    max_trades = max((G.nodes[n]["trades"] for n in G.nodes()), default=1)
    for n in G.nodes():
        x, y = pos[n]
        size = 0.06 + 0.08 * (G.nodes[n]["trades"] / max(max_trades, 1))
        # Color ring for manager
        ax.scatter(x, y, s=2800 * size * size, color=mgr_color(n),
                   alpha=0.85, zorder=2,
                   edgecolor="white", linewidth=2)
        av = _avatar_path(n)
        if av:
            img = mpimg.imread(av)
            im = OffsetImage(img, zoom=0.14 + 0.10 * (G.nodes[n]["trades"] / max(max_trades, 1)))
            ab = AnnotationBbox(im, (x, y), frameon=False, zorder=3)
            ax.add_artist(ab)
        ax.text(x, y - 0.12, _mgr_name(n), ha="center", va="top",
                fontsize=9, fontweight="bold", color=PALETTE["ink"], zorder=4)

    ax.set_axis_off()
    ax.set_title("Trade Network · node size = trade volume · "
                 "edge thickness = pair frequency · edge color = imbalance",
                 fontsize=12, loc="left", pad=14)
    plt.tight_layout()
    plt.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close()


def chart_sleeper_winpct_trend(path):
    """Per-season win pct per current manager."""
    _setup_mpl()
    rid_to_mid = {m["sleeper_roster_id"]: m["id"]
                  for m in all_managers() if m.get("sleeper_roster_id")}
    series = defaultdict(dict)
    for season, s in load_all_seasons().items():
        for rid, r in s["rosters"].items():
            mid = ROSTER_HANDOFFS.get((season, int(rid)), rid_to_mid.get(int(rid)))
            if not mid:
                continue
            g = r["wins"] + r["losses"]
            if g:
                series[mid][season] = r["wins"] / g
    # Plot
    seasons = sorted(set().union(*[set(s.keys()) for s in series.values()]))
    fig, ax = plt.subplots(figsize=(9, 5), dpi=140)
    items = sorted(series.items(), key=lambda kv: -np.mean(list(kv[1].values())))
    for mid, ser in items:
        ys = [ser.get(s, np.nan) for s in seasons]
        ax.plot(seasons, ys, marker="o", linewidth=2.4, markersize=8,
                color=mgr_color(mid), label=_mgr_name(mid),
                markeredgecolor="white", markeredgewidth=1.4)
    ax.set_xticks(seasons)
    ax.axhline(0.5, color=PALETTE["gray"], linestyle="--", alpha=0.5)
    ax.set_ylim(0, 1)
    ax.set_ylabel("Win %", fontweight="bold")
    ax.set_title("Sleeper-Era Win% by Season",
                 loc="left", pad=14, fontsize=14)
    ax.legend(loc="center left", bbox_to_anchor=(1.0, 0.5), fontsize=8,
              frameon=False, ncol=1)
    ax.grid(linestyle="--", alpha=0.4)
    ax.set_axisbelow(True)
    plt.tight_layout()
    plt.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close()


def build_html():
    # All-time
    stats = compute_career_stats()
    vbd, vbd_n = compute_trade_vbd()
    draft = compute_draft_stats()
    cards = build_madden_cards(stats, vbd, vbd_n, draft)

    # Sleeper era only (2023-2025)
    sl = lambda y: 2023 <= y <= 2025
    stats_s = compute_career_stats(year_filter=sl)
    vbd_s, vbd_ns = compute_trade_vbd(year_filter=sl)
    draft_s = compute_draft_stats(year_filter=sl)
    cards_s = build_madden_cards_sleeper(stats_s, vbd_s, vbd_ns, draft_s)

    today = date.today().strftime("%B %Y")

    # Generate charts
    print("rendering charts…")
    chart_paths = {
        "ovr_all": CHART_DIR / "ovr_all.png",
        "radar_top": CHART_DIR / "radar_top.png",
        "scatter": CHART_DIR / "scatter.png",
        "vbd": CHART_DIR / "vbd.png",
        "drafters": CHART_DIR / "drafters.png",
        "champs": CHART_DIR / "champs.png",
        "trade_heatmap": CHART_DIR / "trade_heatmap.png",
        "trade_network": CHART_DIR / "trade_network.png",
        "ovr_sleeper": CHART_DIR / "ovr_sleeper.png",
        "radar_sleeper": CHART_DIR / "radar_sleeper.png",
        "sleeper_trend": CHART_DIR / "sleeper_trend.png",
    }
    chart_ovr_ranking(cards, chart_paths["ovr_all"], "All-Time OVR Rankings")
    chart_radar_grid(cards, chart_paths["radar_top"], "All-Time Top 6 — Attribute Profiles")
    chart_scatter_winpct_ppg(cards, chart_paths["scatter"])
    chart_trade_vbd(cards, chart_paths["vbd"])
    chart_drafters(cards, chart_paths["drafters"])
    chart_championships_timeline(chart_paths["champs"])
    chart_trade_heatmap(chart_paths["trade_heatmap"], cards)
    chart_trade_network(chart_paths["trade_network"], cards)
    chart_ovr_ranking(cards_s, chart_paths["ovr_sleeper"], "Sleeper Era OVR Rankings")
    chart_radar_grid(cards_s, chart_paths["radar_sleeper"],
                     "Sleeper Era Top 6 — Attribute Profiles")
    chart_sleeper_winpct_trend(chart_paths["sleeper_trend"])

    css = """
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Bebas+Neue&display=swap');
    body { font-family: 'Inter', -apple-system, system-ui, sans-serif;
           max-width: 780px; margin: 18px auto; padding: 0 22px;
           color: #1a1d24; line-height: 1.5; font-size: 10.5pt;
           background: #ffffff; }
    h1 { font-family: 'Bebas Neue', sans-serif; font-size: 38pt;
         letter-spacing: 1px; margin: 0; color: #0a3d62;
         line-height: 1; }
    .hero { background: linear-gradient(135deg, #0a3d62 0%, #1f7a8c 100%);
            color: white; padding: 22px 26px; border-radius: 14px;
            margin-bottom: 22px; }
    .hero h1 { color: white; }
    .hero .subtitle { color: rgba(255,255,255,0.85); font-size: 11pt;
                      margin: 6px 0 0; font-weight: 500; }
    h2 { font-family: 'Bebas Neue', sans-serif; font-size: 22pt;
         letter-spacing: 1px; color: #0a3d62; margin: 28px 0 4px;
         padding-bottom: 4px; border-bottom: 3px solid #d4a017; }
    h3 { font-size: 11pt; color: #3d405b; margin: 14px 0 4px;
         font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .subtitle { color: #6b7280; margin: 0 0 14px; font-size: 10pt; }
    .chart { width: 100%; margin: 6px 0 14px; page-break-inside: avoid; }
    .cards-grid { display: grid; grid-template-columns: 1fr 1fr;
                  gap: 10px; margin: 10px 0; }
    .card { border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;
            page-break-inside: avoid;
            box-shadow: 0 2px 6px rgba(0,0,0,0.06); }
    .card-head { color: white; padding: 12px 14px; display: flex;
                 align-items: center; gap: 12px; position: relative;
                 overflow: hidden; }
    .ovr { font-family: 'Bebas Neue', sans-serif; font-size: 36pt;
           font-weight: bold; min-width: 50px; text-align: center;
           line-height: 1; text-shadow: 0 2px 4px rgba(0,0,0,0.25); }
    .avatar { width: 46px; height: 46px; border-radius: 50%;
              object-fit: cover; border: 2.5px solid rgba(255,255,255,0.85);
              box-shadow: 0 2px 6px rgba(0,0,0,0.2); }
    .avatar-placeholder { background: rgba(255,255,255,0.25); }
    .player-name { font-size: 14pt; font-weight: 800; line-height: 1.1; }
    .archetype { font-size: 8.5pt; opacity: 0.92; margin-top: 3px;
                 font-weight: 500; }
    .card-body { padding: 8px 12px 10px; }
    .attr-table { width: 100%; font-size: 8.5pt; }
    .attr-table td { padding: 2px 4px; }
    .attr { font-weight: 700; color: #3d405b; width: 38px;
            font-size: 8pt; letter-spacing: 0.4px; }
    .bar { width: 100%; }
    .bar-fill { height: 8px; border-radius: 4px; background: #888;
                min-width: 4px; }
    .val { width: 24px; text-align: right; font-weight: 800;
           color: #1a1d24; }
    .raw { color: #6b7280; font-size: 8pt; text-align: right;
           min-width: 90px; }
    .badge-fmr { font-size: 7pt; background: rgba(0,0,0,0.3); color: #fff;
                 padding: 1px 5px; border-radius: 4px;
                 vertical-align: middle; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin: 4px 0 12px;
            font-size: 9.5pt; }
    th { background: #0a3d62; color: white; padding: 5px 8px;
         text-align: left; font-weight: 700; }
    td { padding: 4px 8px; border-bottom: 1px solid #f0f0f0; }
    tr:nth-child(even) td { background: #fafafa; }
    .note { font-size: 9pt; color: #6b7280; margin: 4px 0 14px;
            line-height: 1.5; }
    .top3 { font-size: 9.5pt; box-shadow: 0 1px 3px rgba(0,0,0,0.06);
            border-radius: 8px; overflow: hidden; }
    .top3 th { display: none; }
    .top3 td { padding: 6px 10px; border-bottom: 1px solid #f0f0f0; }
    .stat-cards { display: grid; grid-template-columns: repeat(4, 1fr);
                  gap: 8px; margin: 8px 0 14px; }
    .stat-card { background: #f7f4ea; border-radius: 10px; padding: 10px 12px;
                 text-align: center; border: 1px solid #e5e7eb; }
    .stat-card .num { font-family: 'Bebas Neue', sans-serif;
                       font-size: 22pt; color: #0a3d62; line-height: 1; }
    .stat-card .lbl { font-size: 8pt; color: #6b7280; margin-top: 4px;
                      text-transform: uppercase; letter-spacing: 0.5px;
                      font-weight: 600; }
    .section-intro { color: #3d405b; font-size: 10pt; margin: 4px 0 10px; }
    @page { size: letter; margin: 0.45in; }
    """

    n_yrs = max(c["years"] for c in cards)
    n_champs = sum(c["rings"] for c in cards)
    n_trades = sum(c["trade_n"] for c in cards) // 2
    top_ovr = max(c["ovr"] for c in cards)

    h = ['<!DOCTYPE html><html><head><meta charset="utf-8">',
         f'<style>{css}</style></head><body>']

    # Hero
    h.append('<div class="hero">')
    h.append('<h1>MONEYLEAGUE POWER RANKINGS</h1>')
    h.append(f'<p class="subtitle">{today} · 15-year retrospective '
             '· Madden-style attribute scoring · charts + cards</p>')
    h.append('</div>')

    # Stat strip
    h.append('<div class="stat-cards">'
             f'<div class="stat-card"><div class="num">{n_yrs}</div>'
             '<div class="lbl">Yrs of History</div></div>'
             f'<div class="stat-card"><div class="num">{n_champs}</div>'
             '<div class="lbl">Champions Crowned</div></div>'
             f'<div class="stat-card"><div class="num">{n_trades}</div>'
             '<div class="lbl">Trades Logged</div></div>'
             f'<div class="stat-card"><div class="num">{top_ovr}</div>'
             '<div class="lbl">Top OVR</div></div>'
             '</div>')

    # ===== All-time chart =====
    h.append('<h2>All-Time Power Rankings</h2>')
    h.append('<p class="section-intro">OVR is a weighted composite: '
             '<strong>Rings 30%</strong>, <strong>Win% 20%</strong>, '
             '<strong>Draft 17%</strong>, Trade 13%, PPG 12%, Longevity 8%. '
             'Each attribute is normalized 0-99 within the active-vet pool. '
             '<strong>FMR</strong> = former manager.</p>')
    h.append(f'<img class="chart" src="file://{chart_paths["ovr_all"]}"/>')
    h.append(f'<img class="chart" src="file://{chart_paths["radar_top"]}"/>')

    # ===== Madden cards =====
    h.append('<h2>All-Time Player Cards</h2>')
    h.append('<div class="cards-grid">')
    for c in cards:
        h.append(render_card_html(c))
    h.append('</div>')

    # ===== Win% vs PPG scatter =====
    h.append('<h2>Win% vs Scoring</h2>')
    h.append('<p class="section-intro">Where each manager lives on the '
             'win-rate / scoring plane. The top-right is the dream; the '
             'bottom-left is the basement. Bubble size = rings.</p>')
    h.append(f'<img class="chart" src="file://{chart_paths["scatter"]}"/>')

    # ===== Trade fleecer ledger =====
    h.append('<h2>Trade Fleecer Ledger</h2>')
    h.append('<p class="section-intro">Net VBD across every scored trade '
             '(Yahoo 2011-2022 + Sleeper 2023-2024), including picks '
             '(scored as the rookie-year production of the player actually '
             'drafted). Green = won, red = lost.</p>')
    h.append(f'<img class="chart" src="file://{chart_paths["vbd"]}"/>')

    # ===== Trade heatmap =====
    h.append('<h2>Trade Fleecing Matrix</h2>')
    h.append('<p class="section-intro">Every pairwise relationship in the '
             'league. Read across a row: <em>green cells</em> are managers '
             'this person fleeced, <em>red cells</em> are the ones who '
             'fleeced them. Number = net VBD; small subscript = trade count. '
             'Rows ordered by all-time OVR.</p>')
    h.append(f'<img class="chart" src="file://{chart_paths["trade_heatmap"]}"/>')

    # ===== Trade network =====
    h.append('<h2>Trade Network</h2>')
    h.append('<p class="section-intro">Force-directed graph of the league\'s '
             'trade economy. Bigger node = trades more; edges show pair '
             'frequency (thickness) and imbalance (color depth). Managers '
             'who only trade with a few others get pulled to the periphery.</p>')
    h.append(f'<img class="chart" src="file://{chart_paths["trade_network"]}"/>')

    # ===== Best drafters =====
    h.append('<h2>Best Drafters</h2>')
    h.append('<p class="section-intro">Rookie-year nflverse points produced '
             'by every player each manager drafted, normalized per pick. '
             'Minimum 20 career picks to qualify.</p>')
    h.append(f'<img class="chart" src="file://{chart_paths["drafters"]}"/>')

    # ===== Championship timeline =====
    h.append('<h2>Championship Timeline</h2>')
    h.append('<p class="section-intro">15 years of titles, one trophy per '
             'season. Rows ordered by total ring count.</p>')
    h.append(f'<img class="chart" src="file://{chart_paths["champs"]}"/>')

    # ===== Sleeper era split =====
    h.append('<h2>Sleeper Era (2023-2025)</h2>')
    h.append('<p class="section-intro">The last 3 seasons only — recency '
             'view. Weights tilt away from longevity (5%) and toward '
             'draft (22%) and win% (22%). All 12 current rosters '
             'included regardless of tenure.</p>')
    h.append(f'<img class="chart" src="file://{chart_paths["ovr_sleeper"]}"/>')
    h.append(f'<img class="chart" src="file://{chart_paths["sleeper_trend"]}"/>')
    h.append(f'<img class="chart" src="file://{chart_paths["radar_sleeper"]}"/>')

    h.append('<h2>Sleeper Era Player Cards</h2>')
    h.append('<div class="cards-grid">')
    for c in cards_s:
        h.append(render_card_html(c))
    h.append('</div>')

    # ===== Methodology =====
    h.append('<h2>Methodology</h2>')
    h.append('<p class="note">Win/loss + PPG: regular-season games only '
             '(weeks 1-13 for 8/10-team years, 1-14 for 12-team years). '
             'Yahoo data via scraped matchups; Sleeper via league API. '
             'Rings: KNOWN_CHAMPIONS dict (Yahoo era) + winners_bracket.json '
             '(Sleeper era). Trade VBD: full-season nflverse fantasy points '
             '(0.5 PPR for 2019+, 0 PPR before) for players + rookie-year '
             'points of the player actually drafted at each traded pick '
             '(snake-order math against each year\'s actual draft data). '
             'Draft skill: total rookie-year points / total picks made. '
             '2025 Sleeper trades excluded — no nflverse 2025 totals yet.</p>')

    h.append('</body></html>')
    return "\n".join(h)


CHROMIUM_EXEC = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"


def _render_pdf_playwright(html: str, out_path: Path):
    import os
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "/opt/pw-browsers"
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROMIUM_EXEC,
                              args=["--no-sandbox", "--disable-dev-shm-usage"])
        ctx = b.new_context(viewport={"width": 820, "height": 1100})
        page = ctx.new_page()
        page.set_content(html, wait_until="networkidle")
        # Wait for fonts + images
        page.evaluate("document.fonts.ready")
        page.pdf(
            path=str(out_path),
            format="Letter",
            margin={"top": "0.4in", "bottom": "0.4in",
                    "left": "0.4in", "right": "0.4in"},
            print_background=True,
            prefer_css_page_size=False,
        )
        b.close()


def main():
    html = build_html()
    MD_OUT.write_text(html)
    _render_pdf_playwright(html, PDF_OUT)
    print(f"Wrote {PDF_OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
