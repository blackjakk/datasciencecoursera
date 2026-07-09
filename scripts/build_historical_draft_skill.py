"""Historical draft-skill rankings for 2015-2024 (full Yahoo + Sleeper eras).

Sources:
  - data/historical/MONEY_LEAGUE.xlsx  (xlsx cell-color drafts)
  - data/nflverse/player_stats_season.csv  (nflverse season stats 1999-2024)

For each xlsx-attributed pick we look up the player's actual fantasy
points that season, compute VBD (points above replacement at their
position), and aggregate per manager per season.

Scoring eras (per xlsx "Half Point PPR" annotations):
  - 2015-2018: 0 PPR  → use nflverse fantasy_points directly
  - 2019+:     0.5 PPR → average fantasy_points + fantasy_points_ppr

QB-format history:
  - Always 2QB/SF from at least 2015 (per user). Both 2QB and superflex
    yield ~22 QB replacement rank, so a single set of replacement ranks
    works throughout.

League size:
  - 2015-2018: 10 teams, 19 rounds → 190 picks/season
  - 2019+:     12 teams, 17 rounds → 204 picks/season
  Replacement ranks are scaled down by 10/12 for the 10-team era.

Limitations:
  - No wire/trade/luck — only draft skill, since xlsx doesn't have
    matchup or transaction data and Yahoo OAuth is gated.
  - Kickers + DEF aren't in nflverse season stats — treated as neutral
    (no VBD contribution either way; consistent across managers).
  - Player names get normalized + fuzzy-matched; ~5% of picks fall
    through (mostly K + injured/retired players).
"""
from __future__ import annotations

import csv
import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.team_identity import manager_for_xlsx_nickname  # noqa: E402
from fantasy_draft.xlsx_drafts import load_xlsx_drafts  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
NFLVERSE_CSV = ROOT / "data" / "nflverse" / "player_stats_season.csv"
OUT_JSON = ROOT / "data" / "historical_draft_skill.json"

# Replacement ranks for a 12-team 2QB/superflex 0.5 PPR league (matches
# current pick_value.json). Used to compute VBD per pick.
#
# Format history: 2QB starters from at least 2015 through 2022, then
# switched to superflex in 2023 (Sleeper migration). Both formats yield
# essentially the same QB replacement rank (~22), so a single set of
# ranks is valid throughout. For the 10-team era we scale ranks by
# 10/12 (computed in _replacement_ranks_for_year below).
REPLACEMENT_RANKS_12T = {"QB": 22, "RB": 31, "WR": 42, "TE": 13, "K": 12, "DEF": 12}


def _replacement_ranks_for_year(year: int) -> dict[str, int]:
    """10-team era (2015-2018) had fewer roster spots, so the replacement
    rank drops proportionally (10/12). Round to nearest integer."""
    if year <= 2018:
        return {pos: max(1, round(r * 10 / 12))
                for pos, r in REPLACEMENT_RANKS_12T.items()}
    return REPLACEMENT_RANKS_12T


def _scoring_for_year(year: int) -> str:
    """Returns the scoring rule label. 0.5 PPR started 2019."""
    return "0.5ppr" if year >= 2019 else "0ppr"

# Player-name fixups for tokens that nflverse spells differently from
# the xlsx abbreviations. Most matching is handled by normalization
# (strip punctuation, lowercase, ignore suffixes).
NAME_ALIASES = {
    "todd girley": "todd gurley",
    "todd girle": "todd gurley",
    "leveon bell": "leveon bell",
    "le veon bell": "leveon bell",
    "big ben": "ben roethlisberger",
    "gronk": "rob gronkowski",
    "ty hilton": "t y hilton",
    "aj green": "a j green",
    "aj brown": "a j brown",
    "dj moore": "d j moore",
    "dj chark": "d j chark",
    "cj anderson": "c j anderson",
    "cee dee lamb": "ceedee lamb",
    "ceedee lamb": "ceedee lamb",
    "amon ra st brown": "amon-ra st. brown",
    "amon-ra st brown": "amon-ra st. brown",
    "dk metcalf": "d k metcalf",
    "christian mcaffery": "christian mccaffrey",
    "christian mccaffery": "christian mccaffrey",
    "hollywood brown": "marquise brown",
    "marquez valdes scantling": "marquez valdes-scantling",
    "ryquel armstead": "ryquell armstead",
    "kyle rudolf": "kyle rudolph",
    "ezekiel elliot": "ezekiel elliott",
    "micheal badgley": "michael badgley",
}


