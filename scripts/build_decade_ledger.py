"""The DECADE LEDGER: PAR-grade every Yahoo-era trade, 2011-2022.

The behavioral pass (Jul 15) counted 136 trades; this grades them the
same way the Sleeper-era Trade Ledger grades its book — each side's
received-minus-sent rest-of-season points above positional replacement
(PAR) over the weeks AFTER the trade week — so the two eras concatenate
into one all-time standings table.

Cross-platform adaptations, stated plainly:
  - Player join: Yahoo trade payloads carry full names; points come
    from Sleeper's weekly archive (data/scouting/stats/stats_<yr>.json,
    fetched by fetch_trade_intel.fetch_stats back to 2011). Names
    resolve via the catalog (normalized) — unresolved players are
    dropped and COUNTED, never guessed.
  - Replacement levels scale with league size (the league grew
    8 -> 10 -> 12): rank N per position = the 12-team ledger ranks
    times teams/12, using each season's median weekly score at that
    rank.
  - Trade week from the Yahoo timestamp vs a Sep-5 kickoff anchor
    (accurate to +-1 week, which PAR windows tolerate).
  - No draft-pick legs: Yahoo-era trades were player-for-player.

Output: data/research/decade_ledger.json + printed verdicts (all-time
standings incl. the Sleeper era, the Brian<->Trevor pair net, Ankur's
2022 heist grade, biggest heists of the decade).
"""
from __future__ import annotations

import datetime
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.name_aliases import resolve_xlsx_name  # noqa: E402
from fantasy_draft.team_identity import load_identity  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
YAHOO = ROOT / "data" / "yahoo"
STATS = ROOT / "data" / "scouting" / "stats"
OUT = ROOT / "data" / "research" / "decade_ledger.json"
SEASONS = range(2011, 2023)
# 12-team replacement ranks (same as the Sleeper ledger), scaled by size.
RANKS_12 = {"QB": 12, "RB": 30, "WR": 36, "TE": 12, "K": 12, "DEF": 12}


def norm(s: str) -> str:
    s = (s.lower().replace(".", "").replace("'", "")
         .replace("-", " ").strip())
    for suf in (" iii", " ii", " iv", " jr", " sr", " v"):
        if s.endswith(suf):
            s = s[: -len(suf)].strip()
    return s


