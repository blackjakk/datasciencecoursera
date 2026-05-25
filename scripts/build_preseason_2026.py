"""MONEYLEAGUE Summer 2026 Preseason GUAP Rankings.

Built post-2025 / pre-2026 draft. Power score = weighted blend of:
  - Recent form (Sleeper-era OVR composite)         35%
  - 2025 regular-season W-L                         25%
  - 2025 PPG                                        15%
  - 2026 early-round draft capital (R1-R3 picks)    15%
  - Momentum (2024 -> 2025 win pct change)          10%
"""
from __future__ import annotations

import base64
import json
import os
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.results import load_all_seasons  # noqa: E402
from fantasy_draft.team_identity import (  # noqa: E402
    all_managers, manager_for_sleeper_roster,
)
from scripts import build_power_rankings as bpr  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PDF_OUT = ROOT / "data" / "MONEYLEAGUE_2026_PRESEASON.pdf"
CHART_DIR = ROOT / "data" / "charts" / "preseason"
CHART_DIR.mkdir(parents=True, exist_ok=True)
CHROMIUM_EXEC = bpr.CHROMIUM_EXEC

ROSTER_HANDOFFS = {(2025, 10): "josh_wildboy"}

# Brian's hot take per manager (in his voice — the GUAP take)
GUAP_TAKES = {
    "trevor_bergerboy": ("Defending Champ, Depleted Cupboard",
        "Won 2025 but mortgaged his future doing it. 0 R1s and 0 R2s for "
        "2026 — Kyle gutted him in the W6 deadline trade. Still the most "
        "consistent floor in the league, but the ceiling just got capped."),
    "coop": ("Quiet Contender",
        "Won 2024, slept through 2025 (.476). Now sitting on 1 R1, 2 R2s — "
        "enough capital to retool. History says he wakes up in odd years. "
        "Sneaky preseason pick."),
    "kyle_figgy": ("The Pick Hoarder",
        "Three R1s. THREE. Bought Trevor's championship and shipped him "
        "every garbage pick he owned. If his ceiling years align with his "
        "rookie draft, this is a coronation. If they don't, it's another "
        "10th-place finish."),
    "brower_barry": ("Year of the Choke Breakthrough?",
        "Three straight regular seasons winning the league. Three straight "
        "playoff exits. Still no rings. The data screams he should have 2 "
        "by now. Watch this card: either he finally gets one or we add "
        "'Brower Curse' to the league lexicon."),
    "ankur_patel": ("Came in Hot, Cooling Off",
        "Won as a rookie in 2022 and we've been waiting for round 2. "
        "Traded away his R1+R2 in 2025 to chase, ended up middling. "
        "Now picking late with no top-end capital. Bridge year."),
    "eric_m": ("Sleeping Giant",
        "2023 champ. Quiet 2024 + 2025 but he's a top-4 drafter when you "
        "control for slot. If he wakes up at the draft table, he's a "
        "playoff threat. Holds standard 1 R1/R2 capital."),
    "troy_mullings": ("The Mid Mid Mid",
        "Hasn't finished higher than 4th since his 2019 ring. Hasn't "
        "finished below 8th either. Lives in the dead-zone of fantasy "
        "football. Could break either way."),
    "brian_bigguap": ("Year 16 Begins",
        "15 years in, 0 rings. The most-traded manager in league history "
        "still chasing his white whale. Going into 2026 with standard "
        "capital and the league's deepest scar tissue. The story writes "
        "itself if he ever wins one."),
    "lem": ("Schedule-Luck Tax",
        "15 years, 0 rings, -0.80 schedule luck (worst in league). Sitting "
        "on 2 R2s and 2 R4s — actually decent capital. If the universe "
        "stops hating him, this could be his year."),
    "donnie": ("The Lottery Ticket",
        "Bottom of every meaningful chart for years, but now sitting on "
        "2 R1s after fleecing Tim. If you squint, there's a path. If you "
        "open your eyes, it's another double-digit-loss season."),
    "tim_breswick": ("Sold the Farm Early",
        "Already mortgaged his 2026 R1 in October trades. Long-snapper "
        "energy continues into year 10. Ceiling: 6th place. Floor: 12th."),
    "josh_wildboy": ("Year Two — Now It's His",
        "Inherited Dave's roster and went 9-5 last year on training wheels. "
        "Now it's his draft, his trades, his decisions. The Dave-legacy "
        "asterisk comes off — for better or worse."),
}


