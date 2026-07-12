"""S3 — Keeper-declaration sensitivity: which RIVAL keeper calls matter to Brian.

Every rival with alternates has a genuinely uncertain declaration. For each
candidate flip (swap their weakest carryover for an alternate, or — when the
team keeps fewer than the 4-keeper cap — add an alternate outright), run
paired-seed full-draft simulations (same seed list base vs flip, the
optimize_my_keepers pattern) and measure the change in BRIAN's (roster_id 9)
expected starters-shaped roster projection.

Reuses build_mock_draft_sim's entry points (skeleton, keeper placement, the
tendency-aware simulator) — nothing is forked. Flips are capped at the top
MAX_FLIPS league-wide by |net_vbd difference| to stay inside the runtime
budget.

Writes data/research/keeper_sensitivity.json and .html (one <section>
fragment, ml.css classes only — no raw hex; scanned by the design gate).
"""
from __future__ import annotations

import datetime as _dt
import html as _html
import json
import math
import random
import re
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.build_mock_draft_sim import (  # noqa: E402
    KEEPERS_JSON, MC_TEMPERATURE, MY_RID, PREDICTED_SLOT_TO_RID, TOP_K,
    apply_keeper_set, build_skeleton, load_inputs, load_tendencies,
    simulate_full_draft_with_tendencies,
)
from scripts.optimize_my_keepers import starters_proj  # noqa: E402
from fantasy_draft.team_identity import manager_for_sleeper_roster  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT_JSON = ROOT / "data" / "research" / "keeper_sensitivity.json"
OUT_HTML = ROOT / "data" / "research" / "keeper_sensitivity.html"

N_SEEDS = 96       # paired seeds per scenario (~0.17 s/sim -> ~3.5 min total)
MAX_FLIPS = 10     # league-wide cap, ranked by |net_vbd difference|
KEEPER_CAP = 4     # league keeper limit (an under-cap team can ADD an alternate)


# ---------------------------------------------------------------- flips

