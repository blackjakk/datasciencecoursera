"""Research Desk — THE STACK SCREEN: preseason keeper firepower, priced.

Ranks every team's declared keeper stack for the coming season by
blind-curve surplus and flags the historical champion shape — rank-1
surplus >= {MIN_SURPLUS} pts with a proven-majority stack — as a TITLE
WATCH. The record is printed on the flag and it is deliberately modest:
the shape fired in 2023 (Donnie — missed), 2024 (coop — missed, champ
ranked 9th preseason) and 2025 (Trevor — WON). One hit in three, about
4x the 1-in-12 base rate. Nothing preseason separates the 2025 hit from
the 2024 miss, so the watch means "price them into every deal," never
"crown them." (Full backtest, 12 league-seasons incl. the benchmark
corpus: preseason keeper surplus is a coin flip for champions —
MONEYLEAGUE champs ranked 6th/9th/1st.)

Grades the model's predicted keepers until the league locks; the derive
stage copies data/keepers_2026_actual.json over keepers_2026.json when
it lands, so this recomputes against real declarations with zero extra
wiring. Re-runs its own 2023-25 backtest every build so the record
can't silently drift from the copy.

Outputs per the fragment contract:
data/research/keeper_stack_screen.{json,html}. summary_lines() feeds
the weekly movers briefing.
"""
from __future__ import annotations

import html as _html
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.stash_curve import _period_adp, _season_vbd  # noqa: E402
from scripts.build_2026_keepers import (  # noqa: E402
    _load_adp_baselines, MAX_YEARS, ROUND_PENALTY)

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "research"
MY_RID = 9
MIN_SURPLUS = 120.0        # blind-curve pts (2023-25 rank-1s: 178/195/195)
PROVEN_MIN = 0.5           # at least half the stack proven
SEASON_LEAGUES = {         # self-calibration backtest
    2023: "data/sleeper/league_1001657805583077376",
    2024: "data/sleeper/league_1085805164784664576",
    2025: "data/sleeper/league_1245039290518360064",
}

_blind_raw, _ = _load_adp_baselines()


def blind(r: float) -> float:
    return max(0.0, float(_blind_raw.get(max(1, min(17, round(r))), 0.0)))


def _players_by_name():
    players = json.loads((ROOT / "data/sleeper/players_nfl.json").read_text())
    out = {}
    for pid, p in players.items():
        nm = f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
        if nm:
            out.setdefault(nm.lower(), pid)
    return out


# ------------------------------------------------ current-season screen

