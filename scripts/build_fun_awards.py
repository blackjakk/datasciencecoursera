"""Fun MONEYLEAGUE awards — the entertaining stuff only.

Drops the dense per-category tables in favor of single-winner awards
with story-style commentary. Pulls live data for: highest/lowest
single-week scores, biggest heartbreak losses, biggest blowouts,
closest games, best/worst draft picks, biggest wire hits, most-passed-
around players, boomerang adds, draft picks that became league-winners.
"""
from __future__ import annotations

import glob
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.results import (  # noqa: E402
    load_all_seasons,
    load_draft_picks_with_points,
    load_player_ownership_windows,
    load_weekly_player_points,
)
from fantasy_draft.team_identity import manager_for_sleeper_roster  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
MD_OUT = ROOT / "data" / "MONEYLEAGUE_FUN.md"
PDF_OUT = ROOT / "data" / "MONEYLEAGUE_FUN.pdf"


def _mgr(rid: int) -> str | None:
    m = manager_for_sleeper_roster(rid)
    return m["canonical_name"].split(" (")[0] if m else None


def _pname(pid: str, players: dict) -> str:
    p = players.get(pid, {})
    return f"{p.get('first_name', '?')} {p.get('last_name', '?')}".strip()


def _all_weekly_scores(seasons: dict) -> list[tuple[int, int, int, float]]:
    """Returns [(season, week, rid, points)] for all regular-season weeks."""
    out = []
    for season, sd in seasons.items():
        for (rid, wk), pts in sd.get("weekly_team_points", {}).items():
            if wk <= 14 and pts > 0:
                out.append((season, wk, rid, pts))
    return out


def _matchup_pairs(season_dir: Path) -> list[tuple[int, int, int, float, int, float]]:
    """Yield (season, week, winner_rid, winner_pts, loser_rid, loser_pts)
    for every regular-season game in this league directory."""
    out = []
    league_info = season_dir / "league.json"
    if not league_info.exists():
        return out
    season = int(json.loads(league_info.read_text()).get("season", 0))
    matchup_dir = season_dir / "matchups"
    if not matchup_dir.exists():
        return out
    for wf in sorted(matchup_dir.glob("week_*.json")):
        wk = int(wf.stem.replace("week_", ""))
        if wk > 14:
            continue
        ms = json.loads(wf.read_text())
        by_mid = defaultdict(list)
        for m in ms:
            mid = m.get("matchup_id")
            if mid is not None:
                by_mid[mid].append(m)
        for mid, pair in by_mid.items():
            if len(pair) == 2 and all(p.get("points") is not None for p in pair):
                pair.sort(key=lambda p: -p["points"])
                w, l = pair[0], pair[1]
                if w["points"] == l["points"]:
                    continue
                out.append((season, wk,
                             w.get("roster_id"), w["points"],
                             l.get("roster_id"), l["points"]))
    return out


