"""THE CALL SHEET — ranked 2026 trade partner/target board (desk XII).

Fuses every measured trade signal into one per-rival scorecard, so the
question "who do I call and what do I ask for" has a standing answer:

  A. THE AXIS (re-measured Jul 2026, at-trade standings, n=342 sides
     2011-25): the side AHEAD in points-for at the time of the deal wins
     mixed-strength trades by ~+44 PAR/deal; equal-strength pairings net
     ~0. Doctrine: BE the stronger side — trade down the table, never
     call up out of weakness. (This corrected the earlier "sell to
     contenders" phrasing, which had the direction backwards.)
  B. EXPLOITABILITY — career PAR/deal across both eras (Yahoo decade
     ledger + Sleeper ledger), plus 2023-25 form separately because
     skill persistence is weak (Trevor's edge died in 2016; coop's
     didn't).
  C. STAR CONCESSION — how often the single best rest-of-season player
     in their deals walked out of their building. Finalists take the
     deal's best piece 54% of sides vs 28% for the field; a high
     conceder is where rings are bought.
  D. LIQUIDITY — deals per active season. You cannot farm someone who
     never picks up the phone (Tim: one deal a year, make it the seat).
  E. 2026 MOTIVE — expiring keepers (truth #9 rental shelf), war-chest
     rank (capital-poor teams sell), and seat-market lanes where Brian
     is a ranked natural seller.

Output: data/research/trade_targets.{json,html} (Research Desk XII)
and the table behind `trade_advisor.py --partners`.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

ROOT = Path(__file__).resolve().parent.parent
RESEARCH = ROOT / "data" / "research"
ME = "brian_bigguap"
YAHOO_SEASONS = 12          # 2011-2022
SLEEPER_SEASONS = [2023, 2024, 2025]
# roster 10: Dave through 2024, josh from 2025 (identity file note;
# the base sleeper_roster_id map carries only the CURRENT holder)
HANDOFFS = {(2023, 10): "dave_aka_wang", (2024, 10): "dave_aka_wang",
            (2025, 10): "josh_wildboy"}


def _rid_maps() -> dict[int, dict[int, str]]:
    ident = json.loads((ROOT / "data/team_identity.json").read_text())
    base = {rec["sleeper_roster_id"]: mid
            for mid, rec in ident["managers"].items()
            if rec.get("sleeper_roster_id")}
    out = {}
    for season in SLEEPER_SEASONS:
        m = dict(base)
        for (s, rid), mid in HANDOFFS.items():
            if s == season:
                m[rid] = mid
        out[season] = m
    return out


def _yahoo_active_seasons() -> dict[str, int]:
    era = json.loads((ROOT / "data/league_history/yahoo_era.json").read_text())
    n = defaultdict(int)
    for sd in era.values():
        for t in sd["teams"]:
            if t.get("manager"):
                n[t["manager"]] += 1
    return n


def sleeper_sides() -> list[dict]:
    """Per-manager sides of every player-moving Sleeper-era trade, with
    the same star flags the decade ledger carries."""
    tl = json.loads((RESEARCH / "trade_ledger.json").read_text())
    rid_map = _rid_maps()
    sides = []
    for t in tl["trades"]:
        parties = t["parties"]
        if not any(p["received"]["players"] for p in parties):
            continue                      # picks/FAAB-only push
        best = max((pl["ros_par"] for p in parties
                    for pl in p["received"]["players"]), default=0.0)
        for p in parties:
            mid = rid_map[t["season"]].get(p["roster_id"], p["manager"])
            others = [q for q in parties if q is not p]
            sides.append({
                "season": t["season"], "week": t["week"], "manager": mid,
                "counterparty": rid_map[t["season"]].get(
                    others[0]["roster_id"], others[0]["manager"]),
                "par": p["swing_par_pts"],
                "star_buy": best > 0 and any(
                    pl["ros_par"] == best for pl in p["received"]["players"]),
                "star_concede": best > 0 and any(
                    pl["ros_par"] == best
                    for q in others for pl in q["received"]["players"]),
            })
    return sides


def compute() -> dict:
    decade = json.loads((RESEARCH / "decade_ledger.json").read_text())
    stack = json.loads((RESEARCH / "keeper_stack_screen.json").read_text())
    squeeze = json.loads((RESEARCH / "pick_squeeze.json").read_text())
    sl = sleeper_sides()
    yahoo_seasons_of = _yahoo_active_seasons()

    war_rank = {r["manager"]: i + 1
                for i, r in enumerate(sorted(stack["stacks"],
                                             key=lambda r: -r["war_chest"]))}
    war_chest = {r["manager"]: r["war_chest"] for r in stack["stacks"]}
    forced = {f["manager"]: f for f in stack["expiry"]["forced_sellers"]}

    lanes = defaultdict(list)   # buyer -> seat lanes where Brian is ranked
    for c in squeeze.get("seat_market", []):
        if c.get("my_rank"):
            lanes[c["buyer"]].append({"round": c["round"],
                                      "player": c["for_player"],
                                      "my_rank": c["my_rank"]})

    sl_by = defaultdict(list)
    for s in sl:
        sl_by[s["manager"]].append(s)
    pair_sleeper = defaultdict(float)
    pair_sleeper_n = defaultdict(int)
    for s in sl:
        if s["manager"] == ME:
            pair_sleeper[s["counterparty"]] += s["par"]
            pair_sleeper_n[s["counterparty"]] += 1
    pair_decade = {}
    for k, v in decade.get("pairs", {}).items():
        a, b = k.split(" vs ")
        if ME in (a, b):
            other = b if a == ME else a
            net_to_me = v["net_to_first"] if a == ME else -v["net_to_first"]
            pair_decade[other] = {"deals": v["deals"], "net": net_to_me}

    rows = []
    for mgr in war_rank:                  # the 12 current rosters
        if mgr == ME:
            continue
        dstand = decade["standings"].get(mgr, {"deals": 0, "net_par": 0.0})
        dstyle = decade.get("style", {}).get(
            mgr, {"sides": 0, "star_buys": 0, "star_concessions": 0})
        mine = sl_by.get(mgr, [])
        career_deals = dstand["deals"] + len(mine)
        career_net = dstand["net_par"] + sum(s["par"] for s in mine)
        per_deal = career_net / career_deals if career_deals else 0.0
        # live form = 2017+ (both eras): skill persistence is weak, so
        # the recent half outranks the decade book (Trevor's edge was
        # 2011-16 vintage; coop's ran 2017-22 and keeps running).
        recent_n = dstand.get("deals_2017plus", 0) + len(mine)
        recent_net = (dstand.get("net_par_2017plus", 0.0)
                      + sum(s["par"] for s in mine))
        recent_pd = recent_net / recent_n if recent_n else None
        conc_n = dstyle["star_concessions"] + sum(
            s["star_concede"] for s in mine)
        conc_rate = conc_n / career_deals if career_deals else 0.0
        active = yahoo_seasons_of.get(mgr, 0) + sum(
            1 for ssn in SLEEPER_SEASONS
            if mgr in _rid_maps()[ssn].values())
        deals_yr = career_deals / active if active else 0.0
        pair_n = pair_decade.get(mgr, {}).get("deals", 0) + pair_sleeper_n[mgr]
        pair_net = pair_decade.get(mgr, {}).get("net", 0.0) + pair_sleeper[mgr]
        n_exp = forced.get(mgr, {}).get("n", 0)
        exp_assets = forced.get(mgr, {}).get("assets", [])
        my_lanes = lanes.get(mgr, [])

        fish = min(max(-per_deal, 0.0), 60.0)
        bleed = 15.0 if (recent_pd is not None and recent_n >= 2
                         and recent_pd <= -20) else 0.0
        shark = (recent_pd is not None and recent_n >= 2
                 and recent_pd >= 20)
        concede = conc_rate * 40.0
        liquid = min(deals_yr, 3.0) * 8.0
        motive = (22.0 * n_exp
                  + max(0, war_rank[mgr] - 6) * 4.0
                  + sum(12.0 if ln["my_rank"] <= 2 else 5.0
                        for ln in my_lanes))
        pair_adj = -25.0 if pair_net < -100 else (10.0 if pair_net > 50 else 0)
        score = (fish + bleed + concede + liquid + motive + pair_adj
                 - (45.0 if shark else 0.0))

        if n_exp >= 2:
            verdict = ("FORCED SELLER — rental window W9-11, "
                       "pay in picks only")
        elif shark:
            verdict = "SELL ONLY — live shark, never buy from him"
        elif fish >= 20 and deals_yr >= 1.5:
            verdict = "FARM — frequent, losing trader"
        elif fish >= 20:
            verdict = ("SLOW FARM — loses when he deals but rarely deals; "
                       "bring ONE strong offer (his seat needs)")
        elif deals_yr < 1.0:
            verdict = "ONE CALL A YEAR — bring the seat deal, make it count"
        elif war_rank[mgr] <= 3:
            verdict = "CONTENDER SHOP — sell production W6-10, take picks"
        else:
            verdict = "NEUTRAL — advisor-priced only, take the best player"
        if shark and not verdict.startswith("SELL ONLY"):
            verdict += " · CAUTION: live shark — sell or rent, never buy"
        if mgr == "trevor_bergerboy":
            verdict += " · STANDING RULE: advisor first, no exceptions"

        rows.append({
            "manager": mgr, "score": round(score, 1),
            "career_deals": career_deals,
            "career_par_per_deal": round(per_deal, 1),
            "recent_n": recent_n,
            "recent_par_per_deal": (round(recent_pd, 1)
                                    if recent_pd is not None else None),
            "star_concession_rate": round(conc_rate, 2),
            "deals_per_year": round(deals_yr, 2),
            "war_chest_rank": war_rank[mgr],
            "war_chest": war_chest[mgr],
            "expiring_keepers": n_exp, "expiring_assets": exp_assets,
            "seat_lanes": my_lanes,
            "pair_deals_vs_me": pair_n, "pair_net_to_me": round(pair_net, 1),
            "verdict": verdict,
        })
    rows.sort(key=lambda r: -r["score"])
    return {
        "meta": {
            "generated": str(date.today()),
            "axis": "at-trade stronger side wins mixed trades +44 PAR/deal "
                    "(n=342 sides 2011-25); equal-strength trades wash to 0",
            "score": "fish(min(-careerPAR/deal,60)) + bleed(15 if live form "
                     "<= -20) - shark(45 if live form >= +25) + "
                     "starConcession%*40 + min(deals/yr,3)*8 + "
                     "22*expiringKeepers + warChestPoverty*4 + seatLanes "
                     "+ pairHistory(+-25)",
        },
        "targets": rows,
    }


def _fmt_pd(v: float | None, n: int) -> str:
    if v is None or not n:
        return "—"
    return f"{v:+.0f}/deal ({n})"


def build_fragment(res: dict) -> str:
    def lane_txt(r: dict) -> str:
        bits = []
        if r["expiring_keepers"]:
            bits.append(f'{r["expiring_keepers"]} expiring '
                        f'({", ".join(r["expiring_assets"][:3])})')
        if r["war_chest_rank"] >= 9:
            bits.append(f'war chest #{r["war_chest_rank"]} — capital-poor')
        elif r["war_chest_rank"] <= 3:
            bits.append(f'war chest #{r["war_chest_rank"]} — capital-rich')
        for ln in r["seat_lanes"]:
            bits.append(f'seat lane R{ln["round"]} ({ln["player"]}, '
                        f'you rank #{ln["my_rank"]})')
        return "; ".join(bits) or "none measured"

    body = "".join(
        f'<tr><td>{r["manager"]}'
        + (' <span class="ml-badge ml-badge--keeper">SELLER</span>'
           if r["expiring_keepers"] >= 2 else "")
        + f'</td><td class="ml-num">{r["score"]:.0f}</td>'
        f'<td class="ml-num">{_fmt_pd(r["career_par_per_deal"], r["career_deals"])}</td>'
        f'<td class="ml-num">{_fmt_pd(r["recent_par_per_deal"], r["recent_n"])}</td>'
        f'<td class="ml-num">{r["star_concession_rate"]:.0%}</td>'
        f'<td class="ml-num">{r["deals_per_year"]:.1f}</td>'
        f'<td>{lane_txt(r)}</td>'
        f'<td>{r["verdict"]}</td></tr>'
        for r in res["targets"])

    return f"""<section class="ml-panel" id="trade-targets">