def screen_current() -> dict:
    keepers = json.loads((ROOT / "data" / "keepers_2026.json").read_text())
    actual = (ROOT / "data" / "keepers_2026_actual.json").exists()
    helper = json.loads(
        (ROOT / "docs" / "draft_helper" / "data.json").read_text())
    mgr_of = {m["roster_id"]: m["id"] for m in helper["managers"]}
    by_name = _players_by_name()
    last_vbd = _season_vbd(2025)

    stacks: dict[int, dict] = defaultdict(
        lambda: {"keepers": [], "surplus": 0.0, "proven": 0})
    for k in keepers:
        if k.get("status") != "carryover":
            continue
        rid = k["roster_id"]
        cost = k.get("effective_forfeit_round") or k["forfeit_round"]
        # keepers json carries ADP in overall PICKS (Maye 3.5 = round 1)
        adp_rd = max(1.0, k["adp"] / 12.0) if k.get("adp") else None
        surplus = max(0.0, blind(adp_rd) - blind(cost)) if adp_rd else 0.0
        pid = by_name.get(k["player_name"].lower())
        proven = (k.get("years_kept", 0) >= 1
                  or (pid is not None and last_vbd.get(pid, -1) > 0))
        s = stacks[rid]
        s["keepers"].append({
            "player": k["player_name"], "pos": k.get("position", "?"),
            "cost_round": cost,
            "adp_round": round(adp_rd, 1) if adp_rd else None,
            "surplus": round(surplus, 1), "proven": proven,
        })
        s["surplus"] += surplus
        s["proven"] += proven

    # WAR CHEST = keeper value at ADP + value of remaining live picks
    # (helper schedule has pick trades applied; keepers consume their
    # effective forfeit seats, bump rule included).
    rid_of = {m["team_idx"]: m["roster_id"] for m in helper["managers"]}
    owned: dict[int, list[int]] = defaultdict(list)
    for p in helper["schedule"]:
        owned[rid_of[p["team_idx"]]].append(p["round"])
    keeper_val: dict[int, float] = defaultdict(float)
    for k in keepers:
        if k.get("status") != "carryover":
            continue
        rid = k["roster_id"]
        seat = k.get("effective_forfeit_round") or k["forfeit_round"]
        if seat in owned[rid]:
            owned[rid].remove(seat)
        adp_rd = max(1.0, k["adp"] / 12.0) if k.get("adp") else None
        keeper_val[rid] += blind(adp_rd) if adp_rd else 0.0

    rows = []
    for rid in sorted(owned):          # every team, keepers or not
        s = stacks.get(rid) or {"keepers": [], "surplus": 0.0, "proven": 0}
        n = len(s["keepers"])
        pick_value = round(sum(blind(r) for r in owned[rid]), 1)
        rows.append({
            "roster_id": rid, "manager": mgr_of.get(rid, f"rid{rid}"),
            "is_me": rid == MY_RID, "n_keepers": n,
            "surplus": round(s["surplus"], 1),
            "proven": s["proven"],
            "proven_share": round(s["proven"] / n, 2) if n else 0.0,
            "keeper_value": round(keeper_val[rid], 1),
            "pick_value": pick_value,
            "war_chest": round(keeper_val[rid] + pick_value, 1),
            "keepers": sorted(s["keepers"], key=lambda k: -k["surplus"]),
        })
    rows.sort(key=lambda r: -r["surplus"])
    for i, r in enumerate(rows, 1):
        r["rank"] = i
    for i, r in enumerate(sorted(rows, key=lambda r: -r["war_chest"]), 1):
        r["war_rank"] = i
    rows.sort(key=lambda r: -r["war_chest"])

    watch = None
    if len(rows) > 1:
        by_sur = sorted(rows, key=lambda r: -r["surplus"])
        top, second = by_sur[0], by_sur[1]
        war_leader = rows[0]           # rows now sorted by war chest
        watch = {
            "fired": (top["surplus"] >= MIN_SURPLUS
                      and top["proven_share"] >= PROVEN_MIN),
            "top": top["manager"], "top_surplus": top["surplus"],
            "second_surplus": second["surplus"],
            "top_proven_share": top["proven_share"],
            "top_war_rank": top["war_rank"],
            "war_leader": war_leader["manager"],
            "war_leader_chest": war_leader["war_chest"],
        }
    return {"basis": "ACTUAL declarations" if actual
            else "model-predicted keepers (actuals auto-load at lock)",
            "rows": rows, "watch": watch}


# ------------------------------------------------------ the expiry board

