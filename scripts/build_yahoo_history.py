"""Normalize the Yahoo-era MONEYLEAGUE archive (2011-2022).

Input: data/yahoo/<season>_<league_id>/standings.json for every archived
league whose name is "moneyleague" (the OAuth backfill grabbed ALL of the
authorizing user's leagues; this module selects ours). Output:

  data/league_history/yahoo_era.json
    {season: {"teams": [{manager, team_name, rank, playoff_seed, wins,
                          losses, pf, pa}],
              "num_teams": N, "champion": manager_or_null}}

Manager mapping: exact match against team_identity.json
yahoo_team_names[season]; unmatched names are kept with manager=null and
listed in the build output (fix them by adding the name to the identity
file — user corrections about league history are gold).

Champion cross-check: Yahoo's final standings rank 1 is the playoff
champion in completed leagues; every season is validated against
KNOWN_CHAMPIONS and mismatches are printed loudly rather than silently
trusted (either source could be wrong — the identity file is the arbiter
of record).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.team_identity import load_identity  # noqa: E402
from scripts.build_history_charts import KNOWN_CHAMPIONS  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "yahoo"
OUT = ROOT / "data" / "league_history" / "yahoo_era.json"


def _standings_rows(path: Path) -> tuple[list[dict], int]:
    raw = json.loads(path.read_text())
    lg = raw["fantasy_content"]["league"]
    st = next(p["standings"] for p in lg
              if isinstance(p, dict) and "standings" in p)
    teams = (st[0] if isinstance(st, list) else st)["teams"]
    rows = []
    for i in range(int(teams["count"])):
        t = teams[str(i)]["team"]
        meta = {k: v for part in t[0] if isinstance(part, dict)
                for k, v in part.items()}
        stand = t[2]["team_standings"]
        outc = stand.get("outcome_totals") or {}
        rows.append({
            "team_name": meta.get("name", "?"),
            "rank": int(stand.get("rank") or 0),
            "playoff_seed": int(stand.get("playoff_seed") or 0) or None,
            "wins": int(outc.get("wins") or 0),
            "losses": int(outc.get("losses") or 0),
            "pf": float(stand.get("points_for") or 0),
            "pa": float(stand.get("points_against") or 0),
        })
    rows.sort(key=lambda r: r["rank"])
    return rows, int(teams["count"])


def main() -> None:
    ident = load_identity(ROOT / "data" / "team_identity.json")
    name_to_mid: dict[tuple[int, str], str] = {}
    for mid, rec in ident["managers"].items():
        for season, nm in (rec.get("yahoo_team_names") or {}).items():
            if not str(season).isdigit() or not isinstance(nm, str):
                continue                      # skip _note/_comment entries
            name_to_mid[(int(season), nm.strip().lower())] = mid

    era: dict[int, dict] = {}
    unmatched: list[str] = []
    for d in sorted(SRC.iterdir()):
        if not d.is_dir() or "_" not in d.name:
            continue
        lg_f = d / "league.json"
        if not lg_f.exists():
            continue
        raw = json.loads(lg_f.read_text())
        l = raw["fantasy_content"]["league"]
        meta = l[0] if isinstance(l, list) else l
        if (meta.get("name") or "").strip().lower() != "moneyleague":
            continue
        season = int(meta["season"])
        rows, n = _standings_rows(d / "standings.json")
        for r in rows:
            mid = name_to_mid.get((season, r["team_name"].strip().lower()))
            r["manager"] = mid
            if not mid:
                unmatched.append(f"{season}: {r['team_name']!r} (rank "
                                 f"{r['rank']})")
        champ = rows[0]["manager"] if rows else None
        era[season] = {"num_teams": n, "champion": champ, "teams": rows}

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(era, indent=2))
    print(f"[yahoo_era] {len(era)} MONEYLEAGUE seasons "
          f"({min(era)}-{max(era)}) -> {OUT.relative_to(ROOT)}")

    ok = bad = 0
    for season, known in sorted(KNOWN_CHAMPIONS.items()):
        got = era.get(season, {}).get("champion")
        if got is None and season not in era:
            continue
        if got == known:
            ok += 1
        else:
            bad += 1
            print(f"  CHAMPION MISMATCH {season}: standings rank-1 = "
                  f"{got!r}, KNOWN_CHAMPIONS = {known!r}")
    print(f"champion cross-check: {ok} match, {bad} mismatch")
    if unmatched:
        print(f"{len(unmatched)} unmatched team names "
              "(add to team_identity.json yahoo_team_names):")
        for u in unmatched:
            print(f"  {u}")


if __name__ == "__main__":
    main()
