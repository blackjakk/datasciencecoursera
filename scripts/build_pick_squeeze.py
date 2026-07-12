"""Research Desk — PICK SQUEEZE: who is missing the pick their keeper needs.

Keepers consume a specific round's pick (cost = prior round − 2; waiver
keeps sit at R15), so demand for those picks is inelastic. Two tiers:

  HARD SQUEEZE   a carryover keeper with no owned pick in its round —
                 they must buy that round or lose the keeper.
  BLOCKED ALT    a positive-value alternate whose round is fully consumed
                 by carryovers — they'd need to BUY a pick to keep both.
                 These are the standing sales leads.

Inputs (on disk, no network): docs/draft_helper/data.json (schedule with
trades applied), data/keepers_2026.json. Outputs per the fragment
contract: data/research/pick_squeeze.{json,html}.
"""
from __future__ import annotations

import html as _html
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "research"
MY_RID = 9


def compute() -> dict:
    data = json.loads((ROOT / "docs" / "draft_helper" / "data.json").read_text())
    keepers = json.loads((ROOT / "data" / "keepers_2026.json").read_text())
    rid2ti = {m["roster_id"]: m["team_idx"] for m in data["managers"]}
    ti2name = {m["team_idx"]: m["id"] for m in data["managers"]}
    bt = rid2ti[MY_RID]

    owned: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    for p in data["schedule"]:
        owned[p["team_idx"]][p["round"]] += 1

    carry: dict[int, dict[int, list]] = defaultdict(lambda: defaultdict(list))
    for k in keepers:
        if k["status"] == "carryover":
            r = k.get("effective_forfeit_round") or k["forfeit_round"]
            carry[rid2ti[k["roster_id"]]][r].append(k)

    hard = []
    for ti, rounds in carry.items():
        for r, ks in rounds.items():
            short = len(ks) - owned[ti].get(r, 0)
            for k in ks[max(0, len(ks) - short):] if short > 0 else []:
                hard.append({
                    "manager": ti2name[ti], "player": k["player_name"],
                    "round": r, "net_vbd": round(k.get("net_vbd") or 0, 1),
                    "owned_in_round": owned[ti].get(r, 0),
                })

    def free(ti: int, r: int) -> int:
        return owned[ti].get(r, 0) - len(carry[ti].get(r, []))

    # House rule (user-confirmed): a keeper missing its exact round seats at
    # the next EARLIER owned free round. So a "blocked" alternate is never
    # lost while any earlier seat is free — the cost is the BUMP TAX: the
    # chart value of the earlier pick consumed minus the exact round's.
    try:
        from scripts.stash_curve import composed_round_values
        # Composed round value (The Option Book): max(0, redraft blind) +
        # empirical 2027 keeper option value. The redraft part keeps its
        # 0-floor (the blind curve goes negative past ~R9 and a rational
        # manager never values a pick below zero); the option term prices
        # the stash lottery a live late pick carries, so bump taxes now
        # reflect BOTH kinds of forgone value.
        _rv = composed_round_values()

        def round_value(r: int) -> float:
            return _rv.get(r, {}).get("total", 0.0)
    except Exception:
        def round_value(r: int) -> float:
            return 0.0

    blocked = []
    for k in keepers:
        if k["status"] != "alternate" or (k.get("net_vbd") or 0) <= 0:
            continue
        ti = rid2ti[k["roster_id"]]
        r = k.get("effective_forfeit_round") or k["forfeit_round"]
        if free(ti, r) > 0:
            continue
        bump_to = next((rr for rr in range(r - 1, 0, -1) if free(ti, rr) > 0),
                       None)
        bump_tax = (round(round_value(bump_to) - round_value(r), 1)
                    if bump_to else None)
        blocked.append({
            "manager": ti2name[ti], "player": k["player_name"],
            "position": k.get("position", "?"), "round": r,
            "net_vbd": round(k["net_vbd"], 1),
            "bump_to": bump_to,                # None => truly hard-blocked
            "bump_tax": bump_tax,              # chart VBD of the bump
            "is_me": ti == bt,
            "brian_can_sell": free(bt, r) > 0,
        })
    # Urgency = what buying the exact round saves them: tax + a draft slot.
    blocked.sort(key=lambda b: (-(b["bump_tax"] if b["bump_tax"] is not None
                                  else 999), -b["net_vbd"]))

    # Round-level demand vs supply (the R15 logjam lives here)
    demand_by_round: dict[int, int] = defaultdict(int)
    for b in blocked:
        demand_by_round[b["round"]] += 1
    sellers_by_round = {
        r: sorted(ti2name[ti] for ti in ti2name if free(ti, r) > 0
                  and not any(b["manager"] == ti2name[ti] and b["round"] == r
                              for b in blocked))
        for r in demand_by_round
    }

    return {
        "meta": {
            "generated": date.today().isoformat(),
            "basis": "predicted keepers (keepers_2026.json) + schedule with "
                     "trades applied (helper data.json)",
            "hard_squeezes": len(hard),
            "blocked_alternates": len(blocked),
        },
        "hard": hard,
        "blocked": blocked,
        "round_market": [
            {"round": r, "buyers": demand_by_round[r],
             "sellers": sellers_by_round.get(r, [])}
            for r in sorted(demand_by_round)
        ],
    }