def expiry_board(mgr_of: dict[int, str]) -> dict:
    """Every 2026 keeper's 2027 fate, per the contract rules (truth #8):
    cost escalates {ROUND_PENALTY} rounds/yr, {MAX_YEARS} consecutive
    years max, R1/R2 forfeits ineligible — and the clock FOLLOWS THE
    PLAYER (no reset on trade), so an expiring keeper is a pure rental
    to any acquirer."""
    keepers = json.loads((ROOT / "data" / "keepers_2026.json").read_text())
    per_keeper, sellers = [], defaultdict(list)
    for k in keepers:
        if k.get("status") != "carryover":
            continue
        yrs_after = k.get("years_kept", 0) + 1        # after keeping in 2026
        cost27 = k["forfeit_round"] - ROUND_PENALTY
        adp_rd = max(1.0, k["adp"] / 12.0) if k.get("adp") else None
        sur27 = (round(max(0.0, blind(adp_rd) - blind(cost27)), 1)
                 if adp_rd and cost27 >= 3 else None)
        if yrs_after >= MAX_YEARS:
            fate = "EXPIRES (3-yr cap)"
        elif cost27 < 3:
            fate = "EXPIRES (cost hits R1/R2)"
        elif sur27 is not None and sur27 < 10:
            fate = "marginal (surplus ~0)"
        else:
            fate = f"keepable @R{cost27} (+{sur27:.0f})"
        row = {
            "manager": mgr_of.get(k["roster_id"], f"rid{k['roster_id']}"),
            "roster_id": k["roster_id"], "player": k["player_name"],
            "pos": k.get("position", "?"), "cost_2026": k["forfeit_round"],
            "market_round": round(adp_rd, 1) if adp_rd else None,
            "market_value": round(blind(adp_rd), 1) if adp_rd else 0.0,
            "fate": fate, "expires": fate.startswith("EXPIRES"),
        }
        per_keeper.append(row)
        if row["expires"]:
            sellers[row["manager"]].append(row)
    shelf = sorted((r for r in per_keeper if r["expires"]),
                   key=lambda r: -r["market_value"])
    return {
        "rental_shelf": shelf,
        "forced_sellers": [
            {"manager": m, "n": len(rs),
             "assets": [r["player"] for r in rs]}
            for m, rs in sorted(sellers.items(),
                                key=lambda kv: -len(kv[1]))
            if len(rs) >= 2],
        "durables": sorted(
            (r for r in per_keeper if r["fate"].startswith("keepable")),
            key=lambda r: -r["market_value"])[:6],
    }


# --------------------------------------------- self-calibration backtest

def backtest() -> list[dict]:
    """Apply the watch rule to 2023-25: when did it fire, and on whom?"""
    def keepers_of(season):
        """rid -> keeper picks; also rid -> war chest (keepers at ADP
        value + every other pick at its round's blind value — trades are
        inherent in who actually made each pick)."""
        d = ROOT / SEASON_LEAGUES[season]
        adp = _period_adp(season)
        out = defaultdict(list)
        war = defaultdict(float)
        for p in json.loads(next(d.glob("draft_*_picks.json")).read_text()):
            a = adp.get(p["player_id"], 999.0)
            ar = max(1.0, a / 12.0) if a < 999 else None
            if bool(p.get("is_keeper")) or (ar is not None
                                            and p["round"] - ar >= 1.5):
                out[p["roster_id"]].append((p["player_id"], p["round"], ar))
                war[p["roster_id"]] += blind(ar) if ar else 0.0
            else:
                war[p["roster_id"]] += blind(p["round"])
        return out, war

    both = {s: keepers_of(s) for s in SEASON_LEAGUES}
    kp = {s: b[0] for s, b in both.items()}
    war_by = {s: b[1] for s, b in both.items()}
    out = []
    for season, rel in SEASON_LEAGUES.items():
        d = ROOT / rel
        final = next((m for m in
                      json.loads((d / "winners_bracket.json").read_text())
                      if m.get("p") == 1 and m.get("w")), None)
        users = {u["user_id"]: u["display_name"]
                 for u in json.loads((d / "users.json").read_text())}
        rid_mgr = {r["roster_id"]: users.get(r["owner_id"], "?")
                   for r in json.loads((d / "rosters.json").read_text())}
        prev = season - 1
        prev_vbd = (_season_vbd(prev)
                    if (ROOT / "data" / "backtest"
                        / f"stats_{prev}.json").exists() else None)
        prev_kept = ({(rid, pid) for rid, ks in kp[prev].items()
                      for pid, _, _ in ks} if prev in kp else set())

        table = []
        for rid, ks in kp[season].items():
            sur = sum(max(0.0, blind(ar) - blind(r))
                      for _, r, ar in ks if ar)
            proven = (sum(1 for pid, _, _ in ks
                          if (rid, pid) in prev_kept
                          or prev_vbd.get(pid, -1) > 0)
                      if prev_vbd is not None else None)
            table.append((sur, rid, proven, len(ks)))
        table.sort(reverse=True)
        top_s, top_rid, top_pr, top_n = table[0]
        second_s = table[1][0] if len(table) > 1 else 0.0
        proven_share = (round(top_pr / top_n, 2)
                        if top_pr is not None and top_n else None)
        fired = top_s >= MIN_SURPLUS and (proven_share is None
                                          or proven_share >= PROVEN_MIN)
        champ = final["w"] if final else None
        champ_rank = next((i for i, (_, rid, _, _) in enumerate(table, 1)
                           if rid == champ), None)
        war_order = sorted(war_by[season], key=lambda r: -war_by[season][r])
        out.append({
            "season": season, "fired": fired,
            "top": rid_mgr.get(top_rid, "?"),
            "top_surplus": round(top_s, 1),
            "second_surplus": round(second_s, 1),
            "top_proven_share": proven_share,
            "champ": rid_mgr.get(champ, "?"), "champ_rank": champ_rank,
            "champ_war_rank": (war_order.index(champ) + 1
                               if champ in war_order else None),
            "war_leader": rid_mgr.get(war_order[0], "?"),
            "watch_correct": fired and top_rid == champ,
        })
    return out


