#!/usr/bin/env python3
"""build_trade_ledger.py — THE BOOK: in-league trade ledger + counterparty
dossiers, from the data/scouting/ cache (no network).

Emits four artifacts into data/research/ per the RESEARCH DESK fragment
contract (one <section> each, ml.css classes only, zero raw hex):

  trade_ledger.json / trade_ledger.html
      Every completed MONEYLEAGUE trade 2023-25 with a rest-of-season
      grade: for each side, points the players they RECEIVED scored in
      the weeks AFTER the trade week (through week 17) minus the same for
      players they GAVE. Weekly scoring = Sleeper `pts_half_ppr`, falling
      back to `pts_ppr - 0.5*rec`. Draft picks and FAAB are listed as
      assets but graded 0 points (a pick's value realizes at a future
      draft — honest, not clever; see fragment fineprint). Sharks & fish
      standings = all-time net points swung per manager.

  counterparty_dossiers.json / counterparty_dossiers.html
      Behavioral scouting on each of the 11 rivals across their OTHER
      Sleeper leagues: leagues + formats per season, deals closed, timing
      histogram (early w1-4 / mid w5-9 / deadline w10+), positional flow,
      picks moved, superflex-weighted pace — beside their in-league count
      for contrast. NO cross-league value grades (formats differ; the
      fineprint says so). Rivals with no outside leagues (TBreswick,
      dibach215) get "no outside book" cards.

Usage: python3 scripts/build_trade_ledger.py
"""

from __future__ import annotations

import html
import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCOUT = ROOT / "data" / "scouting"
OUT = ROOT / "data" / "research"

SEASONS = (2023, 2024, 2025)
LAST_GRADED_WEEK = 17  # league season ends week 17; week 18 never counts

ML_LEAGUES = {
    2023: "1001657805583077376",
    2024: "1085805164784664576",
    2025: "1245039290518360064",
}
BRIAN_UID = "207020614303621120"

RIVALS = {  # display name -> user_id (the 11 current counterparties)
    "kbrower": "335950922154774528",
    "kylefiggy": "461689313671770112",
    "tjt5055": "470754140222386176",
    "BigDickNicholas": "721397055716659200",
    "TBreswick": "1001713986179686400",
    "LEMVP": "1001871601794637824",
    "apatel185": "1001875733720981504",
    "troymullings": "1001879029017903104",
    "dibach215": "1001897607733514240",
    "emattessich": "1001952871493054464",
    "Wi1dboy": "1249817196369022976",
}

POS_ORDER = ("QB", "RB", "WR", "TE", "K", "DEF")

# GRADING v2 — points ABOVE positional replacement (PAR). Raw half-PPR
# points let QB volume dominate every grade (a mediocre QB outscores a
# good WR most weeks in raw points). Replacement level per position =
# the season's MEDIAN weekly score of the rank-N player that week, where
# N is the last body a 12-team room is starting anyway:
#   QB12 (12 starters even before superflex), RB30 (2 RB + flex share),
#   WR36 (3 WR starters), TE12, K12, DEF12.
# A player-week's PAR = weekly pts - replacement level for his position;
# weeks with no stat line contribute 0 (a replacement body fills in).
REPLACEMENT_RANKS = {"QB": 12, "RB": 30, "WR": 36, "TE": 12,
                     "K": 12, "DEF": 12}


def _load(path: Path):
    return json.loads(path.read_text())


