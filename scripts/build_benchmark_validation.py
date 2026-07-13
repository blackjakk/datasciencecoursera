"""Out-of-sample validation of the Champion Profile signals.

Recomputes the five Champion Profile tendencies inside every cached
BENCHMARK league-season (data/scouting/benchmark/ — MONEYLEAGUE-format
leagues that contain none of our owners; see
scripts/fetch_benchmark_leagues.py) and pools them so section X can
answer: do our championship patterns replicate in rooms we've never
played, or are they three-season folklore?

Grading mirrors build_champion_profile.py with the cross-league
adaptations spelled out in the fineprint: draft ownership is Sleeper's
own feed (no xlsx overlay exists for other people's leagues), keepers
are the explicit is_keeper flag OR the implicit period-ADP gap rule
(>=1.5 rounds, scaled by that league's team count), and player value is
our half-PPR VBD versus 12-team superflex replacement (a slight
distortion for 10-team rooms, flagged not corrected).

Only seasons with period files (data/backtest/proj_/stats_) can be
graded — pre-2023 corpus seasons are counted but skipped.

Output: data/research/benchmark_validation.json (consumed by
build_champion_profile.py — no standalone fragment).
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.stash_curve import _period_adp, _season_vbd  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
BENCH = ROOT / "data" / "scouting" / "benchmark"
OUT = ROOT / "data" / "research" / "benchmark_validation.json"
EARLY_QB_ROUND = 6
KEEPER_HIT_DISC = 5.0
KEEPER_HIT_VBD = 75.0


def grade_league(d: Path, season: int, pos_of) -> dict | None:
    """One benchmark league-season -> per-team rows + champ/runner ids."""
    try:
        lg = json.loads((d / "league.json").read_text())
        wb = json.loads((d / "winners_bracket.json").read_text())
        rosters = json.loads((d / "rosters.json").read_text())
        picks_files = sorted(d.glob("draft_*_picks.json"))
        picks = json.loads(picks_files[0].read_text()) if picks_files else []
    except (FileNotFoundError, IndexError, json.JSONDecodeError):
        return None
    final = next((m for m in wb if m.get("p") == 1 and m.get("w")), None)
    if not final or not picks:
        return None
    champ, runner = final["w"], final["l"]
    playoff_rids = {m[k] for m in wb for k in ("t1", "t2")
                    if isinstance(m.get(k), int)}
    teams = lg["settings"].get("num_teams") or len(rosters)
    po_start = lg["settings"].get("playoff_week_start", 15)

    adp, vbd = _period_adp(season), _season_vbd(season)
    drafted: dict[tuple[int, str], int] = {}
    qb_rounds: dict[int, list[int]] = defaultdict(list)
    keepers: dict[int, list[dict]] = defaultdict(list)
    for p in picks:
        rid, pid, r = p["roster_id"], p["player_id"], p["round"]
        drafted[(rid, pid)] = r
        if pos_of(pid) == "QB":
            qb_rounds[rid].append(r)
        a = adp.get(pid, 999.0)
        adp_round = max(1.0, a / teams) if a < 999 else None
        if bool(p.get("is_keeper")) or (adp_round is not None
                                        and r - adp_round >= 1.5):
            keepers[rid].append({
                "discount": (r - adp_round) if adp_round else 0.0,
                "vbd": vbd.get(pid, 0.0)})

    acq: dict[tuple[int, str], tuple[int, str]] = {}
    tx_dir = d / "transactions"
    if tx_dir.is_dir():
        for f in sorted(tx_dir.iterdir(),
                        key=lambda p: int(p.stem.split("_")[1])):
            wk = int(f.stem.split("_")[1])
            for t in json.loads(f.read_text()) or []:
                if t.get("status") != "complete":
                    continue
                for pid, rid in (t.get("adds") or {}).items():
                    acq[(rid, pid)] = (wk, "trade" if t["type"] == "trade"
                                       else "waiver")

    stat = defaultdict(lambda: defaultdict(float))
    wins: dict[int, float] = defaultdict(float)
    pf: dict[int, float] = defaultdict(float)
    weeks_seen = 0
    for wk in range(1, po_start):
        f = d / "matchups" / f"week_{wk}.json"
        if not f.exists():
            continue
        ms = json.loads(f.read_text()) or []
        if not ms:
            continue
        weeks_seen += 1
        by_m = defaultdict(list)
        for x in ms:
            if x.get("matchup_id") is not None:
                by_m[x["matchup_id"]].append(x)
        for pair in by_m.values():
            if len(pair) != 2:
                continue
            a, b = pair
            pa, pb = a["points"] or 0, b["points"] or 0
            pf[a["roster_id"]] += pa
            pf[b["roster_id"]] += pb
            if pa != pb:
                wins[(a if pa > pb else b)["roster_id"]] += 1
            else:
                wins[a["roster_id"]] += .5
                wins[b["roster_id"]] += .5
        for x in ms:
            rid = x["roster_id"]
            pp = x.get("players_points") or {}
            for pid in (x.get("starters") or []):
                if pid in ("0", None, ""):
                    continue
                pts = pp.get(pid, 0) or 0
                ev = acq.get((rid, pid))
                src = ev[1] if ev and ev[0] <= wk else "draft"
                stat[rid][src] += pts
                stat[rid]["total"] += pts
    if weeks_seen < 8:            # not a real season of data
        return None

    pf_rank = {rid: i + 1 for i, rid in
               enumerate(sorted(pf, key=lambda r: -pf[r]))}
    rows = []
    for r in rosters:
        rid = r["roster_id"]
        qbs = sorted(qb_rounds[rid])
        tot = stat[rid]["total"] or 1
        ks = keepers.get(rid, [])
        rows.append({
            "rid": rid,
            "status": ("CHAMP" if rid == champ else
                       "RUNNER" if rid == runner else
                       "playoff" if rid in playoff_rids else "field"),
            "early_2qb": len(qbs) >= 2 and qbs[1] <= EARLY_QB_ROUND,
            "keeper_vbd": round(sum(k["vbd"] for k in ks), 1),
            "keeper_hit": any(k["discount"] >= KEEPER_HIT_DISC
                              and k["vbd"] >= KEEPER_HIT_VBD for k in ks),
            "pct_trade": round(100 * stat[rid]["trade"] / tot, 1),
            "pct_waiver": round(100 * stat[rid]["waiver"] / tot, 1),
            "pf_rank": pf_rank.get(rid),
        })
    return {"teams": teams, "rows": rows}


def main() -> None:
    corpus_f = BENCH / "_corpus.json"
    if not corpus_f.exists():
        print("[benchmark_validation] no corpus — skipping (section X will "
              "omit the replication block)")
        return
    corpus = {k: v for k, v in json.loads(corpus_f.read_text()).items()
              if not k.startswith("_")}

    players = json.loads(
        (ROOT / "data/sleeper/players_nfl.json").read_text())
    pos_of = lambda pid: (players.get(pid) or {}).get("position") or "?"  # noqa: E731

    graded, skipped = [], []
    for lid, meta in corpus.items():
        season = int(meta["season"])
        if not (ROOT / "data" / "backtest" / f"proj_{season}.json").exists():
            skipped.append(f"{meta['name']} {season} (no period files)")
            continue
        g = grade_league(BENCH / f"{meta['season']}_{lid}", season, pos_of)
        if g is None:
            skipped.append(f"{meta['name']} {season} (incomplete cache)")
            continue
        g["name"], g["season"], g["league_id"] = meta["name"], season, lid
        graded.append(g)

    if not graded:
        print("[benchmark_validation] nothing gradable — skipping")
        return

    all_rows = [(g, r) for g in graded for r in g["rows"]]
    champs = [r for _, r in all_rows if r["status"] == "CHAMP"]
    finalists = [r for _, r in all_rows if r["status"] in ("CHAMP", "RUNNER")]
    field = [r for _, r in all_rows if r["status"] == "field"]
    made = [r for _, r in all_rows if r["status"] != "field"]

    def mean(rs, k):
        return round(sum(r[k] for r in rs) / len(rs), 1) if rs else None

    early = [r for _, r in all_rows if r["early_2qb"]]
    late = [r for _, r in all_rows if not r["early_2qb"]]

    def po_rate(rs):
        return (round(100 * sum(r["status"] != "field" for r in rs)
                      / len(rs)) if rs else None)

    res = {
        "meta": {
            "generated": date.today().isoformat(),
            "leagues_graded": len(graded),
            "league_seasons": [
                {"name": g["name"], "season": g["season"],
                 "teams": g["teams"], "league_id": g["league_id"]}
                for g in graded],
            "skipped": skipped,
            "method": "Sleeper-native draft ownership; keepers = is_keeper "
                      "flag or period-ADP gap >= 1.5 rounds (team-count "
                      "scaled); our 12-team superflex VBD baselines "
                      "throughout",
        },
        "signals": {
            "early_2qb": {
                "po_rate_early": po_rate(early), "n_early": len(early),
                "po_rate_late": po_rate(late), "n_late": len(late),
                "champs_early": sum(r["early_2qb"] for r in champs),
                "n_champs": len(champs),
                # negative in BOTH size classes — not a 10-team artifact
                "by_team_size": {
                    str(t): {
                        "po_rate_early": po_rate(
                            [r for g, r in all_rows
                             if g["teams"] == t and r["early_2qb"]]),
                        "po_rate_late": po_rate(
                            [r for g, r in all_rows
                             if g["teams"] == t and not r["early_2qb"]]),
                    } for t in sorted({g["teams"] for g, _ in all_rows})},
            },
            "keeper_vbd": {
                "champ_mean": mean(champs, "keeper_vbd"),
                "field_mean": mean(field, "keeper_vbd"),
                "champs_with_hit": sum(r["keeper_hit"] for r in champs),
                "n_champs": len(champs),
            },
            "waiver_share": {
                "champ_mean": mean(champs, "pct_waiver"),
                "field_mean": mean(field, "pct_waiver"),
            },
            "trade_share": {
                "finalist_mean": mean(finalists, "pct_trade"),
                "field_mean": mean(field, "pct_trade"),
            },
            "pf": {
                "champ_mean_rank": mean(champs, "pf_rank"),
                "champ_ranks": sorted(r["pf_rank"] for r in champs),
            },
        },
    }
    OUT.write_text(json.dumps(res, indent=2))
    s = res["signals"]
    print(f"[benchmark_validation] {len(graded)} league-seasons graded "
          f"({len(skipped)} skipped) — champ keeper VBD "
          f"{s['keeper_vbd']['champ_mean']} vs field "
          f"{s['keeper_vbd']['field_mean']}; early-2QB PO rate "
          f"{s['early_2qb']['po_rate_early']}% vs "
          f"{s['early_2qb']['po_rate_late']}%; champ PF rank "
          f"{s['pf']['champ_mean_rank']}")


if __name__ == "__main__":
    main()