<h2>The Call Sheet — who to call, what to ask for</h2>
<p class="ml-serial">2026 PARTNER/TARGET BOARD · SIGNALS FROM 342 GRADED
TRADE SIDES, 2011-25 · {res["meta"]["generated"]}</p>
<p>THE AXIS, re-measured at trade time across both eras: the side ahead
in points-for when the deal closes wins mixed-strength trades by about
44 PAR per deal; equal-strength pairings net zero. The doctrine is
<strong>be the stronger side</strong> — trade down the table, and never
call up out of weakness. Two more cohort laws feed this board: finalists
take the deal's single best player on 54% of their trade sides (the
field: 28%), and timing separates nobody — every cohort deals in weeks
6-10. What separates winners is WHO they call and WHAT they insist on.</p>
<table class="ml-table ml-table--compact">
<thead><tr><th>Rival</th><th class="ml-num">Score</th>
<th class="ml-num">Career book</th><th class="ml-num">Live form 23-25</th>
<th class="ml-num">Concedes star</th><th class="ml-num">Deals/yr</th>
<th>2026 motive</th><th>The play</th></tr></thead>
<tbody>{body}</tbody></table>
<p class="ml-fineprint">Score = exploitability (career PAR/deal against
them, capped 60) + live-form bleed/shark adjustment (skill persistence is
weak — the 2023-25 read outranks the decade book) + star-concession rate
&times; 40 + liquidity + 2026 motive (22/expiring keeper, war-chest
poverty, seat lanes where you are a ranked seller) &plusmn; your personal
pair history. Caveat: trade grades partly CAUSE outcomes (a won trade
makes you stronger), so the board is a targeting prior, not a guarantee —
every actual offer still prices through trade_advisor.py. Auto-regrades
weekly; keeper lock and live standings will move the motive column.</p>
</section>
"""


def summary_lines(res: dict) -> list[str]:
    out = []
    for r in res["targets"][:3]:
        out.append(f"CALL SHEET #{res['targets'].index(r) + 1}: "
                   f"{r['manager']} (score {r['score']:.0f}) — {r['verdict']}")
    return out


def main() -> None:
    res = compute()
    (RESEARCH / "trade_targets.json").write_text(json.dumps(res, indent=2))
    (RESEARCH / "trade_targets.html").write_text(build_fragment(res))
    print(f"[trade_targets] {len(res['targets'])} rivals scored -> "
          "data/research/trade_targets.{json,html}")
    for r in res["targets"]:
        print(f"  {r['score']:>6.1f}  {r['manager']:<18} "
              f"career {_fmt_pd(r['career_par_per_deal'], r['career_deals']):>15} "
              f"live {_fmt_pd(r['recent_par_per_deal'], r['recent_n']):>13} "
              f"concede {r['star_concession_rate']:.0%}  {r['verdict']}")


if __name__ == "__main__":
    main()
