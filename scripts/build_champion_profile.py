"""Research Desk — THE CHAMPION PROFILE: what finals teams do differently.

Profiles every decided MONEYLEAGUE finals (champion + runner-up) against
the rest of the field across the tendencies that actually separate them:

  1. QB structure   — both top-2 QBs locked by R6 (all champs to date)
  2. Trade fuel     — share of starter points from traded-for players
  3. Waiver churn   — dependence on waivers is a LOSING signal
  4. Points-for     — record is noise past the cut; PF decides
  5. Keeper engine  — champions carry huge keeper VBD, built from late
                      picks / waivers the season BEFORE (Option Book
                      thesis validated at the title level)

Attribution: draft ownership joins the xlsx color overlay via
scripts.stash_curve._xlsx_owner_by_pick_no (truth: Sleeper's 2023 feed
misattributes 194/204 picks). Keepers are detected the way the backtest
does: explicit is_keeper flag OR implicit period-ADP gap >= 1.5 rounds.
Seasons are discovered from data/sleeper/league_*/ — a season folds in
automatically once its winners bracket is decided and its backtest
period files (proj/stats) exist.

When data/research/benchmark_validation.json exists (built by
scripts/build_benchmark_validation.py from the owner-free benchmark
corpus), the fragment gains an out-of-sample replication block: the same
signals graded in MONEYLEAGUE-format leagues none of us play in.

Outputs per the fragment contract:
data/research/champion_profile.{json,html}.
"""
from __future__ import annotations

import html as _html
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.team_identity import load_identity  # noqa: E402
from scripts.stash_curve import (  # noqa: E402
    _period_adp, _season_vbd, _xlsx_owner_by_pick_no)

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "research"
MY_RID = 9                     # Brian
EARLY_QB_ROUND = 6             # "both QBs locked by R6"
KEEPER_HIT_DISC = 5.0          # a "keeper hit" = >=5 rounds under ADP...
KEEPER_HIT_VBD = 75.0          # ...that actually produced (season VBD)


# ------------------------------------------------------------- discovery

def discover_seasons() -> dict[int, dict]:
    """Season -> {dir, champ, runner, playoff_rids, playoff_week_start}
    for every cached league whose finals are decided and whose period
    files (needed for keeper detection/grading) exist."""
    out: dict[int, dict] = {}
    for d in sorted((ROOT / "data" / "sleeper").glob("league_*")):
        lg_f, wb_f = d / "league.json", d / "winners_bracket.json"
        if not (lg_f.exists() and wb_f.exists() and (d / "matchups").is_dir()):
            continue
        season = int(json.loads(lg_f.read_text())["season"])
        if not ((ROOT / "data" / "backtest" / f"proj_{season}.json").exists()
                and (ROOT / "data" / "backtest" / f"stats_{season}.json").exists()):
            continue
        wb = json.loads(wb_f.read_text())
        final = next((m for m in wb if m.get("p") == 1 and m.get("w")), None)
        if not final:
            continue                      # season not decided yet
        out[season] = {
            "dir": d, "champ": final["w"], "runner": final["l"],
            "playoff_rids": {m[k] for m in wb for k in ("t1", "t2")
                             if isinstance(m.get(k), int)},
            "po_start": json.loads(lg_f.read_text())["settings"]
            .get("playoff_week_start", 15),
        }
    return out


# --------------------------------------------------------------- loaders

def _mgr_rid_map() -> dict[str, int]:
    ident = load_identity(ROOT / "data" / "team_identity.json")
    return {mid: rec["sleeper_roster_id"]
            for mid, rec in ident["managers"].items()
            if rec.get("sleeper_roster_id")}


def _corrected_picks(season: int, d: Path, mgr_rid: dict[str, int]):
    """(rid, pid) -> (round, is_keeper_flag), xlsx-true ownership where
    the overlay covers the season (falls back to Sleeper's roster_id —
    clean for 2025+)."""
    owners = _xlsx_owner_by_pick_no(season)
    out: dict[tuple[int, str], tuple[int, bool]] = {}
    for p in json.loads(next(d.glob("draft_*_picks.json")).read_text()):
        rid = mgr_rid.get(owners.get(p["pick_no"]), p["roster_id"])
        out[(rid, p["player_id"])] = (p["round"], bool(p.get("is_keeper")))
    return out