# -------------------------------------------------------------- outputs

def compute() -> dict:
    cur = screen_current()
    hist = backtest()
    mgr_of = {r["roster_id"]: r["manager"] for r in cur["rows"]}
    fired = [b for b in hist if b["fired"]]
    return {
        "meta": {
            "generated": date.today().isoformat(),
            "season": 2026, "basis": cur["basis"],
            "criteria": f"rank-1 surplus >= {MIN_SURPLUS:.0f} blind-curve "
                        f"pts with >= {PROVEN_MIN:.0%} of keepers proven "
                        "(kept-again or positive realized VBD the season "
                        "before)",
            "record": f"{sum(b['watch_correct'] for b in fired)} title(s) "
                      f"in {len(fired)} firings, 2023-25",
        },
        "stacks": cur["rows"],
        "watch": cur["watch"],
        "expiry": expiry_board(mgr_of),
        "backtest": hist,
    }


def summary_lines(res: dict | None = None) -> list[str]:
    """One-glance lines for the weekly movers briefing."""
    if res is None:
        f = OUT_DIR / "keeper_stack_screen.json"
        if not f.exists():
            return []
        res = json.loads(f.read_text())
    w = res.get("watch") or {}
    lines = ["", "STACK SCREEN (keeper firepower)"]
    if w.get("fired"):
        lines.append(
            f"- TITLE WATCH: {w['top']} holds the champion-shape stack "
            f"({w['top_surplus']:.0f} surplus vs next "
            f"{w['second_surplus']:.0f}, {w['top_proven_share']:.0%} "
            f"proven) but ranks #{w['top_war_rank']} on total capital; "
            f"war-chest leader is {w['war_leader']} "
            f"({w['war_leader_chest']:.0f}). Shape record: "
            f"{res['meta']['record']} — ~4x base title odds, not a "
            "crown. Price both into every deal.")
    else:
        top3 = ", ".join(f"{r['manager']} {r['war_chest']:.0f}"
                         for r in res["stacks"][:3])
        lines.append(f"- no title watch ({res['meta']['basis']}); "
                     f"war chests: {top3}.")
    sellers = (res.get("expiry") or {}).get("forced_sellers") or []
    if sellers:
        lines.append("- expiry board: forced sellers "
                     + "; ".join(f"{s['manager']} "
                                 f"({', '.join(s['assets'])})"
                                 for s in sellers)
                     + " — rentals to any acquirer (clock follows the "
                     "player); optimal buy window W9-11.")
    return lines


