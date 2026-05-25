"""MONEYLEAGUE Trade Behavior — comprehensive analysis of who trades with
whom, who wins, who loses, and who bailed out.

15 years of trade data (Yahoo 2011-2022 + Sleeper 2023-2025), 181 total
trades parsed including players + draft picks.
"""
from __future__ import annotations

import glob
import json
import re
import sys
import unicodedata
import csv as _csv
from collections import defaultdict, Counter
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.results import load_all_trades  # noqa: E402
from fantasy_draft.team_identity import all_managers, manager_for_sleeper_roster  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
MD_OUT = ROOT / "data" / "MONEYLEAGUE_TRADES.md"
PDF_OUT = ROOT / "data" / "MONEYLEAGUE_TRADES.pdf"
NFL_SCORED_YEARS = set(range(2011, 2025))  # nflverse season data through 2024


def _mgr_name(mid):
    for m in all_managers():
        if m["id"] == mid:
            return m["canonical_name"].split(" (")[0]
    return mid


def _norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().strip()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()


def _load_nflverse():
    nfl = {}
    with open(ROOT / "data" / "nflverse" / "player_stats_season.csv") as f:
        for row in _csv.DictReader(f):
            if row["season_type"] != "REG":
                continue
            try:
                s = int(row["season"])
                fp = float(row["fantasy_points"] or 0)
                fpp = float(row["fantasy_points_ppr"] or 0)
            except Exception:
                continue
            pts = (fp + fpp)/2 if s >= 2019 else fp
            name = row["player_display_name"] or row["player_name"]
            if not name:
                continue
            key = (s, _norm(name))
            if key not in nfl or pts > nfl[key]:
                nfl[key] = pts
    return nfl


def _yahoo_name_lookup():
    out = {}
    for m in all_managers():
        for yr, nm in (m.get("yahoo_team_names") or {}).items():
            if yr == "_note" or not nm:
                continue
            out[(int(yr), str(nm).rstrip("?").strip().lower())] = m["id"]
    return out


def _load_sleeper_players():
    p = json.loads((ROOT / "data" / "sleeper" / "players_nfl.json").read_text())
    return {pid: (d.get("full_name") or f"{d.get('first_name','')} {d.get('last_name','')}").strip()
            for pid, d in p.items()}


def _build_sleeper_pick_resolver():
    """Map (target_season, round, original_roster_id) -> player_id picked."""
    out = {}
    for lg in ["league_1001657805583077376",
               "league_1085805164784664576",
               "league_1245039290518360064"]:
        drafts = json.loads((ROOT / "data/sleeper" / lg / "drafts.json").read_text())
        for d in drafts:
            picks_f = ROOT / "data/sleeper" / lg / f"draft_{d['draft_id']}_picks.json"
            if not picks_f.exists():
                continue
            picks = json.loads(picks_f.read_text())
            season = int(d["season"])
            slot_to_rid = {int(k): v for k, v in (d.get("slot_to_roster_id") or {}).items()}
            n = d["settings"]["teams"]
            for p in picks:
                rnd = p["round"]
                slot_in_round = ((p["pick_no"] - 1) % n) + 1
                orig_slot = (n + 1 - slot_in_round) if rnd % 2 == 0 else slot_in_round
                orig_rid = slot_to_rid.get(orig_slot)
                if orig_rid and p.get("player_id"):
                    out[(season, rnd, orig_rid)] = p["player_id"]
    return out


def _build_yahoo_pick_resolver():
    """Map (target_season, round, original_manager_id) -> player name picked."""
    mgr_by_yr_name = _yahoo_name_lookup()
    # Per-year team_name -> draft slot from CSV
    yr_team_to_slot = {}
    yr_round_slot_to_player = {}
    for f in sorted((ROOT / "data" / "yahoo").glob("league_*/draft_*.csv")):
        with open(f) as fh:
            rdr = _csv.DictReader(fh)
            for row in rdr:
                yr = int(row["season"])
                tn = row["team_name"].strip().lower()
                slot = int(row["pick_in_round"])
                rnd = int(row["round"])
                # Slot = round 1 pick_in_round for that team
                if rnd == 1:
                    yr_team_to_slot[(yr, tn)] = slot
                yr_round_slot_to_player[(yr, rnd, slot)] = row["player_name"]
    out = {}
    # For each (target_year, round, manager) we need slot.
    # Compute snake-corrected slot per round.
    # Build via: for each manager known to be in target_year, find their r1 slot.
    n_teams_per_year = {}
    for (yr, _), s in yr_team_to_slot.items():
        n_teams_per_year[yr] = max(n_teams_per_year.get(yr, 0), s)
    for (yr, tn), r1_slot in yr_team_to_slot.items():
        mid = mgr_by_yr_name.get((yr, tn))
        if not mid:
            continue
        n = n_teams_per_year[yr]
        for rnd in range(1, 18):
            slot = (n + 1 - r1_slot) if rnd % 2 == 0 else r1_slot
            player = yr_round_slot_to_player.get((yr, rnd, slot))
            if player:
                out[(yr, rnd, mid)] = player
    return out