def build_markdown() -> str:
    seasons = load_all_seasons(ROOT / "data" / "sleeper")
    players = json.loads((ROOT / "data" / "sleeper" / "players_nfl.json").read_text())
    ownership = load_player_ownership_windows(ROOT / "data" / "sleeper")
    weekly = load_weekly_player_points(ROOT / "data" / "sleeper")

    # All matchup pairs across all leagues
    pairs: list[tuple[int, int, int, float, int, float]] = []
    for ld in glob.glob(str(ROOT / "data" / "sleeper" / "league_*")):
        pairs.extend(_matchup_pairs(Path(ld)))

    # Filter to current-12-roster managers only
    pairs = [p for p in pairs if _mgr(p[2]) and _mgr(p[4])]

    week_scores = _all_weekly_scores(seasons)
    week_scores = [w for w in week_scores if _mgr(w[2])]

    # Top wire hit overall — only count actual waiver/FA adds, not trades.
    top_wire = None
    boomerangs: list[tuple[int, str, int]] = []
    for (s, pid), windows in ownership.items():
        seen = set()
        for sw, ew, rid, src in windows:
            if rid in seen and src == "add":
                boomerangs.append((s, pid, rid))
                break
            seen.add(rid)
            if sw <= 1 or src != "add":
                continue
            pts = sum(weekly.get(s, {}).get(wk, {}).get(pid, 0.0)
                      for wk in range(sw, min(ew + 1, 18)))
            if not top_wire or pts > top_wire["pts"]:
                top_wire = {"season": s, "week": sw, "rid": rid, "pid": pid, "pts": pts}

    # Most-dropped player
    drops = [(s, pid, max(0, len(w) - 1))
             for (s, pid), w in ownership.items()]
    drops.sort(key=lambda d: -d[2])

    # Draft picks: best steal + worst bust (largest above-/below-expectation)
    picks = load_draft_picks_with_points(ROOT / "data" / "sleeper")
    pv = json.loads((ROOT / "data" / "pick_value.json").read_text())
    pv_by_round = {int(r): v["mean_vbd"] for r, v in pv["by_round"].items()}
    RANKS = pv["replacement_ranks_used"]

    # VBD per pick (same logic as awards report)
    per_season: dict[int, list[dict]] = defaultdict(list)
    for p in picks:
        per_season[p["season"]].append(p)
    def repl_for(sp):
        bp: dict[str, list[float]] = defaultdict(list)
        for p in sp:
            if p["position"] in RANKS and p["season_points"]:
                bp[p["position"]].append(p["season_points"])
        out = {}
        for pos, pts in bp.items():
            pts.sort(reverse=True)
            out[pos] = pts[min(RANKS[pos] - 1, len(pts) - 1)] if pts else 0.0
        return out
    repl = {s: repl_for(ps) for s, ps in per_season.items()}
    for p in picks:
        p["vbd"] = (p["season_points"] or 0) - repl[p["season"]].get(p["position"], 0)
        p["above"] = p["vbd"] - pv_by_round.get(p["round"], 0)

    # Best steal & worst bust (excluding keepers)
    fresh = [p for p in picks if not p.get("is_keeper") and _mgr(p["roster_id"])]
    best_steal = max(fresh, key=lambda p: p["above"])
    worst_bust = min(fresh, key=lambda p: p["above"])

    # Best late-round kicker hit
    late_k = [p for p in fresh if p["position"] == "K" and p["round"] >= 14]
    best_k = max(late_k, key=lambda p: p["vbd"]) if late_k else None

    # Highest single-week, lowest single-week
    high_score = max(week_scores, key=lambda w: w[3])
    low_score = min(week_scores, key=lambda w: w[3])

    # Heartbreak / luck / blowout / closest
    heartbreak = max(pairs, key=lambda p: p[5])  # highest losing score
    luck_win = min(pairs, key=lambda p: p[3])    # lowest winning score
    blowout = max(pairs, key=lambda p: p[3] - p[5])
    closest = min(pairs, key=lambda p: p[3] - p[5])

    # Who has the most boomerangs (re-acquired a player they dropped)
    boomerang_counts = Counter(b[2] for b in boomerangs if _mgr(b[2]))
    top_boomerang = boomerang_counts.most_common(1)[0] if boomerang_counts else None

    today = date.today().strftime("%B %Y")

    md: list[str] = []
    md.append("# 🏆 MONEYLEAGUE Funky Awards")
    md.append(f"*The fun stuff · {today} · 3 seasons of Sleeper data (2023-2025)*\n")
    md.append("Forget the percentile composites. These are the awards we'd "
              "actually hand out at a league dinner.\n")
    md.append("---\n")

    # === Single-game/single-week awards ===
    md.append("## 🚀 The Nuke — highest single-game score\n")
    s, w, rid, pts = high_score
    md.append(f"**{_mgr(rid)}** detonated for **{pts:.1f} points** in "
              f"{s} Week {w}. The league average that week was around 130. "
              f"Felt good for about 6 days.\n")

    md.append("## 💩 The No-Show — lowest single-game score\n")
    s, w, rid, pts = low_score
    md.append(f"**{_mgr(rid)}** managed just **{pts:.1f}** in {s} Week {w}. "
              f"Probably a bye-week massacre or an entire starting lineup "
              f"benched. Either way: woof.\n")

    md.append("## 💔 The Heartbreak — highest score that LOST\n")
    s, w, wr, wp, lr, lp = heartbreak
    md.append(f"**{_mgr(lr)}** dropped **{lp:.1f}** points in {s} Week {w} "
              f"and *still lost* — {_mgr(wr)} put up {wp:.1f}. "
              f"There is no justice in this league.\n")

    md.append("## 🍀 Houdini — lowest score that WON\n")
    s, w, wr, wp, lr, lp = luck_win
    md.append(f"**{_mgr(wr)}** scored just **{wp:.1f}** in {s} Week {w} "
              f"and somehow took the W — {_mgr(lr)} scored only {lp:.1f}. "
              f"A truly awful game between two truly cooked rosters.\n")

    md.append("## 💥 The Hammer — biggest blowout\n")
    s, w, wr, wp, lr, lp = blowout
    md.append(f"**{_mgr(wr)} {wp:.1f} – {lp:.1f} {_mgr(lr)}** in {s} Week {w} "
              f"— a **{wp - lp:.1f}-point** beatdown. Hope they at least "
              f"sent a text apologizing.\n")

    md.append("## 📏 The Photo Finish — closest game\n")
    s, w, wr, wp, lr, lp = closest
    md.append(f"**{_mgr(wr)} {wp:.2f} – {lp:.2f} {_mgr(lr)}** in {s} Week {w} "
              f"— decided by **{wp - lp:.2f}** points. Decimal places matter "
              f"in this league.\n")

    md.append("---\n")

    # === Draft / wire ===
    md.append("## 💎 The Heist — best draft pick of the era\n")
    p = best_steal
    md.append(f"**{_mgr(p['roster_id'])}** took **{p['player_name']}** "
              f"({p['position']}) in **Round {p['round']}** of {p['season']} "
              f"and got **+{p['above']:.0f} VBD above what that round "
              f"typically returns.** That's a value pick of a lifetime.\n")

    md.append("## 🪦 The Curse — worst draft pick of the era\n")
    p = worst_bust
    md.append(f"**{_mgr(p['roster_id'])}** spent **Round {p['round']}** of "
              f"{p['season']} on **{p['player_name']}** ({p['position']}) "
              f"and got **{p['above']:.0f} below expectation.** Hurts to "
              f"look at. We've all been there. Mostly.\n")

    if best_k:
        md.append("## 🦵 Late-Round Kicker Magic\n")
        md.append(f"**{_mgr(best_k['roster_id'])}** drafted "
                  f"**{best_k['player_name']}** in **Round {best_k['round']}** "
                  f"of {best_k['season']}, returning **+{best_k['vbd']:.0f} "
                  f"VBD**. That's first-round-RB production from a pick "
                  f"everyone else used on a punter.\n")

    if top_wire:
        md.append("## 🧙 Wire Wizard — best free-agent pickup\n")
        nm = _pname(top_wire["pid"], players)
        md.append(f"**{_mgr(top_wire['rid'])}** plucked **{nm}** off the "
                  f"wire in {top_wire['season']} Week {top_wire['week']}, "
                  f"who then produced **+{top_wire['pts']:.0f} points** "
                  f"in the games after the add. Easily the best wire add "
                  f"of the Sleeper era.\n")

    md.append("---\n")

    # === Player drama ===
    md.append("## 🔁 The Hot Potato — player who got passed around the most\n")
    if drops:
        s, pid, n = drops[0]
        md.append(f"**{_pname(pid, players)}** ({players.get(pid, {}).get('position', '?')}) "
                  f"was added and dropped a combined **{n + 1} times** in "
                  f"{s}. Roster fodder of the year.\n")

    if top_boomerang:
        rid, n = top_boomerang
        md.append("## 🪃 The Boomerang Award — keeps re-adding the same guys\n")
        md.append(f"**{_mgr(rid)}** has re-added a player they previously "
                  f"dropped **{n} different times** across the Sleeper era. "
                  f"There's a hypothesis being tested here, and the "
                  f"hypothesis is: nobody else wants this guy either.\n")

    md.append("---\n")

    # === Manager personality awards ===
    add_counts: dict[int, int] = Counter()
    for (s, pid), windows in ownership.items():
        for sw, ew, rid, src in windows:
            if sw > 1 and src == "add" and _mgr(rid):
                add_counts[rid] += 1
    if add_counts:
        most_active = add_counts.most_common(1)[0]
        least_active = min(add_counts.items(), key=lambda kv: kv[1])
        md.append("## 🌀 Hyper-Manager — most wire activity\n")
        md.append(f"**{_mgr(most_active[0])}** made **{most_active[1]} adds** "
                  f"over 3 seasons. Reportedly has push notifications on for "
                  f"Sleeper, ESPN, NFL.com, RotoWire, and three different "
                  f"weather apps for Buffalo.\n")
        md.append("## 🛋️ Couch Coach — least wire activity\n")
        md.append(f"**{_mgr(least_active[0])}** made just **{least_active[1]} "
                  f"adds** total. Set-it-and-forget-it energy. Honestly "
                  f"respect the discipline.\n")

    md.append("---\n")
    md.append("*The serious version with percentiles and full tables is "
              "still available — this one's just for the group chat.*")
    return "\n".join(md)


