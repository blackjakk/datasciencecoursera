"""Trade-history charts for the 15-year recap.

Produces:
  data/charts/trade_volume.png       — trades made per manager, all-time
  data/charts/trade_network.png      — heatmap of trade partners
  data/charts/trade_assets_flow.png  — players vs picks moved per mgr
"""
from __future__ import annotations

import glob
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.results import load_all_trades  # noqa: E402
from fantasy_draft.team_identity import all_managers, manager_for_sleeper_roster  # noqa: E402

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CHART_DIR = ROOT / "data" / "charts"
CHART_DIR.mkdir(parents=True, exist_ok=True)


def _mgr_name(mid):
    for m in all_managers():
        if m["id"] == mid:
            return m["canonical_name"].split(" (")[0]
    return mid


def _yahoo_lookup():
    """Build (year, lowered_team_name) -> mgr_id."""
    out = {}
    for m in all_managers():
        for yr, nm in (m.get("yahoo_team_names") or {}).items():
            if yr == "_note" or not nm:
                continue
            out[(int(yr), str(nm).rstrip("?").strip().lower())] = m["id"]
    return out


def _load_all_trades_with_mgrs():
    """Yields (year, [mgr_id per side], players_per_side, picks_per_side)."""
    yahoo = _yahoo_lookup()
    out = []

    for f in sorted((ROOT / "data" / "yahoo").glob("league_*/trades_*.json")):
        yr = int(re.search(r"trades_(\d+)\.json", str(f)).group(1))
        for t in json.loads(f.read_text()):
            sides = t["sides"]
            mids = [yahoo.get((yr, s["received_team"].rstrip("?").strip().lower()))
                    for s in sides]
            players = [len(s.get("received_players", [])) for s in sides]
            picks = [len(s.get("received_picks", [])) for s in sides]
            out.append({
                "year": yr, "date": t["date_str"],
                "mgr_ids": mids, "players": players, "picks": picks,
                "raw": t,
            })

    for t in load_all_trades(ROOT / "data" / "sleeper"):
        if t.get("type") != "trade":
            continue
        yr = t.get("_season", 0)
        rids = t.get("roster_ids") or []
        mids = []
        for rid in rids:
            if yr in (2023, 2024) and rid == 10:
                mids.append("dave_aka_wang")
            else:
                m = manager_for_sleeper_roster(rid)
                mids.append(m["id"] if m else None)
        adds = t.get("adds") or {}
        picks = t.get("draft_picks") or []
        players_per = [sum(1 for r in adds.values() if r == rid) for rid in rids]
        picks_per = [sum(1 for p in picks if p.get("owner_id") == rid) for rid in rids]
        out.append({
            "year": yr, "date": "sleeper",
            "mgr_ids": mids, "players": players_per, "picks": picks_per,
            "raw": t,
        })
    return out


def trade_volume_chart(trades):
    counts = defaultdict(float)
    for t in trades:
        n = sum(1 for mid in t["mgr_ids"] if mid)
        if n == 0:
            continue
        for mid in t["mgr_ids"]:
            if mid:
                counts[mid] += 1.0 / n * 2  # each side counts toward "trades made"
    current = {m["id"] for m in all_managers() if m.get("sleeper_roster_id")}
    rows = sorted(((mid, c) for mid, c in counts.items() if mid in current
                    or counts[mid] >= 5),
                  key=lambda kv: -kv[1])
    names = [_mgr_name(m) for m, _ in rows]
    vals = [c for _, c in rows]
    fig, ax = plt.subplots(figsize=(10, 6))
    bars = ax.barh(names, vals, color="#0a4d6b")
    ax.invert_yaxis()
    ax.set_xlabel("Trades made (per side)")
    ax.set_title("All-Time Trade Volume (2011-2025)")
    for bar, v in zip(bars, vals):
        ax.text(v + 0.3, bar.get_y() + bar.get_height()/2, f"{v:.0f}",
                va="center", fontsize=10)
    plt.tight_layout()
    out = CHART_DIR / "trade_volume.png"
    plt.savefig(out, dpi=150); plt.close()
    return out


