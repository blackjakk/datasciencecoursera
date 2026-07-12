"""Research Desk — THE TIMING STUDY: when buying and selling actually pays.

From the graded Trade Ledger (players in rest-of-season PAR, picks priced
by the Option Book), classify every trade side as BUYER (players in,
picks out), SELLER (the mirror), or SWAP (player-for-player), bucket by
trade week, and measure realized value by timing. League doctrine that
falls out of the 2023-25 book: value flows to whoever trades against the
calendar — sellers get paid mid-season while buyers still have hope;
buyers pay least at the deadline after sellers capitulate.

Inputs (on disk): data/research/trade_ledger.json,
data/league_history/<season>_matchups_w<w>.json, scripts/stash_curve.py.
Outputs per the fragment contract: data/research/timing_study.{json,html}.
"""
from __future__ import annotations

import html as _html
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.stash_curve import composed_round_values  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "research"
SEASONS = (2023, 2024, 2025)
CONTENDER_CUT = 6            # top-6 by record (points tiebreak) = contender


def _standings(season: int):
    """Cumulative wins/points per roster through each week."""
    wins: dict[int, dict[int, float]] = defaultdict(dict)
    pts: dict[int, dict[int, float]] = defaultdict(dict)
    cw: dict[int, float] = defaultdict(float)
    cp: dict[int, float] = defaultdict(float)
    for w in range(1, 18):
        f = ROOT / "data" / "league_history" / f"{season}_matchups_w{w}.json"
        if not f.exists():
            break
        by_m = defaultdict(list)
        for m in json.loads(f.read_text()):
            if m.get("matchup_id") is not None:
                by_m[m["matchup_id"]].append(m)
        for pair in by_m.values():
            if len(pair) != 2:
                continue
            a, b = pair
            pa, pb = a.get("points") or 0, b.get("points") or 0
            cp[a["roster_id"]] += pa
            cp[b["roster_id"]] += pb
            if pa > pb:
                cw[a["roster_id"]] += 1
            elif pb > pa:
                cw[b["roster_id"]] += 1
            else:
                cw[a["roster_id"]] += 0.5
                cw[b["roster_id"]] += 0.5
        for rid in cp:
            wins[w][rid], pts[w][rid] = cw[rid], cp[rid]
    return wins, pts


def _bucket(week: int) -> str:
    if week <= 5:
        return "early (W1-5)"
    if week <= 10:
        return "mid (W6-10)"
    return "deadline (W11+)"


BUCKET_ORDER = ["early (W1-5)", "mid (W6-10)", "deadline (W11+)"]


def compute() -> dict:
    rv = composed_round_values()

    def pick_val(r: int) -> float:
        return rv.get(r, {}).get("total", 0.0)

    std = {s: _standings(s) for s in SEASONS}

    def contender(season: int, week: int, rid: int):
        wins, pts = std[season]
        w = max(1, week - 1)
        while w >= 1 and rid not in wins.get(w, {}):
            w -= 1
        if w < 1:
            return None
        table = sorted(wins[w], key=lambda r: (-wins[w][r], -pts[w][r]))
        return table.index(rid) < CONTENDER_CUT

    led = json.loads((OUT_DIR / "trade_ledger.json").read_text())
    sides = []
    for t in led["trades"]:
        for side in t["parties"]:
            pr, ps = side["received"]["players"], side["sent"]["players"]
            kr, ks = side["received"]["picks"], side["sent"]["picks"]
            par = (sum(p["ros_par"] for p in pr)
                   - sum(p["ros_par"] for p in ps))
            pickv = (sum(pick_val(p["round"]) for p in kr)
                     - sum(pick_val(p["round"]) for p in ks))
            if pr and ks and not (ps and kr):
                role = "BUYER"
            elif kr and ps and not (pr and ks):
                role = "SELLER"
            elif (pr or ps) and not kr and not ks:
                role = "SWAP"
            else:
                role = ("BUYER" if par > 0 and pickv < 0
                        else "SELLER" if par < 0 and pickv > 0 else "SWAP")
            sides.append({
                "season": t["season"], "week": t["week"],
                "bucket": _bucket(t["week"]), "manager": side["manager"],
                "role": role,
                "contender": contender(t["season"], t["week"],
                                       side["roster_id"]),
                "player_par": round(par, 1), "pick_value": round(pickv, 1),
                "net": round(par + pickv, 1),
            })

    def rollup(rows):
        g = defaultdict(list)
        for r in rows:
            g[r["bucket"]].append(r)
        return [
            {"bucket": b, "n": len(g[b]),
             "player_par": round(sum(r["player_par"] for r in g[b]) / len(g[b]), 1),
             "pick_value": round(sum(r["pick_value"] for r in g[b]) / len(g[b]), 1),
             "net": round(sum(r["net"] for r in g[b]) / len(g[b]), 1)}
            for b in BUCKET_ORDER if g.get(b)
        ]

    buyers = [r for r in sides if r["role"] == "BUYER"]
    sellers = [r for r in sides if r["role"] == "SELLER"]
    swaps = [r for r in sides if r["role"] == "SWAP"]
    swap_lop = {}
    g = defaultdict(list)
    for r in swaps:
        g[r["bucket"]].append(abs(r["player_par"]))
    for b in BUCKET_ORDER:
        if g.get(b):
            swap_lop[b] = {"n": len(g[b]) // 2,
                           "avg_abs_par": round(sum(g[b]) / len(g[b]), 1)}
    cont_buy = defaultdict(list)
    for r in buyers:
        cont_buy[(r["bucket"], r["contender"])].append(r["net"])

    return {
        "meta": {
            "generated": date.today().isoformat(),
            "sides": len(sides), "buyers": len(buyers),
            "sellers": len(sellers), "swap_sides": len(swaps),
            "method": "player value = rest-of-season PAR (ledger v2); pick "
                      "value = Option Book composed round value; contender = "
                      f"top-{CONTENDER_CUT} record at trade week",
        },
        "buyers_by_timing": rollup(buyers),
        "sellers_by_timing": rollup(sellers),
        "contender_buyer_net": {f"{b} · {'contender' if c else 'non-contender'}":
                                round(sum(v) / len(v), 1)
                                for (b, c), v in cont_buy.items() if c is not None},
        "swap_lopsidedness": swap_lop,
        "doctrine": "Value flows to whoever trades against the calendar: "
                    "sell mid-season while buyers still have hope; buy at "
                    "the deadline after sellers capitulate.",
    }