def _data_uri(path):
    if not Path(path).exists():
        return ""
    ext = str(path).lower().split(".")[-1]
    mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg"}.get(ext, "image/png")
    b = Path(path).read_bytes()
    return f"data:{mime};base64,{base64.b64encode(b).decode()}"


def _avatar_path(mid):
    p = ROOT / "data" / "charts" / "avatars" / f"{mid}.jpg"
    return p if p.exists() else None


def _setup_mpl():
    for f in (ROOT / "data" / "fonts").glob("*.ttf"):
        try:
            fm.fontManager.addfont(str(f))
        except Exception:
            pass
    plt.rcParams.update({
        "font.family": ["Inter", "DejaVu Sans"],
        "font.size": 10,
        "axes.spines.top": False,
        "axes.spines.right": False,
    })


def _xlsx_keeper_years_2025():
    """Parse FF2025 sheet comments → {normalized_player_name: year_of_keeping}.

    Year 3 means 'this is their 3rd year being kept' → CANNOT be kept again
    in 2026 (3-year max rule).
    """
    import openpyxl
    import re as _re
    out = {}
    try:
        wb = openpyxl.load_workbook(ROOT / "data/historical/MONEY_LEAGUE.xlsx",
                                     data_only=True)
        ws = wb["FF2025"]
        for r in range(1, 18):
            for c in range(2, 14):
                cell = ws.cell(r, c)
                if not (cell.comment and "keeper" in cell.comment.text.lower()):
                    continue
                m = _re.search(r"(\d+)(?:st|nd|rd|th)\s*year keeper",
                               cell.comment.text, _re.IGNORECASE)
                if not m or not cell.value:
                    continue
                year = int(m.group(1))
                name = _norm(str(cell.value))
                out[name] = year
    except Exception:
        pass
    return out


def _norm(s):
    import re as _re, unicodedata as _ud
    s = _ud.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().strip()
    return _re.sub(r"\s+", " ", _re.sub(r"[^a-z0-9 ]", " ", s)).strip()


def compute_keeper_value(top_n=4, min_keeper_round=3):
    """Each manager's projected 2026 keepers from data/keepers_2026.json,
    valued by 2026 projected half-PPR points (forward-looking).
    """
    rid_to_mid = {m["sleeper_roster_id"]: m["id"]
                  for m in all_managers() if m.get("sleeper_roster_id")}
    keepers_file = ROOT / "data" / "keepers_2026.json"
    raw = json.loads(keepers_file.read_text())

    by_rid = defaultdict(list)
    for e in raw:
        if e.get("status") == "carryover":
            by_rid[e["roster_id"]].append(e)

    # 2026 projections: name(lower) -> projected half-ppr pts
    proj_raw = json.loads((ROOT / "data/sleeper_projections_2026.json").read_text())
    proj_by_name: dict[str, float] = {}
    proj_by_pid: dict[str, float] = {}
    for p in proj_raw:
        pid = p.get("player_id")
        pts = (p.get("stats") or {}).get("pts_half_ppr", 0)
        if not pts:
            continue
        nm = (p.get("player") or {}).get("full_name") or ""
        if nm:
            proj_by_name[nm.lower()] = pts
        if pid:
            proj_by_pid[pid] = pts

    players = json.loads((ROOT / "data/sleeper/players_nfl.json").read_text())
    name_to_pid: dict[str, str] = {}
    for pid, p in players.items():
        nm = p.get("full_name") or f"{p.get('first_name','')} {p.get('last_name','')}".strip()
        name_to_pid[nm.lower()] = pid

    # Multi-year multiplier: more years remaining = more long-term value
    #   Y1 (2026 + 2027 + 2028 left)  -> 1.6x
    #   Y2 (2026 + 2027 left)         -> 1.3x
    #   Y3 (2026 only — final year)   -> 1.0x
    MULTI_YEAR = {1: 1.6, 2: 1.3, 3: 1.0}

    out = {}
    for rid, keepers in by_rid.items():
        mid = ROSTER_HANDOFFS.get((2025, rid)) or rid_to_mid.get(rid)
        if not mid:
            continue
        scored = []
        details = []
        for k in keepers:
            pid = name_to_pid.get(k["player_name"].lower(), "")
            proj = (proj_by_pid.get(pid) or
                    proj_by_name.get(k["player_name"].lower(), 0))
            year_2026 = (k.get("years_kept", 0) or 0) + 1
            multiplier = MULTI_YEAR.get(year_2026, 1.0)
            weighted = proj * multiplier
            scored.append((pid, weighted))
            details.append({
                "name": k["player_name"],
                "player_id": pid,
                "pos": k.get("position", "?"),
                "year_2025": k.get("years_kept", 0),
                "year_2026": year_2026,
                "cost_round_2026": k.get("forfeit_round", k.get("effective_forfeit_round", 0)),
                "proj_2026": round(proj, 1),
                "multi_year_mult": multiplier,
                "weighted_value": round(weighted, 1),
                "net_vbd_2026": round(k.get("net_vbd", 0), 1),
            })
        out[mid] = {
            "value": sum(p for _, p in scored),
            "players": scored,
            "_keepers_detail": details,
        }
    return out