def _acquisitions(d: Path):
    """(rid, pid) -> latest (week, 'trade'|'waiver'); plus per-rid trade /
    add / FAAB counters."""
    acq: dict[tuple[int, str], tuple[int, str]] = {}
    n_adds: dict[int, int] = defaultdict(int)
    n_trades: dict[int, int] = defaultdict(int)
    faab: dict[int, int] = defaultdict(int)
    for f in sorted((d / "transactions").iterdir(),
                    key=lambda p: int(p.stem.split("_")[1])):
        wk = int(f.stem.split("_")[1])
        for t in json.loads(f.read_text()):
            if t.get("status") != "complete":
                continue
            if t["type"] == "trade":
                for rid in t.get("roster_ids") or []:
                    n_trades[rid] += 1
            for pid, rid in (t.get("adds") or {}).items():
                acq[(rid, pid)] = (wk, "trade" if t["type"] == "trade"
                                   else "waiver")
                if t["type"] != "trade":
                    n_adds[rid] += 1
                    faab[rid] += (t.get("settings") or {}).get("waiver_bid",
                                                               0) or 0
    return acq, n_adds, n_trades, faab


def _keepers(season, picks, pos_of):
    """rid -> keeper list with cost round, ADP-implied round, discount,
    and realized season VBD."""
    adp, vbd = _period_adp(season), _season_vbd(season)
    out: dict[int, list[dict]] = defaultdict(list)
    for (rid, pid), (r, flagged) in picks.items():
        a = adp.get(pid, 999.0)
        adp_round = max(1.0, a / 12.0) if a < 999 else None
        implicit = adp_round is not None and (r - adp_round) >= 1.5
        if flagged or implicit:
            out[rid].append({
                "pid": pid, "pos": pos_of(pid), "cost_round": r,
                "adp_round": round(adp_round, 1) if adp_round else None,
                "discount": round(r - adp_round, 1) if adp_round else None,
                "vbd": round(vbd.get(pid, 0.0), 1),
            })
    return out


# ------------------------------------------------------------------ core