def _md_to_html(md_text: str) -> str:
    import re
    lines = md_text.split("\n")
    html_lines: list[str] = []
    in_para = False

    def close_para():
        nonlocal in_para
        if in_para:
            html_lines.append("</p>")
            in_para = False

    def inline(text):
        text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
        text = re.sub(r"\*(.+?)\*", r"<em>\1</em>", text)
        return text

    for ln in lines:
        if ln.startswith("# "):
            close_para()
            html_lines.append(f"<h1>{inline(ln[2:])}</h1>")
        elif ln.startswith("## "):
            close_para()
            html_lines.append(f"<h2>{inline(ln[3:])}</h2>")
        elif ln.strip() == "---":
            close_para()
            html_lines.append("<hr/>")
        elif ln.strip() == "":
            close_para()
        else:
            if not in_para:
                html_lines.append("<p>")
                in_para = True
            html_lines.append(inline(ln))
    close_para()

    css = """
    body { font-family: Georgia, serif; max-width: 660px;
           margin: 36px auto; padding: 0 32px; color: #1a1a1a;
           line-height: 1.65; font-size: 12pt; }
    h1 { font-size: 24pt; font-family: -apple-system, sans-serif;
         border-bottom: 3px solid #b8860b; padding-bottom: 10px;
         margin-top: 0; }
    h2 { font-size: 14pt; color: #1a1a1a; font-family: -apple-system, sans-serif;
         margin-top: 22px; margin-bottom: 4px;
         background: #fffbe6; padding: 4px 10px;
         border-left: 4px solid #b8860b; }
    p { margin: 4px 0 6px 0; }
    em { color: #555; }
    hr { border: none; border-top: 1px solid #ddd; margin: 18px 0; }
    @page { size: letter; margin: 0.65in; }
    """
    return f"<!DOCTYPE html><html><head><meta charset='utf-8'><style>{css}</style></head><body>" + "\n".join(html_lines) + "</body></html>"


def main():
    md = build_markdown()
    MD_OUT.write_text(md, encoding="utf-8")
    print(f"Wrote {MD_OUT.relative_to(ROOT)}")
    try:
        from weasyprint import HTML
    except ImportError:
        sys.exit("weasyprint not installed.")
    html = _md_to_html(md)
    HTML(string=html).write_pdf(str(PDF_OUT))
    print(f"Wrote {PDF_OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