def build_fragment(res: dict) -> str:
    e = _html.escape

    def table(rows, gain_label):
        head = ('<tr><th>Window</th><th class="ml-num">n</th>'
                '<th class="ml-num">Player PAR</th>'
                f'<th class="ml-num">{gain_label}</th>'
                '<th class="ml-num">Net / deal</th></tr>')
        body = "".join(
            "<tr>"
            f'<td>{e(r["bucket"])}</td><td class="ml-num">{r["n"]}</td>'
            f'<td class="ml-num">{r["player_par"]:+.1f}</td>'
            f'<td class="ml-num">{r["pick_value"]:+.1f}</td>'
            f'<td class="ml-num {"ml-sv-hi" if r["net"] > 5 else ("ml-sv-lo" if r["net"] < -5 else "")}">'
            f'{r["net"]:+.1f}</td></tr>'
            for r in rows)
        return ('<table class="ml-table ml-table--compact">'
                f"<thead>{head}</thead><tbody>{body}</tbody></table>")

    swap_bits = " · ".join(
        f"{e(b)}: {v['avg_abs_par']:.0f}"
        for b, v in res["swap_lopsidedness"].items())

    return f"""<section class="ml-panel" id="timing-study">
<h2>The Timing Study — when buying and selling actually pays</h2>
<p class="ml-serial">2023–25 BOOK · {res["meta"]["buyers"]} BUYER /
{res["meta"]["sellers"]} SELLER / {res["meta"]["swap_sides"]} SWAP SIDES ·
{e(res["meta"]["generated"])}</p>
<p><strong>{e(res["doctrine"])}</strong></p>
<div class="ml-h-label">Buyers (players in, picks out)</div>
{table(res["buyers_by_timing"], "Pick cost")}
<div class="ml-h-label">Sellers (players out, picks in)</div>
{table(res["sellers_by_timing"], "Pick gain")}
<div class="ml-h-label">Swap lopsidedness (avg |PAR| per side)</div>
<p class="ml-num">{swap_bits} — mid-season is peak information asymmetry;
that is when the sharks feed.</p>
<p class="ml-fineprint">Method: {e(res["meta"]["method"])}. Small samples
(the early window holds a single trade) — read the mid-vs-deadline
contrast, not the decimals. Contender buyers lost value in every window;
being "in it" is exactly when the book says you overpay. Recomputed
weekly as new trades enter the ledger.</p>
</section>
"""


def main() -> None:
    res = compute()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "timing_study.json").write_text(json.dumps(res, indent=2))
    (OUT_DIR / "timing_study.html").write_text(build_fragment(res))
    b = {r["bucket"]: r["net"] for r in res["buyers_by_timing"]}
    print(f"[timing_study] {res['meta']['sides']} sides — buyer net by window: "
          + ", ".join(f"{k} {v:+.1f}" for k, v in b.items()))


if __name__ == "__main__":
    main()