def compute() -> dict:
    seasons = discover_seasons()
    if not seasons:
        sys.exit("champion_profile: no decided seasons found")
    mgr_rid = _mgr_rid_map()

    players = json.loads((ROOT / "data/sleeper/players_nfl.json").read_text())
    pos_of = lambda pid: (players.get(pid) or {}).get("position") or "?"  # noqa: E731
    name_of = lambda pid: " ".join(  # noqa: E731
        filter(None, [(players.get(pid) or {}).get("first_name"),
                      (players.get(pid) or {}).get("last_name")])) or pid

    picks_by = {s: _corrected_picks(s, m["dir"], mgr_rid)
                for s, m in seasons.items()}
    acq_by = {s: _acquisitions(m["dir"]) for s, m in seasons.items()}
    keep_by = {s: _keepers(s, picks_by[s], pos_of) for s in seasons}

    def keeper_origin(season: int, rid: int, pid: str) -> str:
        prev = season - 1
        if prev not in seasons:
            return "pre-Sleeper"
        ev = acq_by[prev][0].get((rid, pid))
        if ev:
            return f"{ev[1]} w{ev[0]} {prev}"
        dr = picks_by[prev].get((rid, pid))
        if dr:
            kept_prev = any(k["pid"] == pid for k in keep_by[prev].get(rid, []))
            return (f"kept again (R{dr[0]} {prev})" if kept_prev
                    else f"drafted R{dr[0]} {prev}")
        return "offseason pickup"

    rows: list[dict] = []
    finalist_buys: list[dict] = []
    champ_keeper_hits: list[dict] = []
    for season, m in seasons.items():
        d, po_start = m["dir"], m["po_start"]
        users = {u["user_id"]: u["display_name"]
                 for u in json.loads((d / "users.json").read_text())}
        rid_mgr = {r["roster_id"]: users.get(r["owner_id"], "?")
                   for r in json.loads((d / "rosters.json").read_text())}
        acq, n_adds, n_trades, faab = acq_by[season]

        drafted = {k: v[0] for k, v in picks_by[season].items()}
        qb_rounds: dict[int, list[int]] = defaultdict(list)
        for (rid, pid), r in drafted.items():
            if pos_of(pid) == "QB":
                qb_rounds[rid].append(r)

        def prov(rid, pid, week):
            ev = acq.get((rid, pid))
            if ev and ev[0] <= week:
                return ev[1], ev[0]
            r = drafted.get((rid, pid))
            return ("draft" if r is not None else "pre"), 0

        stat = defaultdict(lambda: defaultdict(float))
        wins: dict[int, float] = defaultdict(float)
        pf: dict[int, float] = defaultdict(float)
        po_acq_pts: dict[int, dict] = defaultdict(lambda: defaultdict(float))
        for wk in range(1, 18):
            f = d / "matchups" / f"week_{wk}.json"
            if not f.exists():
                continue
            ms = json.loads(f.read_text())
            if wk < po_start:
                by_m = defaultdict(list)
                for x in ms:
                    if x.get("matchup_id") is not None:
                        by_m[x["matchup_id"]].append(x)
                for pair in by_m.values():
                    if len(pair) != 2:
                        continue
                    a, b = pair
                    pa, pb = a["points"] or 0, b["points"] or 0
                    pf[a["roster_id"]] += pa
                    pf[b["roster_id"]] += pb
                    if pa != pb:
                        wins[(a if pa > pb else b)["roster_id"]] += 1
                    else:
                        wins[a["roster_id"]] += .5
                        wins[b["roster_id"]] += .5
            for x in ms:
                rid = x["roster_id"]
                pp = x.get("players_points") or {}
                for pid in (x.get("starters") or []):
                    if pid in ("0", None, ""):
                        continue
                    pts = pp.get(pid, 0) or 0
                    src, awk = prov(rid, pid, wk)
                    if wk < po_start:
                        stat[rid][src] += pts
                        stat[rid]["total"] += pts
                    elif src in ("trade", "waiver"):
                        po_acq_pts[rid][(pid, src, awk)] += pts

        for rid in range(1, 13):
            status = ("CHAMP" if rid == m["champ"]
                      else "RUNNER" if rid == m["runner"]
                      else "playoff" if rid in m["playoff_rids"] else "field")
            tot = stat[rid]["total"] or 1
            ks = keep_by[season].get(rid, [])
            qbs = sorted(qb_rounds[rid])
            rows.append({
                "season": season, "rid": rid,
                "mgr": rid_mgr.get(rid, "?"), "status": status,
                "wins": wins[rid], "pf": round(pf[rid], 0),
                "qb_rounds": qbs[:4],
                "early_2qb": len(qbs) >= 2 and qbs[1] <= EARLY_QB_ROUND,
                "trades": n_trades[rid], "adds": n_adds[rid],
                "faab": faab[rid],
                "pct_trade": round(100 * stat[rid]["trade"] / tot),
                "pct_waiver": round(100 * stat[rid]["waiver"] / tot),
                "keeper_vbd": round(sum(k["vbd"] for k in ks), 1),
                "n_keepers": len(ks),
            })
            if status in ("CHAMP", "RUNNER") and po_acq_pts[rid]:
                (pid, src, awk), pts = max(po_acq_pts[rid].items(),
                                           key=lambda kv: kv[1])
                finalist_buys.append({
                    "season": season, "status": status,
                    "mgr": rid_mgr.get(rid, "?"), "player": name_of(pid),
                    "pos": pos_of(pid), "how": src, "week": awk,
                    "po_pts": round(pts, 1),
                })
            if status == "CHAMP":
                for k in ks:
                    if ((k["discount"] or 0) >= KEEPER_HIT_DISC
                            and k["vbd"] >= KEEPER_HIT_VBD):
                        champ_keeper_hits.append({
                            "season": season, "mgr": rid_mgr.get(rid, "?"),
                            "player": name_of(k["pid"]), "pos": k["pos"],
                            "cost_round": k["cost_round"],
                            "adp_round": k["adp_round"],
                            "discount": k["discount"], "vbd": k["vbd"],
                            "origin": keeper_origin(season, rid, k["pid"]),
                        })

    def rollup(rs: list[dict]) -> dict:
        n = len(rs)
        avg = lambda k: round(sum(r[k] for r in rs) / n, 1)  # noqa: E731
        return {"n": n, "wins": avg("wins"), "pf": avg("pf"),
                "trades": avg("trades"), "adds": avg("adds"),
                "faab": avg("faab"), "pct_trade": avg("pct_trade"),
                "pct_waiver": avg("pct_waiver"),
                "keeper_vbd": avg("keeper_vbd")}

    groups = {
        "CHAMP": rollup([r for r in rows if r["status"] == "CHAMP"]),
        "RUNNER": rollup([r for r in rows if r["status"] == "RUNNER"]),
        "playoff-out": rollup([r for r in rows if r["status"] == "playoff"]),
        "field": rollup([r for r in rows if r["status"] == "field"]),
    }

    def po_rate(rs):
        made = sum(r["status"] in ("CHAMP", "RUNNER", "playoff") for r in rs)
        return {"n": len(rs), "made_playoffs": made,
                "rate": round(100 * made / len(rs)) if rs else 0}

    qb_split = {
        "early": po_rate([r for r in rows if r["early_2qb"]]),
        "late": po_rate([r for r in rows if not r["early_2qb"]]),
        "champs_early": sum(r["early_2qb"] for r in rows
                            if r["status"] == "CHAMP"),
        "finalists_early": sum(r["early_2qb"] for r in rows
                               if r["status"] in ("CHAMP", "RUNNER")),
        "champ_qb_rounds": {r["season"]: r["qb_rounds"][:2] for r in rows
                            if r["status"] == "CHAMP"},
    }

    brian = [{k: r[k] for k in ("season", "status", "wins", "pf",
                                "qb_rounds", "trades", "adds", "pct_trade",
                                "pct_waiver", "keeper_vbd")}
             for r in rows if r["rid"] == MY_RID]

    bench_f = OUT_DIR / "benchmark_validation.json"
    benchmark = json.loads(bench_f.read_text()) if bench_f.exists() else None

    # Decade view: champion QB shape across EVERY recorded title (xlsx
    # boards 2015-2022 + Sleeper 2023-25; the room has drafted 2.2-2.8
    # QBs/team every year — same 2QB format throughout).
    decade = []
    try:
        from scripts.build_history_charts import KNOWN_CHAMPIONS
        hist = json.loads(
            (ROOT / "data" / "manager_tendencies.json").read_text()
        ).get("decade_history") or {}
        champ_mid_by_year = {y: m for y, m in KNOWN_CHAMPIONS.items()
                             if y >= 2015}
        for s, m in seasons.items():          # Sleeper-era champs by rid
            rec = None
            from fantasy_draft.team_identity import manager_for_sleeper_roster
            rec = manager_for_sleeper_roster(m["champ"])
            if rec:
                champ_mid_by_year[s] = rec["id"]
        era_f = ROOT / "data" / "league_history" / "yahoo_era.json"
        era = ({int(k): v for k, v in
                json.loads(era_f.read_text()).items()}
               if era_f.exists() else {})

        def champ_pf_rank(y: int, mid: str):
            blob = era.get(y)
            if not blob:
                return None
            order = sorted(blob["teams"], key=lambda t: -t["pf"])
            for i, t in enumerate(order, 1):
                if t["manager"] == mid:
                    return i, blob["num_teams"]
            return None

        for y in sorted(champ_mid_by_year):
            mid = champ_mid_by_year[y]
            yr = (hist.get(mid) or {}).get("by_year", {}).get(str(y)) or \
                 (hist.get(mid) or {}).get("by_year", {}).get(y)
            if yr and yr.get("qb2") is not None:
                pfr = champ_pf_rank(y, mid)
                decade.append({"year": y, "champ": mid,
                               "qb1": yr["qb1"], "qb2": yr["qb2"],
                               "early": yr["qb2"] <= EARLY_QB_ROUND,
                               "pf_rank": pfr[0] if pfr else None,
                               "n_teams": pfr[1] if pfr else None})
    except Exception:
        pass

    return {
        "meta": {
            "generated": date.today().isoformat(),
            "seasons": sorted(seasons),
            "finals": {s: {"champ": m["champ"], "runner": m["runner"]}
                       for s, m in seasons.items()},
            "method": "xlsx-true draft ownership; keepers = is_keeper flag "
                      "or period-ADP gap >= 1.5 rounds, valued in realized "
                      "season VBD; starter-point shares over the regular "
                      "season; playoff rate = top-6 bracket entry",
        },
        "groups": groups,
        "qb_split": qb_split,
        "finalist_buys": sorted(finalist_buys,
                                key=lambda b: (b["season"], b["status"])),
        "champ_keeper_hits": sorted(champ_keeper_hits,
                                    key=lambda k: -k["vbd"]),
        "brian": brian,
        "benchmark": benchmark,
        "decade_champions": decade,
        "doctrine": "Champions are built a year early and finished "
                    "mid-season: two QBs locked by R6, a late-pick or "
                    "waiver find riding as a mega-discount keeper, and "
                    "one conviction trade for a blue-chip starter. Waiver "
                    "churn is what losing looks like, not a way back.",
    }