def compute_pick_value():
    """Sum of round-mean projected pick value across all 2026 picks owned
    (using data/pick_value.json — actual historical points by round).
    """
    pv = json.loads((ROOT / "data/pick_value.json").read_text())
    by_round = {int(k): v["mean_points"] for k, v in pv["by_round"].items()}
    # For rounds outside the file (R6-17), extrapolate decay
    last_known = max(by_round)
    last_val = by_round[last_known]
    for rnd in range(last_known + 1, 18):
        # decay 15% per round past last known
        by_round[rnd] = last_val * (0.85 ** (rnd - last_known))

    rid_to_mid = {m["sleeper_roster_id"]: m["id"]
                  for m in all_managers() if m.get("sleeper_roster_id")}

    def mgr(rid):
        return ROSTER_HANDOFFS.get((2025, rid)) or rid_to_mid.get(rid)

    # Start each roster with 1 pick per round R1-R17
    picks = defaultdict(lambda: defaultdict(int))
    for rid in range(1, 13):
        m = mgr(rid)
        if m:
            for rnd in range(1, 18):
                picks[m][rnd] += 1
    LG = "league_1245039290518360064"
    for f in sorted((ROOT / "data/sleeper" / LG / "transactions").glob("week_*.json")):
        for t in json.loads(f.read_text()):
            if t.get("type") != "trade" or t.get("status") != "complete":
                continue
            for pk in (t.get("draft_picks") or []):
                if str(pk.get("season")) != "2026":
                    continue
                orig = mgr(pk["previous_owner_id"])
                new = mgr(pk["owner_id"])
                rnd = pk["round"]
                if orig:
                    picks[orig][rnd] -= 1
                if new:
                    picks[new][rnd] += 1

    out = {}
    for mid, r2cnt in picks.items():
        total = sum(by_round.get(rnd, 0) * cnt for rnd, cnt in r2cnt.items())
        out[mid] = total
    return out


def _OLD_compute_keeper_value(top_n=4, min_keeper_round=3):
    """(deprecated) old top-4 by raw fpts — replaced by prediction-driven."""
    LG = "league_1245039290518360064"
    rosters = json.loads((ROOT / "data/sleeper" / LG / "rosters.json").read_text())
    ptot = defaultdict(float)
    for f in sorted((ROOT / "data/sleeper" / LG / "matchups").glob("week_*.json")):
        for e in json.loads(f.read_text()):
            for pid, p in (e.get("players_points") or {}).items():
                if p:
                    ptot[pid] += p

    draft_round = {}
    draft_f = list((ROOT / "data/sleeper" / LG).glob("draft_*_picks.json"))[0]
    for p in json.loads(draft_f.read_text()):
        pid = p.get("player_id")
        if pid:
            draft_round[pid] = int(p["round"])

    # xlsx-derived: name -> year of keeping in 2025
    keeper_years = _xlsx_keeper_years_2025()

    # Sleeper player catalog for name lookup
    catalog = json.loads((ROOT / "data/sleeper/players_nfl.json").read_text())
    pid_name = {pid: _norm(p.get("full_name") or
                            f"{p.get('first_name','')} {p.get('last_name','')}")
                for pid, p in catalog.items()}

    rid_to_mid = {m["sleeper_roster_id"]: m["id"]
                  for m in all_managers() if m.get("sleeper_roster_id")}
    out = {}
    for r in rosters:
        rid = r["roster_id"]
        mid = ROSTER_HANDOFFS.get((2025, rid)) or rid_to_mid.get(rid)
        if not mid:
            continue
        eligible = []
        for pid in (r.get("players") or []):
            rnd = draft_round.get(pid, 99)
            if rnd < min_keeper_round:
                continue
            # 3-year max keeper rule
            if keeper_years.get(pid_name.get(pid, ""), 0) >= 3:
                continue
            eligible.append(pid)
        scored = sorted([(pid, ptot.get(pid, 0)) for pid in eligible],
                         key=lambda x: -x[1])[:top_n]
        out[mid] = {"value": sum(p for _, p in scored), "players": scored}
    return out