def trade_network_chart(trades):
    """Heatmap: rows/cols = managers, cell = # trades between them."""
    current = [m["id"] for m in all_managers() if m.get("sleeper_roster_id")]
    current_set = set(current)
    pairs = defaultdict(int)
    for t in trades:
        mids = [m for m in t["mgr_ids"] if m in current_set]
        # Each pair of distinct mgrs in this trade = 1 trade between them
        seen = set()
        for i, a in enumerate(mids):
            for b in mids[i+1:]:
                key = tuple(sorted((a, b)))
                if key in seen: continue
                seen.add(key)
                pairs[key] += 1
    # Order managers by total trade activity
    activity = defaultdict(int)
    for (a, b), n in pairs.items():
        activity[a] += n; activity[b] += n
    order = sorted(current, key=lambda m: -activity[m])
    names = [_mgr_name(m) for m in order]
    idx = {m: i for i, m in enumerate(order)}
    n = len(order)
    mat = np.zeros((n, n), dtype=int)
    for (a, b), v in pairs.items():
        ia, ib = idx[a], idx[b]
        mat[ia, ib] = v; mat[ib, ia] = v
    fig, ax = plt.subplots(figsize=(10, 9))
    im = ax.imshow(mat, cmap="Blues")
    ax.set_xticks(range(n), names, rotation=45, ha="right")
    ax.set_yticks(range(n), names)
    for i in range(n):
        for j in range(n):
            if mat[i, j]:
                ax.text(j, i, str(mat[i, j]), ha="center", va="center",
                        color="white" if mat[i, j] > 4 else "black",
                        fontsize=9)
    ax.set_title("Trade Partnership Heatmap (2011-2025)\nNumbers = trades between pair")
    plt.colorbar(im, ax=ax, label="Trades")
    plt.tight_layout()
    out = CHART_DIR / "trade_network.png"
    plt.savefig(out, dpi=150); plt.close()
    return out


def trade_assets_flow_chart(trades):
    """Stacked bars: total players + picks given/received per mgr."""
    stats = defaultdict(lambda: {"p_rec": 0, "p_giv": 0, "pk_rec": 0, "pk_giv": 0})
    for t in trades:
        for i, mid in enumerate(t["mgr_ids"]):
            if not mid: continue
            stats[mid]["p_rec"] += t["players"][i]
            stats[mid]["pk_rec"] += t["picks"][i]
            for j in range(len(t["mgr_ids"])):
                if j == i: continue
                stats[mid]["p_giv"] += t["players"][j]
                stats[mid]["pk_giv"] += t["picks"][j]
    current = [m["id"] for m in all_managers() if m.get("sleeper_roster_id")]
    rows = sorted([(mid, stats[mid]) for mid in current if stats[mid]["p_rec"]],
                  key=lambda kv: -(kv[1]["p_rec"] + kv[1]["pk_rec"]))
    names = [_mgr_name(m) for m, _ in rows]
    p_rec = [s["p_rec"] for _, s in rows]
    pk_rec = [s["pk_rec"] for _, s in rows]
    fig, ax = plt.subplots(figsize=(11, 5.5))
    y = np.arange(len(names))
    ax.barh(y, p_rec, color="#2c5d7c", label="Players acquired")
    ax.barh(y, pk_rec, left=p_rec, color="#b8860b", label="Picks acquired")
    ax.set_yticks(y, names)
    ax.invert_yaxis()
    ax.set_xlabel("Assets acquired via trade")
    ax.set_title("Trade Assets Acquired (2011-2025)")
    for i, (p, pk) in enumerate(zip(p_rec, pk_rec)):
        total = p + pk
        ax.text(total + 1, i, f"{total} ({p}p + {pk}pk)", va="center", fontsize=9)
    ax.legend(loc="lower right")
    plt.tight_layout()
    out = CHART_DIR / "trade_assets_flow.png"
    plt.savefig(out, dpi=150); plt.close()
    return out


def main():
    trades = _load_all_trades_with_mgrs()
    print(f"Loaded {len(trades)} trades across 15 years")
    o1 = trade_volume_chart(trades)
    o2 = trade_network_chart(trades)
    o3 = trade_assets_flow_chart(trades)
    print(f"Wrote {o1}, {o2}, {o3}")


if __name__ == "__main__":
    main()