def _load_all_trades():
    """Yields normalized trades from Yahoo + Sleeper."""
    name_to_mgr = _yahoo_name_lookup()
    sleeper_names = _load_sleeper_players()
    out = []
    for f in sorted((ROOT / "data" / "yahoo").glob("league_*/trades_*.json")):
        yr = int(re.search(r"trades_(\d+)\.json", str(f)).group(1))
        for t in json.loads(f.read_text()):
            sides = t["sides"]
            if len(sides) != 2:
                continue
            a, b = sides
            ma = name_to_mgr.get((yr, a["received_team"].rstrip("?").strip().lower()))
            mb = name_to_mgr.get((yr, b["received_team"].rstrip("?").strip().lower()))
            if not (ma and mb) or ma == mb:
                continue
            # Skip incomplete
            if (len(a.get("received_players",[])) + len(a.get("received_picks",[]))) == 0:
                continue
            if (len(b.get("received_players",[])) + len(b.get("received_picks",[]))) == 0:
                continue
            out.append({"year": yr, "date": t["date_str"], "source": "yahoo",
                        "side_a_mgr": ma, "side_b_mgr": mb,
                        "side_a": a, "side_b": b})
    for t in load_all_trades(ROOT / "data" / "sleeper"):
        if t.get("type") != "trade":
            continue
        yr = t.get("_season", 0)
        rids = t.get("roster_ids") or []
        if len(rids) != 2:
            continue
        adds = t.get("adds") or {}
        picks = t.get("draft_picks") or []
        def mgr_for(rid):
            if yr in (2023, 2024) and rid == 10:
                return "dave_aka_wang"
            m = manager_for_sleeper_roster(rid)
            return m["id"] if m else None
        ma, mb = mgr_for(rids[0]), mgr_for(rids[1])
        if not (ma and mb) or ma == mb:
            continue
        a_players = [pid for pid, r in adds.items() if r == rids[0]]
        b_players = [pid for pid, r in adds.items() if r == rids[1]]
        a_picks = [p for p in picks if p.get("owner_id") == rids[0]]
        b_picks = [p for p in picks if p.get("owner_id") == rids[1]]
        out.append({"year": yr, "date": "sleeper", "source": "sleeper",
                    "side_a_mgr": ma, "side_b_mgr": mb,
                    "side_a": {"received_players": [{"name": sleeper_names.get(p, p)} for p in a_players],
                                "received_picks": a_picks},
                    "side_b": {"received_players": [{"name": sleeper_names.get(p, p)} for p in b_players],
                                "received_picks": b_picks},
                    "raw": t})
    return out


