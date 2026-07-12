"""Research Desk — THE OPTION BOOK: what a late pick's keeper option is worth.

The gap this closes: the empirical redraft curve says a R10+ pick returns a
below-replacement player (expected redraft value ≤ 0), yet Watson-class
stashes are the league's best assets. The missing term is the KEEPER OPTION:
every drafted player in R3+ can be kept NEXT season at (draft round − 2),
so a late pick is a lottery ticket on next year's surplus.

Empirical, league-own method (no theory, our drafts):
  * Universe: players DRAFTED (not kept) in rounds 3-17 of the 2023 and
    2024 MONEYLEAGUE drafts. Keepers are excluded two ways, mirroring
    backtest_recommender.py: the explicit is_keeper flag, plus the repo's
    implicit-keeper rule (actual round ≥ 1.5 rounds later than the
    period-ADP-implied round — this league entered keepers as ordinary
    picks pre-2025).
  * Option payoff = what keeping him the FOLLOWING season would have been
    worth: max(0, next_season_VBD − floor0(blind[r−2])), where
    next_season_VBD = actual half-PPR points minus the superflex
    replacement level (QB22/RB31/WR42/TE13, same ranks as the VBD engine)
    from data/backtest/stats_<year+1>.json, and floor0(blind[r−2]) is the
    forgone chart value of the pick the keep would consume.
  * option_value[r] = mean payoff INCLUDING zeros (busts count);
    hit_rate[r] = share with payoff > 0. 2023 draft → 2024 stats,
    2024 draft → 2025 stats. The 2025 draft has no 2026 outcomes yet and
    is EXCLUDED. R1/R2 are keeper-ineligible → option value 0 by rule.
    Waiver adds are a different acquisition channel — out of scope.

Attribution: pick ownership joins the xlsx color overlay on
(round, slot) → pick_no (Sleeper's 2023 feed misattributes 194/204 picks),
so best-hit credits name the manager who actually made the pick.

Consumers import:
  * load_option_values()    — round → option VBD (cached json; zeros if absent)
  * composed_round_values() — round → {redraft, option, total}; the ONE
    round-value composition trade_advisor.py and build_pick_squeeze.py use:
    total = max(0, redraft blind) + option_value[round].
  * stash_score(player)     — 0..1 breakout proxy (same formula as the
    helper's CEILING upsideBonus: expert disagreement + youth).

CLI: python3 scripts/stash_curve.py
Writes data/research/stash_curve.{json,html} per the fragment contract.
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
CURVE_JSON = OUT_DIR / "stash_curve.json"

# Same season → (league dir, draft id) map as backtest_recommender.py.
# 2025 draft intentionally absent: its option payoffs need 2026 stats.
DRAFTS = {
    2023: ("data/sleeper/league_1001657805583077376", "1001657806530957312"),
    2024: ("data/sleeper/league_1085805164784664576", "1085805164784664577"),
}
# Superflex replacement ranks — identical to the VBD engine
# (compute_replacement_ranks) and pick_value.json's replacement_ranks_used.
REPL_RANKS = {"QB": 22, "RB": 31, "WR": 42, "TE": 13, "K": 12, "DEF": 12}
ROUNDS = range(3, 18)          # keeper-eligible draft rounds
MY_RID = 9                     # Brian


# ---------------------------------------------------------------- loaders

def _blind_curve() -> dict[int, float]:
    """The forward-looking redraft chart (mean projected VBD per ADP round),
    same baseline every other pick-value consumer uses."""
    from scripts.build_2026_keepers import _load_adp_baselines
    blind, _pos = _load_adp_baselines()
    return {r: float(blind.get(r, 0.0)) for r in range(1, 18)}


def _period_adp(year: int) -> dict[str, float]:
    """Period superflex ADP (adp_2qb) per player id — the only period
    signal we trust (stored projections are contaminated; see backtest)."""
    raw = json.loads((ROOT / "data" / "backtest" / f"proj_{year}.json").read_text())
    out: dict[str, float] = {}
    for row in raw:
        pid = str(row.get("player_id") or (row.get("player") or {}).get("player_id") or "")
        try:
            adp = float((row.get("stats") or {}).get("adp_2qb") or 999.0)
        except (TypeError, ValueError):
            adp = 999.0
        if pid:
            out[pid] = adp
    return out


def _season_vbd(year: int) -> dict[str, float]:
    """Actual half-PPR VBD for a season: points minus the superflex
    replacement level at the player's position (QB22/RB31/WR42/TE13)."""
    raw = json.loads((ROOT / "data" / "backtest" / f"stats_{year}.json").read_text())
    pts_pos: dict[str, tuple[float, str]] = {}
    by_pos: dict[str, list[float]] = defaultdict(list)
    for row in raw:
        pid = str(row.get("player_id") or "")
        pts = (row.get("stats") or {}).get("pts_half_ppr")
        pos = ((row.get("player") or {}).get("position") or "").upper()
        if not pid or pts is None or pos not in REPL_RANKS:
            continue
        pts = float(pts)
        pts_pos[pid] = (pts, pos)
        by_pos[pos].append(pts)
    repl: dict[str, float] = {}
    for pos, lst in by_pos.items():
        lst.sort(reverse=True)
        rank = REPL_RANKS[pos]
        repl[pos] = lst[rank - 1] if rank <= len(lst) else (lst[-1] if lst else 0.0)
    return {pid: pts - repl[pos] for pid, (pts, pos) in pts_pos.items()}


