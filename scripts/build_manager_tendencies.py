"""Extract per-manager position-round tendencies from 2023-2025 Sleeper drafts.

Output: data/manager_tendencies.json
  { manager_id: { position: delta_rounds_from_league_avg_first_pick } }

Negative delta = manager drafts this position EARLIER than league avg.
Positive delta = manager waits LATER on this position.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.team_identity import manager_for_sleeper_roster  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "manager_tendencies.json"

LEAGUES = [
    ('2023', 'data/sleeper/league_1001657805583077376', '1001657806530957312'),
    ('2024', 'data/sleeper/league_1085805164784664576', '1085805164784664577'),
    ('2025', 'data/sleeper/league_1245039290518360064', '1245039290522550272'),
]

POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']


def build_fingerprints() -> dict:
    """Robust per-owner draft fingerprints (July 2026 method):
      - positional reach = MEDIAN of (period-ADP round − round taken),
        positive = pays above market; picks with no real market price
        (ADP >= pick 216) and keepers are EXCLUDED — one undrafted dart
        (Chris Rodriguez, coop 2025) once fabricated a +5.7 "RB tax"
        from a mean, hence median + cap;
      - age_at_draft / rookie_share / yr2_share = veteran-vs-youth axis
        (age backdated per season from the current catalog);
      - discipline = median reach across all graded picks.
    Consumed by the MC sim tilts, practice bots, dossiers, room card."""
    import statistics as st
    from scripts.stash_curve import _period_adp, _xlsx_owner_by_pick_no

    players = json.loads(
        (ROOT / "data/sleeper/players_nfl.json").read_text())
    reach: dict[tuple[str, str], list[float]] = defaultdict(list)
    ages: dict[str, list[float]] = defaultdict(list)
    exp_counts: dict[str, dict[str, int]] = defaultdict(
        lambda: {"rookie": 0, "yr2": 0, "n": 0})

    for year, ldir, did in LEAGUES:
        season = int(year)
        adp = _period_adp(season)
        owners = _xlsx_owner_by_pick_no(season)
        yrs_back = 2026 - season
        picks = json.loads(
            Path(f"{ldir}/draft_{did}_picks.json").read_text())
        for p in picks:
            mgr = owners.get(p["pick_no"])
            pl = players.get(p["player_id"]) or {}
            pos = pl.get("position")
            if not mgr or pos not in ("QB", "RB", "WR", "TE"):
                continue
            age = pl.get("age")
            if age is not None:
                ages[mgr].append(age - yrs_back)
            exp = pl.get("years_exp")
            ec = exp_counts[mgr]
            ec["n"] += 1
            if exp is not None:
                if exp - yrs_back == 0:
                    ec["rookie"] += 1
                elif exp - yrs_back == 1:
                    ec["yr2"] += 1
            a = adp.get(p["player_id"], 999.0)
            if a >= 216:               # no real market price — ungradable
                continue
            ar = max(1.0, a / 12.0)
            if bool(p.get("is_keeper")) or (p["round"] - ar) >= 1.5:
                continue               # keepers were bought, not drafted
            reach[(mgr, pos)].append(ar - p["round"])
            reach[(mgr, "ALL")].append(ar - p["round"])

    fingerprints: dict[str, dict] = {}
    for mgr in exp_counts:
        ec = exp_counts[mgr]
        fp: dict = {
            "age_at_draft": round(sum(ages[mgr]) / len(ages[mgr]), 1)
            if ages[mgr] else None,
            "rookie_share": round(ec["rookie"] / ec["n"], 2) if ec["n"] else 0,
            "yr2_share": round(ec["yr2"] / ec["n"], 2) if ec["n"] else 0,
            "reach": {},
        }
        for pos in ("QB", "RB", "WR", "TE", "ALL"):
            rs = reach.get((mgr, pos), [])
            if rs:
                fp["reach"][pos] = {"median": round(st.median(rs), 2),
                                    "n": len(rs)}
        fingerprints[mgr] = fp
    return fingerprints


def build_decade_history() -> dict:
    """Per-owner draft-behavior series over EVERY xlsx draft (2015-2025 —
    the format check passed: 2.2-2.8 QBs/team every year, a 2QB room the
    whole recorded era). Yahoo years carry no ADP, so this is position
    timing + youth appetite only (no reach, no keeper detection); the
    ADP-era fingerprints stay the sim's tilt source — this block is the
    evidence layer that says whether those habits are decade-stable."""
    import statistics as st
    from fantasy_draft.name_aliases import resolve_xlsx_name
    from fantasy_draft.team_identity import manager_for_xlsx_nickname
    from fantasy_draft.xlsx_drafts import load_xlsx_drafts

    players = json.loads(
        (ROOT / "data/sleeper/players_nfl.json").read_text())
    byname: dict[str, tuple] = {}

    def norm(s: str) -> str:
        return (s.lower().replace(".", "").replace("'", "")
                .replace("-", " ").strip())

    for p in players.values():
        nm = f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
        if nm:
            byname.setdefault(norm(nm),
                              (p.get("position"), p.get("years_exp"),
                               p.get("age")))

    drafts = load_xlsx_drafts(
        str(ROOT / "data" / "historical" / "MONEY_LEAGUE.xlsx"))
    series: dict[str, dict[int, dict]] = defaultdict(dict)
    for year, picks in sorted(drafts.items()):
        yrs_back = 2026 - year
        per: dict[str, dict] = defaultdict(
            lambda: {"qb": [], "rook": 0, "n": 0, "ages": []})
        for xp in picks:
            m = manager_for_xlsx_nickname(xp.manager_nickname)
            canon = resolve_xlsx_name(xp.player_name)
            if not m or not canon:
                continue
            rec = byname.get(norm(canon))
            if not rec:
                continue
            pos, exp, age = rec
            if pos in ("K", "DEF", None):
                continue
            s = per[m["id"]]
            s["n"] += 1
            if pos == "QB":
                s["qb"].append(xp.round)
            if exp is not None and exp - yrs_back == 0:
                s["rook"] += 1
            if age is not None:
                s["ages"].append(age - yrs_back)
        for mid, s in per.items():
            if s["n"] < 8:
                continue                    # partial-year parse — skip
            qbs = sorted(s["qb"])
            series[mid][year] = {
                "qb1": qbs[0] if qbs else None,
                "qb2": qbs[1] if len(qbs) > 1 else None,
                "rook_share": round(s["rook"] / s["n"], 2),
                "age": round(sum(s["ages"]) / len(s["ages"]), 1)
                if s["ages"] else None,
            }

    history: dict[str, dict] = {}
    for mid, yrs in series.items():
        qb2s = [v["qb2"] for v in yrs.values() if v["qb2"] is not None]
        rooks = [v["rook_share"] for v in yrs.values()]
        ages = [v["age"] for v in yrs.values() if v["age"] is not None]
        if not qb2s:
            continue
        q = sorted(qb2s)
        iqr = (q[3 * len(q) // 4] - q[len(q) // 4]) if len(q) >= 4 else None
        history[mid] = {
            "years": len(yrs),
            "qb2_median": st.median(qb2s),
            "qb2_iqr": iqr,
            "qb2_stable": iqr is not None and iqr <= 3,
            "rook_share_mean": round(st.mean(rooks), 2),
            "age_mean": round(st.mean(ages), 1) if ages else None,
            "by_year": yrs,
        }
    return history


def main():
    # mgr_first_per_year[mgr][pos] = [first_round_in_2023, ..., 2024, 2025]
    mgr_first: dict[str, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))
    league_first: dict[str, list[int]] = defaultdict(list)

    # OWNERSHIP comes from the xlsx color overlay — the league's source of
    # truth for who actually made each pick. Sleeper's feed attributes by
    # original slot and is wrong on 194/204 picks in 2023 (pre-migration
    # pick trades never reached Sleeper). Player POSITION still comes from
    # Sleeper metadata, joined on (round, slot) -> pick_no; the join is
    # name-validated at 91-95% (misses are spelling variants).
    # Nicknames also identify HUMANS, which handles the rid-10 franchise
    # handoff (old owner's seasons resolve to the old owner, not Josh).
    from fantasy_draft.team_identity import manager_for_xlsx_nickname
    from fantasy_draft.xlsx_drafts import load_xlsx_drafts
    xlsx_drafts = load_xlsx_drafts(
        str(Path(__file__).resolve().parent.parent
            / "data" / "historical" / "MONEY_LEAGUE.xlsx"))

    for year, ldir, did in LEAGUES:
        picks = json.loads(Path(f"{ldir}/draft_{did}_picks.json").read_text())
        by_pick_no = {p["pick_no"]: p for p in picks}
        owner_by_pick_no: dict[int, str] = {}
        for xp in xlsx_drafts.get(int(year), []):
            pir = xp.slot if xp.round % 2 == 1 else 13 - xp.slot
            m = manager_for_xlsx_nickname(xp.manager_nickname)
            if m:
                owner_by_pick_no[(xp.round - 1) * 12 + pir] = m["id"]

        seen_mgr_pos: set[tuple[str, str]] = set()
        for p in sorted(picks, key=lambda x: x['pick_no']):
            pos = (p.get('metadata') or {}).get('position', '').upper()
            if not pos or pos not in POSITIONS:
                continue
            mgr = owner_by_pick_no.get(p['pick_no'])
            if not mgr or (mgr, pos) in seen_mgr_pos:
                continue
            seen_mgr_pos.add((mgr, pos))
            league_first[pos].append(p['round'])
            mgr_first[mgr][pos].append(p['round'])

    # League averages
    league_avg = {pos: sum(rs) / len(rs) for pos, rs in league_first.items() if rs}

    tendencies = {}
    for mgr in mgr_first:
        tendencies[mgr] = {}
        for pos in POSITIONS:
            firsts = mgr_first[mgr].get(pos, [])
            if not firsts:
                continue
            mgr_avg = sum(firsts) / len(firsts)
            league_pos_avg = league_avg.get(pos, mgr_avg)
            delta = round(mgr_avg - league_pos_avg, 2)
            tendencies[mgr][pos] = {
                'delta_rounds': delta,           # neg = earlier than league
                'manager_first_avg': round(mgr_avg, 2),
                'league_first_avg': round(league_pos_avg, 2),
                'n_samples': len(firsts),
            }

    out = {
        '_note': ('delta_rounds < 0 means this manager drafts this position '
                  'EARLIER than the league average; > 0 means they wait.'),
        'league_first_avg': {p: round(v, 2) for p, v in league_avg.items()},
        'tendencies': tendencies,
        'fingerprints': build_fingerprints(),
        'decade_history': build_decade_history(),
    }
    OUT.write_text(json.dumps(out, indent=2))
    print(f"Wrote {OUT}")
    print()
    print("Strongest tendencies (|delta| >= 2.0):")
    rows = []
    for mgr, posdata in tendencies.items():
        for pos, info in posdata.items():
            if abs(info['delta_rounds']) >= 2.0:
                rows.append((mgr, pos, info['delta_rounds']))
    rows.sort(key=lambda r: r[2])
    for mgr, pos, d in rows:
        kind = 'EARLY' if d < 0 else 'WAITS'
        print(f"  {mgr:<22} {pos:<4} {d:+.1f}  ({kind})")


if __name__ == '__main__':
    main()