# -------------------------------------------------------------- fragment

def build_fragment(res: dict) -> str:
    e = _html.escape
    g = res["groups"]

    def grow(label: str, r: dict) -> str:
        cls = ' class="ml-sv-hi"' if label == "CHAMP" else ""
        return (f"<tr><td{cls}>{e(label)}</td>"
                f'<td class="ml-num">{r["n"]}</td>'
                f'<td class="ml-num">{r["wins"]:.1f}</td>'
                f'<td class="ml-num">{r["pf"]:,.0f}</td>'
                f'<td class="ml-num">{r["trades"]:.1f}</td>'
                f'<td class="ml-num">{r["pct_trade"]:.0f}%</td>'
                f'<td class="ml-num">{r["pct_waiver"]:.0f}%</td>'
                f'<td class="ml-num">{r["keeper_vbd"]:+.0f}</td></tr>')

    group_tbl = (
        '<table class="ml-table ml-table--compact"><thead><tr>'
        '<th>Finish</th><th class="ml-num">n</th><th class="ml-num">Wins</th>'
        '<th class="ml-num">Points-for</th><th class="ml-num">Trades</th>'
        '<th class="ml-num">Pts via trade</th><th class="ml-num">Pts via waiver</th>'
        '<th class="ml-num">Keeper VBD</th></tr></thead><tbody>'
        + "".join(grow(k, g[k]) for k in ("CHAMP", "RUNNER", "playoff-out",
                                          "field"))
        + "</tbody></table>")

    q = res["qb_split"]
    champ_qbs = " · ".join(f"{s}: R{a}+R{b}" for s, (a, b)
                           in sorted(q["champ_qb_rounds"].items()))

    dc = res.get("decade_champions") or []
    decade_block = ""
    if len(dc) >= 6:
        n_early = sum(d["early"] for d in dc)
        rows_d = " · ".join(
            f'{d["year"]} {e(d["champ"])} R{d["qb1"]}+R{d["qb2"]}'
            + ("&nbsp;✓" if d["early"] else "")
            + (f' (PF#{d["pf_rank"]})' if d.get("pf_rank") else "")
            for d in dc)
        pf_known = [d for d in dc if d.get("pf_rank")]
        pf_line = ""
        if pf_known:
            top3 = sum(1 for d in pf_known if d["pf_rank"] <= 3)
            pf_line = (f" PF is the decade law too: {top3} of "
                       f"{len(pf_known)} champions with parsed Yahoo/"
                       "Sleeper standings finished top-3 in scoring.")
        decade_block = f"""
<p class="ml-fineprint">Decade check (xlsx boards; same 2QB format all
era): only <strong>{n_early} of {len(dc)}</strong> recorded champions had
both QBs by R{EARLY_QB_ROUND} — {rows_d} — and three of the four are the
Sleeper-era champs above. Read with one confound: Yahoo-era rounds
include unflagged keepers at COST, so a champion's "R10 QB2" may be a
kept elite at a discount seat — the decade refutes early QB
<em>spending</em> as champion law, not QB <em>capital</em>. Together with
the outside benchmark (which also fails this signal), treat 2QB-by-R6 as
a current-regime exploit of this room's QB-late minority — real, priced,
and revocable — not a law of winning.{pf_line}</p>"""

    champ_badge = ' <span class="ml-badge ml-badge--bluechip">CHAMP</span>'
    buys_rows = "".join(
        f'<tr><td class="ml-num">{b["season"]}</td><td>{e(b["mgr"])}'
        f'{champ_badge if b["status"] == "CHAMP" else ""}</td>'
        f'<td>{e(b["player"])} <span class="ml-fineprint">{e(b["pos"])}</span></td>'
        f'<td>{e(b["how"])} w{b["week"]}</td>'
        f'<td class="ml-num">{b["po_pts"]:.1f}</td></tr>'
        for b in res["finalist_buys"])
    buys_tbl = (
        '<table class="ml-table ml-table--compact"><thead><tr>'
        '<th class="ml-num">Yr</th><th>Finalist</th><th>Top in-season pickup '
        'started in playoffs</th><th>How</th><th class="ml-num">PO pts</th>'
        f"</tr></thead><tbody>{buys_rows}</tbody></table>")

    hit_rows = "".join(
        f'<tr><td class="ml-num">{k["season"]}</td>'
        f'<td>{e(k["player"])} <span class="ml-fineprint">{e(k["pos"])}</span></td>'
        f'<td class="ml-num">R{k["cost_round"]}</td>'
        f'<td class="ml-num">R{k["adp_round"]:.0f}</td>'
        f'<td class="ml-num ml-sv-hi">{k["discount"]:+.1f}</td>'
        f'<td class="ml-num">{k["vbd"]:+.0f}</td><td>{e(k["origin"])}</td></tr>'
        for k in res["champ_keeper_hits"])
    hits_tbl = (
        '<table class="ml-table ml-table--compact"><thead><tr>'
        '<th class="ml-num">Yr</th><th>Champion keeper hit</th>'
        '<th class="ml-num">Cost</th><th class="ml-num">ADP</th>'
        '<th class="ml-num">Disc</th><th class="ml-num">VBD</th>'
        f"<th>Built from</th></tr></thead><tbody>{hit_rows}</tbody></table>")

    brian_rows = "".join(
        f'<tr><td class="ml-num">{b["season"]}</td><td>{e(b["status"])}</td>'
        f'<td class="ml-num">{b["wins"]:.0f}</td>'
        f'<td class="ml-num">{b["pf"]:,.0f}</td>'
        f'<td class="ml-num">{"–".join("R%d" % r for r in b["qb_rounds"][:2]) or "—"}</td>'
        f'<td class="ml-num">{b["pct_trade"]}%</td>'
        f'<td class="ml-num">{b["pct_waiver"]}%</td>'
        f'<td class="ml-num">{b["keeper_vbd"]:+.0f}</td></tr>'
        for b in res["brian"])
    brian_tbl = (
        '<table class="ml-table ml-table--compact"><thead><tr>'
        '<th class="ml-num">Yr</th><th>Finish</th><th class="ml-num">W</th>'
        '<th class="ml-num">Points-for</th><th class="ml-num">First 2 QBs</th>'
        '<th class="ml-num">Pts via trade</th><th class="ml-num">Pts via waiver</th>'
        f'<th class="ml-num">Keeper VBD</th></tr></thead><tbody>{brian_rows}'
        "</tbody></table>")

    bench_block = ""
    if res.get("benchmark"):
        b = res["benchmark"]
        bs, bm = b["signals"], b["meta"]
        names = sorted({ls["name"] for ls in bm["league_seasons"]})

        def verdict(ml_gap: float, bench_gap: float) -> str:
            if abs(bench_gap) < 0.15 * abs(ml_gap):
                return "MIXED"
            if bench_gap * ml_gap > 0:
                return '<span class="ml-sv-hi">REPLICATES</span>'
            return '<span class="ml-sv-lo">FAILS</span>'

        kv, q2 = bs["keeper_vbd"], bs["early_2qb"]
        wv, tr, pf_ = bs["waiver_share"], bs["trade_share"], bs["pf"]
        sig_rows = [
            ("Champion keeper VBD vs field",
             f'{g["CHAMP"]["keeper_vbd"]:+.0f} vs {g["field"]["keeper_vbd"]:+.0f}',
             f'{kv["champ_mean"]:+.0f} vs {kv["field_mean"]:+.0f}',
             verdict(g["CHAMP"]["keeper_vbd"] - g["field"]["keeper_vbd"],
                     kv["champ_mean"] - kv["field_mean"])),
            (f"Champs holding a ≥{KEEPER_HIT_DISC:.0f}-round keeper hit",
             f'{sum(1 for _ in {h["season"] for h in res["champ_keeper_hits"]})}'
             f'/{len(res["meta"]["seasons"])}',
             f'{kv["champs_with_hit"]}/{kv["n_champs"]}',
             verdict(1, kv["champs_with_hit"] / kv["n_champs"] - 0.5)),
            (f"2QB-by-R{EARLY_QB_ROUND} playoff rate",
             f'{q["early"]["rate"]}% vs {q["late"]["rate"]}%',
             f'{q2["po_rate_early"]}% vs {q2["po_rate_late"]}%',
             verdict(q["early"]["rate"] - q["late"]["rate"],
                     (q2["po_rate_early"] or 0) - (q2["po_rate_late"] or 0))),
            ("Waiver share (champ vs field, lower wins)",
             f'{g["CHAMP"]["pct_waiver"]:.0f}% vs {g["field"]["pct_waiver"]:.0f}%',
             f'{wv["champ_mean"]:.0f}% vs {wv["field_mean"]:.0f}%',
             verdict(g["field"]["pct_waiver"] - g["CHAMP"]["pct_waiver"],
                     wv["field_mean"] - wv["champ_mean"])),
            ("Trade share (finalists vs field)",
             f'{(g["CHAMP"]["pct_trade"] + g["RUNNER"]["pct_trade"]) / 2:.0f}%'
             f' vs {g["field"]["pct_trade"]:.0f}%',
             f'{tr["finalist_mean"]:.0f}% vs {tr["field_mean"]:.0f}%',
             verdict((g["CHAMP"]["pct_trade"] + g["RUNNER"]["pct_trade"]) / 2
                     - g["field"]["pct_trade"],
                     tr["finalist_mean"] - tr["field_mean"])),
            ("Champion points-for rank (mean; league middle ≈ 5.5)",
             "2.0", f'{pf_["champ_mean_rank"]:.1f}',
             verdict(1.0, 5.5 - pf_["champ_mean_rank"])),
        ]
        bench_tbl = (
            '<table class="ml-table ml-table--compact"><thead><tr>'
            '<th>Signal</th><th class="ml-num">MONEYLEAGUE</th>'
            '<th class="ml-num">Outside rooms</th><th>Verdict</th>'
            "</tr></thead><tbody>"
            + "".join(f'<tr><td>{e(s)}</td><td class="ml-num">{m}</td>'
                      f'<td class="ml-num">{o}</td><td>{v}</td></tr>'
                      for s, m, o, v in sig_rows)
            + "</tbody></table>")
        bench_block = f"""
<div class="ml-h-label">Out-of-sample check — do the signals replicate
where we don't play?</div>
<p class="ml-serial">{bm["leagues_graded"]} LEAGUE-SEASONS ·
{e(" / ".join(names))} · ZERO SHARED OWNERS</p>
{bench_tbl}
<p class="ml-fineprint">Benchmark method: {e(bm["method"])}. Corpus found
by snowball crawl through the superflex neighborhood two-plus hops from
our rivals' leaguemates; every league verified owner-free. Verdicts are
directional (REPLICATES = same sign, MIXED = near-flat, FAILS =
opposite); no xlsx overlay exists for outside leagues, so their draft
feeds are trusted as-is. Read a FAILS as calibration, not refutation:
the 2QB-by-R{EARLY_QB_ROUND} edge is negative outside in BOTH size
classes, so treat it as pricing THIS room's QB-late minority — an
exploit of our rivals, not a law of superflex.</p>"""

    meta = res["meta"]
    yrs = ", ".join(str(s) for s in meta["seasons"])
    return f"""<section class="ml-panel" id="champion-profile">
<h2>The Champion Profile — what finals teams do differently</h2>
<p class="ml-serial">{e(yrs)} FINALS · {len(meta["seasons"]) * 2} FINALIST
TEAM-SEASONS VS THE FIELD · {e(meta["generated"])}</p>
<p><strong>{e(res["doctrine"])}</strong></p>
<div class="ml-h-label">The separation (per-team averages, regular season)</div>
{group_tbl}
<p>Record barely separates finalists from playoff-outs
({g["CHAMP"]["wins"]:.1f}/{g["RUNNER"]["wins"]:.1f} vs
{g["playoff-out"]["wins"]:.1f} wins) — <strong>points-for does</strong>,
confirming the Autopsy: roster strength decides this league. Champions
average <strong>{g["CHAMP"]["keeper_vbd"]:+.0f} keeper VBD</strong> vs
{g["field"]["keeper_vbd"]:+.0f} for the field, and every finalist got real
starter production via trade while the field's median trade share is zero.</p>
<div class="ml-h-label">QB structure</div>
<p>Teams with both top-2 QBs by R{EARLY_QB_ROUND} made the playoffs
<strong>{q["early"]["rate"]}%</strong> of the time
({q["early"]["made_playoffs"]}/{q["early"]["n"]}) vs
{q["late"]["rate"]}% ({q["late"]["made_playoffs"]}/{q["late"]["n"]}) —
a group holding {q["champs_early"]}/{len(meta["seasons"])} champions and
{q["finalists_early"]}/{len(meta["seasons"]) * 2} finalists. The champion
shape is one elite + one solid ({e(champ_qbs)}), <em>not</em> two premium
picks: both R1+R2 double-QB starts finished bottom-two.</p>
{decade_block}
<div class="ml-h-label">The buys that won rings</div>
{buys_tbl}
<p>Title-relevant <em>trades</em> cluster in W6–10 — the exact window the Timing
Study prices as the buyer's <em>worst</em>. Reconciliation: you lose the
trade on paper and win the title on the field, but only when the buy is a
concentrated blue-chip starter, not depth.</p>
<div class="ml-h-label">The keeper engine (champions' mega-discount keepers)</div>
{hits_tbl}
<p>Every championship carried at least one keeper ≥{KEEPER_HIT_DISC:.0f}
rounds under ADP that produced ≥{KEEPER_HIT_VBD:.0f} VBD — all built from
late picks or waivers the season before. Runner-ups average
{g["RUNNER"]["keeper_vbd"]:+.0f} keeper VBD: surplus keepers are champion
fuel specifically, not merely finals fuel.</p>
{bench_block}
<div class="ml-h-label">Brian vs the template</div>
{brian_tbl}
<p class="ml-fineprint">Method: {e(meta["method"])}. Small sample
({len(meta["seasons"])} seasons, {len(meta["seasons"]) * 2} finalist sides)
— read directions, not decimals. Trade share is partly reverse-causal
(contenders attract offers). Keeper VBD is fuel, not a ring: two field
teams topped +190 and missed. New seasons fold in automatically once the
bracket decides. Recomputed weekly.</p>
</section>
"""


def main() -> None:
    res = compute()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "champion_profile.json").write_text(json.dumps(res, indent=2))
    (OUT_DIR / "champion_profile.html").write_text(build_fragment(res))
    g = res["groups"]
    print(f"[champion_profile] seasons={res['meta']['seasons']} — "
          f"champ keeper VBD {g['CHAMP']['keeper_vbd']:+.0f} vs field "
          f"{g['field']['keeper_vbd']:+.0f}; early-2QB playoff rate "
          f"{res['qb_split']['early']['rate']}% vs "
          f"{res['qb_split']['late']['rate']}%; "
          f"{len(res['champ_keeper_hits'])} champion keeper hits; "
          + (f"benchmark block: {res['benchmark']['meta']['leagues_graded']} "
             f"outside league-seasons" if res.get("benchmark")
             else "no benchmark data (replication block omitted)"))


if __name__ == "__main__":
    main()