def _xlsx_owner_by_pick_no(year: int) -> dict[int, str]:
    """(round, slot) → pick_no join against the xlsx color overlay — the
    league's source of truth for who actually made each pick."""
    from fantasy_draft.team_identity import manager_for_xlsx_nickname
    from fantasy_draft.xlsx_drafts import load_xlsx_drafts
    drafts = load_xlsx_drafts(str(ROOT / "data" / "historical" / "MONEY_LEAGUE.xlsx"))
    out: dict[int, str] = {}
    for xp in drafts.get(year, []):
        m = manager_for_xlsx_nickname(xp.manager_nickname)
        if m:
            pir = xp.slot if xp.round % 2 == 1 else 13 - xp.slot
            out[(xp.round - 1) * 12 + pir] = m["id"]
    return out


# ------------------------------------------------------------ core curve

def compute_curve() -> dict:
    blind = _blind_curve()

    def floor0_blind(r: int) -> float:
        return max(0.0, blind.get(r, 0.0))

    payoffs: dict[int, list[float]] = defaultdict(list)
    best: dict[int, dict] = {}
    keepers_excluded = 0

    for year, (ldir, did) in DRAFTS.items():
        picks = json.loads((ROOT / ldir / f"draft_{did}_picks.json").read_text())
        adp = _period_adp(year)
        nxt_vbd = _season_vbd(year + 1)
        owners = _xlsx_owner_by_pick_no(year)
        for pk in sorted(picks, key=lambda p: p["pick_no"]):
            r = pk["round"]
            if r not in ROUNDS:
                continue
            pid = str(pk["player_id"])
            # Keeper exclusion — explicit flag OR the implicit ADP-gap rule
            # (≥1.5 rounds later than period ADP implies), exactly as the
            # backtest detects this league's unflagged keepers.
            a = adp.get(pid, 999.0)
            implicit = a < 999 and (r - max(1.0, a / 12.0)) >= 1.5
            if bool(pk.get("is_keeper")) or implicit:
                keepers_excluded += 1
                continue
            baseline = floor0_blind(r - 2)
            payoff = max(0.0, nxt_vbd.get(pid, -999.0) - baseline)
            payoffs[r].append(payoff)
            if payoff > best.get(r, {}).get("payoff", 0.0):
                md = pk.get("metadata") or {}
                best[r] = {
                    "player": f"{md.get('first_name', '')} {md.get('last_name', '')}".strip(),
                    "pos": (md.get("position") or "").upper(),
                    "year": year,
                    "payoff": round(payoff, 1),
                    "manager": owners.get(pk["pick_no"], "?"),
                }

    curve = []
    for r in ROUNDS:
        lst = payoffs.get(r, [])
        n = len(lst)
        hits = sum(1 for x in lst if x > 0)
        curve.append({
            "round": r,
            "option_value": round(sum(lst) / n, 1) if n else 0.0,
            "n": n,
            "hit_rate": round(hits / n, 3) if n else 0.0,
            "hits": hits,
            "best_hit": best.get(r),
        })

    option_values = {str(r): 0.0 for r in (1, 2)}
    option_values.update({str(c["round"]): c["option_value"] for c in curve})

    return {
        "meta": {
            "generated": date.today().isoformat(),
            "seasons_used": sorted(DRAFTS),
            "excluded": "2025 draft (no 2026 outcomes yet); keepers "
                        f"(explicit flag + ADP-gap rule, {keepers_excluded} "
                        "picks); waiver adds (different acquisition channel)",
            "method": "option payoff = max(0, following-season half-PPR VBD "
                      "- floor0(blind[round-2])); mean includes zeros",
            "replacement_ranks": REPL_RANKS,
            "keeper_rule": "cost = draft round - 2; R1/R2 ineligible "
                           "(option value 0 by rule)",
        },
        "curve": curve,
        "option_values": option_values,
    }