def compute_pick_capital():
    """Returns {mid: {round: count}} of 2026 picks owned."""
    rid_to_mid = {m["sleeper_roster_id"]: m["id"]
                  for m in all_managers() if m.get("sleeper_roster_id")}
    def mgr(rid):
        return ROSTER_HANDOFFS.get((2025, rid)) or rid_to_mid.get(rid)

    picks = defaultdict(lambda: defaultdict(int))
    for rid in range(1, 13):
        mid = mgr(rid)
        if mid:
            for rnd in range(1, 18):
                picks[mid][rnd] += 1
    LG = "league_1245039290518360064"
    for f in sorted((ROOT / "data/sleeper" / LG / "transactions").glob("week_*.json")):
        for t in json.loads(f.read_text()):
            if t.get("type") != "trade" or t.get("status") != "complete":
                continue
            for pk in (t.get("draft_picks") or []):
                if str(pk.get("season")) != "2026":
                    continue
                orig = mgr(pk["previous_owner_id"])
                new = mgr(pk["owner_id"])
                rnd = pk["round"]
                if orig:
                    picks[orig][rnd] -= 1
                if new:
                    picks[new][rnd] += 1
    return picks


def compute_preseason_ranks():
    """Returns sorted list of dicts ranking managers heading into 2026
    based on ASSETS + SKILL (forward-looking, not recent record)."""
    # Skill: weighted by recency — last 3 years (Sleeper era) only
    sl = lambda y: 2023 <= y <= 2025
    vbd_recent, vbd_n_recent = bpr.compute_trade_vbd(year_filter=sl)
    draft_recent = bpr.compute_draft_stats(year_filter=sl)
    # All-time as fallback for managers with thin recent samples
    vbd_all, vbd_n_all = bpr.compute_trade_vbd()
    draft_all = bpr.compute_draft_stats()

    season_table = bpr.compute_season_table()
    pick_cap = compute_pick_capital()
    pick_val = compute_pick_value()  # NEW: projected pts per owned pick
    keepers = compute_keeper_value(top_n=4, min_keeper_round=3)

    rows = []
    current_mids = [m["id"] for m in all_managers()
                    if m.get("sleeper_roster_id")] + ["josh_wildboy"]
    current_mids = list(dict.fromkeys(current_mids))

    for mid in current_mids:
        s2025 = season_table.get((2025, mid))
        if not s2025:
            continue
        # Skill — prefer Sleeper-era; fall back to career if no recent trades
        n_recent = vbd_n_recent.get(mid, 0)
        if n_recent >= 3:
            trade_per = vbd_recent.get(mid, 0) / n_recent
            n_trades = n_recent
        else:
            n_all = vbd_n_all.get(mid, 0)
            trade_per = vbd_all.get(mid, 0) / n_all if n_all else 0
            n_trades = n_all
        # Draft skill — recent if enough picks, else career
        draft_spp = (draft_recent.get(mid, {}).get("spp")
                     if draft_recent.get(mid, {}).get("picks", 0) >= 20
                     else draft_all.get(mid, {}).get("spp", 0))
        early_picks = pick_cap[mid][1] + pick_cap[mid][2] + pick_cap[mid][3]
        pick_value = pick_val.get(mid, 0)  # projected pts from owned picks
        ppg_2025 = s2025["ppg"]

        kp = keepers.get(mid, {"value": 0, "players": [], "_keepers_detail": []})
        rows.append({
            "mid": mid,
            "name": bpr._mgr_name(mid),
            "trade_per": trade_per,
            "trade_n": n_trades,
            "trade_total": vbd_all.get(mid, 0),
            "draft_spp": draft_spp,
            "pick_value": pick_value,
            "early_picks": early_picks,
            "r1_2026": pick_cap[mid][1],
            "r2_2026": pick_cap[mid][2],
            "r3_2026": pick_cap[mid][3],
            "roster_ppg": ppg_2025,
            "keeper_value": kp["value"],
            "keeper_players": kp["players"],
            "keepers_detail": kp.get("_keepers_detail", []),
            "wl_2025": (s2025["w"], s2025["l"]),
            "rank_2025": s2025["wins_rank"],
        })

    def _norm(vals):
        vmin, vmax = min(vals), max(vals)
        return [(0 if vmax == vmin else (v - vmin) / (vmax - vmin)) * 100
                for v in vals]

    trd = _norm([r["trade_per"] for r in rows])
    drf = _norm([r["draft_spp"] for r in rows])
    cap = _norm([r["pick_value"] for r in rows])
    kpr = _norm([r["keeper_value"] for r in rows])
    ros = _norm([r["roster_ppg"] for r in rows])

    # 70% ASSETS = 35% pick capital + 30% keeper value + 5% roster depth
    # 30% SKILL  = 15% trade + 15% draft
    for i, r in enumerate(rows):
        score = (0.35 * cap[i] + 0.30 * kpr[i] + 0.05 * ros[i]
                 + 0.15 * trd[i] + 0.15 * drf[i])
        r["trade_norm"] = round(trd[i])
        r["draft_norm"] = round(drf[i])
        r["cap_norm"] = round(cap[i])
        r["keeper_norm"] = round(kpr[i])
        r["roster_norm"] = round(ros[i])
        r["power_score"] = round(score, 1)

    rows.sort(key=lambda r: -r["power_score"])
    for rk, r in enumerate(rows, 1):
        r["preseason_rank"] = rk
    return rows