# ------------------------------------------------------------- data access
class Desk:
    """Lazy access to the scouting cache + league identity maps."""

    def __init__(self) -> None:
        self.players = _load(ROOT / "data" / "sleeper" / "players_nfl.json")
        self.stats: dict[int, dict] = {
            s: _load(SCOUT / "stats" / f"stats_{s}.json") for s in SEASONS
        }
        self.rid_to_mgr: dict[int, dict[int, str]] = {}
        self.uid_to_rid: dict[int, dict[str, int]] = {}
        for season, lid in ML_LEAGUES.items():
            ldir = ROOT / "data" / "sleeper" / f"league_{lid}"
            users = {u["user_id"]: u["display_name"] for u in _load(ldir / "users.json")}
            self.rid_to_mgr[season] = {}
            self.uid_to_rid[season] = {}
            for r in _load(ldir / "rosters.json"):
                self.rid_to_mgr[season][r["roster_id"]] = users.get(
                    r["owner_id"], f"roster {r['roster_id']}")
                if r.get("owner_id"):
                    self.uid_to_rid[season][r["owner_id"]] = r["roster_id"]

    def pname(self, pid: str) -> str:
        p = self.players.get(pid) or {}
        return p.get("full_name") or f"{p.get('first_name', '')} {p.get('last_name', pid)}".strip() or pid

    def ppos(self, pid: str) -> str:
        p = self.players.get(pid) or {}
        return p.get("position") or (p.get("fantasy_positions") or ["?"])[0]

    def replacement_level(self, season: int, pos: str) -> float:
        """Fixed per-position weekly replacement level for a season: the
        median across weeks 1..17 of the rank-N weekly score at the
        position (N per REPLACEMENT_RANKS). Cached per season."""
        if not hasattr(self, "_repl"):
            self._repl: dict[int, dict[str, float]] = {}
        if season not in self._repl:
            import statistics
            levels: dict[str, float] = {}
            for p, n in REPLACEMENT_RANKS.items():
                weekly = []
                for w in range(1, LAST_GRADED_WEEK + 1):
                    rows = self.stats[season].get(str(w), {})
                    pts = sorted((self._row_pts(r) for r in rows.values()
                                  if r.get("pos") == p), reverse=True)
                    if len(pts) >= n:
                        weekly.append(pts[n - 1])
                levels[p] = round(statistics.median(weekly), 2) if weekly else 0.0
            self._repl[season] = levels
        return self._repl[season].get(pos, 0.0)

    @staticmethod
    def _row_pts(row: dict) -> float:
        if row.get("pts_half_ppr") is not None:
            return float(row["pts_half_ppr"])
        if row.get("pts_ppr") is not None:
            return float(row["pts_ppr"]) - 0.5 * float(row.get("rec") or 0)
        return 0.0

    def week_pts(self, season: int, week: int, pid: str) -> float:
        row = self.stats[season].get(str(week), {}).get(pid)
        if not row:
            return 0.0
        if row.get("pts_half_ppr") is not None:
            return float(row["pts_half_ppr"])
        if row.get("pts_ppr") is not None:
            return float(row["pts_ppr"]) - 0.5 * float(row.get("rec") or 0)
        return 0.0

    def ros_pts(self, season: int, after_week: int, pid: str) -> float:
        return round(sum(self.week_pts(season, w, pid)
                         for w in range(after_week + 1, LAST_GRADED_WEEK + 1)), 1)

    def ros_par(self, season: int, after_week: int, pid: str) -> float:
        """Rest-of-season points ABOVE positional replacement: for each
        week the player has a stat line, weekly pts minus the season's
        fixed replacement level for his position; no line = 0 PAR."""
        total = 0.0
        for w in range(after_week + 1, LAST_GRADED_WEEK + 1):
            row = self.stats[season].get(str(w), {}).get(pid)
            if not row:
                continue
            pos = row.get("pos") or self.ppos(pid)
            total += self._row_pts(row) - self.replacement_level(season, pos)
        return round(total, 1)

    def inleague_trades(self, season: int) -> list[dict]:
        out = []
        for w in range(1, 19):
            path = SCOUT / "inleague" / str(season) / f"transactions_w{w}.json"
            if not path.exists():
                continue
            out += [t for t in _load(path)
                    if t.get("type") == "trade" and t.get("status") == "complete"]
        # one transaction can appear in one week file only; sort by close time
        return sorted(out, key=lambda t: t.get("status_updated") or 0)