def _norm(name: str) -> str:
    n = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    n = n.lower().strip()
    # remove suffixes like jr/sr/iii
    n = re.sub(r"\b(jr|sr|ii|iii|iv|v)\.?$", "", n).strip()
    n = re.sub(r"[\.'`]", "", n)
    n = re.sub(r"[^a-z0-9 -]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    return NAME_ALIASES.get(n, n)


_NFL_CITIES = {
    "arizona", "atlanta", "baltimore", "buffalo", "carolina", "chicago",
    "cincinnati", "cleveland", "dallas", "denver", "detroit", "green bay",
    "houston", "indianapolis", "jacksonville", "kansas city", "las vegas",
    "oakland", "los angeles", "miami", "minnesota", "new england",
    "new orleans", "new york", "ny giants", "ny jets", "philadelphia",
    "pittsburgh", "san francisco", "seattle", "tampa bay", "tennessee",
    "washington",
}
_NFL_NICKNAMES = {
    "cardinals", "falcons", "ravens", "bills", "panthers", "bears",
    "bengals", "browns", "cowboys", "broncos", "lions", "packers",
    "texans", "colts", "jaguars", "chiefs", "raiders", "rams",
    "chargers", "dolphins", "vikings", "patriots", "saints", "giants",
    "jets", "eagles", "steelers", "49ers", "niners", "seahawks",
    "buccaneers", "bucs", "titans", "commanders", "redskins",
    "football team",
}


def _is_dst(name: str) -> bool:
    """xlsx team-defense entries take many forms: 'Bills D', 'SF D/ST (...)',
    'TENNESSEE', 'Eagles Defense'. Nflverse season stats don't have DST/K
    rows so these will never match — flag them so they're skipped silently."""
    n = re.sub(r"\(.*?\)", "", name).strip().lower()
    if (n.endswith(" d") or n.endswith(" dst") or n.endswith(" d/st")
            or n.endswith(" def") or "defense" in n):
        return True
    # Bare team name (e.g., 'TENNESSEE', 'Cowboys')
    if n in _NFL_CITIES or n in _NFL_NICKNAMES:
        return True
    return False


def _edit_distance(a: str, b: str) -> int:
    if a == b:
        return 0
    if abs(len(a) - len(b)) > 3:
        return 99
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(cur[-1] + 1, prev[j] + 1,
                           prev[j - 1] + (0 if ca == cb else 1)))
        prev = cur
    return prev[-1]