def chart_preseason_power(rows, path):
    """Stacked bar: pick contribution / keeper contribution / skill contribution
    to each manager's preseason power score."""
    _setup_mpl()
    s = sorted(rows, key=lambda r: r["power_score"])
    names = [r["name"] for r in s]
    # Contributions: cap_norm × 0.35, keeper_norm × 0.30, (trd+drf)/2 × 0.30
    # (Roster depth at 0.05 folded into picks for visual simplicity)
    picks_contrib = [r["cap_norm"] * 0.35 + r["roster_norm"] * 0.05 for r in s]
    keep_contrib = [r["keeper_norm"] * 0.30 for r in s]
    skill_contrib = [(r["trade_norm"] + r["draft_norm"]) * 0.5 * 0.30 for r in s]
    totals = [r["power_score"] for r in s]

    fig, ax = plt.subplots(figsize=(9, 0.45 * len(s) + 1), dpi=140)
    y = np.arange(len(s))
    PICK_COLOR = "#0a3d62"
    KEEP_COLOR = "#1f7a8c"
    SKILL_COLOR = "#d4a017"
    ax.barh(y, picks_contrib, color=PICK_COLOR, edgecolor="white", linewidth=1.2,
            label="Picks + depth")
    ax.barh(y, keep_contrib, left=picks_contrib, color=KEEP_COLOR,
            edgecolor="white", linewidth=1.2, label="Keepers")
    starts = [p + k for p, k in zip(picks_contrib, keep_contrib)]
    ax.barh(y, skill_contrib, left=starts, color=SKILL_COLOR,
            edgecolor="white", linewidth=1.2, label="Skill")
    for i, total in enumerate(totals):
        ax.text(total + 1, i, f"{total:.1f}", va="center", fontsize=10,
                fontweight="bold", color="#1a1d24")
    ax.set_yticks(y)
    ax.set_yticklabels(names, fontweight="bold")
    ax.set_xlim(0, max(totals) * 1.18)
    ax.set_xlabel("Preseason Power Score (stacked by source)", fontweight="bold")
    ax.set_title("Summer 2026 GUAP Preseason Power Rankings  ·  "
                 "blue = picks · teal = keepers · gold = skill",
                 loc="left", pad=14, fontsize=13)
    ax.legend(loc="lower right", frameon=False, fontsize=9)
    ax.grid(axis="x", linestyle="--", alpha=0.4)
    ax.set_axisbelow(True)
    plt.tight_layout()
    plt.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close()