# ------------------------------------------------------------------ ledger
def grade_trade(desk: Desk, season: int, t: dict) -> dict:
    week = t.get("leg") or 1
    adds = t.get("adds") or {}
    drops = t.get("drops") or {}
    picks = t.get("draft_picks") or []
    faab = t.get("waiver_budget") or []
    parties = []
    for rid in t.get("roster_ids", []):
        recv_players = [{
            "id": pid, "name": desk.pname(pid), "pos": desk.ppos(pid),
            "ros_pts": desk.ros_pts(season, week, pid),
            "ros_par": desk.ros_par(season, week, pid),
        } for pid, to in adds.items() if to == rid]
        sent_players = [{
            "id": pid, "name": desk.pname(pid), "pos": desk.ppos(pid),
            "ros_pts": desk.ros_pts(season, week, pid),
            "ros_par": desk.ros_par(season, week, pid),
        } for pid, frm in drops.items() if frm == rid]
        recv_picks = [{"season": p["season"], "round": p["round"],
                       "orig_slot": p["roster_id"]}
                      for p in picks if p["owner_id"] == rid]
        sent_picks = [{"season": p["season"], "round": p["round"],
                       "orig_slot": p["roster_id"]}
                      for p in picks if p["previous_owner_id"] == rid]
        faab_in = sum(f["amount"] for f in faab if f["receiver"] == rid)
        faab_out = sum(f["amount"] for f in faab if f["sender"] == rid)
        swing = round(sum(p["ros_pts"] for p in recv_players)
                      - sum(p["ros_pts"] for p in sent_players), 1)
        swing_par = round(sum(p["ros_par"] for p in recv_players)
                          - sum(p["ros_par"] for p in sent_players), 1)
        parties.append({
            "manager": desk.rid_to_mgr[season].get(rid, f"roster {rid}"),
            "roster_id": rid,
            "received": {"players": recv_players, "picks": recv_picks,
                         "faab": faab_in},
            "sent": {"players": sent_players, "picks": sent_picks,
                     "faab": faab_out},
            "swing_ros_pts": swing,
            "swing_par_pts": swing_par,
        })
    # v2: verdicts and ordering run on PAR (points above positional
    # replacement); raw points ride along as the secondary column.
    parties.sort(key=lambda p: -p["swing_par_pts"])
    top = parties[0]["swing_par_pts"]
    players_moved = any(p["received"]["players"] for p in parties)
    if not players_moved:
        verdict, margin = "PUSH — picks/FAAB only (graded 0)", 0.0
    elif top > 0:
        verdict, margin = parties[0]["manager"], top
    else:
        verdict, margin = "PUSH", 0.0
    return {
        "season": season, "week": week,
        "transaction_id": t.get("transaction_id"),
        "parties": parties, "winner": verdict, "margin_par_pts": margin,
        "margin_ros_pts": (parties[0]["swing_ros_pts"]
                           if players_moved and top > 0 else 0.0),
    }