def _round_of_adp(adp: float | None) -> int:
    if not adp or adp >= 900:
        return 18
    return int((float(adp) - 1) // 12) + 1


def enumerate_flips(all_keepers: list[dict]) -> list[dict]:
    """Candidate rival declaration flips, ranked by |net_vbd difference|."""
    carry_by_rid: dict[int, list[dict]] = defaultdict(list)
    alts_by_rid: dict[int, list[dict]] = defaultdict(list)
    for k in all_keepers:
        if k["roster_id"] == MY_RID:
            continue
        if k.get("status") == "carryover":
            carry_by_rid[k["roster_id"]].append(k)
        elif k.get("status") == "alternate":
            alts_by_rid[k["roster_id"]].append(k)

    flips: list[dict] = []
    for rid, alts in alts_by_rid.items():
        carries = carry_by_rid.get(rid, [])
        weakest = (min(carries, key=lambda k: k.get("net_vbd") or 0)
                   if carries else None)
        for alt in alts:
            if weakest is not None:
                flips.append({
                    "roster_id": rid, "kind": "swap",
                    "keep_in": alt, "keep_out": weakest,
                    "delta_net_vbd": round((alt.get("net_vbd") or 0)
                                           - (weakest.get("net_vbd") or 0), 1),
                })
            if len(carries) < KEEPER_CAP:
                flips.append({
                    "roster_id": rid, "kind": "add",
                    "keep_in": alt, "keep_out": None,
                    "delta_net_vbd": round(alt.get("net_vbd") or 0, 1),
                })
    flips.sort(key=lambda f: -abs(f["delta_net_vbd"]))
    return flips[:MAX_FLIPS]


# ------------------------------------------------------- keeper placement

def team_round_capacity(draft) -> dict[int, Counter]:
    """team_idx -> Counter{round: picks owned} from the traded-pick skeleton."""
    cap: dict[int, Counter] = defaultdict(Counter)
    for p in draft.picks:
        cap[p.team_idx][p.round_num] += 1
    return cap


def resolve_team(records: list[dict], owned: Counter) -> list[dict]:
    """Deterministic bump-up seating (house rule): each keeper pays its
    forfeit round; if that seat is taken/unowned it bumps to the next
    EARLIER owned free round. Higher raw_vbd keepers seat first (the
    optimize_my_keepers convention). Keepers with no seat left are dropped."""
    free = Counter(owned)
    out = []
    for k in sorted(records, key=lambda k: -(k.get("raw_vbd") or 0)):
        r = int(k.get("forfeit_round") or 0)
        while r >= 1 and free[r] <= 0:
            r -= 1
        if r < 1:
            continue
        free[r] -= 1
        out.append({**k, "effective_forfeit_round": r})
    return out


def build_keeper_set(carry_by_rid: dict[int, list[dict]],
                     capacity: dict[int, Counter],
                     rid_to_slot: dict[int, int]) -> list[dict]:
    """Resolve every team through the SAME deterministic seating so a null
    flip reproduces the baseline exactly (paired-seed identity)."""
    out: list[dict] = []
    for rid, records in sorted(carry_by_rid.items()):
        slot = rid_to_slot.get(rid)
        if slot is None:
            continue
        out.extend(resolve_team(records, capacity[slot - 1]))
    return out


# ------------------------------------------------------------------ sims

def run_scenario(keeper_set: list[dict], seeds: list[int], league, players,
                 my_team_idx: int, proj_by_name: dict, mgr_expected: dict,
                 league_first: dict, team_idx_to_mgr: dict) -> list[float]:
    totals = []
    for seed in seeds:
        draft = build_skeleton(league)
        apply_keeper_set(draft, players, keeper_set)
        full = simulate_full_draft_with_tendencies(
            draft, players, my_team_idx,
            temperature=MC_TEMPERATURE, top_k=TOP_K, rng=random.Random(seed),
            mgr_expected=mgr_expected, league_first=league_first,
            team_idx_to_mgr=team_idx_to_mgr,
        )
        roster = [fp.player_name for fp in full if fp.team_idx == my_team_idx]
        totals.append(starters_proj(roster, proj_by_name))
    return totals


def paired_stats(base: list[float], flip: list[float]) -> tuple[float, float]:
    diffs = [f - b for b, f in zip(base, flip)]
    n = len(diffs)
    mean = sum(diffs) / n
    var = (sum((d - mean) ** 2 for d in diffs) / (n - 1)) if n > 1 else 0.0
    return mean, math.sqrt(var) / math.sqrt(n)


def why_line(flip: dict) -> str:
    alt = flip["keep_in"]
    pos = alt.get("position", "?")
    paper = _round_of_adp(alt.get("adp"))
    took = f"pulls {pos} {alt['player_name']} off the open board (~R{paper} paper)"
    if flip["kind"] == "add":
        return (f"{took} and burns one of their late picks — "
                f"one fewer target in your R{paper} window")
    out = flip["keep_out"]
    back = _round_of_adp(out.get("adp"))
    return (f"{took}; returns {out.get('position', '?')} {out['player_name']} "
            f"to the pool (~R{back} paper)")


# -------------------------------------------------------------- fragment

def _fmt_signed(x: float, digits: int = 1) -> str:
    return f"{x:+.{digits}f}"


def render_fragment(result: dict) -> str:
    e = _html.escape
    rows = []
    for f in result["flips"]:
        swing, se = f["brian_swing"], f["noise_se"]
        cls = ("ml-sv-mid" if not f["significant"]
               else ("ml-sv-hi" if swing > 0 else "ml-sv-lo"))
        if f["keep_out"]:
            desc = (f"keeps {e(f['keep_in_name'])} instead of "
                    f"{e(f['keep_out'])}")
        else:
            desc = f"also keeps {e(f['keep_in_name'])} (open 4th slot)"
        rows.append(
            "<tr>"
            f"<td>{e(f['rival'])}</td>"
            f"<td>{desc} <span class=\"ml-note\">R{f['seat_round']}</span></td>"
            f"<td class=\"ml-num\">{_fmt_signed(f['delta_net_vbd'])}</td>"
            f"<td class=\"ml-num {cls}\">{_fmt_signed(swing)} "
            f"<span class=\"ml-note\">&plusmn;{se:.1f}</span></td>"
            f"<td>{e(f['why'])}</td>"
            "</tr>"
        )
    today = _dt.date.today().isoformat()
    return (
        '<section class="ml-panel" id="keeper-sensitivity">\n'
        "<h2>Keeper Sensitivity — rival declarations worth probing</h2>\n"
        f'<p class="ml-serial">PAIRED-SEED FULL-DRAFT SIMS · '
        f'{result["n_seeds"]} SEEDS × {len(result["flips"])} FLIPS · '
        f'BASELINE {result["baseline_mean"]:.0f} PROJ PTS · {today}</p>\n'
        "<p>Each row flips ONE rival keeper call (predicted set otherwise "
        "unchanged) and re-runs the whole draft on the same seeds. "
        "<strong>Your swing</strong> is the paired change in your expected "
        "starter projection — positive means the flip quietly helps you.</p>\n"
        '<table class="ml-table ml-table--compact">\n'
        "<thead><tr><th>Rival</th><th>The flip</th>"
        '<th class="ml-num">Board &Delta; (net VBD)</th>'
        '<th class="ml-num">Your swing</th><th>Why it moves you</th>'
        "</tr></thead>\n<tbody>" + "".join(rows) + "</tbody></table>\n"
        '<p class="ml-fineprint">Predictions until keepers lock. Paired '
        "seeds: base and flip see identical draft worlds, so the swing is "
        "the flip's effect, not sim noise. The &plusmn; band is the seed "
        "std &divide; &radic;n; swings inside their band are noise — probe "
        "the rival, don't act on the number. Flips capped at the top "
        f"{MAX_FLIPS} league-wide by |net VBD difference|.</p>\n"
        "</section>\n"
    )


# ---------------------------------------------------------------- main

def main() -> None:
    t_start = time.time()
    league, players = load_inputs()
    proj_by_name = {p.name: (p.position, p.projection) for p in players}
    mgr_expected, league_first = load_tendencies()
    rid_to_slot = {rid: slot for slot, rid in PREDICTED_SLOT_TO_RID.items()}
    my_team_idx = rid_to_slot[MY_RID] - 1
    team_idx_to_mgr = {}
    for slot, rid in PREDICTED_SLOT_TO_RID.items():
        m = manager_for_sleeper_roster(rid)
        if m:
            team_idx_to_mgr[slot - 1] = m["id"]

    all_keepers = json.loads(KEEPERS_JSON.read_text())
    carry_by_rid: dict[int, list[dict]] = defaultdict(list)
    for k in all_keepers:
        if k.get("status") == "carryover":
            carry_by_rid[k["roster_id"]].append(k)

    capacity = team_round_capacity(build_skeleton(league))
    base_set = build_keeper_set(carry_by_rid, capacity, rid_to_slot)

    seed_rng = random.Random(2026)
    seeds = [seed_rng.randint(0, 10 ** 9) for _ in range(N_SEEDS)]
    sim_kw = dict(league=league, players=players, my_team_idx=my_team_idx,
                  proj_by_name=proj_by_name, mgr_expected=mgr_expected,
                  league_first=league_first, team_idx_to_mgr=team_idx_to_mgr)

    base_totals = run_scenario(base_set, seeds, **sim_kw)
    base_mean = sum(base_totals) / len(base_totals)
    print(f"Baseline (predicted keeper sets): {base_mean:.1f} "
          f"projected starter pts over {N_SEEDS} seeds")

    # Self-verify 1 — paired-seed identity: a null flip (flip = base set)
    # must reproduce the baseline exactly under the same seeds.
    null_totals = run_scenario(
        build_keeper_set(carry_by_rid, capacity, rid_to_slot), seeds, **sim_kw)
    ident = max(abs(a - b) for a, b in zip(base_totals, null_totals))
    assert ident < 1e-9, f"paired-seed identity broken (max diff {ident})"
    print(f"Identity check: null flip swing = {ident:.2e} (OK)")

    flips = enumerate_flips(all_keepers)
    print(f"Probing {len(flips)} flips x {N_SEEDS} paired seeds")

    out_flips = []
    for f in flips:
        rid = f["roster_id"]
        records = list(carry_by_rid[rid])
        if f["kind"] == "swap":
            records = [r for r in records
                       if r["player_name"] != f["keep_out"]["player_name"]]
        records.append(f["keep_in"])
        flip_by_rid = dict(carry_by_rid)
        flip_by_rid[rid] = records
        flip_set = build_keeper_set(flip_by_rid, capacity, rid_to_slot)
        seated = next((k for k in flip_set
                       if k["roster_id"] == rid
                       and k["player_name"] == f["keep_in"]["player_name"]),
                      None)
        totals = run_scenario(flip_set, seeds, **sim_kw)
        swing, se = paired_stats(base_totals, totals)
        mgr = manager_for_sleeper_roster(rid)
        out_flips.append({
            "rival": mgr["id"] if mgr else f"roster {rid}",
            "roster_id": rid,
            "kind": f["kind"],
            "keep_in_name": f["keep_in"]["player_name"],
            "keep_in_pos": f["keep_in"].get("position"),
            "keep_out": (f["keep_out"]["player_name"]
                         if f["keep_out"] else None),
            "seat_round": (seated or {}).get(
                "effective_forfeit_round",
                f["keep_in"].get("forfeit_round")),
            "delta_net_vbd": f["delta_net_vbd"],
            "brian_swing": round(swing, 2),
            "noise_se": round(se, 2),
            "significant": abs(swing) > se,
            "why": why_line(f),
        })
        print(f"  {swing:+6.2f} +/-{se:4.2f}  {out_flips[-1]['rival']}: "
              f"{f['kind']} {f['keep_in']['player_name']}"
              + (f" for {f['keep_out']['player_name']}"
                 if f["keep_out"] else ""))

    out_flips.sort(key=lambda r: -abs(r["brian_swing"]))
    result = {
        "generated": _dt.date.today().isoformat(),
        "n_seeds": N_SEEDS,
        "max_flips": MAX_FLIPS,
        "baseline_mean": round(base_mean, 1),
        "identity_check_max_diff": ident,
        "runtime_seconds": None,  # filled below
        "flips": out_flips,
    }
    result["runtime_seconds"] = round(time.time() - t_start, 1)

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(result, indent=2))
    frag = render_fragment(result)
    OUT_HTML.write_text(frag)

    # Self-verify 2 — json round-trips; 3 — fragment is raw-hex free.
    json.loads(OUT_JSON.read_text())
    assert not re.search(r"#[0-9a-fA-F]{3,8}\b", frag), "raw hex in fragment"
    assert frag.lstrip().startswith("<section") and \
        frag.rstrip().endswith("</section>"), "fragment shape"
    print(f"\nWrote {OUT_JSON.relative_to(ROOT)} and "
          f"{OUT_HTML.relative_to(ROOT)} "
          f"({result['runtime_seconds']}s total)")
    top = out_flips[:3]
    for f in top:
        print(f"TOP: {f['rival']} {f['kind']} {f['keep_in_name']}"
              f"{' for ' + f['keep_out'] if f['keep_out'] else ''}"
              f" -> Brian {f['brian_swing']:+.2f} +/-{f['noise_se']:.2f}")


if __name__ == "__main__":
    main()
