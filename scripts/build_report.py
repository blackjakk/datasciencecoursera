"""Regenerate MONEYLEAGUE_2026_REPORT.md and .pdf from current data.

Pulls live state from:
  - data/keepers_2026.json (41 records from MONEY_LEAGUE.xlsx)
  - data/historical_insights.json (retention + post-cap fates)
  - data/position_by_round.json (ROI by round)
  - data/team_tendencies.json (per-team keeper habits)
  - data/sleeper/league_*/ (team names, traded picks, champion history)
  - data/players_2026.csv (projections + ADP)

Renders to PDF via weasyprint (requires `pip install weasyprint`).
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.keepers import Keeper, apply_keepers
from fantasy_draft.draft import Draft
from fantasy_draft.players import load_players
from fantasy_draft.sleeper_offline import league_from_offline
from fantasy_draft.trades import apply_trades, load_trades_from_sleeper_dump
from fantasy_draft.vbd import compute_vbd_post_keepers
from fantasy_draft.keeper_predict import expected_vbd_curve
from fantasy_draft.results import load_all_seasons

ROOT = Path(__file__).resolve().parent.parent
MD_OUT = ROOT / "MONEYLEAGUE_2026_REPORT.md"
PDF_OUT = ROOT / "MONEYLEAGUE_2026_REPORT.pdf"


def _build_keeper_value_table():
    """Compute (player, position, prior_round, forfeit_round, vbd, team_name)
    for each carryover keeper, plus (player, vbd) for the 3 forced-drops."""
    cfg = league_from_offline(str(ROOT / "data" / "sleeper"),
                               round_penalty=2, max_years_consecutive=3)
    players = load_players(str(ROOT / "data" / "players_2026.csv"))
    records = json.loads((ROOT / "data" / "keepers_2026.json").read_text())

    # Resolve team names from rosters + users.
    dump = ROOT / "data" / "sleeper"
    team_names = [f"Team {i+1}" for i in range(cfg.num_teams)]
    for ld in sorted(dump.iterdir()):
        if ld.is_dir() and ld.name.startswith("league_"):
            users = {u["user_id"]: u for u in json.loads((ld / "users.json").read_text())}
            for r in json.loads((ld / "rosters.json").read_text()):
                rid = int(r["roster_id"])
                owner = users.get(r.get("owner_id") or "", {})
                meta = owner.get("metadata") or {}
                nm = meta.get("team_name") or owner.get("display_name") or f"Roster {rid}"
                if 1 <= rid <= cfg.num_teams:
                    team_names[rid - 1] = nm

    # Set up draft, apply trades + keepers, compute VBD post-keepers.
    draft = Draft.new(cfg, team_names=team_names)
    trades = [t for t in load_trades_from_sleeper_dump(str(dump)) if t.season == 2026]
    apply_trades(draft, trades)
    applied = [Keeper(team_idx=int(r["team_idx"]), player_name=r["player_name"],
                       prior_round=int(r["prior_round"]), years_kept=int(r["years_kept"]))
               for r in records]
    apply_keepers(draft, players, applied)
    kept = {p.player.name for p in draft.picks if p.is_keeper and p.player}
    # compute_vbd_post_keepers only assigns vbd to AVAILABLE players (it
    # filters out keepers). We need the replacement projections it returns
    # so we can manually assign post-keeper VBD to the keepers too -- they
    # ARE valuable, just not in the available pool.
    _, replacement_proj = compute_vbd_post_keepers(players, cfg, keeper_names=kept)
    kept_lc = {n.lower() for n in kept}
    for p in players:
        if p.name.lower() in kept_lc:
            p.vbd = p.projection - replacement_proj.get(p.position, 0.0)
    curve = expected_vbd_curve(players, cfg)

    players_by_name = {p.name.lower(): p for p in players}
    carryover, drop_rec, forced = [], [], []
    for r in records:
        p = players_by_name.get(r["player_name"].lower())
        if p is None:
            continue
        forfeit_round = max(1, r["prior_round"] - cfg.keepers.round_penalty)
        repl = curve.get(forfeit_round, 0.0)
        net_vbd = round(p.vbd - repl, 1)
        team_name = team_names[int(r["team_idx"])]
        row = {
            "player": p.name, "position": p.position,
            "prior_round": r["prior_round"], "forfeit_round": forfeit_round,
            "adp": p.adp, "raw_vbd": round(p.vbd, 1),
            "net_vbd": net_vbd, "team": team_name,
            "years_kept": r["years_kept"],
        }
        status = r["status"]
        if status == "carryover":
            carryover.append(row)
        elif status == "drop_recommended":
            drop_rec.append(row)
        else:
            forced.append(row)
    return carryover, drop_rec, forced, team_names, trades, cfg


def _team_vbd_totals(carryover):
    totals = defaultdict(lambda: {"team": "", "n": 0, "vbd": 0.0})
    for k in carryover:
        e = totals[k["team"]]
        e["team"] = k["team"]
        e["n"] += 1
        e["vbd"] += k["net_vbd"]
    return sorted(totals.values(), key=lambda e: -e["vbd"])


def build_markdown() -> str:
    insights = json.loads((ROOT / "data" / "historical_insights.json").read_text())
    pos_data = json.loads((ROOT / "data" / "position_by_round.json").read_text())
    seasons = load_all_seasons(ROOT / "data" / "sleeper")
    carryover, drop_rec, forced, team_names, trades, cfg = _build_keeper_value_table()
    team_totals = _team_vbd_totals(carryover)

    top = sorted(carryover, key=lambda k: -k["net_vbd"])[:8]
    n_carry = len(carryover)
    n_drop = len(forced)

    ret = insights["retention_by_position"]
    dropoff = insights["post_cap_dropoff"]
    fates = dropoff["fates"]
    total_capped = dropoff["total_capped"]
    earlier = fates.get("redrafted_earlier", 0)
    earlier_pct = round(100 * earlier / total_capped, 0) if total_capped else 0

    # Trades summary
    trade_by_team = defaultdict(lambda: {"gained": [], "lost": []})
    for t in trades:
        if t.original_team_idx == t.new_team_idx:
            continue
        new = team_names[t.new_team_idx]
        orig = team_names[t.original_team_idx]
        trade_by_team[new]["gained"].append(f"R{t.round_num}")
        trade_by_team[orig]["lost"].append(f"R{t.round_num}")

    # Champions
    champs = []
    for yr in sorted(seasons):
        s = seasons[yr]
        rid = s.get("champion_roster_id")
        champ = s["rosters"].get(rid, {}).get("team_name", "—") if rid else "—"
        champs.append((yr, champ))

    # Best position per round (top 8 rounds)
    best_per_round = pos_data.get("best_position_per_round", [])[:10]

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines: list[str] = []
    lines.append("# MONEYLEAGUE 2026 — Pre-Draft Snapshot\n")
    lines.append(f"*Generated {now} from `data/*.json` + `MONEY_LEAGUE.xlsx`.*\n")
    lines.append(
        f"**Format:** 12 teams · 17-round superflex · half-PPR · 4 keepers max · "
        f"2-round penalty · 3-year consecutive cap · 11 years of history (since 2015).\n"
    )
    lines.append("---\n")

    # --- Keeper landscape ---
    lines.append("## Keeper landscape\n")
    lines.append(
        f"{n_carry + n_drop} players tagged as keepers in 2025 → **{n_carry} roll "
        f"into 2026** at cost − 2. **{n_drop} yr3 keepers hit the cap** and return "
        f"to the pool:\n"
    )
    lines.append("| Player | Pos | 2026 ADP | VBD | Last team |")
    lines.append("|---|---|---|---|---|")
    for f in sorted(forced, key=lambda x: -x["raw_vbd"]):
        adp = f"{f['adp']:.1f}" if f['adp'] < 999 else "—"
        lines.append(f"| {f['player']} | {f['position']} | {adp} | {f['raw_vbd']:+.1f} | {f['team']} |")
    n_short = sum(1 for t in team_totals if t["n"] < 4)
    lines.append(f"\n{n_short} of 12 teams have **fewer than 4 carryovers** and will "
                 f"fill the remaining slots from the waiver/undrafted pool.\n")
    lines.append("---\n")

    # --- Top keeper values ---
    lines.append("## Top keeper values\n")
    lines.append("Net VBD = player's VBD − expected VBD at the round they cost. Higher = more keeper edge.\n")
    lines.append("| Cost | Player | Pos | Net VBD | Team |")
    lines.append("|---|---|---|---:|---|")
    for k in top:
        lines.append(f"| R{k['forfeit_round']} | {k['player']} | {k['position']} | "
                     f"**{k['net_vbd']:+.1f}** | {k['team']} |")

    lines.append("\n**Team keeper-value totals** (sum of net VBD across carryovers):\n")
    lines.append("| Team | Keepers | VBD total |")
    lines.append("|---|---:|---:|")
    for t in team_totals:
        marker = "**" if t["vbd"] >= 100 or t["vbd"] <= -100 else ""
        lines.append(f"| {t['team']} | {t['n']} | {marker}{t['vbd']:+.1f}{marker} |")
    lines.append("\n---\n")

    # --- Trades ---
    if trades:
        lines.append("## Trade activity (2026 picks)\n")
        n_net = sum(1 for t in trades if t.original_team_idx != t.new_team_idx)
        lines.append(f"{len(trades)} traded picks on file; **{n_net} net moves** after round-trips.\n")
        lines.append("| Team | Gained | Lost |")
        lines.append("|---|---|---|")
        for tname in sorted(trade_by_team):
            g = ", ".join(trade_by_team[tname]["gained"]) or "—"
            l = ", ".join(trade_by_team[tname]["lost"]) or "—"
            lines.append(f"| {tname} | {g} | {l} |")
        lines.append("\n---\n")

    # --- 11-year retention ---
    lines.append("## 11-year retention patterns\n")
    lines.append("Latest-year keepers excluded from the yr1→yr2 column (their fate isn't observable yet).\n")
    lines.append("| Pos | Yr1 → Yr2 | Yr2 → Yr3 | Total cap hits |")
    lines.append("|---|---|---|---:|")
    for pos in ("QB", "RB", "WR", "TE"):
        d = ret[pos]
        y12 = f"{d['yr1_to_yr2_pct']:.0f}% (n={d['yr1_count']})" if d.get('yr1_to_yr2_pct') is not None else "—"
        y23 = f"{d['yr2_to_yr3_pct']:.0f}% (n={d['yr2_count']})" if d.get('yr2_to_yr3_pct') is not None else "—"
        lines.append(f"| {pos} | {y12} | {y23} | {d['hit_cap_count']} |")
    lines.append("")
    lines.append(f"**Post-cap fate:** of the {total_capped} players who hit the 3-year cap "
                 f"across 11 years, **{earlier} ({earlier_pct:.0f}%) were re-drafted EARLIER** the next "
                 f"year — forced drops are typically high-value early-round targets, not discards. "
                 f"({fates.get('redrafted_same_round', 0)} same round, "
                 f"{fates.get('redrafted_later', 0)} later, "
                 f"{fates.get('undrafted_next_year', 0)} undrafted.)\n")
    earlier_rounds = dropoff.get("earlier_round_distribution") or []
    if earlier_rounds:
        median = earlier_rounds[len(earlier_rounds) // 2]
        lines.append(f"Of those re-drafted earlier: min R{earlier_rounds[0]}, "
                     f"median R{median}, max R{earlier_rounds[-1]}.\n")
    lines.append("---\n")

    # --- Position-by-round ROI ---
    lines.append("## Position-by-round ROI (2023-2025)\n")
    lines.append(
        "Mean season fantasy points scored by players drafted at each (round, position) "
        "across the 3 most-recent seasons. Superflex amplifies QB dominance.\n"
    )
    lines.append("| Round | Best position | Mean points | Sample | Advantage |")
    lines.append("|---:|---|---:|---:|---|")
    for b in best_per_round:
        adv = (f"+{b['advantage_over_2nd']:.0f} vs {b['second_best']}"
               if b.get("advantage_over_2nd") and b.get("second_best") else "—")
        lines.append(f"| R{b['round']} | {b['best_position']} | {b['mean_points']:.0f} | "
                     f"n={b['n_samples']} | {adv} |")
    lines.append("\n---\n")

    # --- Champions ---
    lines.append("## Recent champions\n")
    lines.append("| Year | Champion |")
    lines.append("|---:|---|")
    for yr, ch in champs:
        lines.append(f"| {yr} | 🏆 {ch} |")
    lines.append("\n---\n")

    # --- What to expect ---
    lines.append("## What to expect on draft day\n")
    top_carryover = max(carryover, key=lambda k: k["net_vbd"])
    qb_y2_y3 = ret["QB"].get("yr2_to_yr3_pct") or 0
    lines.append(
        f"- **Round 1 board after keepers:** Bijan Robinson, Jahmyr Gibbs, "
        f"Ja'Marr Chase, Christian McCaffrey, Jonathan Taylor lead the available "
        f"pool — top WR/TE keepers like {top_carryover['player']} won't be there.\n"
        f"- **QB cliff in superflex:** {qb_y2_y3:.0f}% of yr2 QB keepers get held to "
        f"yr3 (highest position retention) AND best-position-per-round shows QBs "
        f"winning every round 1-10 in this league's data. Expect QBs to fly early.\n"
        f"- **Forced-drop targets:** {earlier_pct:.0f}% of capped players come back EARLIER "
        f"the next year. The 3 forced-drop QBs (Geno Smith, Brock Purdy, Jordan Love) "
        f"are exactly this archetype — plan to take them well before R11.\n"
        f"- **Draft order TBD:** Sleeper hadn't assigned 2026 draft slots as of this "
        f"report. ADP will swing hard depending on who gets the kylefiggy / Chester "
        f"A. Arthur acquired picks.\n"
    )
    return "\n".join(lines)


def md_to_html(md: str) -> str:
    """Tiny markdown -> HTML converter (covers headers, tables, paras, bold,
    italics, hrs, lists). Avoids adding a markdown dependency."""
    import html as _html
    import re

    lines = md.split("\n")
    out: list[str] = []
    in_table = False
    in_list = False
    table_buf: list[str] = []

    def flush_table():
        if not table_buf:
            return
        # First line is header, second is separator, rest are rows.
        rows = [r for r in table_buf if not re.match(r'^\s*\|[\s\-:|]+\|\s*$', r)]
        if not rows:
            table_buf.clear()
            return
        hdr_cells = [c.strip() for c in rows[0].strip().strip('|').split('|')]
        body_rows = rows[1:]
        out.append("<table>")
        out.append("<thead><tr>" + "".join(f"<th>{_inline(c)}</th>" for c in hdr_cells) + "</tr></thead>")
        out.append("<tbody>")
        for r in body_rows:
            cells = [c.strip() for c in r.strip().strip('|').split('|')]
            out.append("<tr>" + "".join(f"<td>{_inline(c)}</td>" for c in cells) + "</tr>")
        out.append("</tbody></table>")
        table_buf.clear()

    def _inline(s: str) -> str:
        s = _html.escape(s)
        s = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', s)
        s = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)', r'<em>\1</em>', s)
        s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
        return s

    for line in lines:
        if line.startswith('|'):
            table_buf.append(line)
            continue
        else:
            flush_table()
        if not line.strip():
            if in_list:
                out.append("</ul>")
                in_list = False
            continue
        if line.startswith('# '):
            out.append(f"<h1>{_inline(line[2:].strip())}</h1>")
        elif line.startswith('## '):
            out.append(f"<h2>{_inline(line[3:].strip())}</h2>")
        elif line.startswith('### '):
            out.append(f"<h3>{_inline(line[4:].strip())}</h3>")
        elif line.startswith('---'):
            out.append("<hr/>")
        elif line.startswith('- '):
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append(f"<li>{_inline(line[2:].strip())}</li>")
        else:
            if in_list:
                out.append("</ul>")
                in_list = False
            out.append(f"<p>{_inline(line.strip())}</p>")
    flush_table()
    if in_list:
        out.append("</ul>")
    body = "\n".join(out)
    css = """
    @page { size: letter; margin: 0.5in; }
    body { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
           font-size: 9.5pt; line-height: 1.35; color: #222; }
    h1 { font-size: 18pt; margin: 0 0 0.2em 0; border-bottom: 2px solid #222; padding-bottom: 0.2em; }
    h2 { font-size: 12pt; margin: 0.8em 0 0.3em 0; color: #1a4d8a; }
    h3 { font-size: 10.5pt; margin: 0.5em 0 0.2em 0; }
    p { margin: 0 0 0.45em 0; }
    table { border-collapse: collapse; width: 100%; margin: 0.3em 0 0.5em 0; font-size: 9pt; }
    th, td { border: 1px solid #ccc; padding: 3px 6px; text-align: left; }
    th { background: #eef3f9; font-weight: 600; }
    td:last-child, th:last-child { text-align: right; }
    code { background: #f3f3f3; padding: 0 3px; border-radius: 2px; font-size: 8.5pt; }
    hr { border: 0; border-top: 1px solid #ddd; margin: 0.6em 0; }
    ul { margin: 0.3em 0 0.5em 1.4em; padding: 0; }
    li { margin: 0.15em 0; }
    em { color: #555; }
    """
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>{css}</style></head><body>{body}</body></html>"""


def main() -> None:
    md = build_markdown()
    MD_OUT.write_text(md)
    print(f"Wrote {MD_OUT.relative_to(ROOT)} ({len(md)} chars)")

    try:
        from weasyprint import HTML
    except ImportError:
        sys.exit("weasyprint not installed -- `pip install weasyprint` to render PDF.")
    html = md_to_html(md)
    HTML(string=html).write_pdf(str(PDF_OUT))
    size_kb = PDF_OUT.stat().st_size / 1024
    print(f"Wrote {PDF_OUT.relative_to(ROOT)} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