def build_ledger(desk: Desk) -> dict:
    trades = [grade_trade(desk, s, t) for s in SEASONS
              for t in desk.inleague_trades(s)]
    book: dict[str, dict] = defaultdict(lambda: {
        "deals": 0, "wins": 0, "losses": 0, "pushes": 0,
        "net_par_pts": 0.0, "net_ros_pts": 0.0,
        "biggest_heist": None, "worst_deal": None})
    for tr in trades:
        for p in tr["parties"]:
            row = book[p["manager"]]
            row["deals"] += 1
            row["net_ros_pts"] = round(row["net_ros_pts"] + p["swing_ros_pts"], 1)
            row["net_par_pts"] = round(row["net_par_pts"] + p["swing_par_pts"], 1)
            if tr["margin_par_pts"] == 0:
                row["pushes"] += 1
            elif p["swing_par_pts"] > 0:
                row["wins"] += 1
            else:
                row["losses"] += 1
            note = {"season": tr["season"], "week": tr["week"],
                    "swing_par_pts": p["swing_par_pts"],
                    "swing_ros_pts": p["swing_ros_pts"],
                    "counterparty": next(q["manager"] for q in tr["parties"]
                                         if q is not p),
                    "received": [x["name"] for x in p["received"]["players"]] +
                                [f"R{k['round']} '{str(k['season'])[2:]} pick"
                                 for k in p["received"]["picks"]]}
            if p["swing_par_pts"] > 0 and (row["biggest_heist"] is None or
                    p["swing_par_pts"] > row["biggest_heist"]["swing_par_pts"]):
                row["biggest_heist"] = note
            if p["swing_par_pts"] < 0 and (row["worst_deal"] is None or
                    p["swing_par_pts"] < row["worst_deal"]["swing_par_pts"]):
                row["worst_deal"] = note
    standings = sorted(({"manager": m, **v} for m, v in book.items()),
                       key=lambda r: -r["net_par_pts"])
    raw_order = sorted(standings, key=lambda r: -r["net_ros_pts"])
    raw_rank = {r["manager"]: i + 1 for i, r in enumerate(raw_order)}
    for i, r in enumerate(standings, 1):
        r["rank_par"] = i
        r["rank_raw"] = raw_rank[r["manager"]]
    return {
        "generated": time.strftime("%Y-%m-%d"),
        "seasons": list(SEASONS),
        "method": {
            "grade": "v2 — rest-of-season points ABOVE POSITIONAL "
                     "REPLACEMENT (PAR) swung: for players received minus "
                     f"sent, weeks (trade week+1)..{LAST_GRADED_WEEK}; a "
                     "player-week's PAR = weekly pts minus the season's "
                     "fixed replacement level for his position; weeks with "
                     "no stat line contribute 0",
            "replacement": "per season+position: median across weeks 1..17 "
                           "of the rank-N weekly score, N = "
                           + ", ".join(f"{p}{n}" for p, n
                                       in REPLACEMENT_RANKS.items()),
            "raw_secondary": "raw rest-of-season points kept as a secondary "
                             "column (net_ros_pts / swing_ros_pts)",
            "scoring": "pts_half_ppr; fallback pts_ppr - 0.5*rec",
            "picks_and_faab": "listed as assets, graded 0 points",
        },
        "replacement_levels": {str(s): {p: desk.replacement_level(s, p)
                                        for p in REPLACEMENT_RANKS}
                               for s in SEASONS},
        "trade_counts_by_season": dict(Counter(t["season"] for t in trades)),
        "trades": trades,
        "standings": standings,
    }


# --------------------------------------------------------------- dossiers
def league_format(lg: dict) -> dict:
    rp = lg.get("roster_positions") or []
    typ = (lg.get("settings") or {}).get("type", 0)
    return {
        "superflex": "SUPER_FLEX" in rp,
        "dynasty": typ == 2,
        "keeper": typ == 1,
        "teams": (lg.get("settings") or {}).get("num_teams") or lg.get("total_rosters"),
        "name": lg.get("name", "?"),
    }


def fmt_tag(f: dict) -> str:
    bits = ["SF" if f["superflex"] else "1QB"]
    if f["dynasty"]:
        bits.append("dynasty")
    elif f["keeper"]:
        bits.append("keeper")
    else:
        bits.append("redraft")
    return " ".join(bits)


def week_bucket(week: int) -> str:
    return "early" if week <= 4 else ("mid" if week <= 9 else "deadline")