# ------------------------------------------------- stash score + survival

def stash_score(p: dict) -> float:
    """Breakout proxy, 0..1 — the helper CEILING mode's upsideBonus
    (expert disagreement + youth) normalized by its 40-point max."""
    u = 0.0
    if p.get("fp_std") is not None:
        u += min(float(p["fp_std"]), 20.0) * 1.2          # 0..24
    if p.get("years_exp") is not None and p["years_exp"] <= 2:
        u += 10.0
    age = p.get("age")
    if age and age <= 24:
        u += 6.0
    if age and age >= 29:
        u -= 12.0
    return round(max(0.0, min(u, 40.0)) / 40.0, 3)


def survival_at(p: dict, overall: int) -> float:
    """P(still available at overall pick N) from the helper's 11-point
    draft-position quantiles svq — same interpolation as the helper JS."""
    q = p.get("svq")
    if not q:
        return 1.0
    if overall <= q[0]:
        return 1.0
    if overall > q[10]:
        return 0.0
    for i in range(1, 11):
        if overall <= q[i]:
            span = (q[i] - q[i - 1]) or 1
            f = (i - 1 + (overall - q[i - 1]) / span) / 10.0
            return max(0.0, min(1.0, 1.0 - f))
    return 0.0


def brian_stash_board(option_values: dict[str, float]) -> list[dict]:
    """Brian's R10+ picks annotated with the top-3 stash candidates likely
    (P ≥ 50%) still available. Each candidate listed once, at the earliest
    of Brian's late picks where he clears 50%."""
    data = json.loads((ROOT / "docs" / "draft_helper" / "data.json").read_text())
    my_ti = data["my_team_idx"]
    picks = [s for s in data["schedule"]
             if s["team_idx"] == my_ti and s["round"] >= 10]
    picks.sort(key=lambda s: s["overall"])
    scored = sorted(
        ((stash_score(p), p) for p in data["players"] if stash_score(p) > 0),
        key=lambda t: (-t[0], p_adp(t[1])))
    used: set[str] = set()
    board = []
    for pk in picks:
        cands = []
        for sc, p in scored:
            if p["name"] in used or len(cands) >= 3:
                continue
            sv = survival_at(p, pk["overall"])
            if sv >= 0.5:
                used.add(p["name"])
                cands.append({
                    "name": p["name"], "pos": p["pos"], "stash": sc,
                    "survival": round(sv, 2), "adp": p.get("adp"),
                    "keeper_cost": f"R{pk['round'] - 2}",
                })
        board.append({"round": pk["round"], "overall": pk["overall"],
                      "option_value": option_values.get(str(pk["round"]), 0.0),
                      "candidates": cands})
    return board


def p_adp(p: dict) -> float:
    a = p.get("adp")
    return float(a) if a else 999.0


# ---------------------------------------------------------- consumers API

def load_option_values() -> dict[int, float]:
    """Round → empirical keeper-option VBD from the cached curve.
    Zeros when the cache hasn't been built yet (degrade, don't crash)."""
    try:
        raw = json.loads(CURVE_JSON.read_text())["option_values"]
        return {int(r): float(v) for r, v in raw.items()}
    except Exception:
        return {}


def composed_round_values() -> dict[int, dict[str, float]]:
    """THE round-value composition (trade advisor + pick squeeze):
    total = max(0, redraft blind) + option_value[round].
    Redraft keeps its 0-floor (a pick is never worth negative); the option
    term prices the 2027 keeper lottery a live pick carries."""
    blind = _blind_curve()
    opt = load_option_values()
    out = {}
    for r in range(1, 18):
        redraft = max(0.0, blind.get(r, 0.0))
        option = float(opt.get(r, 0.0))
        out[r] = {"redraft": round(redraft, 1), "option": round(option, 1),
                  "total": round(redraft + option, 1)}
    return out


# ----------------------------------------------------------- fragment