def build_fragment(res: dict) -> str:
    e = _html.escape

    def stack_row(r: dict) -> str:
        klist = ", ".join(
            "{}{} R{}".format(k["player"], "*" if k["proven"] else "",
                              k["cost_round"])
            for k in r["keepers"]) or "—"
        me = ' class="ml-sv-hi"' if r["is_me"] else ""
        tag = " (me)" if r["is_me"] else ""
        return (f'<tr{me}><td class="ml-num">{r["war_rank"]}</td>'
                f'<td>{e(r["manager"])}{tag}</td>'
                f'<td class="ml-num">{r["war_chest"]:.0f}</td>'
                f'<td class="ml-num">{r["keeper_value"]:.0f} + '
                f'{r["pick_value"]:.0f}</td>'
                f'<td class="ml-num">{r["surplus"]:.0f} (#{r["rank"]})</td>'
                f'<td class="ml-num">{r["proven"]}/{r["n_keepers"]}</td>'
                f"<td>{e(klist)}</td></tr>")

    rows = "".join(stack_row(r) for r in res["stacks"])
    w = res["watch"] or {}
    if w.get("fired"):
        watch_p = (
            f'<p><strong class="ml-sv-hi">TITLE WATCH — '
            f'{e(w.get("top", ""))}</strong> holds the champion-shape '
            f'stack: {w.get("top_surplus", 0):.0f} surplus (next: '
            f'{w.get("second_surplus", 0):.0f}), '
            f'{w.get("top_proven_share", 0):.0%} proven. This shape has '
            f'gone {e(res["meta"]["record"])} — roughly 4x the 1-in-12 '
            "base rate, and nothing more. But surplus is only half the "
            f'ledger: on TOTAL capital (keepers + live picks, trades '
            f'applied) they rank <strong>#{w.get("top_war_rank", "?")}'
            f'</strong>, and the war-chest leader is '
            f'<strong>{e(w.get("war_leader", "?"))}</strong> '
            f'({w.get("war_leader_chest", 0):.0f}). Price both into '
            "every deal.</p>")
    else:
        watch_p = (
            f'<p><strong>No title watch.</strong> Top stack '
            f'{e(w.get("top", "?"))} at {w.get("top_surplus", 0):.0f} '
            f"(needs {MIN_SURPLUS:.0f}+ with a proven majority). "
            f'War-chest leader: {e(w.get("war_leader", "?"))} '
            f'({w.get("war_leader_chest", 0):.0f}). Below watch level, '
            "preseason keeper surplus is a coin flip for titles — read "
            "the ranking as playoff odds, not destiny.</p>")

    def bt_row(b: dict) -> str:
        pr = (f'{b["top_proven_share"]:.0%}'
              if b["top_proven_share"] is not None else "n/a")
        verdict = ("✓ CALLED IT" if b["watch_correct"]
                   else "missed" if b["fired"] else "—")
        return (f'<tr><td class="ml-num">{b["season"]}</td>'
                f'<td>{"FIRED" if b["fired"] else "quiet"}</td>'
                f'<td>{e(b["top"])} ({b["top_surplus"]:.0f}, {pr} proven)</td>'
                f'<td>{e(b["champ"])} (surplus #{b["champ_rank"]}, '
                f'war chest #{b["champ_war_rank"]})</td>'
                f"<td>{verdict}</td></tr>")

    bt_rows = "".join(bt_row(b) for b in res["backtest"])

    ex = res.get("expiry") or {}
    shelf_rows = "".join(
        f'<tr><td>{e(r["manager"])}</td>'
        f'<td>{e(r["player"])} <span class="ml-fineprint">{e(r["pos"])}</span></td>'
        f'<td class="ml-num">R{r["cost_2026"]}</td>'
        f'<td class="ml-num">R{r["market_round"]:.0f}</td>'
        f'<td class="ml-num">{r["market_value"]:.0f}</td>'
        f'<td>{e(r["fate"])}</td></tr>'
        for r in ex.get("rental_shelf", []))
    sellers = " · ".join(f'{e(s["manager"])} ({s["n"]}: '
                         f'{e(", ".join(s["assets"]))})'
                         for s in ex.get("forced_sellers", []))
    durables = " · ".join(f'{e(r["player"])} {e(r["fate"].split(" (")[0])}'
                          for r in ex.get("durables", []))
    expiry_block = f"""
<div class="ml-h-label">The Expiry Board — 2027 forward supply (clock
follows the player: expiring = pure rental to ANY acquirer)</div>
<table class="ml-table ml-table--compact"><thead><tr>
<th>Seller</th><th>Asset</th><th class="ml-num">2026 cost</th>
<th class="ml-num">Market</th><th class="ml-num">Value</th>
<th>Why it dies</th></tr></thead><tbody>{shelf_rows}</tbody></table>
<p>Forced sellers (≥2 expiring): <strong>{sellers or "none"}</strong>.
Rentals price at rest-of-season only and the seller's leverage decays
weekly — the equilibrium buy window is W9-11, at close to the Timing
Study's deadline discount. Durable 2027 stacks worth protecting:
{durables or "—"}.</p>"""

    return f"""<section class="ml-panel" id="stack-screen">
<h2>The Stack Screen — keeper firepower, priced honestly</h2>
<p class="ml-serial">2026 KEEPER STACKS · {e(res["meta"]["basis"]).upper()}
· {e(res["meta"]["generated"])}</p>
{watch_p}
<div class="ml-h-label">Total preseason capital (war chest = keepers at
market + live picks, trades applied · * = proven)</div>
<table class="ml-table ml-table--compact"><thead><tr>
<th class="ml-num">#</th><th>Manager</th><th class="ml-num">War chest</th>
<th class="ml-num">Keep + picks</th><th class="ml-num">Surplus</th>
<th class="ml-num">Proven</th><th>Keepers</th></tr></thead>
<tbody>{rows}</tbody></table>
{expiry_block}
<div class="ml-h-label">The watch rule's own record (same rule, 2023-25)</div>
<table class="ml-table ml-table--compact"><thead><tr>
<th class="ml-num">Yr</th><th>Watch</th><th>Top stack</th><th>Champion</th>
<th>Verdict</th></tr></thead><tbody>{bt_rows}</tbody></table>
<p class="ml-fineprint">Criteria: {e(res["meta"]["criteria"])}. War chest
= keepers valued at market (blind curve at ADP round) + every remaining
live pick at its round value, pick trades applied and keeper seats
consumed (bump rule included) — surplus measures the DISCOUNT, war chest
the whole ledger; a team can lead one and trail the other by shipping
premium picks. The full backtest (12 league-seasons incl. the benchmark
corpus) says preseason keeper surplus is a coin flip for champions — our
champs ranked 6th/9th/1st (war chest: see table). The watch shape is the
best of a weak field: nothing knowable preseason separates the 2025 hit
(Trevor) from the 2024 miss (coop, same shape). 2023 proven-share is
unknowable (needs 2022 stats). Recomputes weekly; switches to real
declarations the moment keepers_2026_actual.json lands.</p>
</section>
"""


def main() -> None:
    res = compute()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "keeper_stack_screen.json").write_text(
        json.dumps(res, indent=2))
    (OUT_DIR / "keeper_stack_screen.html").write_text(build_fragment(res))
    w = res["watch"] or {}
    print(f"[stack_screen] basis={res['meta']['basis']} — "
          f"{'TITLE WATCH: ' + w['top'] if w.get('fired') else 'quiet'}; "
          f"rule record: {res['meta']['record']}")


if __name__ == "__main__":
    main()