def build_dossiers(desk: Desk, ledger: dict) -> dict:
    inleague_count = Counter()
    for tr in ledger["trades"]:
        for p in tr["parties"]:
            inleague_count[p["manager"]] += 1

    rivals_out = {}
    for name, uid in RIVALS.items():
        seasons_out, tot_trades, sf_trades, picks_moved = {}, 0, 0, 0
        histogram = Counter(early=0, mid=0, deadline=0)
        pos_flow = Counter()
        active_seasons = 0
        for season in SEASONS:
            lpath = SCOUT / "rivals" / f"leagues_{uid}_{season}.json"
            leagues = [lg for lg in (_load(lpath) if lpath.exists() else [])
                       if lg["league_id"] not in ML_LEAGUES.values()]
            if leagues:
                active_seasons += 1
            season_leagues, season_trades = [], 0
            for lg in leagues:
                lid = lg["league_id"]
                ldir = SCOUT / "rivals" / f"league_{lid}_{season}"
                f = league_format(_load(ldir / "league.json")
                                  if (ldir / "league.json").exists() else lg)
                rid = None
                for r in (_load(ldir / "rosters.json")
                          if (ldir / "rosters.json").exists() else []):
                    if r.get("owner_id") == uid or uid in (r.get("co_owners") or []):
                        rid = r["roster_id"]
                        break
                my_trades = []
                if rid is not None and (ldir / "trades.json").exists():
                    my_trades = [t for t in _load(ldir / "trades.json")["trades"]
                                 if rid in (t.get("roster_ids") or [])]
                for t in my_trades:
                    histogram[week_bucket(t.get("leg") or 1)] += 1
                    for pid, to in (t.get("adds") or {}).items():
                        if to == rid:
                            pos_flow[desk.ppos(pid)] += 1
                    for pid, frm in (t.get("drops") or {}).items():
                        if frm == rid:
                            pos_flow[desk.ppos(pid)] -= 1
                    for p in (t.get("draft_picks") or []):
                        if rid in (p.get("owner_id"), p.get("previous_owner_id")):
                            picks_moved += 1
                season_trades += len(my_trades)
                if f["superflex"]:
                    sf_trades += len(my_trades)
                season_leagues.append({"league_id": lid, **f,
                                       "their_trades": len(my_trades)})
            tot_trades += season_trades
            seasons_out[season] = {"leagues": season_leagues,
                                   "trades": season_trades}
        weighted = (round((sf_trades * 1.0 + (tot_trades - sf_trades) * 0.5)
                          / max(active_seasons, 1), 1) if tot_trades else 0.0)
        rivals_out[name] = {
            "user_id": uid,
            "in_league_trades_2023_25": inleague_count.get(name, 0),
            "outside": {
                "active_seasons": active_seasons,
                "leagues_total": sum(len(v["leagues"]) for v in seasons_out.values()),
                "trades_total": tot_trades,
                "sf_trades": sf_trades,
                "weighted_deals_per_yr": weighted,
                "raw_deals_per_yr": round(tot_trades / max(active_seasons, 1), 1)
                if tot_trades else 0.0,
                "week_histogram": dict(histogram),
                "pos_flow": {p: pos_flow[p] for p in POS_ORDER if pos_flow.get(p)},
                "picks_moved": picks_moved,
            },
            "seasons": seasons_out,
        }
    return {
        "generated": time.strftime("%Y-%m-%d"),
        "method": {
            "scope": "rivals' OTHER Sleeper leagues, seasons 2023-25; "
                     "behavioral metrics only — no cross-league value grades "
                     "(scoring/rosters/formats differ league to league)",
            "weighting": "weighted deals/yr counts superflex-league trades "
                         "at 1.0 and non-SF at 0.5, per season with an "
                         "outside league",
            "timing_buckets": "early w1-4, mid w5-9, deadline w10+",
        },
        "rivals": rivals_out,
    }


# ------------------------------------------------------------------- html
def esc(s) -> str:
    return html.escape(str(s), quote=True)


def swing_html(v: float) -> str:
    if v > 0:
        return f'<span class="ml-num" style="color:var(--ml-success)">+{v:g}</span>'
    if v < 0:
        return f'<span class="ml-num" style="color:var(--ml-danger)">{v:g}</span>'
    return '<span class="ml-num">0</span>'