def build_fragment(res: dict, board: list[dict]) -> str:
    e = _html.escape

    def hit_cell(bh):
        if not bh:
            return '<td class="ml-empty">no hit yet</td>'
        return (f'<td>{e(bh["player"])} <span class="ml-note">{e(bh["pos"])} '
                f'&middot; {bh["year"]} draft ({e(bh["manager"])}) &middot; '
                f'+{bh["payoff"]:.0f}</span></td>')

    rows = "".join(
        "<tr>"
        f'<td class="ml-num">R{c["round"]}</td>'
        f'<td class="ml-num{" ml-sv-hi" if c["option_value"] >= 10 else ""}">'
        f'{c["option_value"]:.1f}</td>'
        f'<td class="ml-num">{c["n"]}</td>'
        f'<td class="ml-num">{c["hit_rate"] * 100:.0f}% '
        f'<span class="ml-note">({c["hits"]}/{c["n"]})</span></td>'
        + hit_cell(c["best_hit"]) + "</tr>"
        for c in res["curve"])

    def cand_txt(cands):
        if not cands:
            return '<span class="ml-note">covered by earlier rows</span>'
        return " &middot; ".join(
            f'{e(c["name"])} <span class="ml-note">{e(c["pos"])} '
            f'stash {c["stash"]:.2f}, P {c["survival"] * 100:.0f}%</span>'
            for c in cands)

    board_rows = "".join(
        "<tr>"
        f'<td class="ml-num">R{b["round"]} &middot; pick {b["overall"]}</td>'
        f'<td class="ml-num">{b["option_value"]:.1f}</td>'
        f'<td>{cand_txt(b["candidates"])}</td></tr>'
        for b in board)

    return f"""<section class="ml-panel" id="stash-curve">
<h2>The Option Book — what a late pick's keeper option is worth</h2>
<p class="ml-serial">EMPIRICAL 2027 KEEPER OPTION BY DRAFT ROUND ·
LEAGUE DRAFTS {"+".join(str(y) for y in res["meta"]["seasons_used"])} ·
{e(res["meta"]["generated"])}</p>
<p>The redraft chart prices a R10+ pick at zero — the typical player taken
there finishes below replacement. But every drafted player is also a call
option on NEXT season: keep him at (round − 2). This table is what that
option actually paid in our league — mean next-season keeper surplus per
round, busts included.</p>
<div class="ml-h-label">The stash curve (option value = mean of
max(0, next-season VBD − cost-round chart value), zeros included)</div>
<table class="ml-table ml-table--compact">
<thead><tr><th class="ml-num">Drafted in</th>
<th class="ml-num">Option VBD</th><th class="ml-num">n</th>
<th class="ml-num">Hit rate</th><th>Best hit</th></tr></thead>
<tbody>{rows}</tbody></table>
<div class="ml-h-label">Your late picks — top stash candidates likely
there (P ≥ 50%), listed at your earliest pick that clears 50%</div>
<table class="ml-table ml-table--compact">
<thead><tr><th class="ml-num">Your pick</th>
<th class="ml-num">Round option VBD</th>
<th>Stash candidates (breakout proxy 0-1 &middot; P available)</th></tr>
</thead><tbody>{board_rows}</tbody></table>
<p class="ml-fineprint">Two seasons of history ({len(res["meta"]["seasons_used"])}
drafts, ~12 picks per round-year) — wide error bars; read this as a PRIOR,
not a price. The 2025 draft is excluded (its options pay in 2026 —
outcomes unknown). Keepers are excluded from the sample (explicit flags
plus the implicit ADP-gap rule; they were bought, not drafted); waiver
pickups are a different acquisition channel and out of scope. R1/R2 picks
are keeper-ineligible — their option value is zero by rule. Next-season
VBD uses actual half-PPR points minus superflex replacement
(QB22/RB31/WR42/TE13). Trade math elsewhere now prices every pick as
max(0, redraft chart) + this option value, so a "worthless" R14 is no
longer free — it is a lottery ticket with a measured league-own premium.
Stash candidates use the CEILING-mode breakout proxy (expert disagreement
+ youth) and the Monte-Carlo survival quantiles.</p>
</section>
"""


# ---------------------------------------------------------------- main

def main() -> None:
    res = compute_curve()
    board = brian_stash_board(res["option_values"])
    res["brian_stash_board"] = board
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    CURVE_JSON.write_text(json.dumps(res, indent=2))
    (OUT_DIR / "stash_curve.html").write_text(build_fragment(res, board))

    print("[stash_curve] round → option VBD (n, hit rate, best hit)")
    for c in res["curve"]:
        bh = c["best_hit"]
        tag = (f"best {bh['player']} {bh['year']} +{bh['payoff']:.0f}"
               if bh else "no hit")
        print(f"  R{c['round']:>2}: {c['option_value']:>6.1f}  "
              f"(n={c['n']:>2}, hit {c['hit_rate'] * 100:>3.0f}%, {tag})")
    print(f"[stash_curve] wrote {CURVE_JSON.relative_to(ROOT)} + .html "
          f"({len(board)} late picks on the stash board)")


if __name__ == "__main__":
    main()
