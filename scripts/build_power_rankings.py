"""MONEYLEAGUE Power Rankings — Madden cards + Trade Behavior combined.

Active long-tenure managers only (5+ years, still rostered). Composite OVR
weights: Rings 35%, Win% 25%, PPG 15%, Trade VBD 15%, Longevity 10%.
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.results import load_all_seasons  # noqa: E402
from fantasy_draft.team_identity import (  # noqa: E402
    all_managers, manager_for_sleeper_roster,
)

ROOT = Path(__file__).resolve().parent.parent
PDF_OUT = ROOT / "data" / "MONEYLEAGUE_POWER_RANKINGS.pdf"
MD_OUT = ROOT / "data" / "MONEYLEAGUE_POWER_RANKINGS.md"

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
    color = tier_color(c["ovr"])
    arch = archetype(c)
    badge = "" if c.get("is_current", True) else ' <span class="badge-fmr">FMR</span>'
    return f"""
    <div class="card">
      <div class="card-head" style="background:{color}">
        <div class="ovr">{c['ovr']}</div>
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

    css = """
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 760px;
           margin: 24px auto; padding: 0 20px; color: #1a1a1a;
           line-height: 1.45; font-size: 10.5pt; }
    h1 { font-size: 22pt; border-bottom: 3px solid #b8860b;
         padding-bottom: 6px; margin: 0 0 4px; }
    h2 { font-size: 14pt; color: #0a4d6b; margin: 22px 0 8px;
         border-left: 4px solid #b8860b; padding-left: 10px; }
    h3 { font-size: 11pt; color: #444; margin: 14px 0 4px; }
    .subtitle { color: #666; margin: 0 0 16px; font-size: 10pt; }
    .cards-grid { display: grid; grid-template-columns: 1fr 1fr;
                  gap: 10px; margin: 8px 0; }
    .card { border: 1px solid #ccc; border-radius: 8px; overflow: hidden;
            page-break-inside: avoid; }
    .card-head { color: white; padding: 8px 10px; display: flex;
                 align-items: center; gap: 10px; }
    .ovr { font-size: 24pt; font-weight: bold; min-width: 38px; text-align: center; }
    .player-name { font-size: 13pt; font-weight: bold; line-height: 1.1; }
    .archetype { font-size: 8.5pt; opacity: 0.9; margin-top: 2px; }
    .card-body { padding: 6px 10px 8px; }
    .attr-table { width: 100%; font-size: 8.5pt; }
    .attr-table td { padding: 1px 4px; }
    .attr { font-weight: bold; color: #444; width: 38px; }
    .bar { width: 100%; }
    .bar-fill { height: 7px; border-radius: 3px; background: #888; min-width: 4px; }
    .val { width: 22px; text-align: right; font-weight: bold; }
    .raw { color: #666; font-size: 8pt; text-align: right; min-width: 80px; }
    .badge-fmr { font-size: 7pt; background: #444; color: #fff;
                 padding: 1px 4px; border-radius: 3px; vertical-align: middle; }
    table { width: 100%; border-collapse: collapse; margin: 4px 0 10px;
            font-size: 9pt; }
    th { background: #2c5d7c; color: white; padding: 3px 7px; text-align: left; }
    td { padding: 3px 7px; border-bottom: 1px solid #ddd; }
    tr:nth-child(even) td { background: #f8f8f8; }
    .note { font-size: 9pt; color: #666; font-style: italic; margin: 4px 0 10px; }
    .top3 { font-size: 9.5pt; }
    @page { size: letter; margin: 0.5in; }
    """

    h = ['<!DOCTYPE html><html><head><meta charset="utf-8">',
         f'<style>{css}</style></head><body>']
    h.append('<h1>🏆 MONEYLEAGUE Power Rankings</h1>')
    h.append(f'<p class="subtitle">{today} · Madden-style ratings · '
             'Current managers + long-tenured former vets (10+ yrs)</p>')

    # ===== All-time Madden cards =====
    h.append('<h2>⚡ All-Time Madden OVR</h2>')
    h.append('<p class="note">OVR = 30% Rings + 20% Win% + 17% Draft + '
             '13% Trade + 12% PPG + 8% Longevity. Ratings 0-99 scaled '
             'within this pool. <strong>FMR</strong> = former manager.</p>')
    h.append('<div class="cards-grid">')
    for c in cards:
        h.append(render_card_html(c))
    h.append('</div>')

    # ===== Sleeper era cards =====
    h.append('<h2>📱 Sleeper Era OVR (2023-2025)</h2>')
    h.append('<p class="note">Only the last 3 seasons counted. Same '
             'attributes, re-weighted: Rings 25% + Win% 22% + Draft 22% + '
             'Trade 13% + PPG 13% + Long 5% (recency-heavy).</p>')
    h.append('<div class="cards-grid">')
    for c in cards_s:
        h.append(render_card_html(c))
    h.append('</div>')

    # ===== League leaders =====
    h.append('<h2>🥇 League Leaders</h2>')

    def top3(label, key, fmt, reverse=True):
        rows = sorted(cards, key=lambda c: (-c[key]) if reverse else c[key])[:3]
        lines = [f"<tr><td>{i+1}. <strong>{r['name']}</strong></td>"
                 f"<td>{fmt.format(r[key])}</td></tr>"
                 for i, r in enumerate(rows)]
        return f"<h3>{label}</h3><table class='top3'>{''.join(lines)}</table>"

    h.append('<div class="cards-grid">')
    h.append('<div>' + top3("💍 Most Rings", "rings", "{}") + '</div>')
    h.append('<div>' + top3("📈 Highest Win%", "winpct", "{:.3f}") + '</div>')
    h.append('<div>' + top3("🎯 Highest PPG", "ppg", "{:.1f}") + '</div>')
    h.append('<div>' + top3("🦈 Best Trader (VBD)", "trade_vbd", "{:+.0f}") + '</div>')
    h.append('<div>' + top3("📝 Best Drafter (pts/pick)", "draft_ppp", "{:.1f}") + '</div>')
    h.append('<div>' + top3("⏳ Most Years", "years", "{}") + '</div>')
    h.append('</div>')

    # ===== Championship history =====
    h.append('<h2>🏅 Championship History</h2>')
    h.append('<table><thead><tr><th>Year</th><th>Champion</th></tr></thead><tbody>')
    for yr in sorted(KNOWN_CHAMPIONS):
        h.append(f'<tr><td>{yr}</td><td><strong>{_mgr_name(KNOWN_CHAMPIONS[yr])}</strong></td></tr>')
    # Sleeper champs auto-detected
    for season, s in sorted(load_all_seasons().items()):
        if season in KNOWN_CHAMPIONS:
            continue
        rid = s.get("champion_roster_id")
        if rid:
            mid = ROSTER_HANDOFFS.get((season, int(rid)),
                                      (manager_for_sleeper_roster(int(rid)) or {}).get("id"))
            if mid:
                h.append(f'<tr><td>{season}</td><td><strong>{_mgr_name(mid)}</strong></td></tr>')
    h.append('</tbody></table>')

    # ===== Trade behavior (mini version) =====
    h.append('<h2>🦈 Aggregate Trade Fleecer Ranking</h2>')
    h.append('<p class="note">Net VBD across all scored trades (Yahoo 2011-2022 + Sleeper 2023-2024). '
             'Picks scored as the rookie-year points of the player actually drafted.</p>')
    by_vbd = sorted(vbd.items(), key=lambda kv: -kv[1])
    h.append('<table><thead><tr><th>Rk</th><th>Manager</th><th>Trades</th>'
             '<th>Net VBD</th><th>Per Trade</th></tr></thead><tbody>')
    for i, (mid, net) in enumerate(by_vbd, 1):
        n = vbd_n[mid]
        per = net / n if n else 0
        h.append(f'<tr><td>{i}</td><td><strong>{_mgr_name(mid)}</strong></td>'
                 f'<td>{n}</td><td><strong>{net:+.0f}</strong></td>'
                 f'<td>{per:+.0f}</td></tr>')
    h.append('</tbody></table>')

    h.append('<h2>📜 Methodology</h2>')
    h.append('<p class="note">Win/loss + PPG: regular-season games only. '
             'Yahoo data via scraped matchups; Sleeper via league API. '
             'Trade VBD: full-season nflverse fantasy points for players + '
             'rookie-year points of the player drafted at each traded pick '
             '(snake-order math against actual draft data). '
             '2025 Sleeper trades excluded — no season stats yet.</p>')

    h.append('</body></html>')
    return "\n".join(h)


def main():
    html = build_html()
    MD_OUT.write_text(html)  # save the HTML alongside for debugging
    try:
        from weasyprint import HTML
    except ImportError:
        sys.exit("weasyprint not installed.")
    HTML(string=html, base_url=str(ROOT)).write_pdf(str(PDF_OUT))
    print(f"Wrote {PDF_OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
