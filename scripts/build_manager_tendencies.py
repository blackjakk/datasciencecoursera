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


def main():
    # mgr_first_per_year[mgr][pos] = [first_round_in_2023, ..., 2024, 2025]
    mgr_first: dict[str, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))
    league_first: dict[str, list[int]] = defaultdict(list)

    for year, ldir, did in LEAGUES:
        picks = json.loads(Path(f"{ldir}/draft_{did}_picks.json").read_text())
        rosters = json.loads(Path(f"{ldir}/rosters.json").read_text())
        rid_to_mgr = {}
        for r in rosters:
            m = manager_for_sleeper_roster(r['roster_id'])
            if m:
                rid_to_mgr[r['roster_id']] = m['id']

        # Per (rid, pos) -> earliest round in this year
        seen_mgr_pos: set[tuple[int, str]] = set()
        for p in sorted(picks, key=lambda x: x['pick_no']):
            rid = p['roster_id']
            pos = (p.get('metadata') or {}).get('position', '').upper()
            if not pos or pos not in POSITIONS:
                continue
            if (rid, pos) in seen_mgr_pos:
                continue
            seen_mgr_pos.add((rid, pos))
            mgr = rid_to_mgr.get(rid)
            league_first[pos].append(p['round'])
            if mgr:
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