def week_of(ts: str, season: int) -> int:
    d = datetime.datetime.utcfromtimestamp(int(ts)).date()
    kickoff = datetime.date(season, 9, 5)
    if d < kickoff:
        return 0
    return min(17, (d - kickoff).days // 7 + 1)


def load_week_stats(season: int) -> dict[int, dict]:
    raw = json.loads((STATS / f"stats_{season}.json").read_text())
    return {int(w): v for w, v in raw.items() if w != "_meta"}


def replacement_levels(weeks: dict[int, dict], teams: int) -> dict[str, float]:
    """Per-position replacement = median across weeks of the rank-N
    weekly half-PPR score, N scaled to league size."""
    import statistics as st
    per_pos_weekly: dict[str, list[float]] = defaultdict(list)
    for w, players in weeks.items():
        by_pos: dict[str, list[float]] = defaultdict(list)
        for rec in players.values():
            pts = rec.get("pts_half_ppr")
            if pts is None:
                pts = (rec.get("pts_ppr") or 0) - 0.5 * (rec.get("rec") or 0)
            if rec.get("pos") in RANKS_12:
                by_pos[rec["pos"]].append(float(pts))
        for pos, lst in by_pos.items():
            n = max(1, round(RANKS_12[pos] * teams / 12))
            lst.sort(reverse=True)
            if len(lst) >= n:
                per_pos_weekly[pos].append(lst[n - 1])
    return {pos: round(st.median(v), 2) for pos, v in per_pos_weekly.items()
            if v}


def parse_trades(season: int, name_mid: dict) -> list[dict]:
    lid_dir = next(
        p for p in YAHOO.iterdir()
        if p.name.startswith(f"{season}_") and p.is_dir()
        and json.loads((p / "league.json").read_text())["fantasy_content"]
        ["league"][0]["name"].strip().lower() == "moneyleague")
    raw = json.loads((lid_dir / "transactions.json").read_text())
    lg = raw["fantasy_content"]["league"]
    tx = next(p["transactions"] for p in lg
              if isinstance(p, dict) and "transactions" in p)
    trades = []
    for i in range(int(tx["count"])):
        e = tx[str(i)]["transaction"]
        meta = e[0] if isinstance(e, list) else e
        if meta.get("type") != "trade" or meta.get("status") != "successful":
            continue
        a = name_mid.get((season, meta["trader_team_name"].strip().lower()))
        b = name_mid.get((season, meta["tradee_team_name"].strip().lower()))
        if not (a and b):
            continue
        a_key, b_key = meta["trader_team_key"], meta["tradee_team_key"]
        got: dict[str, list] = {a: [], b: []}
        players_block = next((p["players"] for p in e[1:]
                              if isinstance(p, dict) and "players" in p),
                             None) if isinstance(e, list) else None
        if not players_block:
            continue
        for j in range(int(players_block["count"])):
            pl = players_block[str(j)]["player"]
            pmeta = {k: v for part in pl[0] if isinstance(part, dict)
                     for k, v in part.items()}
            tdata = pl[1]["transaction_data"]
            tdata = tdata[0] if isinstance(tdata, list) else tdata
            dest = tdata.get("destination_team_key")
            who = a if dest == a_key else b if dest == b_key else None
            if who:
                got[who].append({
                    "name": (pmeta.get("name") or {}).get("full", "?"),
                    "pos": pmeta.get("display_position", "?").split(",")[0],
                })
        trades.append({"season": season,
                       "week": week_of(meta["timestamp"], season),
                       "a": a, "b": b, "got": got})
    return trades


def main() -> None:
    ident = load_identity(ROOT / "data" / "team_identity.json")
    name_mid: dict[tuple[int, str], str] = {}
    for mid, rec in ident["managers"].items():
        for s, nm in (rec.get("yahoo_team_names") or {}).items():
            if str(s).isdigit() and isinstance(nm, str):
                name_mid[(int(s), nm.strip().lower())] = mid

    catalog = json.loads((ROOT / "data/sleeper/players_nfl.json").read_text())
    pid_by_name: dict[str, str] = {}
    for pid, p in catalog.items():
        nm = f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
        if nm:
            pid_by_name.setdefault(norm(nm), pid)

    era = {int(k): v for k, v in json.loads(
        (ROOT / "data/league_history/yahoo_era.json").read_text()).items()}

    all_sides = []
    unresolved: dict[str, int] = defaultdict(int)
    for season in SEASONS:
        weeks = load_week_stats(season)
        teams_n = era[season]["num_teams"]
        repl = replacement_levels(weeks, teams_n)

        def ros_par(pid: str, pos: str, after_week: int) -> float:
            lvl = repl.get(pos, 0.0)
            tot = 0.0
            for w in range(after_week + 1, 18):
                rec = weeks.get(w, {}).get(pid)
                if rec:
                    pts = rec.get("pts_half_ppr")
                    if pts is None:
                        pts = ((rec.get("pts_ppr") or 0)
                               - 0.5 * (rec.get("rec") or 0))
                    tot += float(pts) - lvl
                # absent week = didn't play = 0 - replacement
                else:
                    tot -= lvl
            return tot

        for t in parse_trades(season, name_mid):
            sides = {}
            for who in (t["a"], t["b"]):
                par = 0.0
                for p in t["got"][who]:
                    canon = resolve_xlsx_name(p["name"]) or p["name"]
                    pid = pid_by_name.get(norm(canon))
                    if pid is None:
                        unresolved[p["name"]] += 1
                        continue
                    par += ros_par(pid, p["pos"], t["week"])
                sides[who] = par
            a, b = t["a"], t["b"]
            for who, other in ((a, b), (b, a)):
                all_sides.append({
                    "season": t["season"], "week": t["week"],
                    "manager": who, "counterparty": other,
                    "par": round(sides[who] - sides[other], 1),
                })

    standings = defaultdict(lambda: {"deals": 0, "par": 0.0})
    pair_net = defaultdict(float)
    for s in all_sides:
        st_ = standings[s["manager"]]
        st_["deals"] += 1
        st_["par"] += s["par"]
        pair_net[tuple(sorted((s["manager"], s["counterparty"])))] += 0
    # pair net from one perspective (a-side of sorted pair)
    pair_view = defaultdict(float)
    pair_deals = defaultdict(int)
    for s in all_sides:
        key = tuple(sorted((s["manager"], s["counterparty"])))
        if s["manager"] == key[0]:
            pair_view[key] += s["par"]
            pair_deals[key] += 1

    result = {
        "meta": {"seasons": "2011-2022",
                 "sides_graded": len(all_sides),
                 "unresolved_players": dict(sorted(
                     unresolved.items(), key=lambda kv: -kv[1])[:15]),
                 "method": "rest-of-season half-PPR PAR after the trade "
                           "week; replacement = median weekly score at "
                           "rank N scaled to league size; absent weeks "
                           "cost full replacement"},
        "standings": {m: {"deals": v["deals"], "net_par": round(v["par"], 1)}
                      for m, v in sorted(standings.items(),
                                         key=lambda kv: -kv[1]["par"])},
        "pairs": {f"{k[0]} vs {k[1]}": {"deals": pair_deals[k],
                                        "net_to_first": round(v, 1)}
                  for k, v in sorted(pair_view.items(),
                                     key=lambda kv: -pair_deals[kv[0]])
                  if pair_deals[k] >= 3},
        "biggest": sorted(all_sides, key=lambda s: -s["par"])[:10],
    }
    OUT.write_text(json.dumps(result, indent=2))
    print(f"[decade_ledger] {len(all_sides)} sides graded; "
          f"{sum(unresolved.values())} unresolved player-legs")
    print("\nALL-TIME YAHOO-ERA STANDINGS (net PAR):")
    for m, v in result["standings"].items():
        print(f"  {m:<18} {v['deals']:>3} deals  {v['net_par']:>+8.1f}")


if __name__ == "__main__":
    main()