def assets_str(side: dict) -> str:
    bits = [f'{esc(p["name"])} <span class="ml-badge ml-badge--{p["pos"].lower() if p["pos"].lower() in ("qb","rb","wr","te","k","def") else "def"}">{esc(p["pos"])}</span>'
            for p in side["players"]]
    bits += [f'R{p["round"]} &rsquo;{str(p["season"])[2:]} pick' for p in side["picks"]]
    if side["faab"]:
        bits.append(f'{side["faab"]} FAAB')
    return ", ".join(bits) or "&mdash;"


def ledger_html(ledger: dict) -> str:
    rows = []
    for tr in ledger["trades"]:
        a, b = tr["parties"][0], tr["parties"][1]
        if tr["margin_par_pts"] > 0:
            verdict = f"<strong>{esc(tr['winner'])}</strong>"
        else:
            verdict = f'<span class="ml-stat">{esc(tr["winner"])}</span>'
        rows.append(
            "<tr>"
            f'<td class="ml-num">{tr["season"]}.{tr["week"]:02d}</td>'
            f'<td><strong>{esc(a["manager"])}</strong> &rlarr; {esc(b["manager"])}</td>'
            f'<td>{assets_str(a["received"])}</td>'
            f'<td>{assets_str(b["received"])}</td>'
            f'<td class="ml-num">{swing_html(a["swing_par_pts"])}</td>'
            f'<td class="ml-num">{swing_html(a["swing_ros_pts"])}</td>'
            f"<td>{verdict}</td>"
            "</tr>")
    return "".join(rows)


def render_ledger_fragment(ledger: dict) -> str:
    n = len(ledger["trades"])
    by_season = " &middot; ".join(
        f'{s}: <b>{c}</b>' for s, c in sorted(ledger["trade_counts_by_season"].items()))
    stand_rows = []
    for i, r in enumerate(ledger["standings"], 1):
        heist = r["biggest_heist"]
        heist_s = (f'+{heist["swing_par_pts"]:g} v {esc(heist["counterparty"])} '
                   f'(w{heist["week"]} &rsquo;{str(heist["season"])[2:]})') if heist else "&mdash;"
        moved = r["rank_raw"] - r["rank_par"]
        moved_s = (f' <span class="ml-note">({moved:+d} v raw)</span>'
                   if moved else "")
        stand_rows.append(
            "<tr>"
            f'<td class="ml-num">{i}{moved_s}</td>'
            f'<td><strong>{esc(r["manager"])}</strong></td>'
            f'<td class="ml-num">{r["deals"]}</td>'
            f'<td class="ml-num">{r["wins"]}&ndash;{r["losses"]}&ndash;{r["pushes"]}</td>'
            f'<td class="ml-num">{swing_html(r["net_par_pts"])}</td>'
            f'<td class="ml-num">{swing_html(round(r["net_par_pts"] / r["deals"], 1))}</td>'
            f'<td class="ml-num">{swing_html(r["net_ros_pts"])}</td>'
            f"<td>{heist_s}</td>"
            "</tr>")
    shark = ledger["standings"][0]
    fish = ledger["standings"][-1]
    deal_rows = ledger_html(ledger)
    repl = ledger["replacement_levels"]
    repl_s = " &middot; ".join(
        f'{s}: ' + " / ".join(f'{p} {v:g}' for p, v in lv.items())
        for s, lv in sorted(repl.items()))
    return f"""<section id="trade_ledger" class="ml-panel">
<h2>The Book &mdash; In-League Trade Ledger 2023&ndash;25</h2>
<div class="ml-tape"><span>THE BOOK:</span> <span><b>{n}</b> deals closed</span> <span>{by_season}</span> <span>SHARK <b>{esc(shark["manager"])}</b> {shark["net_par_pts"]:+g} PAR</span> <span>FISH <b>{esc(fish["manager"])}</b> {fish["net_par_pts"]:+g} PAR</span></div>
<h3 class="ml-h-label">Sharks &amp; fish &mdash; all-time net points above replacement swung</h3>
<table class="ml-table">
<thead><tr><th>#</th><th>Counterparty</th><th>Deals</th><th>W&ndash;L&ndash;P</th><th>Net PAR</th><th>PAR/deal</th><th>Net raw pts</th><th>Biggest heist (PAR)</th></tr></thead>
<tbody>{"".join(stand_rows)}</tbody>
</table>
<h3 class="ml-h-label">Every deal closed</h3>
<table class="ml-table ml-table--compact">
<thead><tr><th>Closed</th><th>Counterparties (A &rlarr; B)</th><th>A received</th><th>B received</th><th>PAR to A</th><th>Raw pts to A</th><th>Verdict</th></tr></thead>
<tbody>{deal_rows}</tbody>
</table>
<p class="ml-fineprint">Grading v2: rest-of-season points ABOVE POSITIONAL REPLACEMENT (PAR) swung &mdash; each side's received-minus-sent PAR over the weeks AFTER the trade week through week 17. A player-week's PAR = his Sleeper pts_half_ppr (fallback pts_ppr &minus; 0.5&times;rec) minus a fixed per-position weekly replacement level; weeks without a stat line count 0 (a replacement body starts instead). Replacement level = that season's median weekly score of the rank-N player at the position, N = QB12 / RB30 / WR36 / TE12 / K12 / DEF12 (the last body a 12-team room starts anyway); computed levels &mdash; {repl_s}. PAR keeps QB volume from buying every verdict: raw half-PPR points ride along in the raw column for reference, and rank shifts vs the raw table are flagged in the # column. Draft picks and FAAB are listed on the ledger but graded 0: a pick's value realizes at a future draft and grading it here would be guesswork dressed as arithmetic. Picks-only deals are marked PUSH, not wins. W&ndash;L&ndash;P counts a win when a side's PAR swing is positive. Verdict names the side that gained more PAR; it is hindsight, not intent.</p>
</section>
"""


