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
    print(f"Wrote {out1}, {out2}, {out3}, {out4}")
    if not KNOWN_CHAMPIONS:
        print("\n[note] Only Sleeper-era champions (2023-2025) shown.")
        print("       Add Yahoo-era champions to KNOWN_CHAMPIONS dict in this script.")


if __name__ == "__main__":
    main()