def _load_nflverse_points(seasons: list[int]) -> dict[tuple[int, str], dict]:
    """Return {(season, normalized_name): {pts, position, raw_name}}.

    Era-appropriate scoring: 2019+ uses 0.5 PPR (average of fantasy_points
    and fantasy_points_ppr), 2015-2018 uses 0 PPR (fantasy_points directly).
    """
    out: dict[tuple[int, str], dict] = {}
    s_set = set(seasons)
    with open(NFLVERSE_CSV, encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            if row["season_type"] != "REG":
                continue
            s = int(row["season"])
            if s not in s_set:
                continue
            name = row["player_display_name"] or row["player_name"]
            if not name:
                continue
            try:
                fp = float(row["fantasy_points"] or 0)
                fp_ppr = float(row["fantasy_points_ppr"] or 0)
            except ValueError:
                continue
            pts = (fp + fp_ppr) / 2.0 if s >= 2019 else fp
            key = (s, _norm(name))
            if key not in out or pts > out[key]["pts"]:
                out[key] = {"pts": pts, "position": row["position"], "raw_name": name}
    return out


def _match_player(season: int, xlsx_name: str,
                  nfl_data: dict[tuple[int, str], dict],
                  cache: dict) -> dict | None:
    ck = (season, xlsx_name)
    if ck in cache:
        return cache[ck]
    norm = _norm(xlsx_name)
    hit = nfl_data.get((season, norm))
    if hit:
        cache[ck] = hit
        return hit
    # Try last-name-only as a fallback (for very abbreviated entries)
    parts = norm.split()
    if len(parts) >= 2:
        last = parts[-1]
        candidates = [v for (s, n), v in nfl_data.items()
                      if s == season and n.split()[-1] == last]
        if len(candidates) == 1:
            cache[ck] = candidates[0]
            return candidates[0]
        # If exactly two candidates and one matches first-initial, prefer it
        if candidates:
            first_initial = parts[0][:1]
            for c in candidates:
                cn = _norm(c["raw_name"]).split()
                if cn and cn[0][:1] == first_initial:
                    cache[ck] = c
                    return c
    # Fuzzy edit-distance fallback for typos like "Mcaffery" → "Mccaffrey".
    # Only allow ≤ 2 edits and only if there's a unique close match within
    # the same season.
    close = []
    for (s, n), v in nfl_data.items():
        if s != season:
            continue
        d = _edit_distance(norm, n)
        if d <= 2:
            close.append((d, v))
    close.sort(key=lambda t: t[0])
    if close and (len(close) == 1 or close[0][0] < close[1][0]):
        cache[ck] = close[0][1]
        return close[0][1]
    cache[ck] = None
    return None


def _compute_vbd_for_season(picks_with_pts: list[dict], year: int) -> dict:
    """Mutate each pick dict to add 'vbd' = pts - replacement_at_position.
    Uses year-appropriate replacement ranks (10-team era vs 12-team)."""
    ranks_used = _replacement_ranks_for_year(year)
    by_pos: dict[str, list[float]] = defaultdict(list)
    for p in picks_with_pts:
        if p["position"] in ranks_used and p["pts"] is not None:
            by_pos[p["position"]].append(p["pts"])
    replacement: dict[str, float] = {}
    for pos, rank in ranks_used.items():
        pts_list = sorted(by_pos.get(pos, []), reverse=True)
        if not pts_list:
            replacement[pos] = 0.0
        elif rank <= len(pts_list):
            replacement[pos] = pts_list[rank - 1]
        else:
            replacement[pos] = pts_list[-1]
    for p in picks_with_pts:
        if p["pts"] is None or p["position"] not in ranks_used:
            p["vbd"] = None
        else:
            p["vbd"] = p["pts"] - replacement[p["position"]]
    return replacement


def main():
    xlsx = load_xlsx_drafts()
    # nflverse season stats currently end at 2024. 2025 is covered by the
    # main awards report which uses live Sleeper data; we keep this script
    # focused on the years not already in the main report (2019-2022) plus
    # 2023-2024 for cross-validation against the live-Sleeper numbers.
    # nflverse season stats currently end at 2024. 2025 is covered by the
    # main awards report which uses live Sleeper data.
    historical_years = sorted(y for y in xlsx if 2015 <= y <= 2024)
    if not historical_years:
        sys.exit("No xlsx years 2015-2024 found.")
    print(f"Years available: {historical_years}", file=sys.stderr)

    nfl = _load_nflverse_points(historical_years)
    print(f"Loaded {len(nfl)} nflverse season stats rows", file=sys.stderr)

    cache: dict = {}
    unmatched: list[tuple[int, str]] = []
    per_season: dict[int, list[dict]] = {}
    replacements_by_season: dict[int, dict] = {}

    for year in historical_years:
        picks = []
        for xp in xlsx[year]:
            m = manager_for_xlsx_nickname(xp.manager_nickname)
            mgr_id = m["id"] if m else f"unknown_{xp.manager_nickname}"
            mgr_name = m["canonical_name"].split(" (")[0] if m else xp.manager_nickname
            if _is_dst(xp.player_name):
                # K/DEF aren't in nflverse season stats — track as DEF with
                # 0 contribution rather than spamming the unmatched list.
                hit = None
                pts = None
                pos = "DEF"
            else:
                hit = _match_player(year, xp.player_name, nfl, cache)
                if not hit:
                    unmatched.append((year, xp.player_name))
                    pts = None
                    pos = None
                else:
                    pts = hit["pts"]
                    pos = hit["position"]
            picks.append({
                "year": year,
                "round": xp.round,
                "slot": xp.slot,
                "player": xp.player_name,
                "matched_name": hit["raw_name"] if hit else None,
                "position": pos,
                "pts": pts,
                "manager_id": mgr_id,
                "manager_name": mgr_name,
            })
        repl = _compute_vbd_for_season(picks, year)
        replacements_by_season[year] = repl
        per_season[year] = picks

    # Per-season VBD totals by manager
    per_season_mgr: dict[int, dict[str, dict]] = {}
    for year in historical_years:
        mgr_totals: dict[str, dict] = defaultdict(
            lambda: {"manager_name": "?", "total_vbd": 0.0,
                     "n_picks": 0, "n_matched": 0})
        for p in per_season[year]:
            mid = p["manager_id"]
            mgr_totals[mid]["manager_name"] = p["manager_name"]
            mgr_totals[mid]["n_picks"] += 1
            if p["vbd"] is not None:
                mgr_totals[mid]["total_vbd"] += p["vbd"]
                mgr_totals[mid]["n_matched"] += 1
        per_season_mgr[year] = dict(mgr_totals)

    # Era splits:
    #  - Standard scoring (2015-2018): 10-team, 0 PPR, 2QB
    #  - Half PPR (2019-2022): 12-team, 0.5 PPR, 2QB
    #  - Sleeper SF (2023-2024): 12-team, 0.5 PPR, superflex
    standard_years = [y for y in historical_years if y <= 2018]
    halfppr_years = [y for y in historical_years if 2019 <= y <= 2022]
    sf_years = [y for y in historical_years if y >= 2023]

    def _era_block(years: list[int], label: str):
        if not years:
            return
        block: dict[str, dict] = defaultdict(
            lambda: {"manager_name": "?", "total_vbd": 0.0,
                     "n_picks": 0, "n_matched": 0, "seasons": 0})
        for y in years:
            for mid, rec in per_season_mgr[y].items():
                block[mid]["manager_name"] = rec["manager_name"]
                block[mid]["total_vbd"] += rec["total_vbd"]
                block[mid]["n_picks"] += rec["n_picks"]
                block[mid]["n_matched"] += rec["n_matched"]
                block[mid]["seasons"] += 1
        for rec in block.values():
            rec["vbd_per_season"] = (rec["total_vbd"] / rec["seasons"]
                                     if rec["seasons"] else 0.0)
        ranked = sorted(block.items(), key=lambda kv: -kv[1]["vbd_per_season"])
        print(f"=== {label} ({years[0]}-{years[-1]}) draft skill ===")
        for i, (mid, rec) in enumerate(ranked, 1):
            print(f"  {i:>2}. {rec['manager_name']:<12} "
                  f"per-season {rec['vbd_per_season']:>+7.1f}  "
                  f"(total {rec['total_vbd']:>+8.1f}, "
                  f"{rec['seasons']}yr, {rec['n_matched']}/{rec['n_picks']})")
        print()
        return block

    print()
    _era_block(standard_years, "STANDARD-SCORING ERA (10-team, 0 PPR)")
    _era_block(halfppr_years, "HALF-PPR YAHOO ERA (12-team, 2QB)")
    _era_block(sf_years, "SUPERFLEX SLEEPER ERA (12-team)")

    # Cumulative across all historical years
    cumulative: dict[str, dict] = defaultdict(
        lambda: {"manager_name": "?", "total_vbd": 0.0,
                 "n_picks": 0, "n_matched": 0, "seasons": 0})
    for year, mgrs in per_season_mgr.items():
        for mid, rec in mgrs.items():
            cumulative[mid]["manager_name"] = rec["manager_name"]
            cumulative[mid]["total_vbd"] += rec["total_vbd"]
            cumulative[mid]["n_picks"] += rec["n_picks"]
            cumulative[mid]["n_matched"] += rec["n_matched"]
            cumulative[mid]["seasons"] += 1
    for rec in cumulative.values():
        rec["vbd_per_season"] = (rec["total_vbd"] / rec["seasons"]
                                 if rec["seasons"] else 0.0)

    # Print a compact per-manager per-year matrix
    all_mgrs = sorted(
        {mid for y in historical_years for mid in per_season_mgr[y]},
        key=lambda mid: -sum(per_season_mgr[y].get(mid, {}).get("total_vbd", 0)
                              for y in historical_years))
    print()
    print(f"=== Per-season VBD by manager ===")
    header = f"{'Manager':<12} " + "  ".join(f"{y:>6}" for y in historical_years) + "    Avg"
    print(header)
    for mid in all_mgrs:
        name = next((per_season_mgr[y][mid]["manager_name"]
                     for y in historical_years if mid in per_season_mgr[y]), mid)
        cells = []
        vals = []
        for y in historical_years:
            v = per_season_mgr[y].get(mid, {}).get("total_vbd")
            if v is None:
                cells.append(f"{'—':>6}")
            else:
                cells.append(f"{v:>+6.0f}")
                vals.append(v)
        avg = sum(vals) / len(vals) if vals else 0
        print(f"{name:<12} " + "  ".join(cells) + f"  {avg:>+6.0f}")
    print()

    # Cumulative
    print(f"=== {historical_years[0]}-{historical_years[-1]} CUMULATIVE draft skill ===")
    ranked_cum = sorted(cumulative.items(),
                        key=lambda kv: -kv[1]["vbd_per_season"])
    for i, (mid, rec) in enumerate(ranked_cum, 1):
        print(f"  {i:>2}. {rec['manager_name']:<12} "
              f"total VBD {rec['total_vbd']:>+8.1f}  "
              f"per-season {rec['vbd_per_season']:>+7.1f}  "
              f"({rec['n_matched']}/{rec['n_picks']} matched, "
              f"{rec['seasons']} seasons)")

    # Unmatched warnings — mostly kickers (nflverse season stats are
    # offense-only) and players who were drafted but missed the year
    # entirely (injuries, suspensions). These get pts=None which is the
    # correct neutral treatment.
    if unmatched:
        total_picks = sum(len(per_season[y]) for y in historical_years)
        print(f"\n[info] {len(unmatched)}/{total_picks} picks not in nflverse "
              f"(kickers + missed-season players — neutral, no VBD impact)",
              file=sys.stderr)

    payload = {
        "years": historical_years,
        "scoring": "0.5 PPR (avg of nflverse fp + fp_ppr)",
        "replacement_ranks_12team": REPLACEMENT_RANKS_12T,
        "replacement_ranks_10team": _replacement_ranks_for_year(2015),
        "per_season": {str(y): per_season_mgr[y] for y in historical_years},
        "cumulative": cumulative,
        "replacements_by_season": {str(y): replacements_by_season[y]
                                    for y in historical_years},
        "unmatched_count": len(unmatched),
    }
    OUT_JSON.write_text(json.dumps(payload, indent=2, default=str))
    print(f"\nWrote {OUT_JSON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