def dossier_card(name: str, d: dict) -> str:
    o = d["outside"]
    inl = d["in_league_trades_2023_25"]
    if o["leagues_total"] == 0:
        return f"""<div class="ml-card">
<h3 class="ml-h-label">{esc(name)}</h3>
<span class="ml-serial">DOSSIER &middot; NO OUTSIDE BOOK</span>
<p>No other Sleeper leagues on record, 2023&ndash;25. Everything known about this counterparty is already in the ledger above: <strong class="ml-num">{inl}</strong> in-league deal{"s" if inl != 1 else ""} closed.</p>
</div>"""
    fmt_lines = []
    for season, sv in sorted(d["seasons"].items()):
        if not sv["leagues"]:
            continue
        tags = ", ".join(f'{esc(lg["name"])} ({fmt_tag(lg)}, {lg["teams"]}tm)'
                         for lg in sv["leagues"])
        fmt_lines.append(f'<b>{season}</b>: {tags} &mdash; {sv["trades"]} closed')
    h = o["week_histogram"]
    flow = " &middot; ".join(f'{p} {v:+d}' for p, v in o["pos_flow"].items()) or "flat"
    return f"""<div class="ml-card">
<h3 class="ml-h-label">{esc(name)}</h3>
<span class="ml-serial">DOSSIER &middot; {o["leagues_total"]} OUTSIDE LEAGUE{"S" if o["leagues_total"] != 1 else ""}</span>
<p><span class="ml-stat">elsewhere <strong>{o["raw_deals_per_yr"]:g}/yr</strong></span> <span class="ml-stat">SF-weighted <strong>{o["weighted_deals_per_yr"]:g}/yr</strong></span> <span class="ml-stat">here <strong>{round(inl / 3, 1):g}/yr</strong> ({inl} in 3yr)</span></p>
<p>{"<br>".join(fmt_lines)}</p>
<p>Timing: early <b class="ml-num">{h["early"]}</b> &middot; mid <b class="ml-num">{h["mid"]}</b> &middot; deadline <b class="ml-num">{h["deadline"]}</b>. Positional flow: {flow}. Picks moved: <b class="ml-num">{o["picks_moved"]}</b>. Superflex deals: <b class="ml-num">{o["sf_trades"]}</b> of {o["trades_total"]}.</p>
</div>"""