def build_markdown():
    nfl = _load_nflverse()
    trades = _load_all_trades()
    sleeper_names = _load_sleeper_players()
    sleeper_pick_player = _build_sleeper_pick_resolver()
    yahoo_pick_player = _build_yahoo_pick_resolver()
    yahoo_name_to_mgr = _yahoo_name_lookup()
    today = date.today().strftime("%B %Y")

    def _score_side(side, source, trade_year, giver_mgr):
        pts = sum(nfl.get((trade_year, _norm(p["name"])), 0)
                  for p in side.get("received_players", []))
        for pk in side.get("received_picks", []):
            rnd = pk.get("round")
            if not rnd:
                continue
            if source == "sleeper":
                season = int(pk.get("season") or 0)
                orig_rid = pk.get("previous_owner_id") or pk.get("roster_id")
                if not (season and orig_rid):
                    continue
                pid = sleeper_pick_player.get((season, rnd, orig_rid))
                if not pid:
                    continue
                name = sleeper_names.get(pid, "")
                if name:
                    pts += nfl.get((season, _norm(name)), 0)
            else:
                target_yr = trade_year + 1
                of = (pk.get("originally_from") or "").rstrip("?").strip().lower()
                orig_mgr = yahoo_name_to_mgr.get((trade_year, of)) if of else None
                orig_mgr = orig_mgr or giver_mgr
                player = yahoo_pick_player.get((target_yr, rnd, orig_mgr))
                if player:
                    pts += nfl.get((target_yr, _norm(player)), 0)
        return pts

    # Compute per-manager + per-pair stats
    per_mgr = defaultdict(lambda: {"n": 0, "p_recv": 0, "p_giv": 0,
                                    "pk_recv": 0, "pk_giv": 0,
                                    "partners": Counter()})
    pair_trades = defaultdict(list)  # (a, b) sorted -> [(year, net_for_first, source)]
    biggest = []  # (year, date, source, a_mgr, b_mgr, n_assets_a, n_assets_b, a_assets, b_assets)

    for t in trades:
        ma, mb = t["side_a_mgr"], t["side_b_mgr"]
        a, b = t["side_a"], t["side_b"]
        for own, mid, opp_mid in [(a, ma, mb), (b, mb, ma)]:
            per_mgr[mid]["n"] += 1
            per_mgr[mid]["p_recv"] += len(own.get("received_players", []))
            per_mgr[mid]["pk_recv"] += len(own.get("received_picks", []))
            per_mgr[mid]["partners"][opp_mid] += 1
        per_mgr[ma]["p_giv"] += len(b.get("received_players", []))
        per_mgr[ma]["pk_giv"] += len(b.get("received_picks", []))
        per_mgr[mb]["p_giv"] += len(a.get("received_players", []))
        per_mgr[mb]["pk_giv"] += len(a.get("received_picks", []))

        # Score trade if we have nflverse season data for that year
        if t["year"] in NFL_SCORED_YEARS:
            # giver of a's assets is b's manager, and vice versa
            pa = _score_side(a, t["source"], t["year"], mb)
            pb = _score_side(b, t["source"], t["year"], ma)
            key = tuple(sorted([ma, mb]))
            net = (pa - pb) if key[0] == ma else (pb - pa)
            pair_trades[key].append((t["year"], net, t["source"]))

        # Biggest single trade by asset count
        n_a = (len(a.get("received_players", []))
               + len(a.get("received_picks", [])))
        n_b = (len(b.get("received_players", []))
               + len(b.get("received_picks", [])))
        biggest.append((t["year"], t["date"], t["source"], ma, mb, n_a, n_b, a, b))

    biggest.sort(key=lambda x: -(x[5] + x[6]))

    n_yahoo = sum(1 for t in trades if t["source"] == "yahoo")
    n_sleeper = sum(1 for t in trades if t["source"] == "sleeper")
    n_total = n_yahoo + n_sleeper

    md = []
    md.append("# 🤝 MONEYLEAGUE — Trade Behavior")
    md.append(f"*{today} · {n_total} trades across 15 years (2011-2025) · "
              "Yahoo + Sleeper data*\n")
    md.append("---\n")

    md.append("## 📊 By the Numbers\n")
    md.append(f"- **Total trades scraped**: {n_total} ({n_yahoo} Yahoo + {n_sleeper} Sleeper)")
    md.append(f"- **Players moved**: {sum(d['p_recv'] for d in per_mgr.values())}")
    md.append(f"- **Draft picks moved**: {sum(d['pk_recv'] for d in per_mgr.values())}")
    md.append(f"- **Most active year**: see volume chart below\n")

    # ===== Active traders =====
    # ===== Aggregate Fleecer Ranking (sum of net VBD across all trades) =====
    md.append("## 🏆 Top Fleecers — Aggregate Ranking\n")
    md.append("Each manager's **total net point delta across every scored "
              "trade** they were ever in (Yahoo 2011-2022 + Sleeper 2023-2024). "
              "Positive = net winner, negative = net loser. "
              "**Picks are scored as the rookie-year nflverse points of the "
              "player actually drafted with that pick** (resolved via Yahoo "
              "draft CSVs 2015-2022 and Sleeper draft data 2023-2025). "
              "*2025 Sleeper trades and picks for the 2026 draft excluded — "
              "no season data yet. Yahoo picks for the 2012-2014 drafts and "
              "the 2023 (Sleeper) draft are unresolved.*\n")
    agg = defaultdict(float)
    agg_n = defaultdict(int)
    for t in trades:
        if t["year"] not in NFL_SCORED_YEARS:
            continue
        pa = _score_side(t["side_a"], t["source"], t["year"], t["side_b_mgr"])
        pb = _score_side(t["side_b"], t["source"], t["year"], t["side_a_mgr"])
        agg[t["side_a_mgr"]] += (pa - pb)
        agg[t["side_b_mgr"]] += (pb - pa)
        agg_n[t["side_a_mgr"]] += 1
        agg_n[t["side_b_mgr"]] += 1
    rows = sorted(agg.items(), key=lambda kv: -kv[1])
    md.append("| Rank | Manager | Trades | Net VBD | Per trade |")
    md.append("|---|---|---|---|---|")
    for i, (mid, net) in enumerate(rows, 1):
        n = agg_n[mid]
        per = net/n if n else 0
        md.append(f"| {i} | **{_mgr_name(mid)}** | {n} | "
                  f"**{net:+.0f}** | {per:+.0f} |")
    md.append("")
    top_fleecer = rows[0]
    bottom = rows[-1]
    md.append(f"*Net point deltas count full-season nflverse scoring for "
              f"each trade. **{_mgr_name(top_fleecer[0])}** is the league's "
              f"net winner ({top_fleecer[1]:+.0f}) across "
              f"{agg_n[top_fleecer[0]]} trades. "
              f"**{_mgr_name(bottom[0])}** is the net loser "
              f"({bottom[1]:+.0f}).*\n")

    md.append("## 🌀 Most Active Traders\n")
    md.append("| Rank | Manager | Trades | Players acq | Picks acq |")
    md.append("|---|---|---|---|---|")
    by_n = sorted(per_mgr.items(), key=lambda kv: -kv[1]["n"])
    for i, (mid, d) in enumerate(by_n, 1):
        md.append(f"| {i} | **{_mgr_name(mid)}** | {d['n']} | "
                  f"{d['p_recv']} | {d['pk_recv']} |")
    md.append("")
    md.append("**Trevor leads at every level** — most trades, most players "
              "acquired, most picks moved. Famously trades any deal. "
              "Brian and Coop are the next-most-active; the bottom group "
              "(Tim, Eric, Ankur) prefer building through draft + wire.\n")

    # ===== Biggest single trades =====
    md.append("## 🌪️ Biggest Single Trades (most assets moved)\n")
    md.append("| Year | Teams | Asset Count |")
    md.append("|---|---|---|")
    seen = set()
    n_shown = 0
    for yr, date_str, source, ma, mb, n_a, n_b, a, b in biggest:
        key = (yr, date_str, tuple(sorted([ma, mb])))
        if key in seen:
            continue
        seen.add(key)
        md.append(f"| {yr} | **{_mgr_name(ma)} ↔ {_mgr_name(mb)}** | "
                  f"{n_a + n_b} ({n_a}/{n_b}) |")
        n_shown += 1
        if n_shown >= 8:
            break
    md.append("")
    md.append("The biggest 2-team blockbusters in league history. Most include "
              "5+ players and 5+ picks per side.\n")

    # ===== Biggest 2-team trade detail =====
    md.append("### 💎 The Biggest Single Trade Ever\n")
    big = biggest[0]
    yr, date_str, source, ma, mb, n_a, n_b, a, b = big
    md.append(f"**{yr} {date_str} — {_mgr_name(ma)} ↔ {_mgr_name(mb)}**\n")
    md.append(f"**{_mgr_name(ma)} received:**")
    for p in a.get("received_players", []):
        md.append(f"- {p['name']}")
    for pk in a.get("received_picks", []):
        md.append(f"- Round {pk.get('round','?')}")
    md.append(f"\n**{_mgr_name(mb)} received:**")
    for p in b.get("received_players", []):
        md.append(f"- {p['name']}")
    for pk in b.get("received_picks", []):
        md.append(f"- Round {pk.get('round','?')}")
    md.append("")

    # ===== Fleecing patterns =====
    # Compute per-pair stats including Sleeper trades for "still active" check
    pair_all_years = defaultdict(set)  # for last-trade-overall
    for t in trades:
        key = tuple(sorted([t["side_a_mgr"], t["side_b_mgr"]]))
        pair_all_years[key].add(t["year"])

    def left_league(mid):
        rec = next((m for m in all_managers() if m["id"] == mid), None)
        if not rec:
            return False
        return rec.get("sleeper_roster_id") is None

    md.append("## 🦈 Top Fleecers\n")
    md.append("Net points imbalance per pair (full-season nflverse points "
              "through 2024; 2025 Sleeper trades excluded). Positive = the "
              "fleecer's net advantage. Status uses *all* trade history "
              "including unscored 2025.\n")
    cases = []
    for (a, b), trs in pair_trades.items():
        if len(trs) < 2:
            continue
        net = sum(n for _, n, _ in trs)
        if abs(net) < 200:
            continue
        wa = sum(1 for _, n, _ in trs if n > 0)
        wb = sum(1 for _, n, _ in trs if n < 0)
        yrs = [y for y, _, _ in trs]
        last_overall = max(pair_all_years.get((a, b), {0}))
        cases.append((a, b, len(trs), wa, wb, net, min(yrs), last_overall,
                       2025 - last_overall))
    cases.sort(key=lambda x: -abs(x[5]))

    md.append("| Fleecer | Victim | Trades | W-L | Net | Last trade | Status |")
    md.append("|---|---|---|---|---|---|---|")
    for a, b, n, wa, wb, net, first, last, quiet in cases[:15]:
        if net > 0:
            w_mid, l_mid, w, l = a, b, wa, wb
        else:
            w_mid, l_mid, w, l = b, a, wb, wa
        if left_league(l_mid):
            status = f"victim left league"
        elif left_league(w_mid):
            status = f"fleecer left league"
        elif quiet >= 3:
            status = f"⚠️ silent {quiet}yr"
        else:
            status = "still active"
        md.append(f"| **{_mgr_name(w_mid)}** | {_mgr_name(l_mid)} | {n} | "
                  f"{w}-{l} | **+{abs(net):.0f}** | {last} | {status} |")
    md.append("")

    # ===== Bailout patterns =====
    md.append("## 🚪 'Trade Rape → Victim Bailed' Cases\n")
    md.append("Pairs where one side dominated and the other side **stopped "
              "trading with them for 3+ years**. Excludes cases where the "
              "victim simply left the league.\n")
    bailout = [c for c in cases
               if c[8] >= 3 and abs(c[5]) >= 300
               and not left_league(c[1] if c[5] > 0 else c[0])
               and not left_league(c[0] if c[5] > 0 else c[1])]
    md.append("| Fleecer | Victim | W-L | Net | Last trade | Years silent |")
    md.append("|---|---|---|---|---|---|")
    for a, b, n, wa, wb, net, first, last, quiet in bailout:
        if net > 0:
            w_mid, l_mid, w, l = a, b, wa, wb
        else:
            w_mid, l_mid, w, l = b, a, wb, wa
        md.append(f"| **{_mgr_name(w_mid)}** | {_mgr_name(l_mid)} | "
                  f"{w}-{l} | +{abs(net):.0f} | {last} | {quiet} |")
    md.append("")

    # ===== Loyal customers =====
    md.append("## 🐑 Loyal Customers — Victims Who Keep Coming Back\n")
    md.append("Pairs where one side has dominated by 400+ net points but "
              "they're **still actively trading**:\n")
    loyal = [c for c in cases if c[8] < 3 and abs(c[5]) >= 400]
    loyal.sort(key=lambda x: -abs(x[5]))
    md.append("| Fleecer | 'Loyal Customer' | Trades | W-L | Net | Last trade |")
    md.append("|---|---|---|---|---|---|")
    for a, b, n, wa, wb, net, first, last, quiet in loyal:
        if net > 0:
            w_mid, l_mid, w, l = a, b, wa, wb
        else:
            w_mid, l_mid, w, l = b, a, wb, wa
        md.append(f"| **{_mgr_name(w_mid)}** | {_mgr_name(l_mid)} | {n} | "
                  f"{w}-{l} | +{abs(net):.0f} | {last} |")
    md.append("")

    # ===== Closest trade partners =====
    md.append("## 👯 Closest Trade Partners (most trades between same 2)\n")
    md.append("| Partnership | Total Trades | Years |")
    md.append("|---|---|---|")
    pair_count = defaultdict(int)
    pair_years = defaultdict(set)
    for t in trades:
        if t["source"] != "yahoo":
            continue
        key = tuple(sorted([t["side_a_mgr"], t["side_b_mgr"]]))
        pair_count[key] += 1
        pair_years[key].add(t["year"])
    top_pairs = sorted(pair_count.items(), key=lambda kv: -kv[1])[:10]
    for (a, b), n in top_pairs:
        yrs = sorted(pair_years[(a, b)])
        md.append(f"| {_mgr_name(a)} ↔ {_mgr_name(b)} | {n} | "
                  f"{min(yrs)}-{max(yrs)} |")
    md.append("")

    # ===== Embedded charts =====
    md.append("## 📈 Charts\n")
    chart_dir = ROOT / "data" / "charts"
    for fn, label in [
        ("trade_volume.png", "Trade Volume"),
        ("trade_network.png", "Trade Partnership Heatmap"),
        ("trade_lopsided_pairs.png", "Lopsided Pairs Over Time"),
        ("trade_assets_flow.png", "Assets Acquired via Trade"),
    ]:
        if (chart_dir / fn).exists():
            md.append(f"![{label}]({chart_dir / fn})\n")

    md.append("---\n")
    md.append("*Methodology: Yahoo transactions scraped via authenticated "
              "session, parsed via HTML row-pairing (each trade = 2 "
              "consecutive `<tr>` rows with rowspan=2 trade icon). Sleeper "
              "trades pulled from offline data dump. Net point scoring uses "
              "full-season nflverse fantasy points (0.5 PPR for 2019+, "
              "0 PPR before). Draft picks are resolved to the player actually "
              "drafted with that pick (snake-order math against each year's "
              "draft data) and scored using that player's points in the "
              "draft year.*")
    return "\n".join(md)