def chart_pick_capital(rows, path):
    _setup_mpl()
    s = sorted(rows, key=lambda r: -(r["r1_2026"] * 3 + r["r2_2026"] * 2 + r["r3_2026"]))
    names = [r["name"] for r in s][::-1]
    r1 = [r["r1_2026"] for r in s][::-1]
    r2 = [r["r2_2026"] for r in s][::-1]
    r3 = [r["r3_2026"] for r in s][::-1]
    y = np.arange(len(s))
    fig, ax = plt.subplots(figsize=(9, 0.42 * len(s) + 1), dpi=140)
    ax.barh(y, r1, color="#0a3d62", edgecolor="white", linewidth=1.2, label="R1")
    ax.barh(y, r2, left=r1, color="#1f7a8c", edgecolor="white", linewidth=1.2, label="R2")
    ax.barh(y, r3, left=[a + b for a, b in zip(r1, r2)], color="#d4a017",
            edgecolor="white", linewidth=1.2, label="R3")
    ax.set_yticks(y)
    ax.set_yticklabels(names, fontweight="bold")
    for i, r in enumerate(s[::-1]):
        total = r["r1_2026"] + r["r2_2026"] + r["r3_2026"]
        ax.text(total + 0.1, i, f"R1×{r['r1_2026']} R2×{r['r2_2026']} R3×{r['r3_2026']}",
                va="center", fontsize=8.5, color="#3d405b")
    ax.set_xlabel("R1-R3 picks owned", fontweight="bold")
    ax.set_title("2026 Early-Round Draft Capital", loc="left", pad=14, fontsize=13)
    ax.legend(loc="lower right", frameon=False, fontsize=9)
    ax.grid(axis="x", linestyle="--", alpha=0.4)
    ax.set_axisbelow(True)
    plt.tight_layout()
    plt.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close()


_PLAYER_CATALOG = None


def _player_catalog():
    global _PLAYER_CATALOG
    if _PLAYER_CATALOG is None:
        _PLAYER_CATALOG = json.loads(
            (ROOT / "data/sleeper/players_nfl.json").read_text())
    return _PLAYER_CATALOG


def _abbrev_name(nm: str) -> str:
    """Abbreviate first name to fit in keeper chip: 'Christian Watson' -> 'C. Watson'.
    Leaves single-name entities (defenses) unchanged."""
    parts = nm.split()
    if len(parts) < 2:
        return nm
    first, *rest = parts
    if len(first) <= 2:  # e.g. "JK Dobbins", "DJ Moore"
        return nm
    return f"{first[0]}. {' '.join(rest)}"


def _format_keepers(scored_players, keepers_detail=None):
    """Inline keeper chips with portrait + name + 2025 pts + 2026 cost."""
    catalog = _player_catalog()
    detail_by_pid = {k["player_id"]: k for k in (keepers_detail or [])}
    parts = []
    for pid, pts in scored_players:
        nm = catalog.get(pid, {}).get("full_name", pid)
        short = _abbrev_name(nm)
        portrait = ROOT / "data/charts/players" / f"{pid}.jpg"
        img = (f'<img class="keeper-portrait" src="{_data_uri(portrait)}"/>'
               if portrait.exists() else "")
        det = detail_by_pid.get(pid, {})
        cost = det.get("cost_round_2026")
        yr = det.get("year_2026")
        cost_tag = (f'<span class="kc-cost">R{cost}·Y{yr}</span>'
                    if cost else "")
        parts.append(f'<span class="keeper-chip">{img}'
                     f'<span class="kc-name">{short}</span>'
                     f'<span class="kc-pts">{int(pts)}</span>'
                     f'{cost_tag}</span>')
    return "".join(parts) or "—"