def build_fragment(res: dict) -> str:
    e = _html.escape
    rows_hard = "".join(
        f'<tr><td>{e(h["manager"])}</td><td>{e(h["player"])}</td>'
        f'<td class="ml-num">R{h["round"]}</td>'
        f'<td class="ml-num ml-sv-lo">+{h["net_vbd"]:.1f}</td>'
        f'<td class="ml-num">{h["owned_in_round"]}</td></tr>'
        for h in res["hard"]) or (
        '<tr><td colspan="5" class="ml-empty">No hard squeezes — every '
        "carryover keeper currently has a seat. Recomputed weekly; a pick "
        "trade can create one overnight.</td></tr>")

    def bump_cell(b):
        if b["bump_to"] is None:
            return '<td class="ml-urgent">no earlier seat — HARD</td>'
        tax = f' · tax {b["bump_tax"]:+.0f}' if b["bump_tax"] else ""
        return f'<td class="ml-num">seats at R{b["bump_to"]}{tax}</td>'

    rows_blocked = "".join(
        "<tr>"
        f'<td>{e(b["manager"])}'
        + (' <span class="ml-badge ml-badge--keeper" aria-label="You">YOU</span>'
           if b["is_me"] else "")
        + f'</td><td>{e(b["player"])} <span class="ml-note">'
          f'{e(b["position"])}</span></td>'
          f'<td class="ml-num">R{b["round"]}</td>'
          f'<td class="ml-num ml-sv-hi">+{b["net_vbd"]:.1f}</td>'
        + bump_cell(b)
        + ("<td>your pick is spoken for</td>" if b["is_me"] else
           (f'<td class="ml-urgent">you hold a free R{b["round"]}</td>'
            if b["brian_can_sell"] else
            "<td>your seat there is taken too</td>"))
        + "</tr>"
        for b in res["blocked"]) or (
        '<tr><td colspan="6" class="ml-empty">Every positive alternate has '
        "a free seat.</td></tr>")

    market = "".join(
        f'<span class="ml-stat"><strong>R{m["round"]}</strong> '
        f'{m["buyers"]} buyer{"s" if m["buyers"] != 1 else ""} · '
        f'sellers: {e(", ".join(m["sellers"][:5]) or "none")}</span> '
        for m in res["round_market"])

    return f"""<section class="ml-panel" id="pick-squeeze">
<h2>Pick Squeeze — who is missing the pick their keeper needs</h2>
<p class="ml-serial">KEEPER SEAT DEMAND vs PICK OWNERSHIP ·
{e(res["meta"]["generated"])}</p>
<div class="ml-h-label">Hard squeezes — carryover keeper, no seat
(must buy or lose him)</div>
<table class="ml-table ml-table--compact">
<thead><tr><th>Manager</th><th>Keeper at risk</th>
<th class="ml-num">Needs</th><th class="ml-num">Worth</th>
<th class="ml-num">Owned there</th></tr></thead>
<tbody>{rows_hard}</tbody></table>
<div class="ml-h-label">Blocked alternates — they'd buy a pick to keep
both (your sales leads)</div>
<table class="ml-table ml-table--compact">
<thead><tr><th>Manager</th><th>Wants to also keep</th>
<th class="ml-num">Needs</th><th class="ml-num">Worth (GUAP)</th>
<th>Cheap out (house rule)</th><th>Your position</th></tr></thead>
<tbody>{rows_blocked}</tbody></table>
<div class="ml-h-label">Round market</div>
<p>{market}</p>
<p class="ml-fineprint">Demand for a keeper's round is inelastic — there is
no substitute pick, which is exactly what makes these seats sellable above
chart value. Waiver keeps all cost R15, so the R15 seat is the scarcest
asset in the league. Based on PREDICTED keepers until the league locks
(then data/keepers_2026_actual.json takes over); house rule (confirmed): a keeper
missing its exact round seats at the next EARLIER owned free round — so
sell against the BUMP TAX and the burned draft slot, not the keeper's
full value. Only a manager with no earlier free round is truly squeezed.
The empirical value curve is negative past ~R9 (a typical
late pick returns a below-replacement player), so most bump taxes floor
to zero: in THIS league, keeper seats are close to free and late-round
pick trades move almost no expected value — the pick market that
matters is R1-R8. League convention: pick trades run EQUAL COUNT both ways (e.g. R1+R17
for R3+R5) — structure any seat sale as a same-count package where the
round-quality difference carries the price.</p>
</section>
"""


def main() -> None:
    res = compute()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "pick_squeeze.json").write_text(json.dumps(res, indent=2))
    (OUT_DIR / "pick_squeeze.html").write_text(build_fragment(res))
    print(f"[pick_squeeze] hard={res['meta']['hard_squeezes']} "
          f"blocked_alternates={res['meta']['blocked_alternates']} "
          f"rounds_in_demand={[m['round'] for m in res['round_market']]}")


if __name__ == "__main__":
    main()