def _md_to_html(md_text: str) -> str:
    lines = md_text.split("\n")
    html = []
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
        m = re.match(r"!\[([^\]]*)\]\(([^)]+)\)", ln.strip())
        if m:
            cp(); ct()
            html.append(f'<img src="{m.group(2)}" alt="{m.group(1)}" '
                        f'style="max-width:100%;margin:10px 0;"/>')
            continue
        if ln.startswith("# "):
            cp(); ct(); html.append(f"<h1>{inline(ln[2:])}</h1>")
        elif ln.startswith("## "):
            cp(); ct(); html.append(f"<h2>{inline(ln[3:])}</h2>")
        elif ln.startswith("### "):
            cp(); ct(); html.append(f"<h3>{inline(ln[4:])}</h3>")
        elif ln.startswith("|") and "---" in ln:
            continue
        elif ln.startswith("|"):
            cells = [c.strip() for c in ln.strip("|").split("|")]
            if not in_table:
                cp()
                html.append("<table><thead><tr>"
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
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 720px;
           margin: 30px auto; padding: 0 28px; color: #1a1a1a;
           line-height: 1.55; font-size: 11pt; }
    h1 { font-size: 24pt; border-bottom: 3px solid #b8860b; padding-bottom: 8px;
         margin-top: 0; }
    h2 { font-size: 14pt; color: #0a4d6b; margin-top: 22px; margin-bottom: 4px;
         border-left: 4px solid #b8860b; padding-left: 10px; }
    h3 { font-size: 12pt; color: #555; margin-top: 12px; }
    table { width: 100%; border-collapse: collapse; margin: 6px 0 12px 0;
            font-size: 9.5pt; }
    th { background: #2c5d7c; color: white; padding: 4px 8px; text-align: left; }
    td { padding: 4px 8px; border-bottom: 1px solid #ddd; }
    tr:nth-child(even) td { background: #f8f8f8; }
    em { color: #555; }
    hr { border: none; border-top: 1px solid #ccc; margin: 16px 0; }
    p { margin: 4px 0; }
    p.b { margin: 2px 0 2px 14px; }
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
    HTML(string=html, base_url=str(ROOT)).write_pdf(str(PDF_OUT))
    print(f"Wrote {PDF_OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
