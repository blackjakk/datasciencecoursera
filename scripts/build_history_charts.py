"""Generate charts for the 15-year recap — championship counts, all-time
wins, win% over time per manager.

Saves PNGs into data/charts/ and re-runs the anniversary recap to embed
them into the PDF.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.league_history import load_all_history  # noqa: E402
from fantasy_draft.team_identity import all_managers, manager_for_sleeper_roster  # noqa: E402

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CHART_DIR = ROOT / "data" / "charts"
CHART_DIR.mkdir(parents=True, exist_ok=True)

# Champion overrides — Yahoo-era champions that the scraper may not have
# detected. Append as we learn them.
KNOWN_CHAMPIONS: dict[int, str] = {
    # Sleeper-era picked up automatically from sleeper data;
    # Yahoo entries are added here as confirmed from Yahoo trophy room.
    2011: "nark",          # Danny O'Shea's 139.70 d. Trevor (Reno Mahe 911) 118.74
    2012: "kyle_figgy",    # Figgy 128.02 d. Eric (LockOut w my CockOut) 111.66
    2013: "coop",          # Dirty Old Men 124.58 d. Kyle (Figgy) 120.02
    2014: "trevor_bergerboy",  # BergerBoy Brigade 165.84 d. Lem 132.76
    2015: "donnie",            # Big Don's Cuties 171.78 d. Troy (Tyrodasaurus Rex) 89.80
    2016: "kyle_figgy",        # Trust the Process 189.06 d. Eric (Deez Hos) 150.46
    2017: "coop",              # The Dream Team 139.92 d. Dave (Fuck the Process) 106.84
    2018: "dave_aka_wang",     # Land of the Freemans 139.46 d. Lem 101.30
    2019: "troy_mullings",     # Terror Squad 135.28 d. Dave 121.66 — Troy's 1st ring
    2020: "trevor_bergerboy",  # BergerBoy 170.76 d. Brower 161.52 — Trevor's 2nd ring
    2021: "dave_aka_wang",     # Walking Off Like Antonio 132.76 d. Troy 123.58 — Dave's 2nd
    2022: "ankur_patel",       # Hail Koo 158.36 d. Coop 132.00 — Ankur's 1st (rookie-year)
}


def _mgr_name(mgr_id: str) -> str:
    for m in all_managers():
        if m["id"] == mgr_id:
            return m["canonical_name"].split(" (")[0]
    return mgr_id


def _significant_managers(history: dict) -> set[str]:
    """Include managers with 5+ seasons of play, OR currently active."""
    seasons_by_mgr: dict[str, set] = {}
    for yr, sd in history.items():
        for mid in sd["rosters"]:
            seasons_by_mgr.setdefault(mid, set()).add(yr)
    return ({m["id"] for m in all_managers() if m.get("sleeper_roster_id")}
            | {mid for mid, yrs in seasons_by_mgr.items() if len(yrs) >= 5})


def championship_chart(champ_by_year: dict[int, str]):
    counts: dict[str, int] = defaultdict(int)
    for mid in champ_by_year.values():
        counts[mid] += 1
    if not counts:
        return None
    rows = sorted(counts.items(), key=lambda kv: -kv[1])
    names = [_mgr_name(m) for m, _ in rows]
    vals = [c for _, c in rows]
    fig, ax = plt.subplots(figsize=(8, 4.5))
    bars = ax.barh(names, vals, color="#b8860b")
    ax.set_xlabel("Championships")
    ax.set_title("Championships Won (2011-2025)")
    for bar, v in zip(bars, vals):
        ax.text(v + 0.05, bar.get_y() + bar.get_height()/2, str(v),
                va="center", fontsize=10, fontweight="bold")
    ax.invert_yaxis()
    ax.set_xlim(0, max(vals) + 1)
    plt.tight_layout()
    out = CHART_DIR / "championships.png"
    plt.savefig(out, dpi=150); plt.close()
    return out


def all_time_wins_chart(history: dict):
    totals: dict[str, dict] = defaultdict(lambda: {"w": 0, "l": 0, "yrs": set()})
    for yr, sd in history.items():
        for mid, r in sd["rosters"].items():
            totals[mid]["w"] += r["wins"]
            totals[mid]["l"] += r["losses"]
            totals[mid]["yrs"].add(yr)
    current = _significant_managers(history)
    rows = sorted(((m, d) for m, d in totals.items() if m in current),
                  key=lambda kv: -kv[1]["w"])
    names = [_mgr_name(m) for m, _ in rows]
    wins = [d["w"] for _, d in rows]
    losses = [d["l"] for _, d in rows]
    fig, ax = plt.subplots(figsize=(10, 5))
    y = range(len(names))
    ax.barh(y, wins, color="#2c5d7c", label="Wins")
    ax.barh(y, losses, left=wins, color="#aaa", label="Losses")
    ax.set_yticks(list(y), names)
    ax.invert_yaxis()
    ax.set_xlabel("Regular-season games")
    ax.set_title("All-Time W/L (2011-2025 regular season)")
    for i, (w, l) in enumerate(zip(wins, losses)):
        pct = 100 * w / max(1, w + l)
        ax.text(w + l + 2, i, f"{w}-{l}  ({pct:.0f}%)", va="center", fontsize=8)
    ax.legend(loc="lower right")
    plt.tight_layout()
    out = CHART_DIR / "all_time_wl.png"
    plt.savefig(out, dpi=150); plt.close()
    return out


def winpct_over_time_chart(history: dict):
    """Line chart: yearly win% per current manager."""
    current = _significant_managers(history)
    series: dict[str, list[tuple[int, float]]] = defaultdict(list)
    for yr in sorted(history):
        for mid, r in history[yr]["rosters"].items():
            if mid not in current:
                continue
            gp = r["wins"] + r["losses"]
            if gp:
                series[mid].append((yr, 100 * r["wins"] / gp))
    fig, ax = plt.subplots(figsize=(11, 6))
    cmap = plt.get_cmap("tab20")
    for i, (mid, pts) in enumerate(sorted(series.items(),
                                          key=lambda kv: -sum(p[1] for p in kv[1]))):
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        ax.plot(xs, ys, marker="o", label=_mgr_name(mid),
                color=cmap(i % 20), linewidth=1.8, markersize=4)
    ax.set_ylabel("Regular-season Win %")
    ax.set_xlabel("Season")
    ax.set_title("Win Percentage by Year")
    ax.set_xticks(range(2011, 2026))
    ax.set_ylim(0, 100)
    ax.grid(True, alpha=0.3)
    ax.axhline(50, color="black", linestyle="--", alpha=0.4)
    ax.legend(loc="center left", bbox_to_anchor=(1.01, 0.5), fontsize=9)
    plt.tight_layout()
    out = CHART_DIR / "winpct_timeline.png"
    plt.savefig(out, dpi=150); plt.close()
    return out


def ppg_over_time_chart(history: dict):
    current = _significant_managers(history)
    series: dict[str, list[tuple[int, float]]] = defaultdict(list)
    for yr in sorted(history):
        for mid, r in history[yr]["rosters"].items():
            if mid not in current:
                continue
            if r["games"]:
                series[mid].append((yr, r["pf"] / r["games"]))
    fig, ax = plt.subplots(figsize=(11, 6))
    cmap = plt.get_cmap("tab20")
    for i, (mid, pts) in enumerate(sorted(series.items(),
                                          key=lambda kv: -sum(p[1] for p in kv[1]))):
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        ax.plot(xs, ys, marker="o", label=_mgr_name(mid),
                color=cmap(i % 20), linewidth=1.8, markersize=4)
    ax.set_ylabel("Points per game")
    ax.set_xlabel("Season")
    ax.set_title("Points Per Game by Year")
    ax.set_xticks(range(2011, 2026))
    ax.grid(True, alpha=0.3)
    ax.legend(loc="center left", bbox_to_anchor=(1.01, 0.5), fontsize=9)
    plt.tight_layout()
    out = CHART_DIR / "ppg_timeline.png"
    plt.savefig(out, dpi=150); plt.close()
    return out


REPL_RANKS = {"QB": 22, "RB": 31, "WR": 42, "TE": 13, "K": 12, "DEF": 12}


def top_players_per_manager_chart(history: dict, mode: str = "vbd"):
    """Top 3 players per team. mode='raw' for raw points, 'vbd' for impact
    (points above positional replacement)."""
    import csv as _csv, re as _re, unicodedata as _u
    from fantasy_draft.xlsx_drafts import load_xlsx_drafts
    from fantasy_draft.results import (
        load_player_ownership_windows, load_weekly_player_points,
    )
    from fantasy_draft.team_identity import (
        manager_for_xlsx_nickname, manager_for_sleeper_roster,
    )

    def norm(s):
        s = _u.normalize("NFKD", s).encode("ascii","ignore").decode().lower().strip()
        s = _re.sub(r"[^a-z0-9 ]", " ", s); s = _re.sub(r"\s+", " ", s).strip()
        return s

    nfl: dict = {}  # (season, norm_name) -> (pts, position, raw_name)
    nfl_csv = ROOT / "data" / "nflverse" / "player_stats_season.csv"
    with open(nfl_csv) as f:
        for row in _csv.DictReader(f):
            if row["season_type"] != "REG":
                continue
            try:
                s = int(row["season"])
                fp = float(row["fantasy_points"] or 0)
                fp_ppr = float(row["fantasy_points_ppr"] or 0)
            except Exception:
                continue
            pts = (fp + fp_ppr)/2 if s >= 2019 else fp
            name = row["player_display_name"] or row["player_name"]
            pos = row.get("position", "")
            if not name:
                continue
            key = (s, norm(name))
            prev = nfl.get(key)
            if not prev or pts > prev[0]:
                nfl[key] = (pts, pos, name)

    # Compute replacement per (season, position)
    by_season_pos: dict = defaultdict(lambda: defaultdict(list))
    for (s, _n), (pts, pos, _raw) in nfl.items():
        if pos in REPL_RANKS:
            by_season_pos[s][pos].append(pts)
    repl: dict = {}
    for s, by_pos in by_season_pos.items():
        for pos, pts_list in by_pos.items():
            pts_list.sort(reverse=True)
            rank = REPL_RANKS[pos]
            repl[(s, pos)] = (pts_list[rank-1] if rank <= len(pts_list)
                              else (pts_list[-1] if pts_list else 0))

    def impact(season, pos, pts):
        if mode == "raw":
            return pts
        r = repl.get((season, pos), 0)
        return max(0, pts - r)  # only positive VBD counts as "impact"

    per_mgr: dict = defaultdict(lambda: defaultdict(float))

    xlsx = load_xlsx_drafts()
    for yr, picks in xlsx.items():
        if yr > 2022:
            continue
        for p in picks:
            mgr = manager_for_xlsx_nickname(p.manager_nickname)
            if not mgr:
                continue
            hit = nfl.get((yr, norm(p.player_name)))
            if not hit:
                continue
            pts, pos, raw = hit
            per_mgr[mgr["id"]][raw] += impact(yr, pos, pts)

    ownership = load_player_ownership_windows(ROOT / "data" / "sleeper")
    weekly = load_weekly_player_points(ROOT / "data" / "sleeper")
    players_meta = json.loads(
        (ROOT / "data" / "sleeper" / "players_nfl.json").read_text())

    def mgr_for_rid(rid, season):
        if season in (2023, 2024) and rid == 10:
            for m in all_managers():
                if m["id"] == "dave_aka_wang":
                    return m
        return manager_for_sleeper_roster(rid)

    # Compute Sleeper-era player-season totals + positions for replacement calc
    sleeper_season_totals: dict = defaultdict(lambda: defaultdict(float))
    for yr in (2023, 2024, 2025):
        for wk, week_data in weekly.get(yr, {}).items():
            for pid, pts in week_data.items():
                sleeper_season_totals[yr][pid] += pts
    # Replacement levels per Sleeper season
    s_repl: dict = {}
    for yr, pid_pts in sleeper_season_totals.items():
        by_pos = defaultdict(list)
        for pid, pts in pid_pts.items():
            pos = players_meta.get(pid, {}).get("position", "")
            if pos in REPL_RANKS:
                by_pos[pos].append(pts)
        for pos, lst in by_pos.items():
            lst.sort(reverse=True)
            rank = REPL_RANKS[pos]
            s_repl[(yr, pos)] = (lst[rank-1] if rank <= len(lst)
                                 else (lst[-1] if lst else 0))

    for (yr, pid), windows in ownership.items():
        pinfo = players_meta.get(pid, {})
        raw = (f"{pinfo.get('first_name','?')} "
               f"{pinfo.get('last_name','?')}").strip()
        pos = pinfo.get("position", "")
        season_total = sleeper_season_totals.get(yr, {}).get(pid, 0)
        season_repl = s_repl.get((yr, pos), 0)
        season_vbd = max(0, season_total - season_repl)
        for sw, ew, rid, src in windows:
            m = mgr_for_rid(rid, yr)
            if not m:
                continue
            pts_held = sum(weekly.get(yr, {}).get(wk, {}).get(pid, 0.0)
                            for wk in range(sw, min(ew + 1, 18)))
            if mode == "raw":
                per_mgr[m["id"]][raw] += pts_held
            else:
                # VBD attribution: share of season VBD proportional to pts held
                share = (pts_held / season_total) if season_total else 0
                per_mgr[m["id"]][raw] += season_vbd * share

    # Build chart: 12 panels, 1 per current mgr, top 3 horizontal bars each
    current = [m for m in all_managers() if m.get("sleeper_roster_id")]
    current.sort(key=lambda x: x["canonical_name"])

    fig, axes = plt.subplots(4, 3, figsize=(14, 14))
    axes = axes.flatten()
    for i, m in enumerate(current):
        ax = axes[i]
        name = m["canonical_name"].split(" (")[0]
        top = sorted(per_mgr.get(m["id"], {}).items(),
                     key=lambda kv: -kv[1])[:3]
        if not top:
            ax.axis("off"); continue
        players = [p for p, _ in top]
        vals = [v for _, v in top]
        bars = ax.barh(players, vals, color="#2c5d7c")
        ax.invert_yaxis()
        ax.set_title(name, fontsize=12, fontweight="bold")
        ax.set_xlim(0, max(vals) * 1.18)
        for bar, v in zip(bars, vals):
            ax.text(v + max(vals)*0.02, bar.get_y() + bar.get_height()/2,
                    f"{v:.0f}", va="center", fontsize=9)
        ax.tick_params(axis="y", labelsize=10)
        ax.tick_params(axis="x", labelsize=8)
    title = ("Top 3 Players by Lifetime VBD-Impact Per Team (2011-2025)"
             if mode == "vbd"
             else "Top 3 Players by Raw Lifetime Points Per Team (2011-2025)")
    plt.suptitle(title, fontsize=14, fontweight="bold", y=0.995)
    plt.tight_layout()
    out = CHART_DIR / (f"top_players_per_mgr_{mode}.png")
    plt.savefig(out, dpi=130); plt.close()
    return out


def main():
    history = load_all_history()

    # Build champion map: known Sleeper champs + KNOWN_CHAMPIONS overrides
    champs: dict[int, str] = {}
    for yr, sd in history.items():
        if sd.get("champion"):
            m = manager_for_sleeper_roster(sd["champion"])
            if m:
                champs[yr] = m["id"]
    champs.update(KNOWN_CHAMPIONS)

    out1 = championship_chart(champs)
    out2 = all_time_wins_chart(history)
    out3 = winpct_over_time_chart(history)
    out4 = ppg_over_time_chart(history)
    out5 = top_players_per_manager_chart(history, mode="vbd")
    out6 = top_players_per_manager_chart(history, mode="raw")
    print(f"Wrote {out1}, {out2}, {out3}, {out4}, {out5}, {out6}")
    if not KNOWN_CHAMPIONS:
        print("\n[note] Only Sleeper-era champions (2023-2025) shown.")
        print("       Add Yahoo-era champions to KNOWN_CHAMPIONS dict in this script.")


if __name__ == "__main__":
    main()
