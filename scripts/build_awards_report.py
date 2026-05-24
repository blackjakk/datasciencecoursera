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
    load_all_trades, summarize_trade, load_player_ownership_windows,
)
from fantasy_draft.team_identity import manager_for_sleeper_roster

ROOT = Path(__file__).resolve().parent.parent
MD_OUT = ROOT / "data" / "MONEYLEAGUE_AWARDS.md"
PDF_OUT = ROOT / "data" / "MONEYLEAGUE_AWARDS.pdf"


def mgr_name(rid: int) -> str:
    m = manager_for_sleeper_roster(rid)
    if not m:
        return f"Roster {rid}"
    # Strip parenthetical league nicknames for cleaner display
    # (e.g. "Lem (LEMVP)" -> "Lem").
    return m["canonical_name"].split(" (")[0]


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

    # ===== Wire Game (FA hits + Keeper carryovers) =====
    # Find FA pickups that scored positive VBD (hits — kept rest-of-season).
    # Sub-replacement adds are noise (can be dropped); count only the wins.
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

    wire = defaultdict(lambda: {
        "fa_adds": 0, "fa_hits": 0, "fa_hit_vbd": 0.0, "best_fa": None,
        "kept": 0, "kept_vbd": 0.0, "future_carry": 0.0,
    })
    kdef_stream = defaultdict(lambda: {"adds": 0, "hits": 0, "vbd": 0.0, "best": None})
    # Ownership windows: who actually held each player which weeks.
    owners = load_player_ownership_windows(ROOT / "data" / "sleeper")
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
                    rid = int(rid)
                    # Use ownership window to credit only weeks this rid
                    # actually held the player (avoids double-counting when
                    # streaming/dropping).
                    intervals = owners.get((season, str(pid)), [])
                    pts = 0.0
                    for s_wk, e_wk, owner_rid in intervals:
                        if owner_rid == rid and s_wk >= wk:
                            pts += sum(pp_sw[season].get(w, {}).get(str(pid), 0.0)
                                       for w in range(s_wk, e_wk + 1))
                            break  # only the interval starting at this pickup
                    pos = (catalog.get(str(pid)) or {}).get("position") or ""
                    fa_vbd = pts - repl[season].get(pos, 0)
                    wire[rid]["fa_adds"] += 1
                    nm = (catalog.get(str(pid)) or {}).get("full_name", pid)
                    # All positive-VBD FA pickups feed the Wire Game total.
                    if fa_vbd > 0:
                        wire[rid]["fa_hits"] += 1
                        wire[rid]["fa_hit_vbd"] += fa_vbd
                    if not wire[rid]["best_fa"] or pts > (
                            (wire[rid]["best_fa"] or {}).get("pts", -999)):
                        wire[rid]["best_fa"] = {"name": nm, "pts": pts,
                                                  "wk": wk, "season": season}
                    # K/DEF also feed the dedicated Streamers award.
                    if pos in ("K", "DEF", "DST"):
                        kdef_stream[rid]["adds"] += 1
                        if fa_vbd > 0:
                            kdef_stream[rid]["hits"] += 1
                            kdef_stream[rid]["vbd"] += fa_vbd
                        if not kdef_stream[rid].get("best") or pts > kdef_stream[rid]["best"]["pts"]:
                            kdef_stream[rid]["best"] = {"name": nm, "pts": pts,
                                                          "pos": pos, "wk": wk,
                                                          "season": season}
                    if not best_pickup_ever or pts > best_pickup_ever["pts"]:
                        best_pickup_ever = {"name": nm, "rid": rid, "pts": pts,
                                             "wk": wk, "season": season}

    # Keeper carryovers using BOTH the Sleeper is_keeper flag AND
    # multi-year-roster detection (anyone on roster 2+ consecutive years
    # is functionally a keeper carryover even if Sleeper's flag missed it).
    holdovers = defaultdict(list)
    for p in picks:
        if p["player_name"]:
            holdovers[(p["roster_id"], p["player_name"])].append(p)
    for (rid, _name), entries in holdovers.items():
        if len(entries) < 2:
            continue
        season_to_entry = {e["season"]: e for e in entries}
        seasons_list = sorted(season_to_entry)
        # Find consecutive runs; 2nd+ year of each run = carryover.
        run = [seasons_list[0]]
        runs = []
        for s in seasons_list[1:]:
            if s == run[-1] + 1:
                run.append(s)
            else:
                if len(run) >= 2:
                    runs.append(run)
                run = [s]
        if len(run) >= 2:
            runs.append(run)
        for r in runs:
            for s in r[1:]:  # 2nd year onward = carryover
                e = season_to_entry[s]
                wire[rid]["kept"] += 1
                wire[rid]["kept_vbd"] += e["vbd"]

    # Future-carry credit: projected 2026 keeper raw VBD (top players who
    # will keep producing). Captures Puka-style multi-year asset value
    # beyond the historical data.
    try:
        keepers_2026 = json.loads((ROOT / "data" / "keepers_2026.json").read_text(encoding="utf-8"))
        for k in keepers_2026:
            if k.get("status") != "carryover":
                continue
            rid = int(k["team_idx"]) + 1  # team_idx -> roster_id
            wire[rid]["future_carry"] = wire[rid].get("future_carry", 0.0) + (k.get("raw_vbd") or 0)
    except FileNotFoundError:
        pass

    for rid, m in wire.items():
        m["total"] = m["fa_hit_vbd"] + m["kept_vbd"] + m.get("future_carry", 0)

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

    # ===== Trade scorecard (post-trade weekly points only) =====
    trades = load_all_trades(ROOT / "data" / "sleeper")
    pts_by_season = {s["season"]: s["player_total_points"] for s in seasons.values()}
    roster_team = {rid: r["team_name"]
                   for s in seasons.values() for rid, r in s["rosters"].items()}
    team_to_rid = {r["team_name"]: rid for s in seasons.values()
                    for rid, r in s["rosters"].items()}
    weekly_by_season = {s: dict(w) for s, w in pp_sw.items()}
    trade = defaultdict(lambda: {"n": 0, "net": 0.0})
    tank = defaultdict(lambda: {"n_trades": 0, "given": 0.0, "received": 0.0,
                                  "star_sells": 0, "biggest_loss": 0.0})
    leverage = defaultdict(lambda: {"n_future_given": 0, "future_given_val": 0.0,
                                      "n_future_received": 0, "future_received_val": 0.0})
    for t in trades:
        if t.get("_season") == 2023:
            continue
        sides = summarize_trade(t, roster_team, catalog, pts_by_season, pv_blind,
                                 weekly_points_by_season=weekly_by_season)
        for s in sides:
            trade[s["team"]]["n"] += 1
            trade[s["team"]]["net"] += s["net"]
            rid = team_to_rid.get(s["team"])
            if rid is not None:
                tank[rid]["n_trades"] += 1
                tank[rid]["given"] += s["given_value"]
                tank[rid]["received"] += s["received_value"]
                if s["given_value"] >= 100:
                    tank[rid]["star_sells"] += 1
                if s["net"] < tank[rid]["biggest_loss"]:
                    tank[rid]["biggest_loss"] = s["net"]
        # Future picks given/received.
        season = t.get("_season")
        for pk in (t.get("draft_picks") or []):
            rnd = int(pk.get("round") or 0)
            pick_season = int(pk.get("season") or 0)
            value = pv_blind.get(rnd, 0)
            new_owner = int(pk.get("owner_id") or 0)
            prev_owner = int(pk.get("previous_owner_id") or 0)
            if pick_season > season:
                if prev_owner > 0:
                    leverage[prev_owner]["n_future_given"] += 1
                    leverage[prev_owner]["future_given_val"] += value
                if new_owner > 0:
                    leverage[new_owner]["n_future_received"] += 1
                    leverage[new_owner]["future_received_val"] += value

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

    # K/DEF DRAFTING EDGE — above empirical mean at the round picked.
    pv_pos = pv["by_round_position"]
    kdef_draft = defaultdict(lambda: {"n": 0, "above": 0.0, "best": None})
    for p in picks:
        if p.get("is_keeper") or p["position"] not in ("K", "DEF"):
            continue
        rid = p["roster_id"]
        per_pos = pv_pos.get(str(p["round"]), {}).get(p["position"], {})
        exp_mean = per_pos.get("mean_vbd", 0) if per_pos else 0
        above = p["vbd"] - exp_mean
        kdef_draft[rid]["n"] += 1
        kdef_draft[rid]["above"] += above
        if not kdef_draft[rid]["best"] or above > kdef_draft[rid]["best"]["above"]:
            kdef_draft[rid]["best"] = {"name": p["player_name"], "season": p["season"],
                                          "round": p["round"], "above": above}

    return {
        "picks": picks,
        "seasons": seasons,
        "draft": draft,
        "wire": wire,
        "kdef_stream": kdef_stream,
        "kdef_draft": kdef_draft,
        "lineup": lineup,
        "trade": trade,
        "tank": tank,
        "leverage": leverage,
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
    # Dynamic annotation — compute who's actually top by each metric.
    by_raw = sorted(D["draft"].items(), key=lambda x: -x[1]["sum_vbd"] / max(1, x[1]["n"]))
    raw_top = mgr_name(by_raw[0][0])
    skill_top = mgr_name(rows[0][0])
    skill_2nd = mgr_name(rows[1][0]) if len(rows) > 1 else "?"
    md.append(f"\n*By raw per-pick: **{raw_top}** #1. "
              f"By skill-adjusted (above-expectation): **{skill_top}** #1, {skill_2nd} #2.*\n")

    # ========== Wire Game (FA + Keepers + Future Carry) ==========
    md.append("## 🔍 WIRE GAME — talent acquisition + multi-year retention")
    md.append("FA + keepers + future-carry are one skill: find good players outside the draft, hold them, "
              "and lock in projected future value. Components: "
              "(a) positive-VBD FA pickups, "
              "(b) carryover VBD from 2+ consecutive years on roster, "
              "(c) projected 2026 keeper raw VBD (future credit for current top players).\n")
    md.append("| Rank | Manager | FA hits | FA VBD | Carry yrs | Carry VBD | 2026 future | **Total** | Best FA pickup |")
    md.append("|---|---|---|---|---|---|---|---|---|")
    rows = sorted(D["wire"].items(), key=lambda x: -x[1]["total"])
    for i, (rid, m) in enumerate(rows, 1):
        best = m["best_fa"]
        best_str = f"{best['name']} ({best['pts']:.0f}, {best['season']} W{best['wk']})" if best else "—"
        md.append(f"| {i} | **{mgr_name(rid)}** | {m['fa_hits']}/{m['fa_adds']} | "
                  f"{m['fa_hit_vbd']:+.0f} | {m['kept']} | "
                  f"{m['kept_vbd']:+.0f} | {m['future_carry']:+.0f} | **{m['total']:+.0f}** | {best_str} |")
    md.append("")

    bp = D["best_pickup"]
    md.append(f"**League best raw pickup ever:** {bp['name']} → {mgr_name(bp['rid'])} "
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

    # ========== Best Streamers (K/DEF FA) ==========
    md.append("## 🌊 BEST STREAMERS — K/DEF waiver kings")
    md.append("Sum of positive-VBD K/DEF pickups across the season. Volume + matchup-savvy = high streamer score. "
              "(K/DEF VBD is already counted in the Wire Game total above; this is the dedicated breakdown.)\n")
    md.append("| Rank | Manager | K/DEF adds | Hits | Hit VBD | Best stream |")
    md.append("|---|---|---|---|---|---|")
    rows = sorted(D["kdef_stream"].items(), key=lambda x: -x[1]["vbd"])
    for i, (rid, m) in enumerate(rows, 1):
        b = m.get("best")
        best_str = f"{b['name']} ({b['pts']:.0f}, {b['season']} W{b['wk']})" if b else "—"
        md.append(f"| {i} | **{mgr_name(rid)}** | {m['adds']} | {m['hits']} | "
                  f"{m['vbd']:+.0f} | {best_str} |")
    md.append("")

    # ========== K/DEF Drafting Edge ==========
    md.append("## 🎯 K/DEF DRAFTING EDGE — drafting kickers/defenses at the right round")
    md.append("Above-empirical-mean VBD for K/DEF picks. Drafting Tucker R12 or Dicker R14 = big edge.\n")
    md.append("| Rank | Manager | # K/DEF picks | Above-exp total | Per pick | Best K/DEF pick |")
    md.append("|---|---|---|---|---|---|")
    rows = sorted(D["kdef_draft"].items(), key=lambda x: -x[1]["above"])
    for i, (rid, m) in enumerate(rows, 1):
        b = m.get("best")
        best_str = f"{b['name']} ({b['season']} R{b['round']}, {b['above']:+.0f})" if b else "—"
        per_pick = m["above"] / max(1, m["n"])
        md.append(f"| {i} | **{mgr_name(rid)}** | {m['n']} | "
                  f"{m['above']:+.0f} | {per_pick:+.1f} | {best_str} |")
    md.append("")

    # ========== Tank Artists ==========
    md.append("## 💰 BIGGEST TANK ARTISTS — sold the most value via trades")
    md.append("Sum of given-value (players + picks) across all trades. Star-sells = trades where they gave a +100 VBD player/pick.\n")
    md.append("| Rank | Manager | Trades | VBD given | Net | Star-sells | Biggest single loss |")
    md.append("|---|---|---|---|---|---|---|")
    rows = sorted(D["tank"].items(), key=lambda x: -x[1]["given"])
    for i, (rid, m) in enumerate(rows, 1):
        net = m["received"] - m["given"]
        md.append(f"| {i} | **{mgr_name(rid)}** | {m['n_trades']} | "
                  f"+{m['given']:.0f} | {net:+.0f} | {m['star_sells']} | {m['biggest_loss']:+.0f} |")
    md.append("")

    # ========== Leverage Future ==========
    md.append("## 🔮 LEVERAGES THE FUTURE — gave up future-season picks to win NOW")
    md.append("Count + value of FUTURE-SEASON picks given up in trades. High value = aggressive 'mortgage the future' approach.\n")
    md.append("| Rank | Manager | Future picks given | Value given | Net future mortgage |")
    md.append("|---|---|---|---|---|")
    rows = sorted(D["leverage"].items(),
                   key=lambda x: -(x[1]["future_given_val"] - x[1]["future_received_val"]))
    for i, (rid, m) in enumerate(rows, 1):
        net_mortgage = m["future_given_val"] - m["future_received_val"]
        md.append(f"| {i} | **{mgr_name(rid)}** | {m['n_future_given']} | "
                  f"+{m['future_given_val']:.0f} | {net_mortgage:+.0f} |")
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
    md.append("| Rank | Manager | Total adds | Hits | Hit % | Style |")
    md.append("|---|---|---|---|---|---|")
    rows = sorted(D["wire"].items(), key=lambda x: -x[1]["fa_adds"])
    for i, (rid, m) in enumerate(rows, 1):
        hit_pct = m["fa_hits"] * 100 / max(1, m["fa_adds"])
        if m["fa_adds"] >= 150:
            style = "🌪️ spray-and-pray volume"
        elif m["fa_adds"] >= 90:
            style = "active churner"
        elif m["fa_adds"] >= 50:
            style = "selective tactical"
        else:
            style = "minimal-touch"
        md.append(f"| {i} | **{mgr_name(rid)}** | {m['fa_adds']} | "
                  f"{m['fa_hits']} | {hit_pct:.0f}% | {style} |")
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
    wire_total = {rid: m["total"] for rid, m in D["wire"].items()}
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
        w_pct = pct_rank(wire_total.get(rid, 0), list(wire_total.values()))
        l_pct = pct_rank(lineup_per.get(rid, 0), list(lineup_per.values()))
        t_pct = pct_rank(trade_net.get(rid, 0), list(trade_net.values()))
        composite.append({
            "rid": rid, "name": mgr_name(rid),
            "draft": d_pct, "wire": w_pct, "lineup": l_pct, "trade": t_pct,
            "avg": (d_pct + w_pct + l_pct + t_pct) / 4,
        })
    composite.sort(key=lambda x: -x["avg"])
    md.append("| Rank | Manager | Draft | Wire | Lineup | Trade | **Avg** |")
    md.append("|---|---|---|---|---|---|---|")
    for i, c in enumerate(composite, 1):
        md.append(f"| {i} | **{c['name']}** | {c['draft']:.0f} | {c['wire']:.0f} | "
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
    @page { size: letter; margin: 0.4in; }
    body { font-family: 'Helvetica', sans-serif; font-size: 9pt; line-height: 1.25;
            color: #222; margin: 0; padding: 0; }
    h1 { color: #b8860b; border-bottom: 2px solid #b8860b; padding-bottom: 3px;
          margin: 0 0 4px 0; font-size: 16pt; }
    h2 { color: #1e6091; border-bottom: 1px solid #1e6091; padding-bottom: 1px;
          margin: 10px 0 3px 0; font-size: 11pt; }
    h3 { color: #444; margin: 6px 0 2px 0; font-size: 10pt; }
    p { margin: 2px 0; }
    table { border-collapse: collapse; margin: 2px 0 4px 0; width: 100%; font-size: 8pt; }
    th, td { border: 1px solid #ccc; padding: 1.5px 4px; text-align: left; }
    th { background: #efefef; font-weight: 600; }
    tr:nth-child(even) td { background: #fafafa; }
    strong { color: #000; }
    em { color: #666; font-style: italic; }
    code { background: #f5f5f5; padding: 0 3px; border-radius: 2px; font-size: 0.92em; }
    hr { border: none; border-top: 1px solid #ddd; margin: 8px 0; }
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