def render_rank_card(r):
    color = bpr.mgr_color(r["mid"])
    label, body = GUAP_TAKES.get(r["mid"], ("?", "..."))
    av = _avatar_path(r["mid"])
    av_html = (f'<img class="avatar" src="{_data_uri(av)}"/>' if av else
               '<div class="avatar avatar-placeholder"></div>')
    # No momentum field in assets+skill mode; using rank-2025 as a side-stat.
    return f"""
    <div class="rank-card">
      <div class="rank-head" style="background:linear-gradient(135deg, {color} 0%, {color}dd 100%)">
        <div class="rank-num">#{r['preseason_rank']}</div>
        {av_html}
        <div class="rank-name">
          <div class="player-name">{r['name']}</div>
          <div class="rank-label">{label}</div>
        </div>
        <div class="power-score"><div class="ps-num">{r['power_score']:.1f}</div><div class="ps-lbl">Power</div></div>
      </div>
      <div class="rank-body">
        <div class="stat-strip">
          <div><span class="lbl">2025</span><div class="val">{r['wl_2025'][0]}-{r['wl_2025'][1]} <span style="color:#6b7280;font-weight:500">#{r['rank_2025']}</span></div></div>
          <div><span class="lbl">2026 R1/R2/R3</span><div class="val">{r['r1_2026']} / {r['r2_2026']} / {r['r3_2026']}</div></div>
          <div><span class="lbl">Keep Value</span><div class="val">{r['keeper_value']:.0f}</div></div>
          <div><span class="lbl">Skill (trade · draft)</span><div class="val">{r['trade_per']:+.0f} · {r['draft_spp']:+.1f}</div></div>
        </div>
        <div class="keeper-label">Likely Keepers</div>
        <div class="keepers-grid">{_format_keepers(r['keeper_players'], r.get('keepers_detail'))}</div>
        <div class="rank-take">{body}</div>
      </div>
    </div>
    """