def render_dossiers_fragment(doss: dict) -> str:
    rivals = doss["rivals"]
    ordered = sorted(rivals.items(),
                     key=lambda kv: -kv[1]["outside"]["trades_total"])
    cards = "\n".join(dossier_card(n, d) for n, d in ordered)
    busiest = ordered[0]
    n_books = sum(1 for _, d in ordered if d["outside"]["leagues_total"])
    return f"""<section id="counterparty_dossiers" class="ml-panel">
<h2>Counterparty Dossiers &mdash; The Outside Books</h2>
<div class="ml-tape"><span>SCOUTED:</span> <span><b>{n_books}</b> of 11 counterparties keep outside books</span> <span>most active elsewhere: <b>{esc(busiest[0])}</b> ({busiest[1]["outside"]["trades_total"]} deals, 2023&ndash;25)</span></div>
{cards}
<p class="ml-fineprint">Behavioral intelligence only. Deal counts, timing (early w1&ndash;4 / mid w5&ndash;9 / deadline w10+), positional flow (players acquired minus shipped, by position), and picks moved travel across leagues; point values do not &mdash; scoring, rosters, and formats differ book to book, so no cross-league value grades are given. SF-weighted pace counts superflex-league deals at full weight and others at half, since superflex habits are the ones that show up at this table. Source: public Sleeper league data, seasons 2023&ndash;25.</p>
</section>
"""


# -------------------------------------------------------------------- main
def main() -> int:
    desk = Desk()
    ledger = build_ledger(desk)

    # Invariant: every deal is zero-sum — what A received, B sent — so the
    # party swings of each trade must cancel, in BOTH gradings (rounding
    # slack only). If this drifts, the grader is double-counting an asset.
    for tr in ledger["trades"]:
        for key in ("swing_ros_pts", "swing_par_pts"):
            s = sum(p[key] for p in tr["parties"])
            assert abs(s) < 0.5, (
                f"trade {tr['transaction_id']} {key} sum {s} != 0")
    print(f"invariant OK: {len(ledger['trades'])} deals zero-sum "
          f"in raw and PAR grading")

    doss = build_dossiers(desk, ledger)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "trade_ledger.json").write_text(json.dumps(ledger, indent=1))
    (OUT / "trade_ledger.html").write_text(render_ledger_fragment(ledger))
    (OUT / "counterparty_dossiers.json").write_text(json.dumps(doss, indent=1))
    (OUT / "counterparty_dossiers.html").write_text(render_dossiers_fragment(doss))
    n = len(ledger["trades"])
    graded = sum(1 for t in ledger["trades"] if t["margin_par_pts"] > 0)
    print(f"ledger: {n} trades ({ledger['trade_counts_by_season']}), "
          f"{graded} with a graded winner; shark={ledger['standings'][0]['manager']} "
          f"({ledger['standings'][0]['net_par_pts']:+g} PAR), "
          f"fish={ledger['standings'][-1]['manager']} "
          f"({ledger['standings'][-1]['net_par_pts']:+g} PAR)")
    print("replacement levels:", ledger["replacement_levels"])
    flips = [r for r in ledger["standings"] if r["rank_par"] != r["rank_raw"]]
    if flips:
        print("rank changes vs raw grading:")
        for r in flips:
            print(f"  {r['manager']}: raw #{r['rank_raw']} -> PAR "
                  f"#{r['rank_par']} (net {r['net_ros_pts']:+g} raw, "
                  f"{r['net_par_pts']:+g} PAR)")
    else:
        print("rank changes vs raw grading: none")
    tot_out = sum(d["outside"]["trades_total"] for d in doss["rivals"].values())
    print(f"dossiers: 11 rivals, "
          f"{sum(d['outside']['leagues_total'] for d in doss['rivals'].values())} "
          f"outside league-seasons, {tot_out} outside deals closed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