def build_html(rows, paths):
    today = date.today().strftime("%B %Y")
    css = """
    body { font-family: 'Inter', -apple-system, system-ui, sans-serif;
           max-width: 780px; margin: 18px auto; padding: 0 22px;
           color: #1a1d24; line-height: 1.5; font-size: 10.5pt; }
    .hero { background: linear-gradient(135deg, #0a3d62 0%, #1f7a8c 100%);
            color: white; padding: 22px 26px; border-radius: 14px;
            margin-bottom: 18px; }
    .hero h1 { font-family: 'Bebas Neue', sans-serif; font-size: 38pt;
               letter-spacing: 1px; margin: 0; line-height: 1; color: white; }
    .hero .subtitle { color: rgba(255,255,255,0.85); margin: 8px 0 0;
                      font-weight: 500; font-size: 11pt; }
    h2 { font-family: 'Bebas Neue', sans-serif; font-size: 22pt;
         letter-spacing: 1px; color: #0a3d62; margin: 16px 0 4px;
         padding-bottom: 3px; border-bottom: 3px solid #d4a017;
         break-after: avoid-page; }
    .note { color: #6b7280; font-size: 9.5pt; margin: 2px 0 8px; }
    .chart { width: 100%; max-height: 5.5in; object-fit: contain;
             display: block; margin: 4px 0 8px; }
    .rank-card { border: 1px solid #e5e7eb; border-radius: 12px;
                 overflow: hidden; margin: 6px 0; box-shadow: 0 1px 4px rgba(0,0,0,0.06);
                 page-break-inside: avoid; }
    .rank-head { color: white; padding: 10px 14px; display: flex;
                 align-items: center; gap: 12px; }
    .rank-num { font-family: 'Bebas Neue', sans-serif; font-size: 28pt;
                font-weight: bold; min-width: 56px; line-height: 1;
                text-shadow: 0 2px 4px rgba(0,0,0,0.25); }
    .avatar { width: 42px; height: 42px; border-radius: 50%; object-fit: cover;
              border: 2.5px solid rgba(255,255,255,0.85); }
    .rank-name { flex: 1; }
    .player-name { font-size: 13pt; font-weight: 800; line-height: 1.1; }
    .rank-label { font-size: 9pt; opacity: 0.92; margin-top: 3px;
                  font-weight: 500; letter-spacing: 0.3px; }
    .power-score { text-align: center; min-width: 60px; }
    .ps-num { font-family: 'Bebas Neue', sans-serif; font-size: 22pt;
              font-weight: bold; line-height: 1; }
    .ps-lbl { font-size: 7.5pt; opacity: 0.85; letter-spacing: 0.5px;
              text-transform: uppercase; }
    .rank-body { padding: 8px 14px 10px; }
    .stat-strip { display: grid; grid-template-columns: repeat(4, 1fr);
                  gap: 0; font-size: 9pt; color: #3d405b;
                  background: #f9fafb; border-radius: 6px;
                  padding: 6px 10px; margin-bottom: 6px; }
    .stat-strip > div { padding: 0 4px; border-right: 1px solid #e5e7eb;
                        line-height: 1.25; }
    .stat-strip > div:last-child { border-right: none; }
    .stat-strip .lbl { font-size: 7.5pt; color: #6b7280;
                       text-transform: uppercase; letter-spacing: 0.4px;
                       font-weight: 600; }
    .stat-strip .val { font-weight: 700; color: #1a1d24; font-size: 10pt; }
    .keeper-label { display: block; font-size: 7.5pt; font-weight: 700;
                    color: #6b7280; letter-spacing: 0.6px;
                    text-transform: uppercase; margin: 4px 0 4px; }
    .keepers-grid { display: grid; grid-template-columns: repeat(2, 1fr);
                    gap: 6px; }
    .rank-take { font-size: 9.5pt; color: #1a1d24; margin-top: 6px;
                 line-height: 1.55; }
    .keeper-chip { display: flex; align-items: center; gap: 5px;
                   background: #f9fafb; border-radius: 6px; padding: 4px 6px;
                   font-size: 8pt; border: 1px solid #e5e7eb; overflow: hidden; }
    .keeper-portrait { width: 22px; height: 22px; border-radius: 50%;
                       object-fit: cover; background: #d1d5db;
                       border: 1px solid #cbd5e1; flex-shrink: 0; }
    .kc-name { font-weight: 700; color: #1a1d24; font-size: 9pt;
               line-height: 1.15; flex: 1; min-width: 0;
               white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .kc-pts { color: #0a3d62; font-weight: 700;
              font-size: 7.5pt; background: #fef3c7; padding: 1px 5px;
              border-radius: 6px; flex-shrink: 0; }
    .kc-cost { color: white; background: #0a3d62; font-weight: 700;
               font-size: 7pt; padding: 1px 5px; border-radius: 6px;
               flex-shrink: 0; letter-spacing: 0.3px; }
    @page { size: letter; margin: 0.45in; }
    """
    h = ['<!DOCTYPE html><html><head><meta charset="utf-8">',
         f'<style>{css}</style></head><body>']
    h.append('<div class="hero"><h1>2026 PRESEASON POWER RANKINGS</h1>'
             f'<p class="subtitle">{today} · MONEYLEAGUE · Big Guap\'s Hot Takes</p></div>')

    h.append('<h2>Preseason Power Score</h2>')
    h.append('<p class="note">Composite: <strong>70% ASSETS</strong> '
             '(35% 2026 pick capital — projected pts/round from '
             'data/pick_value.json · 30% top-4 keeper projected pts '
             '× multi-year multiplier · 5% roster depth) + '
             '<strong>30% SKILL</strong> (15% trade VBD/trade · 15% draft '
             'surplus/pick — Sleeper-era weighted, career fallback for '
             'small samples). Keeper multipliers: <strong>Y1 = 1.6×</strong> '
             '(3 yrs remaining), <strong>Y2 = 1.3×</strong> (2 yrs), '
             '<strong>Y3 = 1.0×</strong> (final year). Forward-looking '
             '— recent W-L excluded.</p>')
    h.append(f'<img class="chart" src="{_data_uri(paths["power"])}"/>')

    h.append('<h2>2026 Pick Capital</h2>')
    h.append('<p class="note">Who hoarded picks, who sold them. R1+R2+R3 only — '
             'where the meaningful rookie draft action happens.</p>')
    h.append(f'<img class="chart" src="{_data_uri(paths["capital"])}"/>')

    h.append('<h2>The Rankings (with GUAP Takes)</h2>')
    for r in rows:
        h.append(render_rank_card(r))

    h.append('</body></html>')
    return "\n".join(h)


def main():
    rows = compute_preseason_ranks()
    paths = {
        "power": CHART_DIR / "power.png",
        "capital": CHART_DIR / "capital.png",
    }
    chart_preseason_power(rows, paths["power"])
    chart_pick_capital(rows, paths["capital"])

    html = build_html(rows, paths)

    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "/opt/pw-browsers"
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROMIUM_EXEC,
                              args=["--no-sandbox", "--disable-dev-shm-usage"])
        ctx = b.new_context(viewport={"width": 820, "height": 1100})
        page = ctx.new_page()
        page.set_content(html, wait_until="networkidle")
        page.pdf(path=str(PDF_OUT), format="Letter",
                 margin={"top": "0.4in", "bottom": "0.4in",
                         "left": "0.4in", "right": "0.4in"},
                 print_background=True)
        b.close()
    print(f"Wrote {PDF_OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
